import { getEntitySchema, getSyncConfig, toBinaryColumnMetas, toSchemaNode } from '../core/entity';
import { reconstruct, reconstructFromArrayBuffer }            from '../core/binary-encoder';
import { ColumnarStore }                                      from '../core/columnar-store';
import { decodeDelta, decodeDeltaFromArrayBuffer }            from '../core/delta-codec';
import { Entity, SchemaNode, QueryOptions, QueryResult, DeltaApplyResult, SnapshotApplyResult } from '../core/types';
import { executeQuery }                from './query';
import { now }                         from './utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClientConfig {
  artifactsDir?: string;
  /** Decorated entity class — used to derive the schema for facet computation. */
  entity?:       Function;
}

export interface SyncOptions {
  /** Called after each successful sync tick (snapshot or delta applied). */
  onChange?: () => void;
  /** Base URL for endpoints. Default: '' (same origin). */
  baseUrl?: string;
  /** Custom fetch (for testing). Default: globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface SyncHandle {
  /** Stop the polling loop. */
  stop(): void;
  /** Manually trigger a sync tick. */
  refresh(): Promise<void>;
  /** Current server sequence number. */
  readonly seq: number;
  /** Last sync method: 'delta' | 'snapshot' | 'idle'. */
  readonly lastMethod: 'delta' | 'snapshot' | 'idle';
}

export interface ClientStats {
  loadTimeMs:   number;
  itemCount:    number;
  artifactsDir: string;
}

// ── IndexQL Client ────────────────────────────────────────────────────────────

export class IndexQLClient {
  private items!:      Entity[];
  private store?:      ColumnarStore;
  private schemaNode?: SchemaNode;
  private readonly artifactsDir: string;
  private readonly entityClass?: Function;
  private stats!:      ClientStats;

  private constructor(config: ClientConfig = {}) {
    this.artifactsDir = config.artifactsDir ?? '';
    this.entityClass  = config.entity;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /** Rebuild store + items from decoded entities. Returns previous item count. */
  private rebuildFromEntities(items: Entity[]): { previousCount: number } {
    const previousCount = this.items?.length ?? 0;
    this.items = items;

    if (this.entityClass) {
      const schema = getEntitySchema(this.entityClass);
      this.schemaNode = toSchemaNode(schema);

      const keyCols = schema.columns.filter(c => c.isKey);
      if (keyCols.length === 1) {
        const binaryMeta = toBinaryColumnMetas(schema);
        this.store = ColumnarStore.fromEntities(this.items, binaryMeta, keyCols[0].propertyKey);
      } else {
        this.store = undefined;
      }
    }

    return { previousCount };
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  private loadSync(): void {
    const t0 = now();
    const fs   = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');

    const dir = this.artifactsDir || path.join(path.resolve(__dirname, '..', '..'), 'artifacts');
    const binaryPath = path.join(dir, 'products.bin');
    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `IndexQL: products.bin not found at ${binaryPath}.\n` +
        `Run "npm run build" to generate artifacts first.`
      );
    }
    const binaryBuf = fs.readFileSync(binaryPath);
    const items     = reconstruct(binaryBuf);
    this.rebuildFromEntities(items);

    const loadTimeMs = now() - t0;
    this.stats = {
      loadTimeMs,
      itemCount:    this.items.length,
      artifactsDir: dir,
    };
  }

  /** Create and initialize a client synchronously. */
  static load(config: ClientConfig = {}): IndexQLClient {
    const client = new IndexQLClient(config);
    client.loadSync();
    return client;
  }

  /** Create a client from an ArrayBuffer snapshot (browser-first, no disk I/O). */
  static fromSnapshot(ab: ArrayBuffer, config: ClientConfig = {}): IndexQLClient {
    const t0     = now();
    const client = new IndexQLClient(config);
    const items  = reconstructFromArrayBuffer(ab);
    client.rebuildFromEntities(items);

    const loadTimeMs = now() - t0;
    client.stats = {
      loadTimeMs,
      itemCount:    client.items.length,
      artifactsDir: client.artifactsDir,
    };
    return client;
  }

  // ── Query API ──────────────────────────────────────────────────────────────

  query(options: QueryOptions = {}): QueryResult {
    const items = this.store ? this.store.toEntities() : this.items;
    return executeQuery(items, options, this.schemaNode ? { node: this.schemaNode } : undefined);
  }

  getStats(): ClientStats {
    return this.stats;
  }

  getAll(): Entity[] {
    return this.store ? this.store.toEntities() : this.items;
  }

  // ── Delta API ───────────────────────────────────────────────────────────────

  applyDelta(deltaBuf: Buffer): DeltaApplyResult {
    if (!this.store) throw new Error('No key column defined on entity — cannot apply delta');
    const packet = decodeDelta(deltaBuf, this.store.meta);
    const result = this.store.applyDelta(packet);
    this.stats = { ...this.stats, itemCount: this.store.liveCount };
    return result;
  }

  applyDeltaFromArrayBuffer(ab: ArrayBuffer): DeltaApplyResult {
    if (!this.store) throw new Error('No key column defined on entity — cannot apply delta');
    const packet = decodeDeltaFromArrayBuffer(ab, this.store.meta);
    const result = this.store.applyDelta(packet);
    this.stats = { ...this.stats, itemCount: this.store.liveCount };
    return result;
  }

  // ── Snapshot API ────────────────────────────────────────────────────────────

  applySnapshot(buf: Buffer): SnapshotApplyResult {
    const t0    = now();
    const items = reconstruct(buf);
    const { previousCount } = this.rebuildFromEntities(items);
    const timingMs = now() - t0;

    this.stats = { ...this.stats, itemCount: this.items.length };
    return { itemCount: this.items.length, previousCount, timingMs };
  }

  applySnapshotFromArrayBuffer(ab: ArrayBuffer): SnapshotApplyResult {
    const t0    = now();
    const items = reconstructFromArrayBuffer(ab);
    const { previousCount } = this.rebuildFromEntities(items);
    const timingMs = now() - t0;

    this.stats = { ...this.stats, itemCount: this.items.length };
    return { itemCount: this.items.length, previousCount, timingMs };
  }

  // ── Sync API ──────────────────────────────────────────────────────────────

  async startSync(opts: SyncOptions = {}): Promise<SyncHandle> {
    if (!this.entityClass) throw new Error('startSync requires an entity class');
    const syncConfig = getSyncConfig(this.entityClass);
    const baseUrl    = opts.baseUrl ?? '';
    const _fetch     = opts.fetch ?? globalThis.fetch;

    let seq        = 0;
    let lastMethod: 'delta' | 'snapshot' | 'idle' = 'idle';
    let timer: ReturnType<typeof setInterval> | null = null;

    const doSnapshot = async (): Promise<void> => {
      const ab = await _fetch(`${baseUrl}/snapshot.bin`).then(r => r.arrayBuffer());
      this.applySnapshotFromArrayBuffer(ab);
      lastMethod = 'snapshot';
    };

    const doTick = async (): Promise<void> => {
      const head = await _fetch(`${baseUrl}/head`).then(r => r.json()) as { seq: number };
      const gap  = head.seq - seq;
      if (gap <= 0) return;

      if (syncConfig.mode === 'incremental' && gap <= (syncConfig.snapshotEvery ?? 15)) {
        for (let s = seq + 1; s <= head.seq; s++) {
          const res = await _fetch(`${baseUrl}/d/${s}.bin`);
          if (!res.ok) { await doSnapshot(); seq = head.seq; opts.onChange?.(); return; }
          this.applyDeltaFromArrayBuffer(await res.arrayBuffer());
        }
        lastMethod = 'delta';
      } else {
        await doSnapshot();
      }

      seq = head.seq;
      opts.onChange?.();
    };

    // Initial load
    if (syncConfig.mode === 'static') {
      await doSnapshot();
      seq = 0;
      return {
        stop()          {},
        async refresh() {},
        get seq()        { return seq; },
        get lastMethod() { return lastMethod; },
      };
    }

    // For all other modes, fetch initial snapshot + head
    await doSnapshot();
    const head = await _fetch(`${baseUrl}/head`).then(r => r.json()) as { seq: number };
    seq = head.seq;
    opts.onChange?.();

    // Start polling for snapshot / incremental
    if (syncConfig.mode === 'snapshot' || syncConfig.mode === 'incremental') {
      const pollMs = syncConfig.pollMs;
      timer = setInterval(() => { doTick().catch(() => {}); }, pollMs);
    }

    return {
      stop() {
        if (timer !== null) { clearInterval(timer); timer = null; }
      },
      refresh: doTick,
      get seq()        { return seq; },
      get lastMethod() { return lastMethod; },
    };
  }
}
