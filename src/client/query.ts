import {
  Entity, Facet, SchemaNode, QueryOptions, QueryResult,
  QueryFilter, QuerySort, QueryPagination,
} from '../core/types';
import { computeFacets }            from '../core/facet';
import { project, toSet, matchesSet, now } from './utils';

// ── Filter ────────────────────────────────────────────────────────────────────

/**
 * Convention-based generic filter engine:
 *  - Keys ending in `Min` → item[field] >= value  (strip "Min" suffix)
 *  - Keys ending in `Max` → item[field] <= value  (strip "Max" suffix)
 *  - `search` → substring match across all string-valued fields
 *  - boolean value → exact match on item[key]
 *  - string | string[] → set-based match on item[key]
 */
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

      // Range: *Min suffix
      if (key.endsWith('Min')) {
        const field = key.slice(0, -3);
        // lowercase first char: priceMin → price
        const fieldName = field.charAt(0).toLowerCase() + field.slice(1);
        if (Number(item[fieldName]) < Number(filterVal)) return false;
        continue;
      }

      // Range: *Max suffix
      if (key.endsWith('Max')) {
        const field = key.slice(0, -3);
        const fieldName = field.charAt(0).toLowerCase() + field.slice(1);
        if (Number(item[fieldName]) > Number(filterVal)) return false;
        continue;
      }

      // Boolean exact match
      if (typeof filterVal === 'boolean') {
        if (item[key] !== filterVal) return false;
        continue;
      }

      // String / string[] set-based match
      if (typeof filterVal === 'string' || Array.isArray(filterVal)) {
        const filterSet = toSet(filterVal as string | string[]);
        if (filterSet && !matchesSet(item[key] as string | string[], filterSet)) return false;
        continue;
      }
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
