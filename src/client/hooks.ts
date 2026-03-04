import { IndexQLClient } from './indexqlClient';
import { QueryOptions, QueryResult, Entity, Facet, DeltaApplyResult, SnapshotApplyResult } from '../core/types';

// ── State Shape ───────────────────────────────────────────────────────────────

export interface QueryState {
  loading: boolean;
  data: Partial<Entity>[];
  facets: Facet[];
  meta: QueryResult['meta'] | null;
  error: string | null;
  /** Last options that produced the current state */
  lastOptions: QueryOptions | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface QueryHook {
  /** Current reactive state snapshot */
  state: QueryState;
  /** Execute a query and update state */
  query(options?: QueryOptions): void;
  /** Apply a delta buffer and re-run the last query */
  applyDelta(buf: Buffer): DeltaApplyResult;
  /** Apply a delta from ArrayBuffer and re-run the last query */
  applyDeltaFromArrayBuffer(ab: ArrayBuffer): DeltaApplyResult;
  /** Apply a full snapshot buffer and re-run the last query */
  applySnapshot(buf: Buffer): SnapshotApplyResult;
  /** Apply a full snapshot from ArrayBuffer and re-run the last query */
  applySnapshotFromArrayBuffer(ab: ArrayBuffer): SnapshotApplyResult;
  /** Reset state to initial empty values */
  reset(): void;
  /** Subscribe to state changes; returns unsubscribe fn */
  subscribe(listener: (state: QueryState) => void): () => void;
}

function initialState(): QueryState {
  return {
    loading:     false,
    data:        [],
    facets:      [],
    meta:        null,
    error:       null,
    lastOptions: null,
  };
}

/**
 * Create a stateful query hook backed by an IndexQLClient.
 * State updates are synchronous (IndexQL queries never involve I/O).
 */
export function createQueryHook(client: IndexQLClient): QueryHook {
  let state = initialState();
  const listeners = new Set<(s: QueryState) => void>();

  function notify(): void {
    // Snapshot reference to avoid mutation after dispatch
    const snapshot = { ...state };
    for (const l of listeners) l(snapshot);
  }

  function setState(partial: Partial<QueryState>): void {
    state = { ...state, ...partial };
    notify();
  }

  function rerunLastQuery(): void {
    if (state.lastOptions) {
      const qr = client.query({ includeFacets: true, ...state.lastOptions });
      setState({
        data:   qr.data,
        facets: qr.facets ?? [],
        meta:   qr.meta,
      });
    }
  }

  return {
    get state() { return state; },

    query(options: QueryOptions = {}): void {
      setState({ loading: true, error: null, lastOptions: options });
      try {
        const result = client.query({ includeFacets: true, ...options });
        setState({
          loading: false,
          data:    result.data,
          facets:  result.facets ?? [],
          meta:    result.meta,
        });
      } catch (err) {
        setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
      }
    },

    applyDelta(buf: Buffer): DeltaApplyResult {
      const result = client.applyDelta(buf);
      rerunLastQuery();
      return result;
    },

    applyDeltaFromArrayBuffer(ab: ArrayBuffer): DeltaApplyResult {
      const result = client.applyDeltaFromArrayBuffer(ab);
      rerunLastQuery();
      return result;
    },

    applySnapshot(buf: Buffer): SnapshotApplyResult {
      const result = client.applySnapshot(buf);
      rerunLastQuery();
      return result;
    },

    applySnapshotFromArrayBuffer(ab: ArrayBuffer): SnapshotApplyResult {
      const result = client.applySnapshotFromArrayBuffer(ab);
      rerunLastQuery();
      return result;
    },

    reset(): void {
      state = initialState();
      notify();
    },

    subscribe(listener: (s: QueryState) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

// ── Facet Selection Helper ────────────────────────────────────────────────────

/**
 * Toggle a value in an array-type filter (e.g. category multi-select).
 * Returns a new array – safe for immutable state updates.
 */
export function toggleFacetValue(current: string[], value: string): string[] {
  return current.includes(value)
    ? current.filter(v => v !== value)
    : [...current, value];
}
