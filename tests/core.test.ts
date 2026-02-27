import { encodeColumns, decodeColumns, ColumnMeta } from '../src/core/binary-encoder';
import { normalizeRecord, normalizeAll }                         from '../src/core/normalizer';
import { computeFacets }                                         from '../src/core/facet';
import { Entity, Column, Facet, DataType, getEntitySchema, toSchemaNode } from '../src/core/entity';
import { Entity as EntityType, SchemaNode }                      from '../src/core/types';
import { run, assert, assertEq }                                 from './runner';

// ── Fixture: decorated entity class ──────────────────────────────────────────

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
  @Facet('RANGE')
  rating!: number;

  @Column({ type: DataType.Bool })
  inStock!: boolean;

  @Column({ type: DataType.String, isArray: true })
  tags!: string[];

  @Column({ type: DataType.String })
  description!: string;
}

const node: SchemaNode = toSchemaNode(getEntitySchema(TestProduct));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_ITEMS: EntityType[] = [
  { id: 'p1', name: 'Alpha Headphones', price: 299,  category: 'Electronics', brand: 'Sony',    rating: 4.5, inStock: true,  tags: ['audio'],  description: 'Great sound' },
  { id: 'p2', name: 'Beta Speaker',     price: 149,  category: 'Electronics', brand: 'Bose',    rating: 4.2, inStock: false, tags: ['audio'],  description: 'Portable speaker' },
  { id: 'p3', name: 'Gamma Jacket',     price:  89,  category: 'Clothing',    brand: 'Nike',    rating: 4.6, inStock: true,  tags: ['sport'],  description: 'Lightweight jacket' },
  { id: 'p4', name: 'Delta Jeans',      price:  59,  category: 'Clothing',    brand: "Levi's",  rating: 4.3, inStock: true,  tags: ['denim'],  description: 'Classic fit' },
  { id: 'p5', name: 'Epsilon Book',     price:  19,  category: 'Books',       brand: 'Penguin', rating: 4.8, inStock: true,  tags: ['read'],   description: 'Must-read' },
];

const BINARY_COLS: ColumnMeta[] = [
  { name: 'price',   typeName: 'Float32', bits: 32 },
  { name: 'rating',  typeName: 'Float32', bits: 32 },
  { name: 'inStock', typeName: 'Bool',    bits:  8 },
];

// ── Binary Encoder Tests ──────────────────────────────────────────────────────

run('BinaryEncoder: round-trip encodeColumns / decodeColumns', () => {
  const buf      = encodeColumns(SAMPLE_ITEMS, BINARY_COLS);
  const decoded  = decodeColumns(buf);

  assertEq(decoded.numRows,       SAMPLE_ITEMS.length, 'numRows preserved');
  assertEq(decoded.meta.length,   BINARY_COLS.length,  'column count preserved');

  // Verify a few values
  const priceIdx = decoded.meta.findIndex(m => m.name === 'price');
  const p0price  = decoded.getValue(priceIdx, 0);
  assert(Math.abs(Number(p0price) - 299) < 0.01, `price[0] ≈ 299, got ${p0price}`);

  const inStockIdx = decoded.meta.findIndex(m => m.name === 'inStock');
  assertEq(decoded.getValue(inStockIdx, 0), true,  'inStock[0] = true');
  assertEq(decoded.getValue(inStockIdx, 1), false, 'inStock[1] = false');
});

run('BinaryEncoder: magic bytes are "IQBN" at offset 0-3', () => {
  const buf   = encodeColumns(SAMPLE_ITEMS, BINARY_COLS);
  const magic = buf.slice(0, 4).toString('ascii');
  assertEq(magic, 'IQBN', 'magic bytes match');
});

run('BinaryEncoder: stride matches descriptor data in header', () => {
  // Stride should equal sum of bytes per binary field
  const expected = BINARY_COLS.reduce((sum, c) => sum + c.bits / 8, 0);

  // Encode and verify: data section = numRows × stride
  const buf   = encodeColumns(SAMPLE_ITEMS, BINARY_COLS);
  const dec   = decodeColumns(buf);
  const actualStride = dec.meta.reduce((sum, m) => sum + m.bits / 8, 0);
  assertEq(actualStride, expected, 'decoded stride matches expected stride');
});

run('BinaryEncoder: getValue random-access returns correct values', () => {
  const buf     = encodeColumns(SAMPLE_ITEMS, BINARY_COLS);
  const decoded = decodeColumns(buf);
  const rIdx    = decoded.meta.findIndex(m => m.name === 'rating');

  for (let i = 0; i < SAMPLE_ITEMS.length; i++) {
    const got      = Number(decoded.getValue(rIdx, i));
    const expected = SAMPLE_ITEMS[i].rating as number;
    assert(Math.abs(got - expected) < 0.001, `rating[${i}] ≈ ${expected}, got ${got}`);
  }
});

run('BinaryEncoder: large payload (1000 items × 3 columns) round-trips', () => {
  const big: EntityType[] = Array.from({ length: 1000 }, (_, i) => ({
    ...SAMPLE_ITEMS[i % SAMPLE_ITEMS.length],
    id:     `p${i}`,
    price:  10 + i * 0.5,
    rating: 1 + (i % 5) * 0.8,
  }));

  const buf     = encodeColumns(big, BINARY_COLS);
  const decoded = decodeColumns(buf);
  assertEq(decoded.numRows, 1000, '1000 rows decoded');

  const priceIdx = decoded.meta.findIndex(m => m.name === 'price');
  const got0     = Number(decoded.getValue(priceIdx, 0));
  assert(Math.abs(got0 - 10) < 0.01, `price[0] ≈ 10, got ${got0}`);
  const got999   = Number(decoded.getValue(priceIdx, 999));
  assert(Math.abs(got999 - (10 + 999 * 0.5)) < 0.1, `price[999] ≈ ${10 + 999 * 0.5}`);
});

// ── Normalizer Tests ──────────────────────────────────────────────────────────

run('Normalizer: passes through valid entity', () => {
  const item = normalizeRecord(SAMPLE_ITEMS[0] as Record<string, unknown>, node);
  assertEq(item['id'],       'p1',           'id preserved');
  assertEq(item['price'],    299,            'price preserved');
  assertEq(item['inStock'],  true,           'inStock preserved');
  assertEq(item['category'], 'Electronics',  'category preserved');
});

run('Normalizer: coerces price string to float', () => {
  const raw  = { ...SAMPLE_ITEMS[0], price: '149.99' } as Record<string, unknown>;
  const item = normalizeRecord(raw, node);
  assertEq(item['price'], 149.99, 'string price coerced to float');
});

run('Normalizer: fills missing nullable fields with defaults', () => {
  const raw  = { id: 'x1', name: 'Test' } as Record<string, unknown>;
  const item = normalizeRecord(raw, node);
  assertEq(item['price'],   0,     'missing price defaults to 0');
  assertEq(item['inStock'], false, 'missing inStock defaults to false');
  assert(Array.isArray(item['tags']) && (item['tags'] as string[]).length === 0, 'missing tags defaults to []');
});

run('Normalizer: strips undeclared fields', () => {
  const raw  = { ...SAMPLE_ITEMS[0], _secret: 'hidden', __v: 1 } as Record<string, unknown>;
  const item = normalizeRecord(raw, node);
  assert(!('_secret' in item), '_secret stripped');
  assert(!('__v'     in item), '__v stripped');
});

run('Normalizer: normalizeAll filters empty ids', () => {
  const raws = [
    ...(SAMPLE_ITEMS as Record<string, unknown>[]),
    { name: 'No ID item' },
  ];
  const out = normalizeAll(raws, node);
  assertEq(out.length, SAMPLE_ITEMS.length, 'item without id is filtered out');
});

// ── Facet Computation Tests ───────────────────────────────────────────────────

run('Facets: TERMS facet for category', () => {
  const facets = computeFacets(SAMPLE_ITEMS, node);
  const cat    = facets.find(f => f.field === 'category');
  assert(cat !== undefined,       'category facet computed');
  assert(cat!.type === 'TERMS',   'category facet is TERMS');
  const tf = cat as import('../src/core/types').TermsFacet;
  assertEq(tf.buckets.length, 3, 'three categories');
  assert(tf.buckets.some(b => b.value === 'Electronics' && b.count === 2), 'Electronics × 2');
  assert(tf.buckets.some(b => b.value === 'Clothing'    && b.count === 2), 'Clothing × 2');
  assert(tf.buckets.some(b => b.value === 'Books'       && b.count === 1), 'Books × 1');
});

run('Facets: RANGE facet for price', () => {
  const facets = computeFacets(SAMPLE_ITEMS, node);
  const price  = facets.find(f => f.field === 'price');
  assert(price !== undefined,    'price facet computed');
  assert(price!.type === 'RANGE','price facet is RANGE');
  const rf = price as import('../src/core/types').RangeFacet;
  assertEq(rf.min,  19, 'min price is 19');
  assertEq(rf.max, 299, 'max price is 299');
  assert(rf.buckets.length > 0, 'price buckets populated');
  const total = rf.buckets.reduce((s, b) => s + b.count, 0);
  assertEq(total, SAMPLE_ITEMS.length, 'all items accounted in buckets');
});

run('Facets: TERMS facet sorted by count desc', () => {
  const facets = computeFacets(SAMPLE_ITEMS, node);
  const brand  = facets.find(f => f.field === 'brand') as import('../src/core/types').TermsFacet;
  assert(brand !== undefined, 'brand facet exists');
  for (let i = 1; i < brand.buckets.length; i++) {
    assert(brand.buckets[i - 1].count >= brand.buckets[i].count,
      `bucket[${i-1}] count >= bucket[${i}] count`);
  }
});
