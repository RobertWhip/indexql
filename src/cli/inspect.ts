import * as fs   from 'fs';
import * as path from 'path';
import { decodeColumns, reconstruct } from '../core/binary-encoder';
import { fileExists, log, fmtBytes } from './utils';

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
  const binaryPath = path.join(artifactsDir, 'products.bin');

  if (!fileExists(binaryPath)) {
    log.error(`No products.bin found at ${binaryPath}. Run "npm run build" first.`);
    process.exit(1);
  }

  log.bold('IndexQL – Artifact Inspector (v2 binary)');
  log.blank();

  // ── Column layout ──────────────────────────────────────────────────────────
  const buf     = fs.readFileSync(binaryPath);
  const decoded = decodeColumns(buf);

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

  // ── Sample Items ──────────────────────────────────────────────────────────
  const items = reconstruct(buf);

  log.blank();
  hr();
  console.log(`SAMPLE  (first 5 of ${items.length})`);
  hr();
  items.slice(0, 5).forEach((item, i) => {
    const fields = Object.entries(item)
      .map(([k, v]) => `${k}=${v}`)
      .slice(0, 6)
      .join('  ');
    console.log(`  ${i + 1}. ${fields}`);
  });

  log.blank();
  log.success('Inspect complete');
}

inspect();
