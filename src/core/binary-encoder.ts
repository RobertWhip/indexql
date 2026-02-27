/**
 * Binary column layout (IQBN format):
 *   HEADER   [0-3]  magic "IQBN"
 *            [4]    version 0x01
 *            [5-8]  num_items  uint32 LE
 *            [9]    num_columns   uint8
 *   COLUMN DESCRIPTORS (per column):
 *            uint8  name_len
 *            bytes  name  (UTF-8)
 *            uint8  type_code  (1=Bool, 2=Int, 3=Float)
 *            uint8  bits  (8|16|32|64)
 *   DATA (column-major, little-endian):
 *            Per column c: N × (bits_c / 8) bytes
 */

import { Entity } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ColumnMeta {
  name:     string;
  typeName: string;
  bits:     number;
}

const MAGIC_BYTES = [0x49, 0x51, 0x42, 0x4E]; // "IQBN" in ASCII
const VERSION = 0x01;

// type_code values
const TYPE_BOOL  = 1;
const TYPE_INT   = 2;
const TYPE_FLOAT = 3;

function typeCode(typeName: string): number {
  if (typeName === 'Bool')          return TYPE_BOOL;
  if (typeName.startsWith('Float')) return TYPE_FLOAT;
  if (typeName.startsWith('Int'))   return TYPE_INT;
  throw new Error(`Unknown binary type: ${typeName}`);
}

// ── Encode ────────────────────────────────────────────────────────────────────

/**
 * Encode numeric/bool columns to a binary Buffer.
 * Each column is written column-major (all rows of column 0, then column 1, …).
 */
export function encodeColumns(items: Entity[], columns: ColumnMeta[]): Buffer {
  const N = items.length;

  // Build header
  const headerSize = 4 + 1 + 4 + 1; // magic + version + num_items + num_columns
  const descParts: Buffer[] = [];
  for (const col of columns) {
    const nameBytes = Buffer.from(col.name, 'utf8');
    const desc = Buffer.allocUnsafe(1 + nameBytes.length + 1 + 1);
    let o = 0;
    desc.writeUInt8(nameBytes.length, o++);
    nameBytes.copy(desc, o); o += nameBytes.length;
    desc.writeUInt8(typeCode(col.typeName), o++);
    desc.writeUInt8(col.bits, o++);
    descParts.push(desc);
  }

  // Data section sizes
  const dataSizes = columns.map(c => N * (c.bits / 8));
  const totalData = dataSizes.reduce((s, n) => s + n, 0);

  const descBuffer = Buffer.concat(descParts);
  const total = headerSize + descBuffer.length + totalData;
  const buf = Buffer.allocUnsafe(total);

  // Write header
  let pos = 0;
  for (let i = 0; i < 4; i++) buf[pos++] = MAGIC_BYTES[i];
  buf.writeUInt8(VERSION, pos++);
  buf.writeUInt32LE(N, pos); pos += 4;
  buf.writeUInt8(columns.length, pos++);

  // Write descriptors
  descBuffer.copy(buf, pos); pos += descBuffer.length;

  // Write data columns
  for (let ci = 0; ci < columns.length; ci++) {
    const col   = columns[ci];
    const bytes = col.bits / 8;
    for (let ri = 0; ri < N; ri++) {
      const raw = items[ri][col.name];
      const dv  = new DataView(buf.buffer, buf.byteOffset + pos, bytes);
      writeValue(dv, col, raw);
      pos += bytes;
    }
  }

  return buf;
}

function writeValue(dv: DataView, col: ColumnMeta, raw: unknown): void {
  const tc = typeCode(col.typeName);
  if (tc === TYPE_BOOL) {
    dv.setUint8(0, raw === true ? 1 : 0);
  } else if (tc === TYPE_FLOAT) {
    const v = Number(raw ?? 0);
    if (col.bits === 32)      dv.setFloat32(0, v, true);
    else                      dv.setFloat64(0, v, true);
  } else {
    // INT / Bool treated as int
    if (col.bits === 8)       dv.setInt8(0,  Math.round(Number(raw ?? 0)));
    else if (col.bits === 16) dv.setInt16(0, Math.round(Number(raw ?? 0)), true);
    else if (col.bits === 32) dv.setInt32(0, Math.round(Number(raw ?? 0)), true);
    else {
      // Int64: BigInt
      const n = Number(raw ?? 0);
      dv.setBigInt64(0, BigInt(Math.round(n)), true);
    }
  }
}

// ── Decode ────────────────────────────────────────────────────────────────────

export interface DecodedColumns {
  meta:        ColumnMeta[];
  numRows:     number;
  /** Read the value at (col index, row index). */
  getValue:    (col: number, row: number) => number | boolean | bigint;
  /** Byte offset where column data starts (after all descriptors). */
  dataOffset:  number;
}

/**
 * Parse the header + descriptors from a binary buffer.
 * Returns random-access helpers.
 */
export function decodeColumns(buf: Buffer): DecodedColumns {
  // Read header
  const magic = buf.slice(0, 4).toString('ascii');
  if (magic !== 'IQBN') throw new Error(`Invalid magic bytes: ${magic}`);
  const version = buf.readUInt8(4);
  if (version !== VERSION) throw new Error(`Unsupported version: ${version}`);
  const numRows    = buf.readUInt32LE(5);
  const numColumns = buf.readUInt8(9);

  // Read descriptors
  let pos = 10;
  const meta: ColumnMeta[] = [];
  const tcodes: number[] = [];
  for (let ci = 0; ci < numColumns; ci++) {
    const nameLen  = buf.readUInt8(pos++);
    const name     = buf.slice(pos, pos + nameLen).toString('utf8'); pos += nameLen;
    const tc       = buf.readUInt8(pos++);
    const bits     = buf.readUInt8(pos++);
    tcodes.push(tc);
    // Reconstruct typeName from type_code + bits
    let typeName: string;
    if      (tc === TYPE_BOOL)  typeName = 'Bool';
    else if (tc === TYPE_FLOAT) typeName = bits === 32 ? 'Float32' : 'Float64';
    else    typeName = bits === 8 ? 'Int8' : bits === 16 ? 'Int16' : bits === 32 ? 'Int32' : 'Int64';
    meta.push({ name, typeName, bits });
  }

  const dataOffset = pos;

  // Compute column data offsets
  const colOffsets: number[] = [];
  let acc = dataOffset;
  for (const col of meta) {
    colOffsets.push(acc);
    acc += numRows * (col.bits / 8);
  }

  function getValue(ci: number, ri: number): number | boolean | bigint {
    const col   = meta[ci];
    const bytes = col.bits / 8;
    const off   = colOffsets[ci] + ri * bytes;
    const dv    = new DataView(buf.buffer, buf.byteOffset + off, bytes);
    const tc    = tcodes[ci];
    if (tc === TYPE_BOOL)  return dv.getUint8(0) !== 0;
    if (tc === TYPE_FLOAT) return col.bits === 32 ? dv.getFloat32(0, true) : dv.getFloat64(0, true);
    if (col.bits === 8)    return dv.getInt8(0);
    if (col.bits === 16)   return dv.getInt16(0, true);
    if (col.bits === 32)   return dv.getInt32(0, true);
    return dv.getBigInt64(0, true);
  }

  return { meta, numRows, getValue, dataOffset };
}

// ── Browser-compatible decode (ArrayBuffer) ──────────────────────────────────

export interface DecodedColumnsAB {
  meta:       ColumnMeta[];
  numRows:    number;
  getValue:   (col: number, row: number) => number | boolean | bigint;
  dataOffset: number;
}

/**
 * Parse IQBN binary from an ArrayBuffer (browser-safe, no Node Buffer).
 * Same interface as decodeColumns but works with fetch().arrayBuffer().
 */
export function decodeColumnsFromArrayBuffer(ab: ArrayBuffer): DecodedColumnsAB {
  const dv    = new DataView(ab);
  const bytes = new Uint8Array(ab);

  // Header
  const m0 = bytes[0], m1 = bytes[1], m2 = bytes[2], m3 = bytes[3];
  if (m0 !== 73 || m1 !== 81 || m2 !== 66 || m3 !== 78) { // "IQBN"
    throw new Error('Invalid magic bytes');
  }
  const version = bytes[4];
  if (version !== VERSION) throw new Error(`Unsupported version: ${version}`);
  const numRows    = dv.getUint32(5, true);
  const numColumns = bytes[9];

  // Descriptors
  let pos = 10;
  const meta: ColumnMeta[] = [];
  const tcodes: number[] = [];
  for (let ci = 0; ci < numColumns; ci++) {
    const nameLen = bytes[pos++];
    let name = '';
    for (let j = 0; j < nameLen; j++) name += String.fromCharCode(bytes[pos++]);
    const tc   = bytes[pos++];
    const bits = bytes[pos++];
    tcodes.push(tc);
    let typeName: string;
    if      (tc === TYPE_BOOL)  typeName = 'Bool';
    else if (tc === TYPE_FLOAT) typeName = bits === 32 ? 'Float32' : 'Float64';
    else    typeName = bits === 8 ? 'Int8' : bits === 16 ? 'Int16' : bits === 32 ? 'Int32' : 'Int64';
    meta.push({ name, typeName, bits });
  }

  const dataOffset = pos;
  const colOffsets: number[] = [];
  let acc = dataOffset;
  for (const col of meta) {
    colOffsets.push(acc);
    acc += numRows * (col.bits / 8);
  }

  function getValue(ci: number, ri: number): number | boolean | bigint {
    const col      = meta[ci];
    const byteSize = col.bits / 8;
    const off      = colOffsets[ci] + ri * byteSize;
    const tc       = tcodes[ci];
    if (tc === TYPE_BOOL)  return dv.getUint8(off) !== 0;
    if (tc === TYPE_FLOAT) return col.bits === 32 ? dv.getFloat32(off, true) : dv.getFloat64(off, true);
    if (col.bits === 8)    return dv.getInt8(off);
    if (col.bits === 16)   return dv.getInt16(off, true);
    if (col.bits === 32)   return dv.getInt32(off, true);
    return dv.getBigInt64(off, true);
  }

  return { meta, numRows, getValue, dataOffset };
}

// ── Reconstruct ───────────────────────────────────────────────────────────────

/**
 * Reconstruct Entity[] from a binary buffer (IQBN format).
 * Node-only (uses Buffer). For browser contexts use reconstructFromArrayBuffer.
 * @param buf  *.bin Buffer (IQBN format)
 */
export function reconstruct(buf: Buffer): Entity[] {
  const { meta, numRows, getValue } = decodeColumns(buf);

  const items: Entity[] = [];
  for (let ri = 0; ri < numRows; ri++) {
    const obj: Record<string, unknown> = {};
    for (let ci = 0; ci < meta.length; ci++) {
      const col = meta[ci];
      const val = getValue(ci, ri);
      obj[col.name] = col.typeName === 'Bool' ? Boolean(val) : Number(val);
    }
    items.push(obj as Entity);
  }
  return items;
}

/**
 * Reconstruct Entity[] from an IQBN ArrayBuffer.
 * Browser-safe (no Node Buffer). Use this in frontend code.
 * @param ab  IQBN ArrayBuffer (e.g. from fetch().arrayBuffer())
 */
export function reconstructFromArrayBuffer(ab: ArrayBuffer): Entity[] {
  const { meta, numRows, getValue } = decodeColumnsFromArrayBuffer(ab);

  const items: Entity[] = new Array(numRows);
  for (let ri = 0; ri < numRows; ri++) {
    const obj: Record<string, unknown> = {};
    for (let ci = 0; ci < meta.length; ci++) {
      const col = meta[ci];
      const val = getValue(ci, ri);
      obj[col.name] = col.typeName === 'Bool' ? Boolean(val) : Number(val);
    }
    items[ri] = obj as Entity;
  }
  return items;
}
