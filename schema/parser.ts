/**
 * schema/parser.ts
 * Parses IndexQL GraphQL SDL into structured metadata.
 * Zero external dependencies – pure string processing.
 */

import { ParsedSchema, SchemaNode, SchemaField, FieldDirective } from '../src/core/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip single-line and block comments from SDL source. */
function stripComments(src: string): string {
  return src
    .split('\n')
    .map(line => line.replace(/#.*$/, '').replace(/"""[^"]*"""/g, ''))
    .join('\n');
}

/** Parse directive arguments like (collection: "products") → { collection: "products" } */
function parseDirectiveArgs(argsStr: string): Record<string, string | boolean | number> {
  const result: Record<string, string | boolean | number> = {};
  if (!argsStr.trim()) return result;

  // Match: key: "string" | true|false | 123.45 | IDENTIFIER (unquoted enum value)
  const pairs = argsStr.match(/(\w+)\s*:\s*(?:"([^"]*)"|(true|false)|(\d+(?:\.\d+)?)|([A-Z_][A-Z0-9_]*))/g) ?? [];
  for (const pair of pairs) {
    const m = pair.match(/^(\w+)\s*:\s*(?:"([^"]*)"|(true|false)|(\d+(?:\.\d+)?)|([A-Z_][A-Z0-9_]*))/);
    if (!m) continue;
    const [, key, strVal, boolVal, numVal, enumVal] = m;
    if (strVal  !== undefined) result[key] = strVal;
    else if (boolVal !== undefined) result[key] = boolVal === 'true';
    else if (numVal  !== undefined) result[key] = parseFloat(numVal);
    else if (enumVal !== undefined) result[key] = enumVal;
  }
  return result;
}

/** Parse all directives on a line fragment, e.g. "@facet(type: RANGE) @sortable" */
function parseDirectives(fragment: string): FieldDirective[] {
  const directives: FieldDirective[] = [];
  const re = /@(\w+)(?:\(([^)]*)\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    const [, name, rawArgs = ''] = m;
    directives.push({ name, args: parseDirectiveArgs(rawArgs) });
  }
  return directives;
}

/** Parse a single field line like "price: Float! @facet(type: RANGE) @sortable" */
function parseField(line: string): SchemaField | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('}')) return null;

  // Match: fieldName: [TypeName!]! @directives…
  const fieldMatch = trimmed.match(/^(\w+)\s*:\s*(\[)?(\w+)(!?)\]?(!?)(.*)/);
  if (!fieldMatch) return null;

  const [, name, isList, typeName, innerBang, outerBang, rest] = fieldMatch;
  const required = (isList ? outerBang : innerBang) === '!';
  const directives = parseDirectives(rest);

  return {
    name,
    type: typeName,
    nullable: !required,
    isList: !!isList,
    isRequired: required,
    directives,
  };
}

// ── Main Parser ───────────────────────────────────────────────────────────────

/** Parse enums from SDL source. */
function parseEnums(src: string): Record<string, string[]> {
  const enums: Record<string, string[]> = {};
  const enumRe = /enum\s+(\w+)\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = enumRe.exec(src)) !== null) {
    const [, name, body] = m;
    enums[name] = body.trim().split(/\s+/).filter(v => /^\w+$/.test(v));
  }
  return enums;
}

/** Parse directive definition names from SDL source. */
function parseDirectiveNames(src: string): string[] {
  const names: string[] = [];
  const re = /directive\s+@(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names;
}

/** Parse type blocks with @node directive into SchemaNode objects. */
function parseNodes(src: string): SchemaNode[] {
  const nodes: SchemaNode[] = [];
  // Match: type TypeName @node(collection: "...") { ... }
  const typeRe = /type\s+(\w+)(\s+[^{]+)?\{([^}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = typeRe.exec(src)) !== null) {
    const [, typeName, afterName = '', body] = m;

    // Only process types annotated with @node
    const nodeMatch = afterName.match(/@node\s*\(\s*collection\s*:\s*"([^"]+)"\s*\)/);
    if (!nodeMatch) continue;

    const collection = nodeMatch[1];
    const fields: SchemaField[] = [];

    for (const line of body.split('\n')) {
      const field = parseField(line);
      if (field) fields.push(field);
    }

    nodes.push({ typeName, collection, fields });
  }

  return nodes;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Parse a GraphQL SDL string into IndexQL schema metadata. */
export function parseSchema(sdl: string): ParsedSchema {
  const clean = stripComments(sdl);
  return {
    nodes: parseNodes(clean),
    directives: parseDirectiveNames(clean),
    enums: parseEnums(clean),
  };
}

/** Find the SchemaNode for a given collection name, or throw. */
export function getNode(schema: ParsedSchema, collection: string): SchemaNode {
  const node = schema.nodes.find(n => n.collection === collection);
  if (!node) throw new Error(`No @node found for collection "${collection}"`);
  return node;
}

/** Return all fields on a node that carry a given directive. */
export function fieldsWithDirective(node: SchemaNode, directiveName: string): SchemaField[] {
  return node.fields.filter(f => f.directives.some(d => d.name === directiveName));
}
