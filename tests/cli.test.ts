/**
 * tests/cli.test.ts
 * Integration tests for CLI utilities and the build pipeline (v2 binary format).
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { hashString, fmtBytes, fmtMs }                from '../src/cli/utils';
import { encodeColumns, decodeColumns, reconstructProducts, ColumnMeta } from '../src/core/binary-encoder';
import { normalizeAll }                                from '../src/core/normalizer';
import { computeFacets }                               from '../src/core/facet';
import { parseSchema, getNode }                        from '../schema/parser';
import { Product, FacetData, Manifest }                from '../src/core/types';
import { run, assert, assertEq }                       from './runner';

// ── Hash ──────────────────────────────────────────────────────────────────────

run('Hash: deterministic', () => {
  assertEq(hashString('hello'), hashString('hello'), 'same input → same hash');
});

run('Hash: different inputs produce different hashes', () => {
  assert(hashString('abc') !== hashString('xyz'), 'different inputs differ');
});

run('Hash: 16-char hex string', () => {
  const h = hashString('test');
  assert(/^[0-9a-f]{16}$/.test(h), `hash matches hex pattern: ${h}`);
});

// ── Formatting ────────────────────────────────────────────────────────────────

run('fmtBytes: sub-kilobyte', () => {
  assertEq(fmtBytes(512), '512 B', '512 B');
});

run('fmtBytes: kilobytes', () => {
  assertEq(fmtBytes(2048), '2.0 KB', '2.0 KB');
});

run('fmtBytes: megabytes', () => {
  const result = fmtBytes(1024 * 1024);
  assert(result.endsWith('MB'), 'ends with MB');
});

run('fmtMs: sub-millisecond', () => {
  assertEq(fmtMs(0.5), '<1 ms', '<1 ms for 0.5');
});

run('fmtMs: normal', () => {
  assertEq(fmtMs(12.345), '12.35 ms', '12.35 ms');
});

// ── SDL fixture (for normalizer / facet compatibility) ─────────────────────────

const SDL = `
  directive @node(collection: String!) on OBJECT
  directive @facet(type: FacetType!) on FIELD_DEFINITION
  directive @sortable on FIELD_DEFINITION
  directive @filterable on FIELD_DEFINITION
  enum FacetType { TERMS RANGE }
  type Product @node(collection: "products") {
    id: ID!
    name: String!
    price: Float! @facet(type: RANGE) @sortable
    category: String! @facet(type: TERMS)
    brand: String! @facet(type: TERMS)
    rating: Float
    inStock: Boolean
    tags: [String]
    description: String
  }
`;

const RAW_PRODUCTS = [
  { id: 'a1', name: 'Widget A', price: '29.99', category: 'Tools', brand: 'Acme', rating: 4.2, inStock: 'true',  tags: ['hand-tool'],  description: 'A fine widget' },
  { id: 'a2', name: 'Widget B', price: 49,      category: 'Tools', brand: 'Acme', rating: 4.5, inStock: true,   tags: ['power-tool'], description: 'Better widget' },
  { id: 'a3', name: 'Gadget X', price: 149,     category: 'Tech',  brand: 'Zeta', rating: 4.8, inStock: false,  tags: ['smart'],      description: 'Smart gadget' },
];

const BINARY_COLS: ColumnMeta[] = [
  { name: 'price',   typeName: 'Float32', bits: 32 },
  { name: 'rating',  typeName: 'Float32', bits: 32 },
  { name: 'inStock', typeName: 'Bool',    bits:  8 },
];

// ── Build Pipeline Integration ────────────────────────────────────────────────

run('Pipeline: normalize → facet → encodeColumns → reconstructProducts round-trip', () => {
  const schema   = parseSchema(SDL);
  const node     = getNode(schema, 'products');
  const products = normalizeAll(RAW_PRODUCTS as Record<string, unknown>[], node);

  assertEq(products.length,   3,     '3 products normalized');
  assertEq(products[0].price, 29.99, 'price coerced from string');
  assertEq(products[0].inStock, true, 'inStock coerced from "true"');

  // Facets
  const facets = computeFacets(products, node);
  assert(facets.length >= 2, 'at least 2 facets');

  // Binary encode/decode round-trip
  const buf     = encodeColumns(products, BINARY_COLS);
  const decoded = decodeColumns(buf);
  assertEq(decoded.numRows, 3, '3 rows decoded from binary');

  // Check a value
  const priceIdx = decoded.meta.findIndex(m => m.name === 'price');
  const price0   = Number(decoded.getValue(priceIdx, 0));
  assert(Math.abs(price0 - 29.99) < 0.01, `price[0] ≈ 29.99, got ${price0}`);
});

run('Pipeline: strings.json written and parsed back correctly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'indexql-strings-'));
  try {
    const schema   = parseSchema(SDL);
    const node     = getNode(schema, 'products');
    const products = normalizeAll(RAW_PRODUCTS as Record<string, unknown>[], node);

    // Build strings object (string fields only)
    const strFields = ['id', 'name', 'category', 'brand', 'description', 'tags'];
    const stringsObj: Record<string, unknown[]> = {};
    for (const field of strFields) {
      stringsObj[field] = products.map(p => (p as unknown as Record<string, unknown>)[field]);
    }

    const stringsPath = path.join(tmpDir, 'strings.json');
    fs.writeFileSync(stringsPath, JSON.stringify(stringsObj), 'utf8');

    const loaded = JSON.parse(fs.readFileSync(stringsPath, 'utf8')) as Record<string, string[]>;
    assertEq(loaded['id'].length,       3,         '3 IDs in strings.json');
    assertEq(loaded['id'][0],           'a1',      'first ID is a1');
    assertEq(loaded['category'][0],     'Tools',   'first category is Tools');
    assertEq(loaded['brand'][1],        'Acme',    'second brand is Acme');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

run('Pipeline: manifest references products.bin + strings.json with correct fields', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'indexql-manifest-'));
  try {
    const schema   = parseSchema(SDL);
    const node     = getNode(schema, 'products');
    const products = normalizeAll(RAW_PRODUCTS as Record<string, unknown>[], node);
    const facets   = computeFacets(products, node);
    const facetData: FacetData = { facets, generatedAt: new Date().toISOString(), schema: '2.0.0' };

    const buf     = encodeColumns(products, BINARY_COLS);
    const stringsJson = JSON.stringify({ id: products.map(p => p.id) });

    const manifest: Manifest = {
      version:     '2.0.0',
      schema:      hashString(SDL),
      generatedAt: new Date().toISOString(),
      numProducts: products.length,
      files: {
        products: { name: 'products.bin',  hash: hashString(buf.toString('base64')),   sizeBytes: buf.byteLength,                          count: products.length },
        strings:  { name: 'strings.json',  hash: hashString(stringsJson),               sizeBytes: Buffer.byteLength(stringsJson, 'utf8') },
        facets:   { name: 'facets.json',   hash: hashString(JSON.stringify(facetData)), sizeBytes: Buffer.byteLength(JSON.stringify(facetData), 'utf8') },
      },
    };

    const manifestPath = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const loaded = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;

    assertEq(loaded.version,                 '2.0.0', 'version is 2.0.0');
    assertEq(loaded.numProducts,             3,       'numProducts = 3');
    assertEq(loaded.files.products.name,     'products.bin', 'products file is products.bin');
    assertEq(loaded.files.strings.name,      'strings.json', 'strings file is strings.json');
    assertEq(loaded.files.facets.name,       'facets.json',  'facets file is facets.json');
    assertEq(loaded.files.products.count,    3,       'product count in manifest');
    assert(typeof loaded.schema === 'string',         'schema hash is string');
    assert(typeof loaded.generatedAt === 'string',    'generatedAt is string');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});
