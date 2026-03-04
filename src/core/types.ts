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

// ── Query Types ───────────────────────────────────────────────────────────────

export interface EqOp       { eq: string | number | boolean }
export interface ComparisonOp { gt?: number; gte?: number; lt?: number; lte?: number }
export interface InOp        { in: (string | number)[] }
export interface ContainsOp  { contains: string }

export type FieldFilter = EqOp | ComparisonOp | InOp | ContainsOp;

export type QueryFilter = {
  search?: string;
  [field: string]: FieldFilter | string | undefined;
};

// ── Delta Types ──────────────────────────────────────────────────────────────

export interface DeltaApplyResult {
  inserted: number;
  updated: number;
  deleted: number;
  totalAfter: number;
  timingMs: number;
}

export interface SnapshotApplyResult {
  itemCount: number;
  previousCount: number;
  timingMs: number;
}

export type SyncMode = 'static' | 'snapshot' | 'incremental' | 'manual';

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
