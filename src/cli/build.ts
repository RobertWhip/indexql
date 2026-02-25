/**
 * src/cli/build.ts
 * IndexQL artifact build pipeline (v2 – binary format).
 *
 * Usage: npx ts-node src/cli/build.ts [--products <path>] [--out <dir>]
 *
 * Outputs:
 *   artifacts/products.bin  – column-major binary (numeric/bool fields)
 *   artifacts/strings.json  – parallel string arrays
 *   artifacts/facets.json   – pre-computed facets (plain JSON)
 *   artifacts/manifest.json – hashes, sizes, counts
 */

import * as fs   from 'fs';
import * as path from 'path';
import { parseIQSchema, binaryFields, stringFields, toSchemaNode } from '../../schema/iq-parser';
import { normalizeAll }           from '../core/normalizer';
import { computeFacets }          from '../core/facet';
import { encodeColumns }          from '../core/binary-encoder';
import { FacetData, Manifest }    from '../core/types';
import { writeBinaryArtifact, writeJsonArtifact, readJson, log, fmtBytes, hashString } from './utils';

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT          = path.resolve(__dirname, '..', '..');
const SCHEMA_FILE   = path.join(ROOT, 'schema', 'indexql.iq');
const PRODUCTS_FILE = path.join(ROOT, 'data',   'products.json');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const SCHEMA_VERSION = '2.0.0';

function parseArgs(): { productsFile: string; outDir: string } {
  const args = process.argv.slice(2);
  let productsFile = PRODUCTS_FILE;
  let outDir       = ARTIFACTS_DIR;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--products' && args[i + 1]) productsFile = path.resolve(args[++i]);
    if (args[i] === '--out'      && args[i + 1]) outDir       = path.resolve(args[++i]);
  }
  return { productsFile, outDir };
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function build(): Promise<void> {
  const { productsFile, outDir } = parseArgs();
  const start = Date.now();

  log.bold('IndexQL – Artifact Build Pipeline (v2 binary)');
  log.blank();

  // ── 1. Schema ──────────────────────────────────────────────────────────────
  log.info('Parsing schema…');
  const iqSrc    = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const iqSchema = parseIQSchema(iqSrc);
  const node     = toSchemaNode(iqSchema);
  const binCols  = binaryFields(iqSchema);
  const strCols  = stringFields(iqSchema);
  log.success(`Schema parsed: ${iqSchema.fields.length} fields  (${binCols.length} binary, ${strCols.length} string)`);

  // ── 2. Load & Normalize ────────────────────────────────────────────────────
  log.info('Loading products…');
  const rawProducts = readJson<Record<string, unknown>[]>(productsFile);
  log.success(`Loaded ${rawProducts.length} raw records`);

  log.info('Normalizing…');
  const products = normalizeAll(rawProducts, node);
  log.success(`Normalized ${products.length} products`);

  // ── 3. Facets ──────────────────────────────────────────────────────────────
  log.info('Computing facets…');
  const facets = computeFacets(products, node);
  const facetData: FacetData = {
    facets,
    generatedAt: new Date().toISOString(),
    schema: SCHEMA_VERSION,
  };
  log.success(`Computed ${facets.length} facets: ${facets.map(f => f.field).join(', ')}`);

  // ── 4. Encode binary columns ───────────────────────────────────────────────
  log.info('Encoding binary columns…');
  const columnMetas = binCols.map(f => ({ name: f.name, typeName: f.typeName, bits: f.bits! }));
  const productsBuf = encodeColumns(products, columnMetas);
  log.success(`Binary encoded: ${fmtBytes(productsBuf.byteLength)} (${products.length} × ${columnMetas.length} cols)`);

  // ── 5. Build strings object ────────────────────────────────────────────────
  log.info('Building strings index…');
  const stringsObj: Record<string, unknown[]> = {};
  for (const f of strCols) {
    stringsObj[f.name] = products.map(p => (p as unknown as Record<string, unknown>)[f.name]);
  }

  // ── 6. Write ───────────────────────────────────────────────────────────────
  log.info(`Writing artifacts to ${outDir}/…`);

  const productsMeta = writeBinaryArtifact(outDir, 'products.bin', productsBuf, products.length);
  log.success(`  products.bin    ${fmtBytes(productsMeta.sizeBytes)}`);

  const stringsMeta = writeJsonArtifact(outDir, 'strings.json', stringsObj);
  log.success(`  strings.json    ${fmtBytes(stringsMeta.sizeBytes)}`);

  const facetsMeta = writeJsonArtifact(outDir, 'facets.json', facetData);
  log.success(`  facets.json     ${fmtBytes(facetsMeta.sizeBytes)}`);

  // ── Manifest ───────────────────────────────────────────────────────────────
  const schemaHash = hashString(iqSrc);
  const manifest: Manifest = {
    version:     SCHEMA_VERSION,
    schema:      schemaHash,
    generatedAt: new Date().toISOString(),
    numProducts: products.length,
    files: {
      products: productsMeta,
      strings:  stringsMeta,
      facets:   facetsMeta,
    },
  };

  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  log.success(`  manifest.json`);

  // ── Summary ────────────────────────────────────────────────────────────────
  log.blank();
  log.bold(`Build complete in ${Date.now() - start} ms`);
  log.dim(`  Products   : ${products.length}`);
  log.dim(`  Facets     : ${facets.length}`);
  log.dim(`  Binary     : ${fmtBytes(productsBuf.byteLength)}`);
  log.dim(`  Artifacts  : ${outDir}`);
  log.dim(`  Schema     : ${schemaHash}`);
}

build().catch(err => {
  log.error(String(err));
  process.exit(1);
});
