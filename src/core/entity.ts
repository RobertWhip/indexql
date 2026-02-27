import { encodeColumns, reconstructFromArrayBuffer, type ColumnMeta } from './binary-encoder';
import type { Entity as EntityType } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FacetKind = 'RANGE' | 'TERMS';

export enum DataType {
  String = 'String',
  Bool = 'Bool',
  Int8 = 'Int8',
  Int16 = 'Int16',
  Int32 = 'Int32',
  Int64 = 'Int64',
  Float32 = 'Float32',
  Float64 = 'Float64',
}

export interface ColumnDef {
  propertyKey: string;
  type:        DataType | null;   // IQ type: 'Float32', 'String', 'Bool', etc.
  bits:        number | null;
  isBinary:    boolean;
  facet?:      FacetKind;
}

export interface EntitySchema {
  collection:    string;
  columns:       ColumnDef[];
  binaryColumns: ColumnDef[];
}

// ── Binary type registry (duplicated from iq-parser for zero internal deps) ──

const BINARY_TYPES: Record<string, number> = {
  Bool:    8,
  Int8:    8,
  Int16:  16,
  Int32:  32,
  Int64:  64,
  Float32: 32,
  Float64: 64,
};

// ── Metadata keys ─────────────────────────────────────────────────────────────

const COLLECTION_KEY = Symbol('entity:collection');
const COLUMNS_KEY    = Symbol('entity:columns');

// ── Decorators ────────────────────────────────────────────────────────────────

/**
 * Class decorator: marks this class as an entity with a collection name.
 * Usage: @Entity('products')
 */
export function Entity(collection: string): ClassDecorator {
  return (target) => {
    Reflect.defineProperty(target, COLLECTION_KEY, { value: collection, enumerable: false });
  };
}

/** Get or create the column defs map for a class prototype. */
function getColumnMap(proto: object): Map<string, ColumnDef> {
  let map = (proto as Record<symbol, unknown>)[COLUMNS_KEY] as Map<string, ColumnDef> | undefined;
  if (!map) {
    map = new Map();
    Object.defineProperty(proto, COLUMNS_KEY, { value: map, enumerable: false });
  }
  return map;
}

/**
 * Property decorator: registers a field with its IQ type.
 * Usage: @Column('Float32')
 */
export function Column(options: { type: DataType, isArray?: boolean }): PropertyDecorator {
  const { type, isArray } = options;
  return (target, propertyKey) => {
    const key  = String(propertyKey);
    const map  = getColumnMap(target);
    const bits = BINARY_TYPES[type.replace('[]', '')] ?? null;
    const isBinary = bits !== null && !isArray;

    const existing = map.get(key);
    if (existing) {
      // @Facet may have already run — merge
      existing.type     = type;
      existing.bits     = bits;
      existing.isBinary = isBinary;
    } else {
      map.set(key, { propertyKey: key, type, bits, isBinary });
    }
  };
}

/**
 * Property decorator: marks a field as a facet.
 * Usage: @Facet('RANGE') or @Facet('TERMS')
 */
export function Facet(kind: FacetKind): PropertyDecorator {
  return (target, propertyKey) => {
    const key = String(propertyKey);
    const map = getColumnMap(target);

    const existing = map.get(key);
    if (existing) {
      existing.facet = kind;
    } else {
      // @Column hasn't run yet — create a placeholder that Column will merge into
      map.set(key, { propertyKey: key, type: null, bits: null, isBinary: false, facet: kind });
    }
  };
}

// ── Schema extraction ─────────────────────────────────────────────────────────

/**
 * Extract the EntitySchema from a decorated class.
 */
export function getEntitySchema(cls: Function): EntitySchema {
  const collection = (cls as unknown as Record<symbol, unknown>)[COLLECTION_KEY] as string | undefined;
  if (!collection) throw new Error(`${cls.name} is not decorated with @Entity`);

  const map = (cls.prototype as Record<symbol, unknown>)[COLUMNS_KEY] as Map<string, ColumnDef> | undefined;
  if (!map || map.size === 0) throw new Error(`${cls.name} has no @Column fields`);

  const columns       = Array.from(map.values());
  const binaryColumns = columns.filter(c => c.isBinary);

  return { collection, columns, binaryColumns };
}

/**
 * Convert an EntitySchema's binary columns to ColumnMeta[] for the encoder.
 */
export function toBinaryColumnMetas(schema: EntitySchema): ColumnMeta[] {
  return schema.binaryColumns.map(c => ({
    name:     c.propertyKey,
    typeName: c.type!,
    bits:     c.bits!,
  }));
}

/**
 * Encode items to binary using a decorated entity class as the schema source.
 * Derives columns from decorators under the hood.
 */
export function encodeEntity<T>(cls: new () => T, items: T[]): Buffer {
  const schema  = getEntitySchema(cls);
  const columns = toBinaryColumnMetas(schema);
  return encodeColumns(items as EntityType[], columns);
}

/**
 * Decode a binary ArrayBuffer into typed entities using a decorated class.
 * Browser-safe counterpart to encodeEntity.
 */
export function parseEntity<T>(cls: new () => T, ab: ArrayBuffer): T[] {
  getEntitySchema(cls); // validate decorated class
  return reconstructFromArrayBuffer(ab) as unknown as T[];
}
