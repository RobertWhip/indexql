# IndexQL — Schema-Driven Catalog Indexing for Node.js

Pre-build a compact binary artifact at deploy time, ship it to the client via CDN, and execute all filtering, sorting, and faceting **in-process** — zero network latency per query. Keep clients current with four sync modes: static, snapshot polling, incremental deltas, or manual refresh.

## How It Works

```
@Entity class → toSchemaNode() → normalizer → binary encoder → products.bin
                                                                     │
                                                              CDN / S3 / local
                                                                     │
                                                                     ▼
                                                        IndexQLClient.fromSnapshot()
                                                                     │
                                                      ┌──────────────┼──────────────┐
                                                      ▼              ▼              ▼
                                                 .query()    applyDelta()   applySnapshot()
                                                      │
                                                      ▼
                                          QueryResult { data, facets, meta }
```

## Folder Structure

```
facetql/
├── data/
│   ├── products.json            15,000 seeded items (LCG seed=42)
│   └── seed.ts                  Regenerates products.json
│
├── artifacts/                   Build outputs (run "npm run build")
│   └── products.bin             Column-major binary (Float32/Bool)
│
├── src/
│   ├── core/
│   │   ├── types.ts             All shared TypeScript types
│   │   ├── entity.ts            @Entity/@Column/@Facet/@Sync decorators
│   │   ├── binary-encoder.ts    Column-major encode/decode (IQBN format)
│   │   ├── columnar-store.ts    Slotted TypedArray store with tombstones
│   │   ├── delta-codec.ts       Delta wire format encode/decode (0xDF01)
│   │   ├── normalizer.ts        Schema-driven record normalization
│   │   ├── facet.ts             TERMS + RANGE facet computation
│   │   └── resolver.ts          Collection registry
│   │
│   ├── client/
│   │   ├── indexqlClient.ts     Client SDK — load, query, delta/snapshot apply
│   │   ├── query.ts             Convention-based local query engine
│   │   ├── hooks.ts             Framework-agnostic reactive query hooks
│   │   └── utils.ts             Client utilities
│   │
│   └── fmt.ts                   ANSI formatting + logging utilities
│
├── demo/
│   ├── sync-modes/              4 sync mode demos (see demo/README.md)
│   │   ├── shared/              Mock data gen + React client
│   │   ├── static/              Load once, no updates
│   │   ├── snapshot/            Poll, full snapshot each tick
│   │   ├── incremental/         Poll, deltas + snapshot fallback
│   │   └── manual/              No auto-poll, refresh button
│   └── product-catalog/         Full-stack demo (PostgreSQL + Redis + React)
│
├── tests/
│   ├── runner.ts                Zero-dependency test runner
│   ├── core.test.ts             Encoder, normalizer, facet tests
│   ├── client.test.ts           Query engine, hooks, projection tests
│   └── delta.test.ts            Delta codec, columnar store, sync tests
│
├── package.json
└── tsconfig.json
```

## Setup

```bash
npm install
```

## Commands

```bash
npm test               # 89 tests (zero-dep runner)
npm run seed           # Regenerate data/products.json (15k items)
npm run build:ts       # TypeScript compilation only
```

## Entity Decorators

Decorators on a plain class are the **single source of truth** for schema definition. No separate schema files.

```typescript
import { Entity, Column, Facet, Sync, DataType } from './src/core/entity';

@Entity('products')
@Sync({ mode: 'incremental', pollMs: 2000, snapshotEvery: 15 })
class Product {
  @Column({ type: DataType.Int32, isKey: true })
  seq!: number;

  @Column({ type: DataType.Float32 })
  @Facet('RANGE')
  price!: number;

  @Column({ type: DataType.Bool })
  inStock!: boolean;

  @Column({ type: DataType.String })
  name!: string;
}
```

## Sync Modes

The `@Sync` decorator controls how the client keeps data current:

| Mode | Decorator | Behavior |
|------|-----------|----------|
| **static** | `@Sync({ mode: 'static' })` | Load once. No polling, no updates. |
| **snapshot** | `@Sync({ mode: 'snapshot', pollMs: 2000 })` | Poll at interval, always fetch full snapshot. |
| **incremental** | `@Sync({ mode: 'incremental', pollMs: 2000, snapshotEvery: 15 })` | Poll at interval. Use deltas for small gaps, snapshot for large gaps. |
| **manual** | `@Sync({ mode: 'manual' })` | No auto-poll. Client calls refresh explicitly. |

See `demo/sync-modes/` for working examples of all four modes.

## Client SDK

```typescript
import { IndexQLClient } from './src/client/indexqlClient';

// Load from binary snapshot
const ab = await fetch('/snapshot.bin').then(r => r.arrayBuffer());
const client = IndexQLClient.fromSnapshot(ab, { entity: Product });

// Query — sub-millisecond after init
const result = client.query({
  filter: {
    category: 'Electronics',
    priceMax: 500,
    inStock: true,
    search: 'wireless',
  },
  sort:       { field: 'rating', order: 'desc' },
  pagination: { page: 1, pageSize: 10 },
  fields:     ['id', 'name', 'price', 'brand', 'rating'],
  includeFacets: true,
});

result.data;            // projected entities
result.facets;          // facets on filtered set
result.meta.timingMs;   // ~1–2 ms warm

// Apply incremental delta
const deltaBuf = await fetch('/d/1.bin').then(r => r.arrayBuffer());
client.applyDeltaFromArrayBuffer(deltaBuf);

// Apply full snapshot replacement
const snapBuf = await fetch('/snapshot.bin').then(r => r.arrayBuffer());
client.applySnapshotFromArrayBuffer(snapBuf);
```

## Convention-Based Filters

Filter keys are inferred from naming conventions — no schema required at query time:

```typescript
{ priceMin: 100, priceMax: 500 }   // → range filter on price
{ search: 'wireless' }              // → full-text substring across all string fields
{ inStock: true }                    // → exact boolean match
{ category: ['Electronics', 'Books'] } // → set membership
```

## Binary Format (IQBN)

Column-major layout. Only numeric/bool fields are encoded — string fields are excluded.

| IQ Type | Bits | Artifact |
|---------|------|----------|
| Bool | 8 | products.bin |
| Int8/16/32/64 | 8–64 | products.bin |
| Float32/Float64 | 32/64 | products.bin |
| String / String[] | — | not encoded |

## Delta Wire Format (0xDF01)

Sparse column bitmask format — only changed columns are transmitted per row. Deletes are sorted and delta-coded for compression. See [ALGORITHM.md](./ALGORITHM.md) for the full specification.

## Deploying Artifacts to S3/CDN

```bash
# Build artifacts locally
npm run build

# Upload to S3
aws s3 cp artifacts/products.bin s3://my-bucket/catalog/products.bin \
  --content-type application/octet-stream
```

The client can hydrate from HTTP using `fetch` — works identically in browsers and Node 18+.

## Performance

| Metric | Value |
|--------|-------|
| Init (load + decode) | ~50 ms |
| Warm query | 0.9–2 ms |
| Delta apply (200 upserts) | ~0.5 ms |
| Items | 15,000 |
| Binary size | 132 KB |
| Delta size (200 mutations) | ~2.4 KB |
