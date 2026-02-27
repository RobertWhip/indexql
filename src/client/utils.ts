import { Entity } from '../core/types';

/** High-resolution wall-clock timestamp in milliseconds. */
export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Project an entity to a subset of fields. */
export function project(item: Entity, fields: string[]): Partial<Entity> {
  if (!fields.length) return item;
  const out: Partial<Entity> = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(item, f)) {
      (out as Record<string, unknown>)[f] = item[f];
    }
  }
  return out;
}

/** Normalise a string | string[] filter into a Set<string>. */
export function toSet(value: string | string[] | undefined): Set<string> | undefined {
  if (value === undefined) return undefined;
  return new Set(Array.isArray(value) ? value : [value]);
}

/** Check whether an entity value overlaps with a filter set. */
export function matchesSet(
  value: string | string[],
  filterSet: Set<string>
): boolean {
  const vals = Array.isArray(value) ? value : [value];
  return vals.some(v => filterSet.has(v));
}
