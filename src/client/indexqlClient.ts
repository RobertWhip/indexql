import * as fs   from 'fs';
import * as path from 'path';
import { parseIQSchema, toSchemaNode, IQSchema } from '../../schema/iq-parser';
import { reconstruct }                from '../core/binary-encoder';
import { Entity, FacetData, Manifest, QueryOptions, QueryResult } from '../core/types';
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
  facetCount:   number;
  artifactsDir: string;
}

// ── IndexQL Client ────────────────────────────────────────────────────────────

export class IndexQLClient {
  private items!:     Entity[];
  private facetData!: FacetData;
  private manifest!:  Manifest;
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

    // 1. Read manifest
    const manifestPath = path.join(this.artifactsDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(
        `IndexQL: manifest not found at ${manifestPath}.\n` +
        `Run "npm run build" to generate artifacts first.`
      );
    }
    this.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;

    // 2. Load binary data
    const binaryPath  = path.join(this.artifactsDir, this.manifest.files.binary.name);
    const stringsPath = path.join(this.artifactsDir, this.manifest.files.strings.name);
    const binaryBuf   = fs.readFileSync(binaryPath);
    const strings: Record<string, string[] | string[][]> = JSON.parse(fs.readFileSync(stringsPath, 'utf8'));
    this.items        = reconstruct(binaryBuf, strings);

    // 3. Load facets
    const facetsPath = path.join(this.artifactsDir, this.manifest.files.facets.name);
    this.facetData   = JSON.parse(fs.readFileSync(facetsPath, 'utf8')) as FacetData;

    // 4. Parse IQ schema
    const iqSrc   = fs.readFileSync(this.schemaFile, 'utf8');
    this.schema   = parseIQSchema(iqSrc);

    const loadTimeMs = now() - t0;
    this.stats = {
      loadTimeMs,
      itemCount:    this.items.length,
      facetCount:   this.facetData.facets.length,
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

  getFacets(): FacetData['facets'] {
    return this.facetData.facets;
  }

  getManifest(): Manifest {
    return this.manifest;
  }

  getStats(): ClientStats {
    return this.stats;
  }

  getAll(): Entity[] {
    return this.items;
  }
}
