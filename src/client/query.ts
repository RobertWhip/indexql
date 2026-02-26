import {
  Product, Facet, SchemaNode, QueryOptions, QueryResult,
  QueryFilter, QuerySort, QueryPagination,
} from '../core/types';
import { computeFacets }            from '../core/facet';
import { project, toSet, matchesSet, now } from './utils';

// ── Filter ────────────────────────────────────────────────────────────────────

function applyFilter(products: Product[], filter: QueryFilter): Product[] {
  const categorySet = toSet(filter.category);
  const brandSet    = toSet(filter.brand);
  const tagsSet     = toSet(filter.tags);
  const search      = filter.search?.toLowerCase();

  return products.filter(p => {
    if (categorySet && !matchesSet(p.category, categorySet)) return false;
    if (brandSet    && !matchesSet(p.brand, brandSet))       return false;
    if (tagsSet     && !matchesSet(p.tags,  tagsSet))        return false;

    if (filter.priceMin  !== undefined && p.price  < filter.priceMin)  return false;
    if (filter.priceMax  !== undefined && p.price  > filter.priceMax)  return false;
    if (filter.ratingMin !== undefined && p.rating < filter.ratingMin) return false;
    if (filter.ratingMax !== undefined && p.rating > filter.ratingMax) return false;
    if (filter.inStock   !== undefined && p.inStock !== filter.inStock) return false;

    if (search) {
      const haystack = `${p.name} ${p.description}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });
}

// ── Sort ──────────────────────────────────────────────────────────────────────

function applySort(products: Product[], sort: QuerySort): Product[] {
  const { field, order } = sort;
  return [...products].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    const cmp = typeof av === 'string'
      ? av.localeCompare(bv as string)
      : Number(av) - Number(bv);
    return order === 'asc' ? cmp : -cmp;
  });
}

// ── Paginate ──────────────────────────────────────────────────────────────────

function applyPagination(products: Product[], pagination: QueryPagination): Product[] {
  const { page, pageSize } = pagination;
  const start = (page - 1) * pageSize;
  return products.slice(start, start + pageSize);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute a local query against a product array.
 * All operations happen in-process – no I/O after initial artifact load.
 */
export function executeQuery(
  allProducts: Product[],
  options: QueryOptions,
  schema?: { node: SchemaNode }
): QueryResult {
  const t0 = now();

  // 1. Filter
  let results = options.filter
    ? applyFilter(allProducts, options.filter)
    : allProducts.slice();

  const total = results.length;

  // 2. Optional: facets on filtered set
  let facets: Facet[] | undefined;
  if (options.includeFacets && schema) {
    facets = computeFacets(results, schema.node);
  }

  // 3. Sort
  if (options.sort) results = applySort(results, options.sort);

  // 4. Paginate
  const pagination = options.pagination ?? { page: 1, pageSize: total };
  const paged = applyPagination(results, pagination);

  // 5. Project
  const fields = options.fields ?? [];
  const data = fields.length
    ? paged.map(p => project(p, fields))
    : paged;

  const timingMs = now() - t0;

  return {
    data,
    facets,
    meta: {
      total,
      page:       pagination.page,
      pageSize:   pagination.pageSize,
      totalPages: Math.ceil(total / pagination.pageSize),
      timingMs,
    },
  };
}
