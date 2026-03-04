import {
  Entity, Facet, SchemaNode, QueryOptions, QueryResult,
  QueryFilter, QuerySort, QueryPagination, FieldFilter,
} from '../core/types';
import { computeFacets }            from '../core/facet';
import { project, now } from './utils';

// ── Filter ────────────────────────────────────────────────────────────────────

function applyFilter(items: Entity[], filter: QueryFilter): Entity[] {
  const keys = Object.keys(filter);
  if (keys.length === 0) return items;

  return items.filter(item => {
    for (const key of keys) {
      const filterVal = filter[key];
      if (filterVal === undefined) continue;

      // Full-text search across all string fields
      if (key === 'search') {
        const needle = String(filterVal).toLowerCase();
        let found = false;
        for (const v of Object.values(item)) {
          if (typeof v === 'string' && v.toLowerCase().includes(needle)) {
            found = true;
            break;
          }
        }
        if (!found) return false;
        continue;
      }

      const op = filterVal as FieldFilter;
      const val = item[key];

      // eq
      if ('eq' in op) {
        if (val !== op.eq) return false;
        continue;
      }

      // in
      if ('in' in op) {
        const set = new Set(op.in as (string | number)[]);
        if (Array.isArray(val)) {
          if (!val.some(v => set.has(v))) return false;
        } else {
          if (!set.has(val as string | number)) return false;
        }
        continue;
      }

      // contains
      if ('contains' in op) {
        const needle = op.contains.toLowerCase();
        if (Array.isArray(val)) {
          if (!val.some(v => typeof v === 'string' && v.toLowerCase().includes(needle))) return false;
        } else if (typeof val === 'string') {
          if (!val.toLowerCase().includes(needle)) return false;
        } else {
          return false;
        }
        continue;
      }

      // comparison: gt/gte/lt/lte
      const num = Number(val);
      const cmp = op as { gt?: number; gte?: number; lt?: number; lte?: number };
      if (cmp.gt  !== undefined && !(num >  cmp.gt))  return false;
      if (cmp.gte !== undefined && !(num >= cmp.gte)) return false;
      if (cmp.lt  !== undefined && !(num <  cmp.lt))  return false;
      if (cmp.lte !== undefined && !(num <= cmp.lte)) return false;
    }
    return true;
  });
}

// ── Sort ──────────────────────────────────────────────────────────────────────

function applySort(items: Entity[], sort: QuerySort): Entity[] {
  const { field, order } = sort;
  return [...items].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    const cmp = typeof av === 'string'
      ? av.localeCompare(bv as string)
      : Number(av) - Number(bv);
    return order === 'asc' ? cmp : -cmp;
  });
}

// ── Paginate ──────────────────────────────────────────────────────────────────

function applyPagination(items: Entity[], pagination: QueryPagination): Entity[] {
  const { page, pageSize } = pagination;
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute a local query against an entity array.
 * All operations happen in-process – no I/O after initial artifact load.
 */
export function executeQuery(
  allItems: Entity[],
  options: QueryOptions,
  schema?: { node: SchemaNode }
): QueryResult {
  const t0 = now();

  // 1. Filter
  let results = options.filter
    ? applyFilter(allItems, options.filter)
    : allItems.slice();

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
    ? paged.map(item => project(item, fields))
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
