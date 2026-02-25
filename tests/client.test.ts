/**
 * tests/client.test.ts
 * Unit tests for the query engine and client-side utilities.
 */

import { executeQuery }                           from '../src/client/query';
import { project, toSet, matchesSet, cloneArray } from '../src/client/utils';
import { createQueryHook, toggleFacetValue }      from '../src/client/hooks';
import { IndexQLClient }                          from '../src/client/indexqlClient';
import { parseSchema, getNode }                   from '../schema/parser';
import { Product }                                from '../src/core/types';
import { run, assert, assertEq, assertThrows }    from './runner';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SDL = `
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

const schema = parseSchema(SDL);
const node   = getNode(schema, 'products');

const PRODUCTS: Product[] = [
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

run('Query: no filter returns all products', () => {
  const r = executeQuery(PRODUCTS, {});
  assertEq(r.meta.total, PRODUCTS.length, 'total equals all products');
  assertEq(r.data.length, PRODUCTS.length, 'data contains all products');
});

run('Query: filter by single category', () => {
  const r = executeQuery(PRODUCTS, { filter: { category: 'Electronics' } });
  assertEq(r.meta.total, 3, '3 Electronics products');
  assert(r.data.every(p => (p as Product).category === 'Electronics'), 'all results are Electronics');
});

run('Query: filter by category array', () => {
  const r = executeQuery(PRODUCTS, { filter: { category: ['Electronics', 'Books'] } });
  assertEq(r.meta.total, 4, '3 Electronics + 1 Books');
});

run('Query: filter by brand array', () => {
  const r = executeQuery(PRODUCTS, { filter: { brand: ['Apple', 'Nike'] } });
  assertEq(r.meta.total, 3, '2 Apple + 1 Nike');
});

run('Query: filter by price range', () => {
  const r = executeQuery(PRODUCTS, { filter: { priceMin: 100, priceMax: 500 } });
  r.data.forEach(p => {
    assert((p as Product).price >= 100 && (p as Product).price <= 500, 'price in range');
  });
});

run('Query: filter by inStock', () => {
  const inStock  = executeQuery(PRODUCTS, { filter: { inStock: true  } });
  const outStock = executeQuery(PRODUCTS, { filter: { inStock: false } });
  assertEq(inStock.meta.total + outStock.meta.total, PRODUCTS.length, 'totals add up');
  assert(inStock.data.every( p => (p as Product).inStock === true),  'all in stock');
  assert(outStock.data.every(p => (p as Product).inStock === false), 'all out of stock');
});

run('Query: filter by rating range', () => {
  const r = executeQuery(PRODUCTS, { filter: { ratingMin: 4.7 } });
  r.data.forEach(p => assert((p as Product).rating >= 4.7, 'rating >= 4.7'));
});

run('Query: full-text search (case-insensitive)', () => {
  const r = executeQuery(PRODUCTS, { filter: { search: 'wireless' } });
  assert(r.meta.total >= 1, 'at least one result for "wireless"');
  r.data.forEach(p => {
    const hay = `${(p as Product).name} ${(p as Product).description}`.toLowerCase();
    assert(hay.includes('wireless'), 'search term in name or description');
  });
});

run('Query: filter by tag', () => {
  const r = executeQuery(PRODUCTS, { filter: { tags: 'shoes' } });
  assertEq(r.meta.total, 2, 'two products tagged "shoes"');
});

run('Query: combined filter', () => {
  const r = executeQuery(PRODUCTS, {
    filter: { category: 'Electronics', inStock: true, priceMax: 500 },
  });
  assertEq(r.meta.total, 1, 'only AirPods Pro matches (in stock, <$500, Electronics)');
});

// ── Query: Sort ───────────────────────────────────────────────────────────────

run('Query: sort price ascending', () => {
  const r = executeQuery(PRODUCTS, { sort: { field: 'price', order: 'asc' } });
  for (let i = 1; i < r.data.length; i++) {
    assert((r.data[i-1] as Product).price <= (r.data[i] as Product).price, 'ascending price order');
  }
});

run('Query: sort price descending', () => {
  const r = executeQuery(PRODUCTS, { sort: { field: 'price', order: 'desc' } });
  for (let i = 1; i < r.data.length; i++) {
    assert((r.data[i-1] as Product).price >= (r.data[i] as Product).price, 'descending price order');
  }
});

run('Query: sort name ascending', () => {
  const r = executeQuery(PRODUCTS, { sort: { field: 'name', order: 'asc' } });
  for (let i = 1; i < r.data.length; i++) {
    assert(
      (r.data[i-1] as Product).name.localeCompare((r.data[i] as Product).name) <= 0,
      'ascending name order'
    );
  }
});

// ── Query: Pagination ─────────────────────────────────────────────────────────

run('Query: pagination page 1', () => {
  const r = executeQuery(PRODUCTS, { pagination: { page: 1, pageSize: 3 } });
  assertEq(r.data.length, 3,        'page 1 has 3 items');
  assertEq(r.meta.totalPages, 3,    'totalPages = ceil(8/3) = 3');
  assertEq(r.meta.total, PRODUCTS.length, 'total is unaffected by pagination');
});

run('Query: pagination page 2', () => {
  const r = executeQuery(PRODUCTS, { pagination: { page: 2, pageSize: 3 } });
  assertEq(r.data.length, 3, 'page 2 has 3 items');
});

run('Query: pagination last page (partial)', () => {
  const r = executeQuery(PRODUCTS, { pagination: { page: 3, pageSize: 3 } });
  assertEq(r.data.length, 2, 'last page has 2 items (8 % 3)');
});

run('Query: pagination beyond last page returns empty', () => {
  const r = executeQuery(PRODUCTS, { pagination: { page: 99, pageSize: 5 } });
  assertEq(r.data.length, 0, 'empty page beyond bounds');
});

// ── Query: Field Projection ───────────────────────────────────────────────────

run('Query: fields projection', () => {
  const r = executeQuery(PRODUCTS, { fields: ['id', 'name', 'price'] });
  r.data.forEach(p => {
    assert('id'    in p, 'id present');
    assert('name'  in p, 'name present');
    assert('price' in p, 'price present');
    assert(!('category' in p), 'category excluded');
    assert(!('brand'    in p), 'brand excluded');
  });
});

// ── Query: Facets ─────────────────────────────────────────────────────────────

run('Query: includeFacets computes facets on filtered set', () => {
  const r = executeQuery(
    PRODUCTS,
    { filter: { category: 'Electronics' }, includeFacets: true },
    { node }
  );
  assert(r.facets !== undefined, 'facets present');
  const cat = r.facets!.find(f => f.field === 'category');
  assert(cat !== undefined, 'category facet present');
});

run('Query: no facets when includeFacets is false', () => {
  const r = executeQuery(PRODUCTS, { includeFacets: false });
  assert(r.facets === undefined, 'no facets when disabled');
});

run('Query: timing is measured', () => {
  const r = executeQuery(PRODUCTS, {});
  assert(r.meta.timingMs >= 0, 'timingMs is non-negative');
});

// ── Client Utils ──────────────────────────────────────────────────────────────

run('Utils: project returns only specified fields', () => {
  const p = PRODUCTS[0];
  const projected = project(p, ['id', 'name']);
  assertEq(Object.keys(projected).sort().join(','), 'id,name', 'only id and name');
});

run('Utils: project with empty fields returns full product', () => {
  const p   = PRODUCTS[0];
  const out = project(p, []);
  assertEq(out, p, 'empty fields returns identity');
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

run('Hooks: cloneArray does not mutate original', () => {
  const arr  = [1, 2, 3];
  const copy = cloneArray(arr);
  copy.push(4);
  assertEq(arr.length, 3, 'original unchanged');
});
