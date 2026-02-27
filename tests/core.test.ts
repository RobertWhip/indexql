import { encodeColumns, decodeColumns, reconstruct, ColumnMeta } from '../src/core/binary-encoder';
import { parseIQSchema, binaryFields, stringFields, stride }    from '../schema/iq-parser';
import { normalizeRecord, normalizeAll }                         from '../src/core/normalizer';
import { computeFacets }                                         from '../src/core/facet';
import { parseSchema, getNode, fieldsWithDirective }             from '../schema/parser';
import { Entity, SchemaNode }                                    from '../src/core/types';
import { run, assert, assertEq }                                 from './runner';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MINI_SDL = `
  directive @node(collection: String!) on OBJECT
  directive @facet(type: FacetType!) on FIELD_DEFINITION
  directive @sortable on FIELD_DEFINITION
  directive @filterable on FIELD_DEFINITION
  enum FacetType { TERMS RANGE }
  type Product @node(collection: "products") {
    id: ID!
    name: String! @filterable
    price: Float! @facet(type: RANGE) @sortable
    category: String! @facet(type: TERMS)
    brand: String! @facet(type: TERMS)
    rating: Float
    inStock: Boolean
    tags: [String]
    description: String
  }
`;

/** Minimal .iq schema for parser tests */
const MINI_IQ = `
# Mini IQ schema for tests
@collection(products)
type Product {
  id:          String
  name:        String
  price:       Float32   @facet(RANGE)
  category:    String    @facet(TERMS)
  brand:       String    @facet(TERMS)
  rating:      Float32   @facet(RANGE)
  inStock:     Bool
  tags:        String[]
  description: String
}
`;

const SAMPLE_ITEMS: Entity[] = [
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
  const iqSchema  = parseIQSchema(MINI_IQ);
  const s         = stride(iqSchema);
  const binFields = binaryFields(iqSchema);

  // Stride should equal sum of bytes per binary field
  const expected = binFields.reduce((sum, f) => sum + (f.bits! / 8), 0);
  assertEq(s, expected, `stride = ${expected} bytes`);

  // Encode and verify: data section = numRows × stride
  const cols  = binFields.map(f => ({ name: f.name, typeName: f.typeName, bits: f.bits! }));
  const buf   = encodeColumns(SAMPLE_ITEMS, cols);
  const dec   = decodeColumns(buf);
  const actualStride = dec.meta.reduce((sum, m) => sum + m.bits / 8, 0);
  assertEq(actualStride, s, 'decoded stride matches schema stride');
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
  const big: Entity[] = Array.from({ length: 1000 }, (_, i) => ({
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

// ── IQ Schema Parser Tests ────────────────────────────────────────────────────

run('IQ Parser: collection and field count', () => {
  const schema = parseIQSchema(MINI_IQ);
  assertEq(schema.collection, 'products', 'collection = products');
  assert(schema.fields.length >= 9, `at least 9 fields, got ${schema.fields.length}`);
});

run('IQ Parser: binary vs string field classification', () => {
  const schema  = parseIQSchema(MINI_IQ);
  const binF    = binaryFields(schema);
  const strF    = stringFields(schema);

  assert(binF.some(f => f.name === 'price'),   'price is binary');
  assert(binF.some(f => f.name === 'rating'),  'rating is binary');
  assert(binF.some(f => f.name === 'inStock'), 'inStock is binary');
  assert(strF.some(f => f.name === 'id'),      'id is string');
  assert(strF.some(f => f.name === 'name'),    'name is string');
  assert(strF.some(f => f.name === 'tags'),    'tags is string');
});

run('IQ Parser: bit widths for binary types', () => {
  const schema = parseIQSchema(MINI_IQ);
  const price  = schema.fields.find(f => f.name === 'price')!;
  const stock  = schema.fields.find(f => f.name === 'inStock')!;
  assertEq(price.bits,  32, 'Float32 → 32 bits');
  assertEq(stock.bits,   8, 'Bool → 8 bits');
});

run('IQ Parser: @facet directives parsed correctly', () => {
  const schema     = parseIQSchema(MINI_IQ);
  const priceField = schema.fields.find(f => f.name === 'price')!;
  const catField   = schema.fields.find(f => f.name === 'category')!;

  const priceFacet = priceField.directives.find(d => d.name === 'facet');
  assert(priceFacet !== undefined, 'price has @facet directive');
  assertEq(String(priceFacet!.args['type']), 'RANGE', 'price @facet type = RANGE');

  const catFacet = catField.directives.find(d => d.name === 'facet');
  assertEq(String(catFacet!.args['type']), 'TERMS', 'category @facet type = TERMS');
});

run('IQ Parser: stride = 9 for (Float32 + Float32 + Bool)', () => {
  const schema = parseIQSchema(MINI_IQ);
  const s = stride(schema);
  // price(4) + rating(4) + inStock(1) = 9
  assertEq(s, 9, 'stride = 9 bytes/item');
});

run('IQ Parser: typeName parsed from schema', () => {
  const schema = parseIQSchema(MINI_IQ);
  assertEq(schema.typeName, 'Product', 'typeName parsed from type block');
});

// ── SDL Parser Tests (kept for compatibility) ─────────────────────────────────

run('Parser: extracts Product @node', () => {
  const schema = parseSchema(MINI_SDL);
  assertEq(schema.nodes.length, 1, 'one @node type');
  assertEq(schema.nodes[0].typeName,  'Product',  'typeName');
  assertEq(schema.nodes[0].collection,'products', 'collection');
});

run('Parser: extracts all fields', () => {
  const schema = parseSchema(MINI_SDL);
  const node   = getNode(schema, 'products');
  assert(node.fields.length >= 9, 'at least 9 fields');
  assert(node.fields.some(f => f.name === 'price'),    'price field');
  assert(node.fields.some(f => f.name === 'category'), 'category field');
  assert(node.fields.some(f => f.name === 'tags'),     'tags field');
});

run('Parser: field types and list', () => {
  const schema = parseSchema(MINI_SDL);
  const node   = getNode(schema, 'products');
  const tags   = node.fields.find(f => f.name === 'tags')!;
  assert(tags.isList,           'tags is a list');
  assertEq(tags.type, 'String', 'tags element type is String');
  const id = node.fields.find(f => f.name === 'id')!;
  assert(id.isRequired, 'id is required');
});

run('Parser: facet directives', () => {
  const schema      = parseSchema(MINI_SDL);
  const node        = getNode(schema, 'products');
  const facetFields = fieldsWithDirective(node, 'facet');
  assertEq(facetFields.length, 3, 'three @facet fields (price, category, brand)');
  assert(facetFields.some(f => f.name === 'price'),    'price is a facet field');
  assert(facetFields.some(f => f.name === 'category'), 'category is a facet field');
  assert(facetFields.some(f => f.name === 'brand'),    'brand is a facet field');
});

run('Parser: enum extraction', () => {
  const schema = parseSchema(MINI_SDL);
  assert(Array.isArray(schema.enums['FacetType']), 'FacetType enum extracted');
  assert(schema.enums['FacetType'].includes('TERMS'), 'TERMS in enum');
  assert(schema.enums['FacetType'].includes('RANGE'), 'RANGE in enum');
});

// ── Normalizer Tests ──────────────────────────────────────────────────────────

run('Normalizer: passes through valid entity', () => {
  const schema = parseSchema(MINI_SDL);
  const node   = getNode(schema, 'products');
  const item   = normalizeRecord(SAMPLE_ITEMS[0] as Record<string, unknown>, node);
  assertEq(item['id'],       'p1',           'id preserved');
  assertEq(item['price'],    299,            'price preserved');
  assertEq(item['inStock'],  true,           'inStock preserved');
  assertEq(item['category'], 'Electronics',  'category preserved');
});

run('Normalizer: coerces price string to float', () => {
  const schema = parseSchema(MINI_SDL);
  const node   = getNode(schema, 'products');
  const raw    = { ...SAMPLE_ITEMS[0], price: '149.99' } as Record<string, unknown>;
  const item   = normalizeRecord(raw, node);
  assertEq(item['price'], 149.99, 'string price coerced to float');
});

run('Normalizer: fills missing nullable fields with defaults', () => {
  const schema = parseSchema(MINI_SDL);
  const node   = getNode(schema, 'products');
  const raw    = { id: 'x1', name: 'Test' } as Record<string, unknown>;
  const item   = normalizeRecord(raw, node);
  assertEq(item['price'],   0,     'missing price defaults to 0');
  assertEq(item['inStock'], false, 'missing inStock defaults to false');
  assert(Array.isArray(item['tags']) && (item['tags'] as string[]).length === 0, 'missing tags defaults to []');
});

run('Normalizer: strips undeclared fields', () => {
  const schema  = parseSchema(MINI_SDL);
  const node    = getNode(schema, 'products');
  const raw     = { ...SAMPLE_ITEMS[0], _secret: 'hidden', __v: 1 } as Record<string, unknown>;
  const item    = normalizeRecord(raw, node);
  assert(!('_secret' in item), '_secret stripped');
  assert(!('__v'     in item), '__v stripped');
});

run('Normalizer: normalizeAll filters empty ids', () => {
  const schema = parseSchema(MINI_SDL);
  const node   = getNode(schema, 'products');
  const raws   = [
    ...(SAMPLE_ITEMS as Record<string, unknown>[]),
    { name: 'No ID item' },
  ];
  const out = normalizeAll(raws, node);
  assertEq(out.length, SAMPLE_ITEMS.length, 'item without id is filtered out');
});

// ── Facet Computation Tests ───────────────────────────────────────────────────

run('Facets: TERMS facet for category', () => {
  const schema = parseSchema(MINI_SDL);
  const node   = getNode(schema, 'products');
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
  const schema = parseSchema(MINI_SDL);
  const node   = getNode(schema, 'products');
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
  const schema  = parseSchema(MINI_SDL);
  const node    = getNode(schema, 'products');
  const facets  = computeFacets(SAMPLE_ITEMS, node);
  const brand   = facets.find(f => f.field === 'brand') as import('../src/core/types').TermsFacet;
  assert(brand !== undefined, 'brand facet exists');
  for (let i = 1; i < brand.buckets.length; i++) {
    assert(brand.buckets[i - 1].count >= brand.buckets[i].count,
      `bucket[${i-1}] count >= bucket[${i}] count`);
  }
});
