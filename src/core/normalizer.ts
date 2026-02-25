/**
 * src/core/normalizer.ts
 * Normalizes raw product records to match schema field definitions.
 * Coerces types, fills defaults, and strips undeclared fields.
 */

import { SchemaNode, SchemaField, Product } from './types';

// ── Type Coercions ────────────────────────────────────────────────────────────

type Scalar = string | number | boolean | null;
type RawRecord = Record<string, unknown>;

function coerceScalar(value: unknown, typeName: string): Scalar {
  switch (typeName) {
    case 'ID':
    case 'String':
      return value == null ? '' : String(value);
    case 'Int':
      return value == null ? 0 : Math.round(Number(value));
    case 'Float':
      return value == null ? 0 : Number(value);
    case 'Boolean':
      return value == null ? false : Boolean(value);
    // IQ binary types
    case 'Float32': case 'Float64':
      return Number(value ?? 0);
    case 'Int8': case 'Int16': case 'Int32':
      return Math.round(Number(value ?? 0));
    case 'Bool':
      return Boolean(value);
    default:
      return value == null ? null : String(value);
  }
}

function defaultForType(field: SchemaField): unknown {
  if (field.isList) return [];
  switch (field.type) {
    case 'ID':
    case 'String':  return '';
    case 'Int':
    case 'Float':   return 0;
    case 'Boolean': return false;
    default:        return null;
  }
}

// ── Normalizer ────────────────────────────────────────────────────────────────

/**
 * Normalize a single raw record against a SchemaNode.
 * - Retains only fields declared in the schema.
 * - Coerces scalar types.
 * - Fills missing fields with safe defaults.
 * - Unwraps single-element arrays and wraps scalars for list fields.
 */
export function normalizeRecord(raw: RawRecord, node: SchemaNode): Product {
  const out: RawRecord = {};

  for (const field of node.fields) {
    const rawValue = Object.prototype.hasOwnProperty.call(raw, field.name)
      ? raw[field.name]
      : defaultForType(field);

    if (field.isList) {
      const arr = Array.isArray(rawValue) ? rawValue : [rawValue].filter(v => v != null);
      out[field.name] = arr.map(item => coerceScalar(item, field.type));
    } else {
      out[field.name] = coerceScalar(rawValue, field.type);
    }
  }

  return out as unknown as Product;
}

/**
 * Normalize an array of raw records.
 * Skips records missing a required 'id' field after coercion.
 */
export function normalizeAll(raws: RawRecord[], node: SchemaNode): Product[] {
  return raws
    .map(r => normalizeRecord(r, node))
    .filter(p => p.id && p.id !== '');
}
