/**
 * src/core/facet.ts
 * Computes TERMS and RANGE facets from a product array.
 * Driven by SchemaNode @facet directives – no hardcoded field names.
 */

import { Product, SchemaNode, Facet, TermsFacet, RangeFacet, RangeBucket } from './types';
import { fieldsWithDirective } from '../../schema/parser';

// ── TERMS Facet ───────────────────────────────────────────────────────────────

function computeTermsFacet(products: Product[], field: string): TermsFacet {
  const counts: Map<string, number> = new Map();

  for (const p of products) {
    const val = (p as unknown as Record<string, unknown>)[field];
    const values = Array.isArray(val) ? val as string[] : [String(val ?? '')];
    for (const v of values) {
      const sv = String(v);
      if (sv) counts.set(sv, (counts.get(sv) ?? 0) + 1);
    }
  }

  const buckets = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    type: 'TERMS',
    field,
    buckets,
    total: buckets.reduce((s, b) => s + b.count, 0),
  };
}

// ── RANGE Facet ───────────────────────────────────────────────────────────────

/**
 * Create evenly-spaced numeric buckets between min and max.
 * Bucket count adjusts based on data spread.
 */
function buildRangeBuckets(products: Product[], field: string, min: number, max: number): RangeBucket[] {
  if (min === max) {
    return [{ from: min, to: max, label: `${min}`, count: products.length }];
  }

  const spread = max - min;
  const bucketCount = spread <= 10 ? 5 : spread <= 100 ? 5 : 6;
  const step = spread / bucketCount;

  const buckets: RangeBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const from = parseFloat((min + i * step).toFixed(2));
    const to   = i === bucketCount - 1
      ? max
      : parseFloat((min + (i + 1) * step).toFixed(2));

    const count = products.filter(p => {
      const v = Number((p as unknown as Record<string, unknown>)[field]);
      return i === bucketCount - 1 ? v >= from && v <= to : v >= from && v < to;
    }).length;

    const label = step >= 1
      ? `${Math.round(from)}–${Math.round(to)}`
      : `${from}–${to}`;

    buckets.push({ from, to, label, count });
  }

  return buckets;
}

function computeRangeFacet(products: Product[], field: string): RangeFacet {
  const values = products
    .map(p => Number((p as unknown as Record<string, unknown>)[field]))
    .filter(v => !isNaN(v));

  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;

  return {
    type: 'RANGE',
    field,
    min,
    max,
    buckets: buildRangeBuckets(products, field, min, max),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute all facets declared in the schema for the given product set.
 * Uses @facet(type: TERMS|RANGE) directives to drive computation.
 */
export function computeFacets(products: Product[], node: SchemaNode): Facet[] {
  const facetFields = fieldsWithDirective(node, 'facet');
  return facetFields.map(field => {
    const facetDirective = field.directives.find(d => d.name === 'facet')!;
    const facetType = String(facetDirective.args['type'] ?? 'TERMS');
    return facetType === 'RANGE'
      ? computeRangeFacet(products, field.name)
      : computeTermsFacet(products, field.name);
  });
}

/**
 * Look up a specific facet by field name from a facet array.
 */
export function getFacet(facets: Facet[], field: string): Facet | undefined {
  return facets.find(f => f.field === field);
}
