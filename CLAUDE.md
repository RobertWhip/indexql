# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test              # Run all tests (66 tests, zero-dep runner via ts-node)
npm run build         # Build artifacts/ from data/products.json + schema/indexql.iq
npm run inspect       # Inspect built artifacts (manifest, columns, facets, samples)
npm run seed          # Regenerate data/products.json (15k items)
npm run build:ts      # TypeScript compilation only
```

There is no lint command. To run a single test, edit `tests/runner.ts` to selectively import test files or add filtering logic — there is no built-in single-test flag.

## Architecture

IndexQL is an **entity-agnostic**, schema-driven indexing library. It compiles structured data into compact binary artifacts that are queried entirely in-process (zero network latency). The core library contains **no domain/business logic** — all product-specific code lives in `demo/`.

### Data flow

```
.iq schema → normalizer → binary encoder → artifacts (bin + strings + facets + manifest)
                                                ↓
                                        IndexQLClient.load() → query() → results
```

### Key modules

- **Schema parser** (`schema/iq-parser.ts`) — Parses `.iq` files into `IQSchema`. Defines field types (`Bool`, `Int8/16/32/64`, `Float32/64`, `String`, `String[]`) and directives (`@facet(RANGE|TERMS)`, `@collection(name)`).
- **Entity decorators** (`src/core/entity.ts`) — `@Entity`, `@Column`, `@Facet` decorators for class-based schema definition. `getEntitySchema()` extracts metadata, `toBinaryColumnMetas()` converts for the encoder.
- **Binary encoder** (`src/core/binary-encoder.ts`) — Column-major IQBN format. `encodeColumns()` / `decodeColumns()` for Node; `decodeColumnsFromArrayBuffer()` / `reconstructFromArrayBuffer()` for browser.
- **Query engine** (`src/client/query.ts`) — Convention-based filter: `*Min`/`*Max` → range, `search` → full-text substring, `string[]` → set match, `boolean` → exact match.
- **Client SDK** (`src/client/indexqlClient.ts`) — `IndexQLClient.load()` synchronously loads artifacts; `.query()` filters/sorts/paginates locally.
- **Reactive hooks** (`src/client/hooks.ts`) — `createQueryHook(client)` provides stateful pub/sub query wrapper. `toggleFacetValue()` for immutable facet selection.
- **CLI** (`src/cli/build.ts`, `src/cli/inspect.ts`) — Build pipeline and artifact inspector.

### Binary format (IQBN)

Magic `IQBN`, version `0x01`, little-endian, column-major layout. Numeric/bool fields go into `.bin`; string fields go into `strings.json`. Stride = sum of bytes across all binary columns per item.

### Type conventions

- `Entity` = `Record<string, string | number | boolean | string[]>` (generic, not product-specific)
- `QueryFilter` = `Record<string, unknown>` (convention-based keys)
- `Manifest` has `numItems`, `files.binary` (not product-specific names)

## Testing

Tests use a custom zero-dependency runner (`tests/runner.ts`) with `run()`, `assert()`, `assertEq()`, `assertThrows()`. Test files:

- `tests/core.test.ts` — Binary encode/decode roundtrip, IQ parser, normalizer, facets
- `tests/client.test.ts` — Query filtering, sorting, pagination, hooks, projections
- `tests/cli.test.ts` — Build pipeline integration, hashing, formatting

## Key constraints

- `experimentalDecorators: true` is required in tsconfig (used by entity decorators)
- Node.js >= 18.0.0
- Core modules (`src/core/`, `src/client/`, `schema/`) must remain domain-agnostic — no product references
- The demo app (`demo/product-catalog/`) has its own `package.json` and uses Docker (Postgres 16 + Redis 7)
