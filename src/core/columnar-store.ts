/**
 * Slotted columnar store with tombstone bitvector and free-list.
 *
 * - One TypedArray per binary column, all length = capacity
 * - keyMap: entity_key → slot_index (persistent, O(1) lookup)
 * - tombstone: bitvector, bit=1 → deleted
 * - freeList: stack of reusable slot indices
 * - liveIndex: cached dense array of non-tombstoned slots (lazy, rebuilt per generation)
 * - entities: cached Entity[] materialization (lazy, rebuilt per generation)
 */

import { Entity, DeltaApplyResult } from './types';
import type { ColumnMeta } from './binary-encoder';

// ── Types ─────────────────────────────────────────────────────────────────────

type StoreArray = Int8Array | Uint8Array | Int16Array | Int32Array | Float32Array | Float64Array;

export interface DeltaUpsert {
  key:    number;
  /** Column index → value. Only changed columns. */
  values: Map<number, number | boolean>;
}

export interface DeltaPacket {
  seq:     number;
  upserts: DeltaUpsert[];
  deletes: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nextPowerOf2(n: number): number {
  let v = Math.ceil(n);
  v--;
  v |= v >> 1; v |= v >> 2; v |= v >> 4; v |= v >> 8; v |= v >> 16;
  return v + 1;
}

function createTypedArray(typeName: string, length: number): StoreArray {
  switch (typeName) {
    case 'Bool':    return new Uint8Array(length);
    case 'Int8':    return new Int8Array(length);
    case 'Int16':   return new Int16Array(length);
    case 'Int32':   return new Int32Array(length);
    case 'Float32': return new Float32Array(length);
    case 'Float64': return new Float64Array(length);
    case 'Int64':   return new Float64Array(length); // JS number precision limit
    default: throw new Error(`Unknown column type: ${typeName}`);
  }
}

function copyTypedArray(src: StoreArray, newLength: number): StoreArray {
  const dst = createTypedArray(resolveTypeName(src), newLength);
  (dst as any).set(src);
  return dst;
}

function resolveTypeName(arr: StoreArray): string {
  if (arr instanceof Uint8Array)    return 'Bool';
  if (arr instanceof Int8Array)     return 'Int8';
  if (arr instanceof Int16Array)    return 'Int16';
  if (arr instanceof Int32Array)    return 'Int32';
  if (arr instanceof Float32Array)  return 'Float32';
  if (arr instanceof Float64Array)  return 'Float64';
  return 'Float64';
}

// ── ColumnarStore ─────────────────────────────────────────────────────────────

export class ColumnarStore {
  readonly meta: ColumnMeta[];
  readonly keyColumnName: string;
  readonly keyColumnIndex: number;

  private _columns:    StoreArray[];
  private _keyMap:     Map<number, number>;
  private _tombstone:  Uint32Array;
  private _freeList:   number[];
  private _capacity:   number;
  private _liveCount:  number;
  private _nextSlot:   number;
  private _generation: number;
  private _lastSeq:    number;

  // Cached lazy views
  private _liveIndex?:    Uint32Array;
  private _liveIndexGen:  number = -1;
  private _entities?:     Entity[];
  private _entitiesGen:   number = -1;

  private constructor(meta: ColumnMeta[], keyColumnName: string, capacity: number) {
    this.meta          = meta;
    this.keyColumnName = keyColumnName;
    this.keyColumnIndex = meta.findIndex(c => c.name === keyColumnName);
    if (this.keyColumnIndex === -1) throw new Error(`Key column "${keyColumnName}" not found in meta`);

    this._capacity   = capacity;
    this._keyMap     = new Map();
    this._tombstone  = new Uint32Array(Math.ceil(capacity / 32));
    this._freeList   = [];
    this._liveCount  = 0;
    this._nextSlot   = 0;
    this._generation = 0;
    this._lastSeq    = 0;

    this._columns = meta.map(col => createTypedArray(col.typeName, capacity));
  }

  // ── Factory ─────────────────────────────────────────────────────────────────

  /**
   * Build a store from Entity[] (e.g. from reconstruct()).
   * O(n × c) where n = items, c = columns.
   */
  static fromEntities(items: Entity[], meta: ColumnMeta[], keyColumnName: string): ColumnarStore {
    const capacity = nextPowerOf2(Math.ceil(Math.max(items.length, 1) * 1.25));
    const store = new ColumnarStore(meta, keyColumnName, capacity);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key  = Number(item[keyColumnName]);
      store._keyMap.set(key, i);

      for (let ci = 0; ci < meta.length; ci++) {
        const col = meta[ci];
        const arr = store._columns[ci];
        const val = item[col.name];
        if (col.typeName === 'Bool') {
          (arr as Uint8Array)[i] = val ? 1 : 0;
        } else {
          (arr as any)[i] = Number(val ?? 0);
        }
      }
    }

    store._nextSlot  = items.length;
    store._liveCount = items.length;
    return store;
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  get liveCount():  number { return this._liveCount; }
  get generation(): number { return this._generation; }
  get lastSeq():    number { return this._lastSeq; }

  // ── Tombstone bitvector ─────────────────────────────────────────────────────

  private tbTest(i: number): boolean {
    return (this._tombstone[i >>> 5] & (1 << (i & 31))) !== 0;
  }

  private tbSet(i: number): void {
    this._tombstone[i >>> 5] |= (1 << (i & 31));
  }

  private tbClear(i: number): void {
    this._tombstone[i >>> 5] &= ~(1 << (i & 31));
  }

  // ── Capacity management ─────────────────────────────────────────────────────

  private grow(newCapacity: number): void {
    for (let ci = 0; ci < this._columns.length; ci++) {
      this._columns[ci] = copyTypedArray(this._columns[ci], newCapacity);
    }
    const newTombstone = new Uint32Array(Math.ceil(newCapacity / 32));
    newTombstone.set(this._tombstone);
    this._tombstone = newTombstone;
    this._capacity  = newCapacity;
  }

  // ── Delta apply — O(k + d) ─────────────────────────────────────────────────

  /**
   * Apply a decoded delta packet. All operations are O(1) per affected row.
   * Returns merge statistics.
   */
  applyDelta(packet: DeltaPacket): DeltaApplyResult {
    const t0 = performance.now();

    // Idempotency: skip if already applied
    if (packet.seq > 0 && packet.seq <= this._lastSeq) {
      return { inserted: 0, updated: 0, deleted: 0, totalAfter: this._liveCount, timingMs: performance.now() - t0 };
    }

    let inserted = 0;
    let updated  = 0;
    let deleted  = 0;

    // Step 1: Deletes — O(d)
    for (const key of packet.deletes) {
      const slot = this._keyMap.get(key);
      if (slot === undefined) continue;
      this._keyMap.delete(key);
      this.tbSet(slot);
      this._freeList.push(slot);
      this._liveCount--;
      deleted++;
    }

    // Step 2: Ensure capacity for new inserts
    let newInsertCount = 0;
    for (const u of packet.upserts) {
      if (!this._keyMap.has(u.key)) newInsertCount++;
    }
    const needed = this._nextSlot + Math.max(0, newInsertCount - this._freeList.length);
    if (needed > this._capacity) {
      this.grow(nextPowerOf2(Math.ceil(needed * 1.25)));
    }

    // Step 3: Upserts — O(k × changed_cols)
    for (const u of packet.upserts) {
      let slot = this._keyMap.get(u.key);

      if (slot === undefined) {
        // New row: allocate slot
        slot = this._freeList.length > 0 ? this._freeList.pop()! : this._nextSlot++;
        this._keyMap.set(u.key, slot);
        this.tbClear(slot);
        // Write key to key column
        (this._columns[this.keyColumnIndex] as any)[slot] = u.key;
        this._liveCount++;
        inserted++;
      } else {
        updated++;
      }

      // Write only changed columns — O(changed_cols)
      for (const [colIdx, value] of u.values) {
        const col = this.meta[colIdx];
        const arr = this._columns[colIdx];
        if (col.typeName === 'Bool') {
          (arr as Uint8Array)[slot] = value ? 1 : 0;
        } else {
          (arr as any)[slot] = Number(value);
        }
      }
    }

    // Step 4: Advance state
    if (packet.seq > 0) this._lastSeq = packet.seq;
    this._generation++;

    // Invalidate caches
    this._liveIndex = undefined;
    this._entities  = undefined;

    return {
      inserted,
      updated,
      deleted,
      totalAfter: this._liveCount,
      timingMs:   performance.now() - t0,
    };
  }

  // ── Live index — O(capacity) once per generation ────────────────────────────

  ensureLiveIndex(): Uint32Array {
    if (this._liveIndex && this._liveIndexGen === this._generation) {
      return this._liveIndex;
    }

    const idx = new Uint32Array(this._liveCount);
    let w = 0;
    for (let i = 0; i < this._nextSlot; i++) {
      if (!this.tbTest(i)) idx[w++] = i;
    }
    this._liveIndex    = idx.subarray(0, w);
    this._liveIndexGen = this._generation;
    return this._liveIndex;
  }

  // ── Entity materialization — cached per generation ──────────────────────────

  /**
   * Materialize Entity[] from columnar data. Cached by generation —
   * only rebuilt once per delta apply. Queries use this.
   */
  toEntities(): Entity[] {
    if (this._entities && this._entitiesGen === this._generation) {
      return this._entities;
    }

    const liveIndex = this.ensureLiveIndex();
    const entities: Entity[] = new Array(liveIndex.length);

    for (let i = 0; i < liveIndex.length; i++) {
      entities[i] = this.readRow(liveIndex[i]);
    }

    this._entities    = entities;
    this._entitiesGen = this._generation;
    return this._entities;
  }

  /**
   * Read a single row by slot index. Returns an Entity with binary columns only.
   */
  readRow(slot: number): Entity {
    const obj: Record<string, unknown> = {};
    for (let ci = 0; ci < this.meta.length; ci++) {
      const col = this.meta[ci];
      const arr = this._columns[ci];
      if (col.typeName === 'Bool') {
        obj[col.name] = (arr as Uint8Array)[slot] !== 0;
      } else {
        obj[col.name] = (arr as any)[slot] as number;
      }
    }
    return obj as Entity;
  }

  /**
   * Direct column value access by name and slot. O(1).
   */
  getColumnValue(colName: string, slot: number): number | boolean {
    const ci = this.meta.findIndex(c => c.name === colName);
    if (ci === -1) throw new Error(`Unknown column: ${colName}`);
    const col = this.meta[ci];
    const arr = this._columns[ci];
    if (col.typeName === 'Bool') return (arr as Uint8Array)[slot] !== 0;
    return (arr as any)[slot] as number;
  }

  /**
   * Check if a key exists in the store.
   */
  hasKey(key: number): boolean {
    return this._keyMap.has(key);
  }

  /**
   * Get slot index for a key. Returns undefined if not found.
   */
  getSlot(key: number): number | undefined {
    return this._keyMap.get(key);
  }
}
