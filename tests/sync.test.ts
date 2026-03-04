import { encodeColumns, type ColumnMeta } from '../src/core/binary-encoder';
import { encodeDelta }                    from '../src/core/delta-codec';
import { computeDelta }                   from '../src/core/delta-codec';
import {
  Entity,
  Column,
  Sync,
  DataType,
  getEntitySchema,
  toBinaryColumnMetas,
} from '../src/core/entity';
import { Entity as EntityType }           from '../src/core/types';
import { IndexQLClient }                  from '../src/client/indexqlClient';
import { run, assert, assertEq, assertThrows } from './runner';

// ── Fixture ──────────────────────────────────────────────────────────────────

const ITEMS: EntityType[] = [
  { id: 1, price: 10.0, qty: 100, inStock: true },
  { id: 2, price: 20.0, qty: 200, inStock: false },
  { id: 3, price: 30.0, qty: 300, inStock: true },
];

const ITEMS_V2: EntityType[] = [
  { id: 1, price: 10.0, qty: 100, inStock: true },
  { id: 2, price: 25.0, qty: 180, inStock: false },
  { id: 4, price: 40.0, qty: 400, inStock: true },
];

function makeMeta(cls: Function): ColumnMeta[] {
  return toBinaryColumnMetas(getEntitySchema(cls));
}

// ── Mock fetch helper ────────────────────────────────────────────────────────

interface MockEndpoints {
  head:      { seq: number; itemCount: number };
  snapshot:  ArrayBuffer;
  deltas:    Map<number, ArrayBuffer>;
  /** Track which URLs were fetched */
  log:       string[];
  /** Set of URLs that should return 404 */
  notFound?: Set<string>;
}

function createMockFetch(endpoints: MockEndpoints): typeof globalThis.fetch {
  return (async (input: any) => {
    const url = String(input);
    endpoints.log.push(url);

    if (endpoints.notFound?.has(url)) {
      return { ok: false, status: 404 } as Response;
    }

    if (url.endsWith('/head')) {
      return {
        ok: true,
        json: async () => endpoints.head,
      } as Response;
    }
    if (url.endsWith('/snapshot.bin')) {
      return {
        ok: true,
        arrayBuffer: async () => endpoints.snapshot,
      } as Response;
    }
    const deltaMatch = url.match(/\/d\/(\d+)\.bin$/);
    if (deltaMatch) {
      const seq = Number(deltaMatch[1]);
      const ab  = endpoints.deltas.get(seq);
      if (!ab) return { ok: false, status: 404 } as Response;
      return {
        ok: true,
        arrayBuffer: async () => ab,
      } as Response;
    }
    return { ok: false, status: 404 } as Response;
  }) as typeof globalThis.fetch;
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ── Entity fixtures per mode ────────────────────────────────────────────────

@Entity('sync_static')
@Sync({ mode: 'static' })
class StaticItem {
  @Column({ type: DataType.Int32, isKey: true }) id!: number;
  @Column({ type: DataType.Float32 })           price!: number;
  @Column({ type: DataType.Int32 })             qty!: number;
  @Column({ type: DataType.Bool })              inStock!: boolean;
}

@Entity('sync_snapshot')
@Sync({ mode: 'snapshot', pollMs: 100 })
class SnapshotItem {
  @Column({ type: DataType.Int32, isKey: true }) id!: number;
  @Column({ type: DataType.Float32 })           price!: number;
  @Column({ type: DataType.Int32 })             qty!: number;
  @Column({ type: DataType.Bool })              inStock!: boolean;
}

@Entity('sync_incremental')
@Sync({ mode: 'incremental', pollMs: 100, snapshotEvery: 5 })
class IncrementalItem {
  @Column({ type: DataType.Int32, isKey: true }) id!: number;
  @Column({ type: DataType.Float32 })           price!: number;
  @Column({ type: DataType.Int32 })             qty!: number;
  @Column({ type: DataType.Bool })              inStock!: boolean;
}

@Entity('sync_manual')
@Sync({ mode: 'manual' })
class ManualItem {
  @Column({ type: DataType.Int32, isKey: true }) id!: number;
  @Column({ type: DataType.Float32 })           price!: number;
  @Column({ type: DataType.Int32 })             qty!: number;
  @Column({ type: DataType.Bool })              inStock!: boolean;
}

const META = makeMeta(StaticItem);

function makeEndpoints(items: EntityType[]): MockEndpoints {
  const snapshotBuf = encodeColumns(items, META);
  return {
    head:     { seq: 1, itemCount: items.length },
    snapshot: toArrayBuffer(snapshotBuf),
    deltas:   new Map(),
    log:      [],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

run('Sync: startSync throws without entity class', async () => {
  const client = IndexQLClient.fromSnapshot(toArrayBuffer(encodeColumns(ITEMS, META)));
  let threw = false;
  try { await client.startSync(); } catch { threw = true; }
  assert(threw, 'Should throw without entity class');
});

run('Sync: static mode — fetches snapshot once, no polling', async () => {
  const ep    = makeEndpoints(ITEMS);
  const client = IndexQLClient.fromSnapshot(ep.snapshot, { entity: StaticItem });
  const sync  = await client.startSync({ fetch: createMockFetch(ep) });

  assertEq(sync.lastMethod, 'snapshot');
  assertEq(client.getAll().length, 3);

  // No /head fetch for static mode
  const headFetches = ep.log.filter(u => u.endsWith('/head'));
  assertEq(headFetches.length, 0);

  sync.stop(); // no-op, but should not throw
});

run('Sync: snapshot mode — tick triggers snapshot apply', async () => {
  const ep = makeEndpoints(ITEMS);
  const client = IndexQLClient.fromSnapshot(ep.snapshot, { entity: SnapshotItem });

  let changeCount = 0;
  const sync = await client.startSync({
    fetch: createMockFetch(ep),
    onChange: () => changeCount++,
  });

  // Initial load triggers onChange
  assertEq(changeCount, 1);
  assertEq(sync.seq, 1);

  // Bump server seq and wait for a tick
  const v2Buf = encodeColumns(ITEMS_V2, META);
  ep.head     = { seq: 2, itemCount: ITEMS_V2.length };
  ep.snapshot = toArrayBuffer(v2Buf);

  await new Promise(r => setTimeout(r, 200));

  assert(sync.seq >= 2, `Expected seq >= 2, got ${sync.seq}`);
  assertEq(sync.lastMethod, 'snapshot');
  assert(changeCount >= 2, 'onChange should have fired again');

  sync.stop();
});

run('Sync: incremental mode — small gap uses deltas', async () => {
  const ep = makeEndpoints(ITEMS);
  ep.head  = { seq: 1, itemCount: ITEMS.length };

  const client = IndexQLClient.fromSnapshot(ep.snapshot, { entity: IncrementalItem });
  const mockFetch = createMockFetch(ep);

  const sync = await client.startSync({ fetch: mockFetch });
  assertEq(sync.seq, 1);

  // Add delta for seq 2
  const deltaPacket = computeDelta(ITEMS, ITEMS_V2, META, 'id');
  deltaPacket.seq = 2;
  const deltaBuf = encodeDelta(deltaPacket, META);
  ep.deltas.set(2, toArrayBuffer(deltaBuf));
  ep.head = { seq: 2, itemCount: ITEMS_V2.length };

  // Wait for tick
  await new Promise(r => setTimeout(r, 200));

  assertEq(sync.seq, 2);
  assertEq(sync.lastMethod, 'delta');

  // Verify delta was fetched, not snapshot
  const deltaFetches    = ep.log.filter(u => u.includes('/d/'));
  const snapshotFetches = ep.log.filter(u => u.endsWith('/snapshot.bin'));
  assert(deltaFetches.length >= 1, 'Should have fetched delta');
  // Snapshot only from initial load (2: one in fromSnapshot constructor wasn't through mock, one from startSync init)
  assertEq(snapshotFetches.length, 1); // only the initial startSync snapshot

  sync.stop();
});

run('Sync: incremental mode — large gap falls back to snapshot', async () => {
  const ep = makeEndpoints(ITEMS);
  ep.head  = { seq: 1, itemCount: ITEMS.length };

  const client = IndexQLClient.fromSnapshot(ep.snapshot, { entity: IncrementalItem });
  const sync   = await client.startSync({ fetch: createMockFetch(ep) });
  assertEq(sync.seq, 1);

  // Jump server seq by more than snapshotEvery (5)
  const v2Buf = encodeColumns(ITEMS_V2, META);
  ep.head     = { seq: 10, itemCount: ITEMS_V2.length };
  ep.snapshot = toArrayBuffer(v2Buf);

  await new Promise(r => setTimeout(r, 200));

  assertEq(sync.seq, 10);
  assertEq(sync.lastMethod, 'snapshot');

  sync.stop();
});

run('Sync: incremental mode — delta 404 falls back to snapshot', async () => {
  const ep = makeEndpoints(ITEMS);
  ep.head  = { seq: 1, itemCount: ITEMS.length };

  const client   = IndexQLClient.fromSnapshot(ep.snapshot, { entity: IncrementalItem });
  const mockFetch = createMockFetch(ep);
  const sync     = await client.startSync({ fetch: mockFetch });

  // Bump by 1 (within snapshotEvery) but don't provide delta — will 404
  const v2Buf = encodeColumns(ITEMS_V2, META);
  ep.head     = { seq: 2, itemCount: ITEMS_V2.length };
  ep.snapshot = toArrayBuffer(v2Buf);
  // No ep.deltas.set(2, ...) — delta fetch will 404

  await new Promise(r => setTimeout(r, 200));

  assertEq(sync.seq, 2);
  assertEq(sync.lastMethod, 'snapshot'); // fell back

  sync.stop();
});

run('Sync: manual mode — no auto-polling, refresh works', async () => {
  const ep = makeEndpoints(ITEMS);
  const client = IndexQLClient.fromSnapshot(ep.snapshot, { entity: ManualItem });

  let changeCount = 0;
  const sync = await client.startSync({
    fetch: createMockFetch(ep),
    onChange: () => changeCount++,
  });

  assertEq(changeCount, 1); // initial
  assertEq(sync.seq, 1);

  // Wait — should NOT auto-poll
  ep.log.length = 0;
  await new Promise(r => setTimeout(r, 200));
  assertEq(ep.log.length, 0, 'Manual mode should not auto-poll');

  // Manual refresh
  const v2Buf = encodeColumns(ITEMS_V2, META);
  ep.head     = { seq: 5, itemCount: ITEMS_V2.length };
  ep.snapshot = toArrayBuffer(v2Buf);

  await sync.refresh();
  assertEq(sync.seq, 5);
  assert(changeCount >= 2, 'onChange should fire on refresh');

  sync.stop();
});

run('Sync: stop prevents further ticks', async () => {
  const ep = makeEndpoints(ITEMS);
  const client = IndexQLClient.fromSnapshot(ep.snapshot, { entity: SnapshotItem });
  const sync   = await client.startSync({ fetch: createMockFetch(ep) });

  sync.stop();
  ep.log.length = 0;

  // Bump seq — should NOT be fetched
  ep.head = { seq: 99, itemCount: ITEMS.length };
  await new Promise(r => setTimeout(r, 200));

  const headFetches = ep.log.filter(u => u.endsWith('/head'));
  assertEq(headFetches.length, 0, 'Should not fetch after stop()');
  assertEq(sync.seq, 1); // unchanged
});
