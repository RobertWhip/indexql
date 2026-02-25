/**
 * src/client/hooks.ts
 * Framework-agnostic reactive "hooks" for the IndexQL client.
 *
 * These mimic React hook semantics in a plain TypeScript closure so the
 * patterns can be lifted into any UI framework (React, Vue, Svelte…).
 *
 * Usage (vanilla TS):
 *   const { state, query, reset } = createQueryHook(client);
 *   query({ filter: { category: 'Electronics' } });
 *   console.log(state.data);
 */

import { IndexQLClient } from './indexqlClient';
import { QueryOptions, QueryResult, Product, Facet } from '../core/types';

// ── State Shape ───────────────────────────────────────────────────────────────

export interface QueryState {
  loading: boolean;
  data: Partial<Product>[];
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

  return {
    get state() { return state; },

    query(options: QueryOptions = {}): void {
      setState({ loading: true, error: null, lastOptions: options });
      try {
        const result = client.queryProducts({ ...options, includeFacets: true });
        setState({
          loading: false,
          data:    result.data,
          facets:  result.facets ?? [],
          meta:    result.meta,
        });
      } catch (err) {
        setState({ loading: false, error: String(err) });
      }
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
