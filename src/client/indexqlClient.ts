import * as fs   from 'fs';
import * as path from 'path';
import { parseIQSchema, toSchemaNode, IQSchema } from '../../schema/iq-parser';
import { reconstruct }                from '../core/binary-encoder';
import { Entity, QueryOptions, QueryResult } from '../core/types';
import { executeQuery }                from './query';
import { now }                         from './utils';

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT          = path.resolve(__dirname, '..', '..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const SCHEMA_FILE   = path.join(ROOT, 'schema', 'indexql.iq');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClientConfig {
  artifactsDir?: string;
  schemaFile?:   string;
}

export interface ClientStats {
  loadTimeMs:   number;
  itemCount:    number;
  artifactsDir: string;
}

// ── IndexQL Client ────────────────────────────────────────────────────────────

export class IndexQLClient {
  private items!:     Entity[];
  private schema!:    IQSchema;
  private readonly artifactsDir: string;
  private readonly schemaFile:   string;
  private stats!:     ClientStats;

  private constructor(config: ClientConfig = {}) {
    this.artifactsDir = config.artifactsDir ?? ARTIFACTS_DIR;
    this.schemaFile   = config.schemaFile   ?? SCHEMA_FILE;
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

    // 2. Parse IQ schema
    const iqSrc   = fs.readFileSync(this.schemaFile, 'utf8');
    this.schema   = parseIQSchema(iqSrc);

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
    const node = toSchemaNode(this.schema);
    return executeQuery(this.items, options, { node });
  }

  getStats(): ClientStats {
    return this.stats;
  }

  getAll(): Entity[] {
    return this.items;
  }
}
