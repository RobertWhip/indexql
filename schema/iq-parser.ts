import { FieldDirective, SchemaNode, SchemaField } from '../src/core/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IQField {
  name:       string;
  typeName:   string;       // 'Float32', 'Bool', 'String', 'String[]', etc.
  bits:       number | null; // null for String types
  isBinary:   boolean;
  isArray:    boolean;
  directives: FieldDirective[];
}

export interface IQSchema {
  collection: string;
  fields:     IQField[];
}

// ── Binary type registry ──────────────────────────────────────────────────────

const BINARY_TYPES: Record<string, number> = {
  Bool:    8,
  Int8:    8,
  Int16:  16,
  Int32:  32,
  Int64:  64,
  Float32: 32,
  Float64: 64,
};

// ── Parser helpers ────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  return src
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trimEnd())
    .join('\n');
}

/** Parse @directive(ARG) or @directive items from a field's trailing text. */
function parseIQDirectives(rest: string): FieldDirective[] {
  const directives: FieldDirective[] = [];
  const re = /@(\w+)(?:\(([^)]*)\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    const [, name, rawArg = ''] = m;
    // Single positional arg like @facet(RANGE) or @facet(TERMS)
    const args: Record<string, string | boolean | number> = {};
    const trimmed = rawArg.trim();
    if (trimmed) {
      // Could be a bare enum like RANGE or TERMS
      if (/^[A-Z_][A-Z0-9_]*$/.test(trimmed)) {
        args['type'] = trimmed;
      } else {
        // key: value pairs
        const pairs = trimmed.match(/(\w+)\s*:\s*(?:"([^"]*)"|(true|false)|(\d+(?:\.\d+)?)|([A-Z_][A-Z0-9_]*))/g) ?? [];
        for (const pair of pairs) {
          const pm = pair.match(/^(\w+)\s*:\s*(?:"([^"]*)"|(true|false)|(\d+(?:\.\d+)?)|([A-Z_][A-Z0-9_]*))/);
          if (!pm) continue;
          const [, key, strVal, boolVal, numVal, enumVal] = pm;
          if      (strVal  !== undefined) args[key] = strVal;
          else if (boolVal !== undefined) args[key] = boolVal === 'true';
          else if (numVal  !== undefined) args[key] = parseFloat(numVal);
          else if (enumVal !== undefined) args[key] = enumVal;
        }
      }
    }
    directives.push({ name, args });
  }
  return directives;
}

/** Parse a single field line like "price: Float32 @facet(RANGE)" */
function parseIQField(line: string): IQField | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('}') || trimmed.startsWith('type ') || trimmed.startsWith('@')) {
    return null;
  }

  // Match: fieldName: TypeName[] @directives  OR  fieldName: TypeName @directives
  const m = trimmed.match(/^(\w+)\s*:\s*([\w]+)(\[\])?\s*(.*)/);
  if (!m) return null;

  const [, name, baseType, arrayBrackets, rest] = m;
  const isArray   = arrayBrackets === '[]';
  const typeName  = isArray ? `${baseType}[]` : baseType;
  const bits      = BINARY_TYPES[baseType] ?? null;
  const isBinary  = bits !== null && !isArray;
  const directives = parseIQDirectives(rest);

  return { name, typeName, bits, isBinary, isArray, directives };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Parse a .iq schema source string into an IQSchema. */
export function parseIQSchema(src: string): IQSchema {
  const clean = stripComments(src);
  const lines  = clean.split('\n');

  // Extract collection name from @collection(name)
  let collection = '';
  for (const line of lines) {
    const cm = line.trim().match(/^@collection\s*\(\s*(\w+)\s*\)/);
    if (cm) { collection = cm[1]; break; }
  }
  if (!collection) throw new Error('IQ schema missing @collection directive');

  // Extract fields from type block
  const typeRe = /type\s+\w+\s*\{([\s\S]*?)\}/;
  const typeMatch = clean.match(typeRe);
  if (!typeMatch) throw new Error('IQ schema missing type block');

  const body   = typeMatch[1];
  const fields: IQField[] = [];
  for (const line of body.split('\n')) {
    const field = parseIQField(line);
    if (field) fields.push(field);
  }

  return { collection, fields };
}

/** Return only binary fields (numeric/bool, stored in products.bin). */
export function binaryFields(schema: IQSchema): IQField[] {
  return schema.fields.filter(f => f.isBinary);
}

/** Return only string fields (stored in strings.json). */
export function stringFields(schema: IQSchema): IQField[] {
  return schema.fields.filter(f => !f.isBinary);
}

/** Sum of bytes per product across all binary columns. */
export function productStride(schema: IQSchema): number {
  // bits is always non-null for binary fields (binaryFields filters by isBinary)
  return binaryFields(schema).reduce((sum, f) => sum + ((f.bits as number) / 8), 0);
}

/**
 * Convert an IQSchema to a SchemaNode for compatibility with facet.ts and query.ts.
 * Maps IQ type names to GraphQL-compatible type names.
 */
export function toSchemaNode(schema: IQSchema): SchemaNode {
  function mapType(typeName: string): string {
    switch (typeName) {
      case 'Float32': case 'Float64': return 'Float';
      case 'Int8': case 'Int16': case 'Int32': return 'Int';
      case 'Int64': return 'Int';
      case 'Bool': return 'Boolean';
      case 'String[]': return 'String';
      default: return typeName;  // 'String', 'ID', etc.
    }
  }

  const fields: SchemaField[] = schema.fields.map(f => ({
    name:       f.name,
    type:       mapType(f.typeName),
    nullable:   true,
    isList:     f.isArray,
    isRequired: false,
    directives: f.directives,
  }));

  return {
    typeName:   'Product',
    collection: schema.collection,
    fields,
  };
}
