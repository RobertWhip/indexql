import { ParsedSchema, SchemaNode, Product } from './types';
import { getNode } from '../../schema/parser';

// ── Registry ──────────────────────────────────────────────────────────────────

/** A resolver registry maps collection names to in-memory data arrays. */
export type CollectionRegistry = Map<string, Product[]>;

/** Create an empty resolver registry. */
export function createRegistry(): CollectionRegistry {
  return new Map();
}

/** Register a product array under a collection name. */
export function registerCollection(
  registry: CollectionRegistry,
  collection: string,
  data: Product[]
): void {
  registry.set(collection, data);
}

// ── Resolver ──────────────────────────────────────────────────────────────────

export class Resolver {
  private registry: CollectionRegistry;
  private schema: ParsedSchema;

  constructor(schema: ParsedSchema, registry: CollectionRegistry) {
    this.schema = schema;
    this.registry = registry;
  }

  /** Resolve all products for a schema node's collection. */
  resolveAll(collection: string): Product[] {
    const data = this.registry.get(collection);
    if (!data) throw new Error(`Resolver: no data registered for collection "${collection}"`);
    return data;
  }

  /** Resolve a single product by id. */
  resolveOne(collection: string, id: string): Product | undefined {
    return this.resolveAll(collection).find(p => p.id === id);
  }

  /** Return the SchemaNode for a collection. */
  nodeFor(collection: string): SchemaNode {
    return getNode(this.schema, collection);
  }

  /** List all registered collection names. */
  collections(): string[] {
    return Array.from(this.registry.keys());
  }
}

/** Convenience factory: build a Resolver from schema + data map. */
export function createResolver(
  schema: ParsedSchema,
  data: Record<string, Product[]>
): Resolver {
  const registry = createRegistry();
  for (const [collection, products] of Object.entries(data)) {
    registerCollection(registry, collection, products);
  }
  return new Resolver(schema, registry);
}
