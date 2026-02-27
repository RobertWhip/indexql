import * as fs   from 'fs';
import * as path from 'path';
import { getEntitySchema, toSchemaNode } from '../core/entity';
import { reconstruct }                from '../core/binary-encoder';
import { Entity, SchemaNode, QueryOptions, QueryResult } from '../core/types';
import { executeQuery }                from './query';
import { now }                         from './utils';

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT          = path.resolve(__dirname, '..', '..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClientConfig {
  artifactsDir?: string;
  /** Decorated entity class — used to derive the schema for facet computation. */
  entity?:       Function;
}

export interface ClientStats {
  loadTimeMs:   number;
  itemCount:    number;
  artifactsDir: string;
}

// ── IndexQL Client ────────────────────────────────────────────────────────────

export class IndexQLClient {
  private items!:      Entity[];
  private schemaNode?: SchemaNode;
  private readonly artifactsDir: string;
  private readonly entityClass?: Function;
  private stats!:      ClientStats;

  private constructor(config: ClientConfig = {}) {
    this.artifactsDir = config.artifactsDir ?? ARTIFACTS_DIR;
    this.entityClass  = config.entity;
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  private loadSync(): void {
    const t0 = now();

    // 1. Load binary data
    const binaryPath = path.join(this.artifactsDir, 'products.bin');
    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `IndexQL: products.bin not found at ${binaryPath}.\n` +
        `Run "npm run build" to generate artifacts first.`
      );
    }
    const binaryBuf = fs.readFileSync(binaryPath);
    this.items      = reconstruct(binaryBuf);

    // 2. Derive schema node from entity class (if provided)
    if (this.entityClass) {
      const schema = getEntitySchema(this.entityClass);
      this.schemaNode = toSchemaNode(schema);
    }

    const loadTimeMs = now() - t0;
    this.stats = {
      loadTimeMs,
      itemCount:    this.items.length,
      artifactsDir: this.artifactsDir,
    };
  }

  /** Create and initialize a client synchronously. */
  static load(config: ClientConfig = {}): IndexQLClient {
    const client = new IndexQLClient(config);
    client.loadSync();
    return client;
  }

  // ── Query API ──────────────────────────────────────────────────────────────

  query(options: QueryOptions = {}): QueryResult {
    return executeQuery(this.items, options, this.schemaNode ? { node: this.schemaNode } : undefined);
  }

  getStats(): ClientStats {
    return this.stats;
  }

  getAll(): Entity[] {
    return this.items;
  }
}
