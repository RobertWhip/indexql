/**
 * Delta wire format (sparse columns, varint-encoded).
 *
 * HEADER (8 bytes):
 *   [0-1]   magic   0xDF01 (LE)
 *   [2]     version 0x01
 *   [3-6]   seq     uint32 LE (monotonic sequence number)
 *   [7]     flags   (bit 0: has_upserts, bit 1: has_deletes)
 *
 * UPSERT SECTION (if flags & 0x01):
 *   upsert_count:  varint
 *   Per upsert:
 *     key:         varint_zigzag
 *     col_mask:    ceil(num_columns / 8) bytes
 *     For each set bit i: value bytes (native encoding per column type)
 *
 * DELETE SECTION (if flags & 0x02):
 *   delete_count:  varint
 *   first_key:     varint_zigzag
 *   Subsequent:    varint (positive diff from previous key, keys sorted ascending)
 */

import { Entity } from './types';
import type { ColumnMeta } from './binary-encoder';
import type { DeltaPacket, DeltaUpsert } from './columnar-store';

// ── Constants ─────────────────────────────────────────────────────────────────

const DELTA_MAGIC   = 0xDF01;
const DELTA_VERSION = 0x01;
const FLAG_UPSERTS  = 0x01;
const FLAG_DELETES  = 0x02;

// ── Varint (unsigned LEB128) ──────────────────────────────────────────────────

function varintEncode(value: number, out: number[]): void {
  value = value >>> 0; // ensure unsigned 32-bit
  while (value >= 0x80) {
    out.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  out.push(value);
}

function varintDecode(dv: DataView, offset: { pos: number }): number {
  let result = 0;
  let shift  = 0;
  while (true) {
    const byte = dv.getUint8(offset.pos++);
    result |= (byte & 0x7F) << shift;
    shift += 7;
    if (byte < 0x80) break;
  }
  return result >>> 0;
}

// ── Zigzag (signed → unsigned) ────────────────────────────────────────────────

function zigzagEncode(n: number): number {
  return (n << 1) ^ (n >> 31);
}

function zigzagDecode(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}

// ── Value read/write helpers ──────────────────────────────────────────────────

function writeValueToBytes(out: number[], col: ColumnMeta, value: number | boolean): void {
  const buf = new ArrayBuffer(8);
  const dv  = new DataView(buf);

  if (col.typeName === 'Bool') {
    out.push(value ? 1 : 0);
    return;
  }

  const v = Number(value);
  switch (col.typeName) {
    case 'Int8':
      dv.setInt8(0, Math.round(v));
      out.push(new Uint8Array(buf, 0, 1)[0]);
      break;
    case 'Int16':
      dv.setInt16(0, Math.round(v), true);
      for (let i = 0; i < 2; i++) out.push(new Uint8Array(buf)[i]);
      break;
    case 'Int32':
      dv.setInt32(0, Math.round(v), true);
      for (let i = 0; i < 4; i++) out.push(new Uint8Array(buf)[i]);
      break;
    case 'Float32':
      dv.setFloat32(0, v, true);
      for (let i = 0; i < 4; i++) out.push(new Uint8Array(buf)[i]);
      break;
    case 'Float64':
    case 'Int64':
      dv.setFloat64(0, v, true);
      for (let i = 0; i < 8; i++) out.push(new Uint8Array(buf)[i]);
      break;
  }
}

function readValue(dv: DataView, offset: { pos: number }, col: ColumnMeta): number | boolean {
  const pos = offset.pos;

  if (col.typeName === 'Bool') {
    offset.pos += 1;
    return dv.getUint8(pos) !== 0;
  }

  const bytes = col.bits / 8;
  offset.pos += bytes;

  switch (col.typeName) {
    case 'Int8':    return dv.getInt8(pos);
    case 'Int16':   return dv.getInt16(pos, true);
    case 'Int32':   return dv.getInt32(pos, true);
    case 'Float32': return dv.getFloat32(pos, true);
    case 'Float64':
    case 'Int64':   return dv.getFloat64(pos, true);
    default: throw new Error(`Unknown type: ${col.typeName}`);
  }
}

// ── Encode ────────────────────────────────────────────────────────────────────

/**
 * Encode a delta packet to binary.
 * Uses sparse column bitmask per upsert row and delta-coded delete keys.
 */
export function encodeDelta(packet: DeltaPacket, meta: ColumnMeta[]): Buffer {
  const out: number[] = [];
  const colMaskBytes = Math.ceil(meta.length / 8);

  // Header (8 bytes)
  out.push(DELTA_MAGIC & 0xFF, (DELTA_MAGIC >> 8) & 0xFF);  // magic LE
  out.push(DELTA_VERSION);

  // seq (4 bytes LE)
  const seqBuf = new ArrayBuffer(4);
  new DataView(seqBuf).setUint32(0, packet.seq, true);
  const seqBytes = new Uint8Array(seqBuf);
  for (let i = 0; i < 4; i++) out.push(seqBytes[i]);

  // flags
  let flags = 0;
  if (packet.upserts.length > 0) flags |= FLAG_UPSERTS;
  if (packet.deletes.length > 0) flags |= FLAG_DELETES;
  out.push(flags);

  // Upsert section
  if (flags & FLAG_UPSERTS) {
    varintEncode(packet.upserts.length, out);

    for (const u of packet.upserts) {
      // Key (zigzag + varint)
      varintEncode(zigzagEncode(u.key), out);

      // Column bitmask
      const mask = new Uint8Array(colMaskBytes);
      for (const colIdx of u.values.keys()) {
        mask[colIdx >>> 3] |= (1 << (colIdx & 7));
      }
      for (let i = 0; i < colMaskBytes; i++) out.push(mask[i]);

      // Values for set bits, in column order
      for (let ci = 0; ci < meta.length; ci++) {
        if (mask[ci >>> 3] & (1 << (ci & 7))) {
          writeValueToBytes(out, meta[ci], u.values.get(ci)!);
        }
      }
    }
  }

  // Delete section (sorted, delta-coded)
  if (flags & FLAG_DELETES) {
    const sorted = [...packet.deletes].sort((a, b) => a - b);
    varintEncode(sorted.length, out);

    // First key: zigzag varint
    varintEncode(zigzagEncode(sorted[0]), out);

    // Subsequent: positive diffs as varint
    for (let i = 1; i < sorted.length; i++) {
      varintEncode(sorted[i] - sorted[i - 1], out);
    }
  }

  return Buffer.from(out);
}

// ── Decode (shared logic for Buffer and ArrayBuffer) ──────────────────────────

function decodeFromDataView(dv: DataView, meta: ColumnMeta[]): DeltaPacket {
  const colMaskBytes = Math.ceil(meta.length / 8);

  // Header
  const magic = dv.getUint16(0, true);
  if (magic !== DELTA_MAGIC) throw new Error(`Invalid delta magic: 0x${magic.toString(16)}`);
  const version = dv.getUint8(2);
  if (version !== DELTA_VERSION) throw new Error(`Unsupported delta version: ${version}`);
  const seq   = dv.getUint32(3, true);
  const flags = dv.getUint8(7);

  const offset = { pos: 8 };
  const upserts: DeltaUpsert[] = [];
  const deletes: number[] = [];

  // Upsert section
  if (flags & FLAG_UPSERTS) {
    const count = varintDecode(dv, offset);

    for (let u = 0; u < count; u++) {
      const key = zigzagDecode(varintDecode(dv, offset));
      const values = new Map<number, number | boolean>();

      // Read column bitmask
      const maskStart = offset.pos;
      offset.pos += colMaskBytes;

      // Read values for set bits
      for (let ci = 0; ci < meta.length; ci++) {
        const maskByte = dv.getUint8(maskStart + (ci >>> 3));
        if (maskByte & (1 << (ci & 7))) {
          values.set(ci, readValue(dv, offset, meta[ci]));
        }
      }

      upserts.push({ key, values });
    }
  }

  // Delete section
  if (flags & FLAG_DELETES) {
    const count = varintDecode(dv, offset);

    let prevKey = zigzagDecode(varintDecode(dv, offset));
    deletes.push(prevKey);

    for (let i = 1; i < count; i++) {
      prevKey += varintDecode(dv, offset);
      deletes.push(prevKey);
    }
  }

  return { seq, upserts, deletes };
}

/**
 * Decode a delta from a Node Buffer.
 * Client must provide the column metadata (known from initial snapshot schema).
 */
export function decodeDelta(buf: Buffer, meta: ColumnMeta[]): DeltaPacket {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return decodeFromDataView(new DataView(ab), meta);
}

/**
 * Decode a delta from an ArrayBuffer (browser-safe).
 */
export function decodeDeltaFromArrayBuffer(ab: ArrayBuffer, meta: ColumnMeta[]): DeltaPacket {
  return decodeFromDataView(new DataView(ab), meta);
}

// ── Compute delta (snapshot diff utility) ─────────────────────────────────────

/**
 * Compute a delta by diffing two Entity[] snapshots.
 * This is a build-time / utility function — NOT the hot path.
 * For production, use server-side MutationTracker to emit deltas directly.
 */
export function computeDelta(
  oldItems:  Entity[],
  newItems:  Entity[],
  meta:      ColumnMeta[],
  keyColumn: string,
): DeltaPacket {
  const keyColIndex = meta.findIndex(c => c.name === keyColumn);
  if (keyColIndex === -1) throw new Error(`Key column "${keyColumn}" not in meta`);

  const oldMap = new Map<number, Entity>();
  for (const item of oldItems) oldMap.set(Number(item[keyColumn]), item);

  const newMap = new Map<number, Entity>();
  for (const item of newItems) newMap.set(Number(item[keyColumn]), item);

  const upserts: DeltaUpsert[] = [];

  for (const [key, newItem] of newMap) {
    const oldItem = oldMap.get(key);
    const values  = new Map<number, number | boolean>();

    if (!oldItem) {
      // New row: include all columns
      for (let ci = 0; ci < meta.length; ci++) {
        const col = meta[ci];
        const val = newItem[col.name];
        values.set(ci, col.typeName === 'Bool' ? Boolean(val) : Number(val ?? 0));
      }
      upserts.push({ key, values });
    } else {
      // Existing row: only changed columns (sparse)
      for (let ci = 0; ci < meta.length; ci++) {
        const col = meta[ci];
        const oldVal = col.typeName === 'Bool' ? Boolean(oldItem[col.name]) : Number(oldItem[col.name] ?? 0);
        const newVal = col.typeName === 'Bool' ? Boolean(newItem[col.name]) : Number(newItem[col.name] ?? 0);
        if (oldVal !== newVal) {
          values.set(ci, newVal);
        }
      }
      if (values.size > 0) upserts.push({ key, values });
    }
  }

  const deletes: number[] = [];
  for (const key of oldMap.keys()) {
    if (!newMap.has(key)) deletes.push(key);
  }

  return { seq: 0, upserts, deletes };
}
