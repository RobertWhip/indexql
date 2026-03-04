# IndexQL — Full System Algorithm

## Overview

IndexQL is a schema-driven indexing library that compiles structured data into compact binary artifacts queried entirely in-process. The system supports four sync modes controlled by the `@Sync` decorator:

| Mode | Behavior |
|------|----------|
| **static** | Load once, no updates |
| **snapshot** | Poll at interval, always fetch full snapshot |
| **incremental** | Poll at interval, use deltas for small gaps, snapshot fallback for large gaps |
| **manual** | No auto-poll, client calls refresh explicitly |

```
                          SERVER                              CLIENT
  ┌──────────────────────────────────┐      ┌──────────────────────────────────┐
  │  Entity[]  ──encodeEntity()──►   │      │                                  │
  │       products.bin (IQBN)        │─GET──│► fromSnapshot(ab)                │
  │                                  │      │    → reconstruct → ColumnarStore │
  │  old[] + new[]                   │      │                                  │
  │    ──computeDelta()──►           │      │                                  │
  │    ──encodeDelta()──►            │      │                                  │
  │       delta.bin (0xDF01)         │─GET──│► applyDeltaFromArrayBuffer(ab)   │
  │                                  │      │    → decodeDelta → store.apply   │
  └──────────────────────────────────┘      │                                  │
                                            │  store.toEntities()              │
                                            │    → executeQuery(filter,sort..) │
                                            │    → QueryResult                 │
                                            └──────────────────────────────────┘
```

---

## 1. Schema Definition

Decorators on a plain class are the **single source of truth**.

```typescript
@Entity('products')
@Sync({ mode: 'incremental', pollMs: 2000, snapshotEvery: 15 })
class Product {
  @Column({ type: DataType.Int32, isKey: true })
  seq!: number;                    // key column for delta operations

  @Column({ type: DataType.Float32 })
  @Facet('RANGE')
  price!: number;                  // binary-encoded, range facet

  @Column({ type: DataType.Int32 })
  qty!: number;                    // binary-encoded

  @Column({ type: DataType.Bool })
  inStock!: boolean;               // binary-encoded

  @Column({ type: DataType.String })
  name!: string;                   // NOT binary-encoded (string)
}
```

**Extraction chain:**
```
@Entity / @Column / @Facet / @Sync
    → getEntitySchema(Product)     → EntitySchema { columns, binaryColumns }
    → toBinaryColumnMetas(schema)  → ColumnMeta[] [seq:Int32, price:Float32, qty:Int32, inStock:Bool]
    → toSchemaNode(schema)         → SchemaNode (used by normalizer, facets, query engine)
    → getSyncConfig(Product)       → SyncConfig { mode, pollMs?, snapshotEvery? }
```

Only numeric and boolean columns become `ColumnMeta`. String columns are excluded from binary encoding.

---

## 2. Binary Encoding (IQBN Format)

Column-major layout optimized for sequential reads and delta patches.

```
Offset  Size     Field
──────  ───────  ──────────────────────────
0       4        Magic "IQBN" (ASCII)
4       1        Version (0x01)
5       4        num_items (uint32 LE)
9       1        num_columns (uint8)

                 ── Column Descriptors (repeat num_columns) ──
10      1        name_length
11      N        name (UTF-8)
11+N    1        type_code (1=Bool, 2=Int, 3=Float)
12+N    1        bits (8, 16, 32, 64)

                 ── Data Section (column-major) ──
...     varies   Column 0: all rows, then Column 1: all rows, ...
```

**Stride** = sum of (bits/8) across all columns. For `[Int32, Float32, Int32, Bool]` → stride = 4+4+4+1 = 13 bytes per row.

**Algorithm — `encodeColumns(items, meta)`:**
1. Write header (magic, version, item count, column count)
2. Write column descriptors (name + type code + bits)
3. For each column, iterate all items and write native-endian values
4. Return `Buffer`

**Algorithm — `reconstruct(buf)`:**
1. Parse header, validate magic
2. Parse column descriptors, compute data offsets
3. For each row, read value from each column's data region → `Entity`
4. Return `Entity[]`

---

## 3. ColumnarStore (In-Memory Mutable Storage)

Slotted TypedArray storage with tombstone bitvector for O(1) row operations.

```
Slot:       0     1     2     3     4     5     ...
          ┌─────┬─────┬─────┬─────┬─────┬─────┐
seq:      │  1  │  2  │  ░░ │  4  │  5  │     │   (Int32Array)
price:    │ 10  │ 25  │  ░░ │ 40  │ 50  │     │   (Float32Array)
qty:      │ 100 │ 180 │  ░░ │ 400 │ 500 │     │   (Int32Array)
inStock:  │  1  │  1  │  ░░ │  1  │  0  │     │   (Uint8Array)
          └─────┴─────┴─────┴─────┴─────┴─────┘
tombstone: [0,    0,    1,    0,    0,    ...]     (bitvector)
freeList:  [2]                                     (reusable slots)
keyMap:    {1→0, 2→1, 4→3, 5→4}                   (key → slot)
```

**Key properties:**
- `_generation`: increments after each mutation, invalidates cached `liveIndex` and `Entity[]`
- `_lastSeq`: last applied delta seq (idempotency guard)
- `liveCount`: number of non-tombstoned rows

**Algorithm — `applyDelta(packet)`:**
```
if packet.seq ≤ _lastSeq → return (idempotent)

1. DELETE phase: O(d)
   for each key in packet.deletes:
     slot = keyMap.get(key)
     if slot exists and not tombstoned:
       set tombstone bit, push slot to freeList, decrement liveCount

2. CAPACITY check:
   count new keys (not in keyMap after deletes)
   if nextSlot + newCount > capacity → grow all TypedArrays (power-of-2)

3. UPSERT phase: O(k × changed_cols)
   for each upsert in packet.upserts:
     if key in keyMap → slot = existing slot (UPDATE)
     else → slot = freeList.pop() or nextSlot++ (INSERT), set keyMap
     for each (colIndex, value) in upsert.values:
       columns[colIndex][slot] = value

4. FINALIZE:
   _lastSeq = packet.seq
   _generation++
   invalidate caches
```

**Algorithm — `toEntities()`:**
```
if cached at current generation → return cached

1. liveIndex = scan tombstone bitvector, collect non-tombstoned slots
2. for each slot in liveIndex:
     entity = {} ; for each column: entity[name] = columns[col][slot]
3. cache and return Entity[]
```

---

## 4. Delta Wire Format (0xDF01)

Sparse column bitmask format — only changed columns are transmitted.

```
Offset  Size     Field
──────  ───────  ──────────────────────────
0       2        Magic 0xDF01 (uint16 LE)
2       1        Version (0x01)
3       4        seq (uint32 LE)
7       1        flags (bit0: has_upserts, bit1: has_deletes)

                 ── Upsert Section (if flags & 0x01) ──
8       varint   upsert_count
        ...      Per upsert:
                   varint(zigzag(key))
                   col_mask: ceil(num_columns / 8) bytes
                   values: native bytes for each set bit in col_mask

                 ── Delete Section (if flags & 0x02) ──
...     varint   delete_count
        varint   zigzag(first_key)
        varint   delta from previous key (repeat delete_count - 1)
```

**Varint:** unsigned LEB128, 7 bits per byte + continuation bit.
**Zigzag:** `(n << 1) ^ (n >> 31)` — maps signed → unsigned for varint efficiency.
**Delta-coded deletes:** sorted keys, first key zigzag-encoded, subsequent keys stored as positive differences.

**Example — single field update on key=2 (price only):**
```
DF 01           magic
01              version
2A 00 00 00     seq=42
01              flags (upserts only)
01              upsert_count=1
04              zigzag(2)=4 as varint
02              col_mask=0b00000010 (only col 1 = price)
00 00 C8 42     price=100.0 as float32
                ─────────────────────
                Total: 15 bytes
```

**Algorithm — `computeDelta(oldItems, newItems, meta, keyCol)`:**
```
1. Build old map: key → item (O(n_old))
2. Build new map: key → item (O(n_new))
3. For each new key:
   - if in old: compare each column, include only changed ones (sparse)
   - if not in old: include ALL columns (full row insert)
4. For each old key not in new: add to deletes
5. Return DeltaPacket { seq, upserts[], deletes[] }
```

---

## 5. Query Engine (Convention-Based)

Filters are inferred from key naming conventions — no schema required at query time.

```typescript
// Convention → Behavior
{ priceMin: 100 }              → item.price >= 100
{ priceMax: 500 }              → item.price <= 500
{ search: 'wireless' }         → any string field contains 'wireless' (case-insensitive)
{ inStock: true }              → item.inStock === true
{ category: ['A', 'B'] }      → item.category ∈ {'A', 'B'}
```

**Algorithm — `executeQuery(items, options)`:**
```
1. FILTER:   items = items.filter(matchesAllFilterKeys)    O(n × f)
2. FACETS:   computeFacets(filtered, schema) if requested  O(n × facetFields)
3. SORT:     items.sort(byField, asc|desc)                 O(n log n)
4. PAGINATE: items.slice(offset, offset + pageSize)        O(pageSize)
5. PROJECT:  keep only requested fields                    O(pageSize × fields)
6. Return { data, facets?, meta: { total, page, pageSize, totalPages, timingMs } }
```

---

## 6. Sync Modes (Client Poll Strategy)

The `@Sync` decorator on the entity class determines the client's update strategy.

### Static (`@Sync({ mode: 'static' })`)

Load initial snapshot once. No polling, no updates. Suitable for data that rarely changes (e.g., product catalogs rebuilt on deploy).

```
CLIENT                              SERVER
  │  GET /snapshot.bin                │
  │◄──────────────────────────────────│  IQBN binary
  │                                   │
  ▼ IndexQLClient.fromSnapshot(ab)
  Done. No further requests.
```

### Snapshot (`@Sync({ mode: 'snapshot', pollMs: 2000 })`)

Poll at fixed interval. Always fetch the full snapshot — simple, no delta logic needed server-side.

```
every pollMs:
  1. GET /head → { seq }
  2. if seq === clientSeq → skip
  3. GET /snapshot.bin → applySnapshotFromArrayBuffer()
  4. clientSeq = seq
```

### Incremental (`@Sync({ mode: 'incremental', pollMs: 2000, snapshotEvery: 15 })`)

Poll at fixed interval. Use deltas for small gaps, snapshot fallback for large gaps or missing deltas.

```
every pollMs:
  1. GET /head → { seq }
  2. gap = seq - clientSeq
  3. DECIDE:
     ┌─ gap = 0              → skip
     ├─ gap ≤ snapshotEvery  → DELTA MODE
     │    for s in [clientSeq+1 .. seq]:
     │      GET /d/{s}.bin → applyDeltaFromArrayBuffer()
     │      if 404 → fallback to SNAPSHOT
     └─ gap > snapshotEvery  → SNAPSHOT MODE
          GET /snapshot.bin → applySnapshotFromArrayBuffer()
```

**Why dual-mode:**
- Deltas are tiny (only changed columns), so for 1–15 ticks they transfer far less data
- For large gaps (>30s), one snapshot is cheaper than dozens of sequential delta fetches
- Delta 404 (expired from server's rolling window) auto-falls back to snapshot

### Manual (`@Sync({ mode: 'manual' })`)

No auto-poll. The client exposes a refresh action that the user triggers explicitly.

```
on user action:
  1. GET /head → { seq }
  2. GET /snapshot.bin → applySnapshotFromArrayBuffer()
  3. clientSeq = seq
```

---

## 7. Example Flow

### Setup

Server has 10,000 products. Client connects for the first time.

### Step 1: Initial Snapshot Load

```
CLIENT                              SERVER
  │                                   │
  │  GET /snapshot.bin                │
  │◄──────────────────────────────────│  130,013 bytes (IQBN binary)
  │                                   │
  │  GET /head                        │
  │◄──────────────────────────────────│  { seq: 0 }
  │                                   │
  ▼ IndexQLClient.fromSnapshot(ab)
    1. reconstructFromArrayBuffer(ab)
       → parse IQBN header: 10,000 items × 4 columns
       → materialize Entity[10000]
    2. ColumnarStore.fromEntities(items)
       → allocate TypedArrays (capacity 16384)
       → populate keyMap (10,000 entries)
    clientSeq = 0
```

### Step 2: Server Mutates (2 seconds later)

```
SERVER (mutate tick):
  1. Pick ~200 random items, adjust price ±10%, qty ±20%
  2. Insert ~5 new items
  3. Delete ~5 items
  4. computeDelta(oldItems, newItems, meta, 'seq')
     → 200 upserts (sparse: avg 2 cols each), 5 full-row inserts, 5 deletes
  5. encodeDelta(packet, meta)
     → ~2,400 bytes (vs 130,013 for full snapshot)
  6. Store in rolling window, globalSeq = 1
  7. Re-encode snapshotBuf for /snapshot.bin
```

### Step 3: Client Polls — Delta Mode

```
CLIENT (poll tick, 2s later):
  │  GET /head                        │
  │◄──────────────────────────────────│  { seq: 1 }
  │                                   │
  │  gap = 1 - 0 = 1  (≤ 15 → DELTA)│
  │                                   │
  │  GET /d/1.bin                     │
  │◄──────────────────────────────────│  2,400 bytes (delta)
  │                                   │
  ▼ applyDeltaFromArrayBuffer(ab)
    1. decodeDeltaFromArrayBuffer(ab, meta)
       → parse header: seq=1, 205 upserts, 5 deletes
       → decode sparse column bitmask per upsert
    2. store.applyDelta(packet)
       → delete 5 rows: tombstone slots, push to freeList
       → upsert 200 existing: update only changed columns in TypedArrays
       → insert 5 new: pop freeList or allocate new slots
       → generation++, invalidate caches
    3. store.toEntities() → rebuild Entity[10000] (lazy, on next query)
    clientSeq = 1
    mode = "delta" (green)
    bytes transferred: 2,400 (98% savings vs snapshot)
```

### Step 4: Client Goes Idle for 60 Seconds

```
(Client tab backgrounded, 30 server ticks pass, server seq = 31)

CLIENT (resumes polling):
  │  GET /head                        │
  │◄──────────────────────────────────│  { seq: 31 }
  │                                   │
  │  gap = 31 - 1 = 30  (> 15 → SNAPSHOT)
  │                                   │
  │  GET /snapshot.bin                │
  │◄──────────────────────────────────│  130,078 bytes (full binary)
  │                                   │
  ▼ applySnapshotFromArrayBuffer(ab)
    1. reconstructFromArrayBuffer(ab)
       → parse IQBN: 10,003 items × 4 columns
    2. rebuildFromEntities(items)
       → discard old ColumnarStore entirely
       → create fresh ColumnarStore from new items
    clientSeq = 31
    mode = "snapshot" (orange)
```

### Step 5: Back to Delta Mode

```
CLIENT (next poll, 2s later):
  │  GET /head                        │
  │◄──────────────────────────────────│  { seq: 32 }
  │                                   │
  │  gap = 32 - 31 = 1  (≤ 15 → DELTA)
  │                                   │
  │  GET /d/32.bin                    │
  │◄──────────────────────────────────│  2,500 bytes
  │                                   │
  ▼ applyDeltaFromArrayBuffer(ab)
    → merge as before
    clientSeq = 32
    mode = "delta" (green)  ← back to incremental sync
```

### Step 6: Delta 404 Fallback

```
(Server restarts, rolling delta window is empty)

CLIENT (next poll):
  │  GET /head                        │
  │◄──────────────────────────────────│  { seq: 33 }
  │                                   │
  │  gap = 33 - 32 = 1  (≤ 15 → DELTA)
  │                                   │
  │  GET /d/33.bin                    │
  │◄──────────────────────────────────│  404 Not Found
  │                                   │
  │  (fallback to snapshot)           │
  │  GET /snapshot.bin                │
  │◄──────────────────────────────────│  130,100 bytes
  │                                   │
  ▼ applySnapshotFromArrayBuffer(ab)
    → full replace
    clientSeq = 33
    mode = "snapshot" (orange)
```

---

## Complexity Summary

| Operation | Time | Space |
|-----------|------|-------|
| `encodeColumns` | O(n × c) | O(n × stride) |
| `reconstruct` | O(n × c) | O(n) entities |
| `ColumnarStore.fromEntities` | O(n × c) | O(n × c) TypedArrays |
| `store.applyDelta` | O(k + d) | O(new inserts) |
| `store.toEntities` | O(n × c) once/gen | O(n) cached |
| `encodeDelta` | O(k × c + d) | O(wire bytes) |
| `decodeDelta` | O(k × c + d) | O(packet) |
| `computeDelta` | O(n_old + n_new) | O(n) maps |
| `executeQuery` | O(n × f + n log n) | O(result set) |

Where n = items, c = columns, k = upserts, d = deletes, f = filter keys.
