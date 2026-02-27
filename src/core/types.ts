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

// ── Entity Type ──────────────────────────────────────────────────────────────

/** Generic entity record — the base shape for any indexed collection. */
export type Entity = Record<string, string | number | boolean | string[]>;

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
  numItems: number;
  files: {
    binary:  ArtifactFile;   // *.bin (column-major binary)
    strings: ArtifactFile;   // strings.json
    facets:  ArtifactFile;   // facets.json
  };
}

// ── Query Types ───────────────────────────────────────────────────────────────

/**
 * Convention-based filter:
 *  - `{field}Min` / `{field}Max` → numeric range
 *  - `search` → full-text substring across all string fields
 *  - boolean value → exact match on `{key}`
 *  - string | string[] value → set-based match on `{key}`
 */
export type QueryFilter = Record<string, unknown>;

export type SortField = string;
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
  /** Subset of entity fields to return (projection) */
  fields?: string[];
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
  data: Partial<Entity>[];
  facets?: Facet[];
  meta: QueryMeta;
}
