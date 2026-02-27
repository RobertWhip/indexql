import { hashString, fmtBytes, fmtMs }                from '../src/cli/utils';
import { encodeColumns, decodeColumns, ColumnMeta }    from '../src/core/binary-encoder';
import { normalizeAll }                                from '../src/core/normalizer';
import { computeFacets }                               from '../src/core/facet';
import { Entity, Column, Facet, DataType, getEntitySchema, toSchemaNode } from '../src/core/entity';
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

// ── Decorator entity fixture ─────────────────────────────────────────────────

@Entity('products')
class TestProduct {
  @Column({ type: DataType.String })
  id!: string;

  @Column({ type: DataType.String })
  name!: string;

  @Column({ type: DataType.Float32 })
  @Facet('RANGE')
  price!: number;

  @Column({ type: DataType.String })
  @Facet('TERMS')
  category!: string;

  @Column({ type: DataType.String })
  @Facet('TERMS')
  brand!: string;

  @Column({ type: DataType.Float32 })
  rating!: number;

  @Column({ type: DataType.Bool })
  inStock!: boolean;

  @Column({ type: DataType.String, isArray: true })
  tags!: string[];

  @Column({ type: DataType.String })
  description!: string;
}

const node = toSchemaNode(getEntitySchema(TestProduct));

const RAW_ITEMS = [
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

run('Pipeline: normalize → facet → encodeColumns → reconstruct round-trip', () => {
  const items = normalizeAll(RAW_ITEMS as Record<string, unknown>[], node);

  assertEq(items.length,       3,     '3 items normalized');
  assertEq(items[0]['price'],  29.99, 'price coerced from string');
  assertEq(items[0]['inStock'], true, 'inStock coerced from "true"');

  // Facets
  const facets = computeFacets(items, node);
  assert(facets.length >= 2, 'at least 2 facets');

  // Binary encode/decode round-trip
  const buf     = encodeColumns(items, BINARY_COLS);
  const decoded = decodeColumns(buf);
  assertEq(decoded.numRows, 3, '3 rows decoded from binary');

  // Check a value
  const priceIdx = decoded.meta.findIndex(m => m.name === 'price');
  const price0   = Number(decoded.getValue(priceIdx, 0));
  assert(Math.abs(price0 - 29.99) < 0.01, `price[0] ≈ 29.99, got ${price0}`);
});
