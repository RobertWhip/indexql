import * as fs   from 'fs';
import * as path from 'path';
import { decodeColumns, reconstruct } from '../core/binary-encoder';
import { FacetData, Manifest } from '../core/types';
import { readJson, fileExists, log, fmtBytes } from './utils';

const ROOT          = path.resolve(__dirname, '..', '..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');

function parseArgs(): { artifactsDir: string } {
  const args = process.argv.slice(2);
  let artifactsDir = ARTIFACTS_DIR;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--artifacts' && args[i + 1]) artifactsDir = path.resolve(args[++i]);
  }
  return { artifactsDir };
}

function hr(): void { console.log('─'.repeat(60)); }

function inspect(): void {
  const { artifactsDir } = parseArgs();
  const manifestPath = path.join(artifactsDir, 'manifest.json');

  if (!fileExists(manifestPath)) {
    log.error(`No manifest found at ${manifestPath}. Run "npm run build" first.`);
    process.exit(1);
  }

  const manifest = readJson<Manifest>(manifestPath);

  // ── Manifest ───────────────────────────────────────────────────────────────
  log.bold('IndexQL – Artifact Inspector (v2 binary)');
  log.blank();
  hr();
  console.log('MANIFEST');
  hr();
  console.log(`  Version      : ${manifest.version}`);
  console.log(`  Generated At : ${manifest.generatedAt}`);
  console.log(`  Schema Hash  : ${manifest.schema}`);
  console.log(`  Items        : ${manifest.numItems} items`);
  console.log(`  binary       : ${fmtBytes(manifest.files.binary.sizeBytes)}`);
  console.log(`  strings.json : ${fmtBytes(manifest.files.strings.sizeBytes)}`);
  console.log(`  facets.json  : ${fmtBytes(manifest.files.facets.sizeBytes)}`);

  // ── Column layout ──────────────────────────────────────────────────────────
  const binaryPath = path.join(artifactsDir, manifest.files.binary.name);
  if (fileExists(binaryPath)) {
    const buf     = fs.readFileSync(binaryPath);
    const decoded = decodeColumns(buf);

    log.blank();
    hr();
    console.log('BINARY COLUMN LAYOUT');
    hr();
    let strideBytes = 0;
    decoded.meta.forEach((col, i) => {
      const bytes = col.bits / 8;
      strideBytes += bytes;
      console.log(`  [${i}] ${col.name.padEnd(16)} ${col.typeName.padEnd(8)} ${col.bits} bits  (${bytes} B/row)`);
    });
    console.log(`\n  Stride per item    : ${strideBytes} bytes`);
    console.log(`  Rows               : ${decoded.numRows}`);
    console.log(`  Data section size  : ${fmtBytes(decoded.numRows * strideBytes)}`);
    console.log(`  Total file size    : ${fmtBytes(buf.byteLength)}`);
  }

  // ── Facets ─────────────────────────────────────────────────────────────────
  const facetsPath = path.join(artifactsDir, 'facets.json');
  if (fileExists(facetsPath)) {
    const facetData = readJson<FacetData>(facetsPath);

    log.blank();
    hr();
    console.log('FACETS');
    hr();

    for (const facet of facetData.facets) {
      if (facet.type === 'TERMS') {
        console.log(`\n  [TERMS] ${facet.field}  (${facet.buckets.length} values, ${facet.total} items)`);
        facet.buckets.slice(0, 8).forEach(b =>
          console.log(`    ${b.value.padEnd(28)} ${String(b.count).padStart(4)}`));
        if (facet.buckets.length > 8) console.log(`    … +${facet.buckets.length - 8} more`);
      } else {
        console.log(`\n  [RANGE] ${facet.field}  (min: ${facet.min}, max: ${facet.max})`);
        facet.buckets.forEach(b =>
          console.log(`    ${b.label.padEnd(20)} ${String(b.count).padStart(4)} items`));
      }
    }
  }

  // ── Sample Items ──────────────────────────────────────────────────────────
  if (fileExists(binaryPath)) {
    const buf     = fs.readFileSync(binaryPath);
    const stringsPath = path.join(artifactsDir, 'strings.json');
    const strings = fileExists(stringsPath)
      ? readJson<Record<string, string[] | string[][]>>(stringsPath)
      : {};

    const items = reconstruct(buf, strings);

    log.blank();
    hr();
    console.log(`SAMPLE  (first 5 of ${items.length})`);
    hr();
    items.slice(0, 5).forEach((item, i) => {
      const fields = Object.entries(item)
        .filter(([, v]) => typeof v !== 'object' || !Array.isArray(v))
        .map(([k, v]) => `${k}=${v}`)
        .slice(0, 6)
        .join('  ');
      console.log(`  ${i + 1}. ${fields}`);
    });
  }

  log.blank();
  log.success('Inspect complete');
}

inspect();
