import { executeQuery }                           from '../src/client/query';
import { project, toSet, matchesSet } from '../src/client/utils';
import { createQueryHook, toggleFacetValue }      from '../src/client/hooks';
import { IndexQLClient }                          from '../src/client/indexqlClient';
import { Entity, Column, Facet, DataType, getEntitySchema, toSchemaNode } from '../src/core/entity';
import { Entity as EntityType }                   from '../src/core/types';
import { run, assert, assertEq, assertThrows }    from './runner';

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
  rating!: number;

  @Column({ type: DataType.Bool })
  inStock!: boolean;

  @Column({ type: DataType.String, isArray: true })
  tags!: string[];

  @Column({ type: DataType.String })
  description!: string;
}

const node = toSchemaNode(getEntitySchema(TestProduct));

const ITEMS: EntityType[] = [
  { id: 'p1', name: 'iPhone 15',     price: 999, category: 'Electronics', brand: 'Apple', rating: 4.8, inStock: true,  tags: ['smartphone'],      description: 'Latest iPhone' },
  { id: 'p2', name: 'AirPods Pro',   price: 249, category: 'Electronics', brand: 'Apple', rating: 4.7, inStock: true,  tags: ['earbuds','anc'],    description: 'Wireless earbuds' },
  { id: 'p3', name: 'Galaxy S24',    price: 849, category: 'Electronics', brand: 'Samsung',rating:4.6, inStock: false, tags: ['smartphone'],       description: 'Android flagship' },
  { id: 'p4', name: 'Ultraboost 23', price: 180, category: 'Clothing',    brand: 'Adidas',rating: 4.7, inStock: true,  tags: ['shoes','running'],  description: 'Running shoe' },
  { id: 'p5', name: 'Air Max 270',   price: 150, category: 'Clothing',    brand: 'Nike',  rating: 4.5, inStock: true,  tags: ['shoes','lifestyle'],description: 'Lifestyle sneaker' },
  { id: 'p6', name: 'Clean Code',    price:  45, category: 'Books',       brand: "O'Reilly",rating:4.8,inStock: true,  tags: ['programming'],      description: 'Software craftsmanship' },
  { id: 'p7', name: 'Dyson V15',     price: 749, category: 'Home',        brand: 'Dyson', rating: 4.7, inStock: true,  tags: ['vacuum','cordless'],description: 'Cordless vacuum' },
  { id: 'p8', name: 'LEGO Technic',  price: 449, category: 'Toys',        brand: 'LEGO',  rating: 4.9, inStock: false, tags: ['lego','technic'],   description: 'Technic Bugatti' },
];

// ── Query: Filter ─────────────────────────────────────────────────────────────

run('Query: no filter returns all items', () => {
  const r = executeQuery(ITEMS, {});
  assertEq(r.meta.total, ITEMS.length, 'total equals all items');
  assertEq(r.data.length, ITEMS.length, 'data contains all items');
});

run('Query: filter by single category (eq)', () => {
  const r = executeQuery(ITEMS, { filter: { category: { eq: 'Electronics' } } });
  assertEq(r.meta.total, 3, '3 Electronics items');
  assert(r.data.every(item => (item as EntityType).category === 'Electronics'), 'all results are Electronics');
});

run('Query: filter by category array (in)', () => {
  const r = executeQuery(ITEMS, { filter: { category: { in: ['Electronics', 'Books'] } } });
  assertEq(r.meta.total, 4, '3 Electronics + 1 Books');
});

run('Query: filter by brand array (in)', () => {
  const r = executeQuery(ITEMS, { filter: { brand: { in: ['Apple', 'Nike'] } } });
  assertEq(r.meta.total, 3, '2 Apple + 1 Nike');
});

run('Query: filter by price range (gte/lte)', () => {
  const r = executeQuery(ITEMS, { filter: { price: { gte: 100, lte: 500 } } });
  r.data.forEach(item => {
    const price = Number((item as EntityType).price);
    assert(price >= 100 && price <= 500, 'price in range');
  });
});

run('Query: filter by inStock (eq boolean)', () => {
  const inStock  = executeQuery(ITEMS, { filter: { inStock: { eq: true  } } });
  const outStock = executeQuery(ITEMS, { filter: { inStock: { eq: false } } });
  assertEq(inStock.meta.total + outStock.meta.total, ITEMS.length, 'totals add up');
  assert(inStock.data.every( item => (item as EntityType).inStock === true),  'all in stock');
  assert(outStock.data.every(item => (item as EntityType).inStock === false), 'all out of stock');
});

run('Query: filter by rating range (gte)', () => {
  const r = executeQuery(ITEMS, { filter: { rating: { gte: 4.7 } } });
  r.data.forEach(item => assert(Number((item as EntityType).rating) >= 4.7, 'rating >= 4.7'));
});

run('Query: full-text search (case-insensitive)', () => {
  const r = executeQuery(ITEMS, { filter: { search: 'wireless' } });
  assert(r.meta.total >= 1, 'at least one result for "wireless"');
  r.data.forEach(item => {
    const hay = `${(item as EntityType).name} ${(item as EntityType).description}`.toLowerCase();
    assert(hay.includes('wireless'), 'search term in name or description');
  });
});

run('Query: filter by tag (in)', () => {
  const r = executeQuery(ITEMS, { filter: { tags: { in: ['shoes'] } } });
  assertEq(r.meta.total, 2, 'two items tagged "shoes"');
});

run('Query: combined filter', () => {
  const r = executeQuery(ITEMS, {
    filter: { category: { eq: 'Electronics' }, inStock: { eq: true }, price: { lte: 500 } },
  });
  assertEq(r.meta.total, 1, 'only AirPods Pro matches (in stock, <$500, Electronics)');
});

run('Query: gt/lt strict inequality', () => {
  // price strictly > 249 and strictly < 999
  const r = executeQuery(ITEMS, { filter: { price: { gt: 249, lt: 999 } } });
  r.data.forEach(item => {
    const price = Number((item as EntityType).price);
    assert(price > 249 && price < 999, 'price in strict range');
  });
  assertEq(r.meta.total, 3, 'Galaxy S24 (849), Dyson V15 (749), LEGO Technic (449)');
});

run('Query: contains on a specific string field', () => {
  const r = executeQuery(ITEMS, { filter: { description: { contains: 'flagship' } } });
  assertEq(r.meta.total, 1, 'only Galaxy S24 has "flagship" in description');
  assertEq((r.data[0] as EntityType).id, 'p3');
});

run('Query: eq with a number', () => {
  const r = executeQuery(ITEMS, { filter: { price: { eq: 999 } } });
  assertEq(r.meta.total, 1, 'only iPhone 15 costs 999');
  assertEq((r.data[0] as EntityType).id, 'p1');
});

// ── Query: Sort ───────────────────────────────────────────────────────────────

run('Query: sort price ascending', () => {
  const r = executeQuery(ITEMS, { sort: { field: 'price', order: 'asc' } });
  for (let i = 1; i < r.data.length; i++) {
    assert((r.data[i-1] as EntityType).price <= (r.data[i] as EntityType).price, 'ascending price order');
  }
});

run('Query: sort price descending', () => {
  const r = executeQuery(ITEMS, { sort: { field: 'price', order: 'desc' } });
  for (let i = 1; i < r.data.length; i++) {
    assert((r.data[i-1] as EntityType).price >= (r.data[i] as EntityType).price, 'descending price order');
  }
});

run('Query: sort name ascending', () => {
  const r = executeQuery(ITEMS, { sort: { field: 'name', order: 'asc' } });
  for (let i = 1; i < r.data.length; i++) {
    assert(
      ((r.data[i-1] as EntityType).name as string).localeCompare((r.data[i] as EntityType).name as string) <= 0,
      'ascending name order'
    );
  }
});

// ── Query: Pagination ─────────────────────────────────────────────────────────

run('Query: pagination page 1', () => {
  const r = executeQuery(ITEMS, { pagination: { page: 1, pageSize: 3 } });
  assertEq(r.data.length, 3,        'page 1 has 3 items');
  assertEq(r.meta.totalPages, 3,    'totalPages = ceil(8/3) = 3');
  assertEq(r.meta.total, ITEMS.length, 'total is unaffected by pagination');
});

run('Query: pagination page 2', () => {
  const r = executeQuery(ITEMS, { pagination: { page: 2, pageSize: 3 } });
  assertEq(r.data.length, 3, 'page 2 has 3 items');
});

run('Query: pagination last page (partial)', () => {
  const r = executeQuery(ITEMS, { pagination: { page: 3, pageSize: 3 } });
  assertEq(r.data.length, 2, 'last page has 2 items (8 % 3)');
});

run('Query: pagination beyond last page returns empty', () => {
  const r = executeQuery(ITEMS, { pagination: { page: 99, pageSize: 5 } });
  assertEq(r.data.length, 0, 'empty page beyond bounds');
});

// ── Query: Field Projection ───────────────────────────────────────────────────

run('Query: fields projection', () => {
  const r = executeQuery(ITEMS, { fields: ['id', 'name', 'price'] });
  r.data.forEach(item => {
    assert('id'    in item, 'id present');
    assert('name'  in item, 'name present');
    assert('price' in item, 'price present');
    assert(!('category' in item), 'category excluded');
    assert(!('brand'    in item), 'brand excluded');
  });
});

// ── Query: Facets ─────────────────────────────────────────────────────────────

run('Query: includeFacets computes facets on filtered set', () => {
  const r = executeQuery(
    ITEMS,
    { filter: { category: { eq: 'Electronics' } }, includeFacets: true },
    { node }
  );
  assert(r.facets !== undefined, 'facets present');
  const cat = r.facets!.find(f => f.field === 'category');
  assert(cat !== undefined, 'category facet present');
});

run('Query: no facets when includeFacets is false', () => {
  const r = executeQuery(ITEMS, { includeFacets: false });
  assert(r.facets === undefined, 'no facets when disabled');
});

run('Query: timing is measured', () => {
  const r = executeQuery(ITEMS, {});
  assert(r.meta.timingMs >= 0, 'timingMs is non-negative');
});

// ── Client Utils ──────────────────────────────────────────────────────────────

run('Utils: project returns only specified fields', () => {
  const item = ITEMS[0];
  const projected = project(item, ['id', 'name']);
  assertEq(Object.keys(projected).sort().join(','), 'id,name', 'only id and name');
});

run('Utils: project with empty fields returns full entity', () => {
  const item = ITEMS[0];
  const out  = project(item, []);
  assertEq(out, item, 'empty fields returns identity');
});

run('Utils: toSet handles string', () => {
  const s = toSet('Apple');
  assert(s!.has('Apple'), 'string converted to set');
  assertEq(s!.size, 1, 'set has one element');
});

run('Utils: toSet handles array', () => {
  const s = toSet(['Apple', 'Nike']);
  assert(s!.has('Apple') && s!.has('Nike'), 'both values in set');
});

run('Utils: toSet handles undefined', () => {
  const s = toSet(undefined);
  assert(s === undefined, 'undefined returns undefined');
});

run('Utils: matchesSet with string', () => {
  const s = new Set(['Electronics']);
  assert( matchesSet('Electronics', s), 'match present');
  assert(!matchesSet('Clothing',    s), 'match absent');
});

run('Utils: matchesSet with array', () => {
  const s = new Set(['shoes', 'running']);
  assert(matchesSet(['casual', 'running'], s), 'one of array matches');
  assert(!matchesSet(['casual', 'winter'],  s), 'none of array matches');
});

// ── Hooks ─────────────────────────────────────────────────────────────────────

run('Hooks: toggleFacetValue adds missing value', () => {
  const result = toggleFacetValue(['Nike', 'Adidas'], 'Apple');
  assert(result.includes('Apple'), 'Apple added');
  assertEq(result.length, 3, 'length is 3');
});

run('Hooks: toggleFacetValue removes existing value', () => {
  const result = toggleFacetValue(['Nike', 'Adidas', 'Apple'], 'Adidas');
  assert(!result.includes('Adidas'), 'Adidas removed');
  assertEq(result.length, 2, 'length is 2');
});

run('Utils: array slice does not mutate original', () => {
  const arr  = [1, 2, 3];
  const copy = arr.slice();
  copy.push(4);
  assertEq(arr.length, 3, 'original unchanged');
});
