import * as fs   from 'fs';
import * as path from 'path';
import { parseIQSchema, binaryFields, toSchemaNode } from '../../schema/iq-parser';
import { normalizeAll }                from '../core/normalizer';
import { encodeColumns }               from '../core/binary-encoder';
import { writeBinaryArtifact, log, fmtBytes } from './utils';

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT          = path.resolve(__dirname, '..', '..');
const SCHEMA_FILE   = path.join(ROOT, 'schema', 'indexql.iq');
const DATA_FILE     = path.join(ROOT, 'data',   'products.json');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');

function parseArgs(): { dataFile: string; outDir: string } {
  const args = process.argv.slice(2);
  let dataFile = DATA_FILE;
  let outDir   = ARTIFACTS_DIR;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data'     && args[i + 1]) dataFile = path.resolve(args[++i]);
    if (args[i] === '--products' && args[i + 1]) dataFile = path.resolve(args[++i]);
    if (args[i] === '--out'      && args[i + 1]) outDir   = path.resolve(args[++i]);
  }
  return { dataFile, outDir };
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function build(): Promise<void> {
  const { dataFile, outDir } = parseArgs();
  const start = Date.now();

  log.bold('IndexQL – Artifact Build Pipeline (v2 binary)');
  log.blank();

  // ── 1. Schema ──────────────────────────────────────────────────────────────
  log.info('Parsing schema…');
  const iqSrc    = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const iqSchema = parseIQSchema(iqSrc);
  const binCols  = binaryFields(iqSchema);
  log.success(`Schema parsed: ${iqSchema.fields.length} fields  (${binCols.length} binary)`);

  // ── 2. Load & Normalize ────────────────────────────────────────────────────
  log.info('Loading data…');
  const rawRecords: Record<string, unknown>[] = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  log.success(`Loaded ${rawRecords.length} raw records`);

  log.info('Normalizing…');
  const node  = toSchemaNode(iqSchema);
  const items = normalizeAll(rawRecords, node);
  log.success(`Normalized ${items.length} items`);

  // ── 3. Encode binary columns ───────────────────────────────────────────────
  log.info('Encoding binary columns…');
  const columnMetas = binCols.map(f => ({ name: f.name, typeName: f.typeName, bits: f.bits! }));
  const binaryBuf = encodeColumns(items, columnMetas);
  log.success(`Binary encoded: ${fmtBytes(binaryBuf.byteLength)} (${items.length} × ${columnMetas.length} cols)`);

  // ── 4. Write ───────────────────────────────────────────────────────────────
  log.info(`Writing artifact to ${outDir}/…`);
  const binaryMeta = writeBinaryArtifact(outDir, 'products.bin', binaryBuf);
  log.success(`  products.bin    ${fmtBytes(binaryMeta.sizeBytes)}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  log.blank();
  log.bold(`Build complete in ${Date.now() - start} ms`);
  log.dim(`  Items      : ${items.length}`);
  log.dim(`  Binary     : ${fmtBytes(binaryBuf.byteLength)}`);
  log.dim(`  Artifacts  : ${outDir}`);
}

build().catch(err => {
  log.error(String(err));
  process.exit(1);
});
