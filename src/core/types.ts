/**
 * src/core/types.ts
 * Shared type definitions for IndexQL.
 */

// ── Schema Types ──────────────────────────────────────────────────────────────

export type FacetType = 'TERMS' | 'RANGE';

export interface DirectiveArg {
  [key: string]: string | number | boolean;
}

export interface FieldDirective {
  name: string;
  args: DirectiveArg;
}

export interface SchemaField {
  name: string;
  type: string;
  nullable: boolean;
  isList: boolean;
  isRequired: boolean;
  directives: FieldDirective[];
}

export interface SchemaNode {
  typeName: string;
  collection: string;
  fields: SchemaField[];
}

export interface ParsedSchema {
  nodes: SchemaNode[];
  directives: string[];
  enums: Record<string, string[]>;
}

// ── Domain Types ──────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  brand: string;
  rating: number;
  inStock: boolean;
  tags: string[];
  description: string;
}

// ── Facet Types ───────────────────────────────────────────────────────────────

export interface TermsBucket {
  value: string;
  count: number;
}

export interface RangeBucket {
  from: number;
  to: number;
  label: string;
  count: number;
}

export interface TermsFacet {
  type: 'TERMS';
  field: string;
  buckets: TermsBucket[];
  total: number;
}

export interface RangeFacet {
  type: 'RANGE';
  field: string;
  min: number;
  max: number;
  buckets: RangeBucket[];
}

export type Facet = TermsFacet | RangeFacet;

export interface FacetData {
  facets: Facet[];
  generatedAt: string;
  schema: string;
}

// ── IQ Schema Types ───────────────────────────────────────────────────────────

export type BinaryTypeCode = 1 | 2 | 3;  // 1=Bool, 2=Int, 3=Float

export interface IQField {
  name:       string;
  typeName:   string;
  bits:       number | null;
  isBinary:   boolean;
  isArray:    boolean;
  directives: FieldDirective[];
}

export interface IQSchema {
  collection: string;
  fields:     IQField[];
}

// ── Artifact Types ────────────────────────────────────────────────────────────

export interface ArtifactFile {
  name: string;
  hash: string;
  sizeBytes: number;
  count?: number;
}

export interface Manifest {
  version: string;
  schema: string;
  generatedAt: string;
  numProducts: number;
  files: {
    products: ArtifactFile;   // products.bin (binary)
    strings:  ArtifactFile;   // strings.json
    facets:   ArtifactFile;   // facets.json
  };
}

// ── Query Types ───────────────────────────────────────────────────────────────

export interface QueryFilter {
  category?: string | string[];
  brand?: string | string[];
  tags?: string | string[];
  priceMin?: number;
  priceMax?: number;
  ratingMin?: number;
  ratingMax?: number;
  inStock?: boolean;
  /** Full-text substring search across name + description */
  search?: string;
}

export type SortField = 'price' | 'rating' | 'name';
export type SortOrder = 'asc' | 'desc';

export interface QuerySort {
  field: SortField;
  order: SortOrder;
}

export interface QueryPagination {
  /** 1-based page index */
  page: number;
  pageSize: number;
}

export interface QueryOptions {
  filter?: QueryFilter;
  sort?: QuerySort;
  pagination?: QueryPagination;
  /** Subset of product fields to return (projection) */
  fields?: (keyof Product)[];
  /** Include recomputed facets on the filtered result set */
  includeFacets?: boolean;
}

export interface QueryMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Wall-clock milliseconds for local query execution */
  timingMs: number;
}

export interface QueryResult {
  data: Partial<Product>[];
  facets?: Facet[];
  meta: QueryMeta;
}
