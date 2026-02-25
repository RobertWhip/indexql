/**
 * src/client/utils.ts
 * Lightweight client-side utilities: timing, projection, deep-clone.
 */

import { Product } from '../core/types';

/** High-resolution wall-clock timestamp in milliseconds. */
export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Project a product to a subset of fields. */
export function project(product: Product, fields: (keyof Product)[]): Partial<Product> {
  if (!fields.length) return product;
  const out: Partial<Product> = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(product, f)) {
      (out as Record<string, unknown>)[f] = product[f];
    }
  }
  return out;
}

/** Shallow-clone an array (avoids mutating the cache). */
export function cloneArray<T>(arr: T[]): T[] {
  return arr.slice();
}

/** Normalise a string | string[] filter into a Set<string>. */
export function toSet(value: string | string[] | undefined): Set<string> | undefined {
  if (value === undefined) return undefined;
  return new Set(Array.isArray(value) ? value : [value]);
}

/** Check whether a product array value overlaps with a filter set. */
export function matchesSet(
  productVal: string | string[],
  filterSet: Set<string>
): boolean {
  const vals = Array.isArray(productVal) ? productVal : [productVal];
  return vals.some(v => filterSet.has(v));
}
