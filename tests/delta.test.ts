import { encodeColumns, type ColumnMeta } from '../src/core/binary-encoder';
import { ColumnarStore }                  from '../src/core/columnar-store';
import type { DeltaPacket, DeltaUpsert }  from '../src/core/columnar-store';
import {
  encodeDelta,
  decodeDelta,
  decodeDeltaFromArrayBuffer,
  computeDelta,
} from '../src/core/delta-codec';
import {
  Entity,
  Column,
  Facet,
  Sync,
  DataType,
  getEntitySchema,
  getKeyColumn,
  getSyncConfig,
  toBinaryColumnMetas,
} from '../src/core/entity';
import { Entity as EntityType }           from '../src/core/types';
import { IndexQLClient }                  from '../src/client/indexqlClient';
import { createQueryHook }                from '../src/client/hooks';
import { run, assert, assertEq, assertThrows } from './runner';
import * as fs   from 'fs';
import * as path from 'path';

// ── Fixture: keyed entity ────────────────────────────────────────────────────

@Entity('widgets')
class Widget {
  @Column({ type: DataType.Int32, isKey: true })
  id!: number;

  @Column({ type: DataType.Float32 })
  @Facet('RANGE')
  price!: number;

  @Column({ type: DataType.Int32 })
  qty!: number;

  @Column({ type: DataType.Bool })
  inStock!: boolean;

  @Column({ type: DataType.String })
  name!: string;

  @Column({ type: DataType.String })
  @Facet('TERMS')
  category!: string;
}

const META: ColumnMeta[] = toBinaryColumnMetas(getEntitySchema(Widget));
// META = [id:Int32, price:Float32, qty:Int32, inStock:Bool]

const OLD_ITEMS: EntityType[] = [
  { id: 1, price: 10.0, qty: 100, inStock: true,  name: 'Widget A', category: 'Tools' },
  { id: 2, price: 20.0, qty: 200, inStock: true,  name: 'Widget B', category: 'Tools' },
  { id: 3, price: 30.0, qty: 300, inStock: false, name: 'Widget C', category: 'Parts' },
];

const NEW_ITEMS: EntityType[] = [
  { id: 1, price: 10.0, qty: 100, inStock: true,  name: 'Widget A', category: 'Tools' },  // unchanged
  { id: 2, price: 25.0, qty: 180, inStock: true,  name: 'Widget B', category: 'Tools' },  // price+qty changed
  { id: 4, price: 40.0, qty: 400, inStock: true,  name: 'Widget D', category: 'Parts' },  // new
  // id=3 deleted
];

// ── getKeyColumn ─────────────────────────────────────────────────────────────

run('Delta: getKeyColumn returns key column', () => {
  const key = getKeyColumn(getEntitySchema(Widget));
  assertEq(key.propertyKey, 'id');
  assert(key.isKey === true);
});

run('Delta: getKeyColumn throws on missing key', () => {
  @Entity('nokeys')
  class NoKey {
    @Column({ type: DataType.Int32 })
    val!: number;
  }
  assertThrows(() => getKeyColumn(getEntitySchema(NoKey)));
});

run('Delta: getKeyColumn throws on multiple keys', () => {
  @Entity('multikeys')
  class MultiKey {
    @Column({ type: DataType.Int32, isKey: true })
    a!: number;
    @Column({ type: DataType.Int32, isKey: true })
    b!: number;
  }
  assertThrows(() => getKeyColumn(getEntitySchema(MultiKey)));
});

run('Delta: getKeyColumn throws on non-binary key', () => {
  @Entity('stringkey')
  class StringKey {
    @Column({ type: DataType.String, isKey: true })
    id!: string;
  }
  assertThrows(() => getKeyColumn(getEntitySchema(StringKey)));
});

// ── computeDelta ─────────────────────────────────────────────────────────────

run('Delta: computeDelta detects new, changed, deleted rows', () => {
  const d = computeDelta(OLD_ITEMS, NEW_ITEMS, META, 'id');
  const upsertKeys = d.upserts.map(u => u.key);

  assert(upsertKeys.includes(2), 'Should include changed row id=2');
  assert(upsertKeys.includes(4), 'Should include new row id=4');
  assert(!upsertKeys.includes(1), 'Should not include unchanged row id=1');

  assertEq(d.deletes.length, 1);
  assertEq(d.deletes[0], 3);
});

run('Delta: computeDelta sparse — only changed columns for updates', () => {
  const d = computeDelta(OLD_ITEMS, NEW_ITEMS, META, 'id');
  const u2 = d.upserts.find(u => u.key === 2)!;
  // id=2: price and qty changed, id and inStock did NOT change
  assert(!u2.values.has(0), 'id column should not be in values (unchanged)');
  assert(u2.values.has(1), 'price column should be in values');
  assert(u2.values.has(2), 'qty column should be in values');
  assert(!u2.values.has(3), 'inStock column should not be in values (unchanged)');
});

run('Delta: computeDelta includes all columns for new rows', () => {
  const d = computeDelta(OLD_ITEMS, NEW_ITEMS, META, 'id');
  const u4 = d.upserts.find(u => u.key === 4)!;
  assertEq(u4.values.size, META.length);
});

run('Delta: computeDelta empty diff when identical', () => {
  const d = computeDelta(OLD_ITEMS, OLD_ITEMS, META, 'id');
  assertEq(d.upserts.length, 0);
  assertEq(d.deletes.length, 0);
});

// ── encodeDelta / decodeDelta round-trip ─────────────────────────────────────

run('Delta: encode/decode round-trip preserves upserts and deletes', () => {
  const packet = computeDelta(OLD_ITEMS, NEW_ITEMS, META, 'id');
  packet.seq = 42;
  const buf     = encodeDelta(packet, META);
  const decoded = decodeDelta(buf, META);

  assertEq(decoded.seq, 42);
  assertEq(decoded.upserts.length, packet.upserts.length);
  assertEq(decoded.deletes.length, packet.deletes.length);

  // Verify upsert values
  for (const orig of packet.upserts) {
    const dec = decoded.upserts.find(u => u.key === orig.key)!;
    assert(dec !== undefined, `Missing upsert key=${orig.key}`);
    assertEq(dec.values.size, orig.values.size);
    for (const [ci, val] of orig.values) {
      const decVal = dec.values.get(ci);
      if (typeof val === 'boolean') {
        assertEq(decVal, val);
      } else {
        assert(Math.abs(Number(decVal) - Number(val)) < 0.01, `Value mismatch col=${ci}`);
      }
    }
  }

  assertEq(decoded.deletes[0], 3);
});

run('Delta: magic bytes 0xDF01', () => {
  const buf = encodeDelta({ seq: 1, upserts: [], deletes: [] }, META);
  assertEq(buf[0], 0x01);
  assertEq(buf[1], 0xDF);
});

run('Delta: decodeDelta rejects wrong magic', () => {
  const buf = Buffer.from([0x00, 0x00, 0x01, 0, 0, 0, 0, 0]);
  assertThrows(() => decodeDelta(buf, META));
});

run('Delta: empty packet (no upserts, no deletes)', () => {
  const buf     = encodeDelta({ seq: 5, upserts: [], deletes: [] }, META);
  const decoded = decodeDelta(buf, META);
  assertEq(decoded.seq, 5);
  assertEq(decoded.upserts.length, 0);
  assertEq(decoded.deletes.length, 0);
});

// ── decodeDeltaFromArrayBuffer (browser path) ────────────────────────────────

run('Delta: decodeDeltaFromArrayBuffer round-trip', () => {
  const packet = computeDelta(OLD_ITEMS, NEW_ITEMS, META, 'id');
  packet.seq = 7;
  const buf = encodeDelta(packet, META);
  const ab  = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  const decoded = decodeDeltaFromArrayBuffer(ab, META);
  assertEq(decoded.seq, 7);
  assertEq(decoded.upserts.length, packet.upserts.length);
  assertEq(decoded.deletes.length, packet.deletes.length);
});

// ── ColumnarStore ────────────────────────────────────────────────────────────

run('Delta: ColumnarStore.fromEntities builds correct store', () => {
  const store = ColumnarStore.fromEntities(OLD_ITEMS, META, 'id');
  assertEq(store.liveCount, 3);
  assert(store.hasKey(1));
  assert(store.hasKey(2));
  assert(store.hasKey(3));
  assert(!store.hasKey(99));
});

run('Delta: ColumnarStore.toEntities round-trips values', () => {
  const store    = ColumnarStore.fromEntities(OLD_ITEMS, META, 'id');
  const entities = store.toEntities();
  assertEq(entities.length, 3);

  const e1 = entities.find(e => e.id === 1)!;
  assert(Math.abs(Number(e1.price) - 10.0) < 0.01);
  assertEq(e1.qty, 100);
  assertEq(e1.inStock, true);
});

run('Delta: ColumnarStore.toEntities is cached by generation', () => {
  const store = ColumnarStore.fromEntities(OLD_ITEMS, META, 'id');
  const a = store.toEntities();
  const b = store.toEntities();
  assert(a === b, 'Should return same reference when generation unchanged');
});

run('Delta: ColumnarStore.applyDelta upserts and deletes', () => {
  const store  = ColumnarStore.fromEntities(OLD_ITEMS, META, 'id');
  const packet = computeDelta(OLD_ITEMS, NEW_ITEMS, META, 'id');
  packet.seq = 1;
  const result = store.applyDelta(packet);

  assertEq(result.updated, 1);   // id=2
  assertEq(result.inserted, 1);  // id=4
  assertEq(result.deleted, 1);   // id=3
  assertEq(result.totalAfter, 3);
  assert(result.timingMs >= 0);

  // Verify data integrity
  assert(store.hasKey(1));
  assert(store.hasKey(2));
  assert(!store.hasKey(3));
  assert(store.hasKey(4));

  const entities = store.toEntities();
  const e2 = entities.find(e => e.id === 2)!;
  assert(Math.abs(Number(e2.price) - 25.0) < 0.01, 'price should be updated');
  assertEq(e2.qty, 180);

  const e4 = entities.find(e => e.id === 4)!;
  assert(Math.abs(Number(e4.price) - 40.0) < 0.01);
  assertEq(e4.qty, 400);
});

run('Delta: ColumnarStore tombstone + freeList slot reuse', () => {
  const store = ColumnarStore.fromEntities(OLD_ITEMS, META, 'id');
  const gen0 = store.generation;

  // Delete id=2 (slot 1)
  store.applyDelta({ seq: 1, upserts: [], deletes: [2] });
  assertEq(store.liveCount, 2);
  assert(!store.hasKey(2));
  assertEq(store.generation, gen0 + 1);

  // Insert id=5 — should reuse the freed slot
  const upsert: DeltaUpsert = {
    key: 5,
    values: new Map<number, number | boolean>([[0, 5], [1, 55.0], [2, 555], [3, true]]),
  };
  store.applyDelta({ seq: 2, upserts: [upsert], deletes: [] });
  assertEq(store.liveCount, 3);
  assert(store.hasKey(5));

  const entities = store.toEntities();
  assertEq(entities.length, 3);
  const e5 = entities.find(e => e.id === 5)!;
  assertEq(e5.qty, 555);
});

run('Delta: ColumnarStore idempotent — re-applying same seq is no-op', () => {
  const store  = ColumnarStore.fromEntities(OLD_ITEMS, META, 'id');
  const packet: DeltaPacket = { seq: 1, upserts: [], deletes: [3] };

  store.applyDelta(packet);
  assertEq(store.liveCount, 2);

  // Re-apply same seq
  const result = store.applyDelta(packet);
  assertEq(result.deleted, 0);
  assertEq(result.inserted, 0);
  assertEq(result.updated, 0);
  assertEq(store.liveCount, 2); // unchanged
});

run('Delta: ColumnarStore liveIndex excludes tombstones', () => {
  const store = ColumnarStore.fromEntities(OLD_ITEMS, META, 'id');
  store.applyDelta({ seq: 1, upserts: [], deletes: [2] });

  const liveIndex = store.ensureLiveIndex();
  assertEq(liveIndex.length, 2);

  // All live slots should produce valid entities
  for (let i = 0; i < liveIndex.length; i++) {
    const row = store.readRow(liveIndex[i]);
    assert(row.id === 1 || row.id === 3, `Unexpected id: ${row.id}`);
  }
});

run('Delta: ColumnarStore getColumnValue direct access', () => {
  const store = ColumnarStore.fromEntities(OLD_ITEMS, META, 'id');
  const slot  = store.getSlot(2)!;
  assert(Math.abs(Number(store.getColumnValue('price', slot)) - 20.0) < 0.01);
  assertEq(store.getColumnValue('inStock', slot), true);
});

// ── Full pipeline: encode → decode → store.applyDelta ────────────────────────

run('Delta: full pipeline encode → wire → decode → applyDelta', () => {
  const store = ColumnarStore.fromEntities(OLD_ITEMS, META, 'id');

  // Server side: compute + encode
  const packet = computeDelta(OLD_ITEMS, NEW_ITEMS, META, 'id');
  packet.seq = 1;
  const wireBuf = encodeDelta(packet, META);

  // Client side: decode + apply
  const decoded = decodeDelta(wireBuf, META);
  const result  = store.applyDelta(decoded);

  assertEq(result.inserted, 1);
  assertEq(result.updated, 1);
  assertEq(result.deleted, 1);

  const entities = store.toEntities();
  const ids = entities.map(e => Number(e.id)).sort();
  assertEq(ids[0], 1);
  assertEq(ids[1], 2);
  assertEq(ids[2], 4);
});

// ── Wire format payload efficiency ───────────────────────────────────────────

run('Delta: sparse single-field update is compact', () => {
  // Only price changed on 1 row — should be much smaller than full row
  const singleUpdate: DeltaPacket = {
    seq: 1,
    upserts: [{ key: 2, values: new Map([[1, 99.0]]) }],  // only price (col 1)
    deletes: [],
  };
  const buf = encodeDelta(singleUpdate, META);

  // Header(8) + count_varint(1) + key_varint(1) + col_mask(1) + float32(4) = 15 bytes
  assert(buf.length <= 20, `Expected compact payload, got ${buf.length} bytes`);
});

// ── Client integration ───────────────────────────────────────────────────────

function withTmpArtifacts(items: EntityType[], fn: (dir: string) => void): void {
  const tmpDir = path.join(__dirname, `__delta_tmp_${Date.now()}__`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const buf = encodeColumns(items, META);
    fs.writeFileSync(path.join(tmpDir, 'products.bin'), buf);
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run('Delta: client applyDelta merges correctly', () => {
  withTmpArtifacts(OLD_ITEMS, (dir) => {
    const client = IndexQLClient.load({ artifactsDir: dir, entity: Widget });
    assertEq(client.getStats().itemCount, 3);

    const packet = computeDelta(OLD_ITEMS, NEW_ITEMS, META, 'id');
    packet.seq = 1;
    const deltaBuf = encodeDelta(packet, META);
    const result   = client.applyDelta(deltaBuf);

    assertEq(result.updated, 1);
    assertEq(result.inserted, 1);
    assertEq(result.deleted, 1);
    assertEq(result.totalAfter, 3);
    assertEq(client.getStats().itemCount, 3);

    const all = client.getAll();
    const ids = all.map(i => Number(i.id)).sort();
    assertEq(ids[0], 1);
    assertEq(ids[1], 2);
    assertEq(ids[2], 4);

    // Query still works
    const qr = client.query({ filter: { priceMin: 20 } });
    assertEq(qr.meta.total, 2); // id=2 (25) and id=4 (40)
  });
});

run('Delta: client applyDelta throws without key column', () => {
  @Entity('nokey_items')
  class NoKeyItem {
    @Column({ type: DataType.Int32 })
    val!: number;
  }
  const tmpDir = path.join(__dirname, '__delta_nokey_tmp__');
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const buf = encodeColumns([{ val: 1 }], [{ name: 'val', typeName: 'Int32', bits: 32 }]);
    fs.writeFileSync(path.join(tmpDir, 'products.bin'), buf);
    const client = IndexQLClient.load({ artifactsDir: tmpDir, entity: NoKeyItem });
    const deltaBuf = encodeDelta({ seq: 1, upserts: [], deletes: [] }, META);
    assertThrows(() => client.applyDelta(deltaBuf));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Hook integration ─────────────────────────────────────────────────────────

run('Delta: hook applyDelta re-executes query', () => {
  withTmpArtifacts(OLD_ITEMS, (dir) => {
    const client = IndexQLClient.load({ artifactsDir: dir, entity: Widget });
    const hook   = createQueryHook(client);

    hook.query({ filter: { priceMin: 15 } });
    assertEq(hook.state.data.length, 2); // id=2 (20) and id=3 (30)

    const packet = computeDelta(OLD_ITEMS, NEW_ITEMS, META, 'id');
    packet.seq = 1;
    const deltaBuf = encodeDelta(packet, META);
    const result = hook.applyDelta(deltaBuf);

    assertEq(result.updated, 1);
    assertEq(result.inserted, 1);
    assertEq(result.deleted, 1);

    // Hook should have re-run query with priceMin: 15
    assertEq(hook.state.data.length, 2); // id=2 (25) and id=4 (40)
  });
});

// ── Delete + insert same key in one delta ────────────────────────────────────

run('Delta: delete + insert same key in one delta', () => {
  const store = ColumnarStore.fromEntities(OLD_ITEMS, META, 'id');

  // Delete id=2, then re-insert id=2 with new values
  const packet: DeltaPacket = {
    seq: 1,
    deletes: [2],
    upserts: [{ key: 2, values: new Map<number, number | boolean>([[0, 2], [1, 99.0], [2, 999], [3, false]]) }],
  };
  const result = store.applyDelta(packet);

  // Deletes run first, then upserts — so id=2 is deleted then re-inserted
  assertEq(result.deleted, 1);
  assertEq(result.inserted, 1);
  assertEq(store.liveCount, 3);

  const e2 = store.toEntities().find(e => e.id === 2)!;
  assert(Math.abs(Number(e2.price) - 99.0) < 0.01);
  assertEq(e2.qty, 999);
  assertEq(e2.inStock, false);
});

// ── Snapshot tests ────────────────────────────────────────────────────────────

run('Snapshot: client applySnapshot replaces all data', () => {
  withTmpArtifacts(OLD_ITEMS, (dir) => {
    const client = IndexQLClient.load({ artifactsDir: dir, entity: Widget });
    assertEq(client.getStats().itemCount, 3);

    const newBuf = encodeColumns(NEW_ITEMS, META);
    client.applySnapshot(newBuf);

    const all = client.getAll();
    const ids = all.map(i => Number(i.id)).sort();
    assertEq(ids.length, 3);
    assertEq(ids[0], 1);
    assertEq(ids[1], 2);
    assertEq(ids[2], 4);

    const e2 = all.find(e => e.id === 2)!;
    assert(Math.abs(Number(e2.price) - 25.0) < 0.01);
    assertEq(e2.qty, 180);
  });
});

run('Snapshot: client applySnapshotFromArrayBuffer replaces all data', () => {
  withTmpArtifacts(OLD_ITEMS, (dir) => {
    const client = IndexQLClient.load({ artifactsDir: dir, entity: Widget });
    assertEq(client.getStats().itemCount, 3);

    const newBuf = encodeColumns(NEW_ITEMS, META);
    const ab = newBuf.buffer.slice(newBuf.byteOffset, newBuf.byteOffset + newBuf.byteLength) as ArrayBuffer;
    client.applySnapshotFromArrayBuffer(ab);

    const all = client.getAll();
    const ids = all.map(i => Number(i.id)).sort();
    assertEq(ids.length, 3);
    assertEq(ids[0], 1);
    assertEq(ids[1], 2);
    assertEq(ids[2], 4);
  });
});

run('Snapshot: applySnapshot returns correct SnapshotApplyResult', () => {
  withTmpArtifacts(OLD_ITEMS, (dir) => {
    const client = IndexQLClient.load({ artifactsDir: dir, entity: Widget });

    const newBuf = encodeColumns(NEW_ITEMS, META);
    const result = client.applySnapshot(newBuf);

    assertEq(result.itemCount, 3);
    assertEq(result.previousCount, 3);
    assert(result.timingMs >= 0);
  });
});

run('Snapshot: applySnapshot handles different-sized datasets', () => {
  withTmpArtifacts(OLD_ITEMS, (dir) => {
    const client = IndexQLClient.load({ artifactsDir: dir, entity: Widget });
    assertEq(client.getStats().itemCount, 3);

    // 3 → 5 items
    const fiveItems: EntityType[] = [
      { id: 1, price: 10.0, qty: 100, inStock: true,  name: 'A', category: 'X' },
      { id: 2, price: 20.0, qty: 200, inStock: true,  name: 'B', category: 'X' },
      { id: 3, price: 30.0, qty: 300, inStock: false, name: 'C', category: 'Y' },
      { id: 4, price: 40.0, qty: 400, inStock: true,  name: 'D', category: 'Y' },
      { id: 5, price: 50.0, qty: 500, inStock: true,  name: 'E', category: 'Z' },
    ];
    const r1 = client.applySnapshot(encodeColumns(fiveItems, META));
    assertEq(r1.itemCount, 5);
    assertEq(r1.previousCount, 3);
    assertEq(client.getStats().itemCount, 5);

    // 5 → 1 item
    const oneItem: EntityType[] = [
      { id: 99, price: 1.0, qty: 1, inStock: false, name: 'Z', category: 'Z' },
    ];
    const r2 = client.applySnapshot(encodeColumns(oneItem, META));
    assertEq(r2.itemCount, 1);
    assertEq(r2.previousCount, 5);
    assertEq(client.getStats().itemCount, 1);
  });
});

run('Snapshot: hook applySnapshot re-runs query', () => {
  withTmpArtifacts(OLD_ITEMS, (dir) => {
    const client = IndexQLClient.load({ artifactsDir: dir, entity: Widget });
    const hook   = createQueryHook(client);

    hook.query({ filter: { priceMin: 15 } });
    assertEq(hook.state.data.length, 2); // id=2 (20) and id=3 (30)

    const newBuf = encodeColumns(NEW_ITEMS, META);
    const result = hook.applySnapshot(newBuf);

    assertEq(result.itemCount, 3);
    // Hook should have re-run query with priceMin: 15
    assertEq(hook.state.data.length, 2); // id=2 (25) and id=4 (40)
  });
});

run('Snapshot: hook applySnapshotFromArrayBuffer re-runs query', () => {
  withTmpArtifacts(OLD_ITEMS, (dir) => {
    const client = IndexQLClient.load({ artifactsDir: dir, entity: Widget });
    const hook   = createQueryHook(client);

    hook.query({ filter: { priceMin: 15 } });
    assertEq(hook.state.data.length, 2); // id=2 (20) and id=3 (30)

    const newBuf = encodeColumns(NEW_ITEMS, META);
    const ab = newBuf.buffer.slice(newBuf.byteOffset, newBuf.byteOffset + newBuf.byteLength) as ArrayBuffer;
    const result = hook.applySnapshotFromArrayBuffer(ab);

    assertEq(result.itemCount, 3);
    assertEq(hook.state.data.length, 2); // id=2 (25) and id=4 (40)
  });
});

// ── @Sync decorator ──────────────────────────────────────────────────────────

run('Sync: getSyncConfig returns incremental config', () => {
  @Entity('synced')
  @Sync({ mode: 'incremental', pollMs: 2000, snapshotEvery: 15 })
  class SyncedEntity {
    @Column({ type: DataType.Int32 })
    id!: number;
  }
  const cfg = getSyncConfig(SyncedEntity);
  if (cfg.mode !== 'incremental') throw new Error('expected incremental');
  assertEq(cfg.pollMs, 2000);
  assertEq(cfg.snapshotEvery, 15);
});

run('Sync: getSyncConfig returns static default for undecorated class', () => {
  @Entity('nosync')
  class NoSyncEntity {
    @Column({ type: DataType.Int32 })
    id!: number;
  }
  const cfg = getSyncConfig(NoSyncEntity);
  assertEq(cfg.mode, 'static');
  assert(!('pollMs' in cfg));
  assert(!('snapshotEvery' in cfg));
});

run('Sync: snapshot mode requires pollMs, no snapshotEvery', () => {
  @Entity('snap_sync')
  @Sync({ mode: 'snapshot', pollMs: 3000 })
  class SnapEntity {
    @Column({ type: DataType.Int32 })
    id!: number;
  }
  const cfg = getSyncConfig(SnapEntity);
  if (cfg.mode !== 'snapshot') throw new Error('expected snapshot');
  assertEq(cfg.pollMs, 3000);
  assert(!('snapshotEvery' in cfg));
});

run('Sync: manual mode has no pollMs or snapshotEvery', () => {
  @Entity('manual_sync')
  @Sync({ mode: 'manual' })
  class ManualEntity {
    @Column({ type: DataType.Int32 })
    id!: number;
  }
  const cfg = getSyncConfig(ManualEntity);
  assertEq(cfg.mode, 'manual');
  assert(!('pollMs' in cfg));
  assert(!('snapshotEvery' in cfg));
});

run('Sync: incremental without snapshotEvery is valid', () => {
  @Entity('inc_no_snap')
  @Sync({ mode: 'incremental', pollMs: 1000 })
  class IncEntity {
    @Column({ type: DataType.Int32 })
    id!: number;
  }
  const cfg = getSyncConfig(IncEntity);
  if (cfg.mode !== 'incremental') throw new Error('expected incremental');
  assertEq(cfg.pollMs, 1000);
  assertEq(cfg.snapshotEvery, undefined);
});

run('Sync: decorator does not interfere with entity schema', () => {
  @Entity('sync_with_schema')
  @Sync({ mode: 'incremental', pollMs: 5000, snapshotEvery: 10 })
  class SyncSchemaEntity {
    @Column({ type: DataType.Int32, isKey: true })
    id!: number;

    @Column({ type: DataType.Float32 })
    @Facet('RANGE')
    price!: number;

    @Column({ type: DataType.String })
    name!: string;
  }
  const schema = getEntitySchema(SyncSchemaEntity);
  assertEq(schema.collection, 'sync_with_schema');
  assertEq(schema.columns.length, 3);
  assertEq(schema.binaryColumns.length, 2); // id + price
  const key = getKeyColumn(schema);
  assertEq(key.propertyKey, 'id');

  const cfg = getSyncConfig(SyncSchemaEntity);
  if (cfg.mode !== 'incremental') throw new Error('expected incremental');
  assertEq(cfg.pollMs, 5000);
  assertEq(cfg.snapshotEvery, 10);
});
