# IndexQL – Schema-Driven Catalog Indexing for Node.js

A demonstration of **static artifact delivery** with a **GraphQL-inspired local query interface**.

Instead of sending every filter query over HTTP, IndexQL:
1. Pre-builds a compact encoded artifact at deploy time
2. Ships it to the client (CDN, local file, etc.)
3. Executes all filtering, sorting, and faceting **in-process** – zero network latency per query

---

## Folder Structure

```
indexql-mvp/
├── data/
│   ├── products.json          100 sample products
│   └── seed.ts                Generates products.json
│
├── schema/
│   ├── indexql.schema.graphql Schema with @node, @facet, @sortable, @filterable
│   └── parser.ts              Zero-dependency GraphQL SDL parser
│
├── artifacts/                 Build outputs (run "npm run build")
│   ├── products.gz.json       Encoded product catalog
│   ├── facets.gz.json         Pre-computed facets
│   ├── manifest.json          Build metadata + file hashes
│   └── README.md              Artifact format documentation
│
├── src/
│   ├── cli/
│   │   ├── build.ts           Artifact build pipeline
│   │   ├── inspect.ts         Artifact inspector CLI
│   │   └── utils.ts           Hashing, file I/O, logging
│   │
│   ├── core/
│   │   ├── types.ts           All shared TypeScript types
│   │   ├── encoder.ts         Buffer-based encode/decode (no external deps)
│   │   ├── normalizer.ts      Schema-driven record normalization
│   │   ├── facet.ts           TERMS + RANGE facet computation
│   │   └── resolver.ts        Collection registry & data-access layer
│   │
│   ├── client/
│   │   ├── indexqlClient.ts   Client SDK – loads artifacts, exposes query API
│   │   ├── query.ts           Local query engine: filter → sort → paginate → project
│   │   ├── hooks.ts           Framework-agnostic reactive query hooks
│   │   └── utils.ts           Client utilities (timing, projection, set helpers)
│   │
│   └── demo/
│       ├── indexqlDemo.ts     IndexQL approach demo
│       ├── httpDemo.ts        Simulated HTTP approach demo
│       └── output.txt         Sample output
│
├── tests/
│   ├── runner.ts              Zero-dependency test runner
│   ├── core.test.ts           Encoder, parser, normalizer, facet tests
│   ├── client.test.ts         Query engine, hooks, projection tests
│   └── cli.test.ts            Pipeline integration tests
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## Setup

```bash
npm install
```

---

## Workflow

### 1 · Seed Data (optional – products.json is pre-included)

```bash
npm run seed
```

### 2 · Build Artifacts

```bash
npm run build
```

Emits `artifacts/products.gz.json`, `artifacts/facets.gz.json`, `artifacts/manifest.json`.

### 3 · Inspect Artifacts

```bash
npm run inspect
```

### 4 · Run Demos

```bash
npm run demo:indexql   # Static artifact approach
npm run demo:http      # Simulated HTTP approach
npm run demo           # Both
```

### 5 · Run Tests

```bash
npm test
```

---

## Schema

```graphql
type Product @node(collection: "products") {
  id: ID!
  name: String! @filterable @searchable
  price: Float! @facet(type: RANGE) @sortable @filterable
  category: String! @facet(type: TERMS) @filterable
  brand: String! @facet(type: TERMS) @filterable
  rating: Float @facet(type: RANGE) @sortable @filterable
  inStock: Boolean @filterable
  tags: [String] @filterable
  description: String @searchable
}
```

Custom directives:

| Directive | Scope | Effect |
|---|---|---|
| `@node(collection)` | type | Marks a type as a catalog node |
| `@facet(type)` | field | Includes field in artifact facet computation |
| `@sortable` | field | Enables client-side sort on this field |
| `@filterable` | field | Enables QueryFilter condition for this field |
| `@searchable` | field | Includes field in full-text search |

---

## Client SDK

```typescript
import { IndexQLClient } from './src/client/indexqlClient';

// Load artifacts once (file reads + Buffer decode)
const client = IndexQLClient.load();

// GraphQL-like query interface
const result = client.queryProducts({
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

console.log(result.data);         // projected products
console.log(result.facets);       // facets on filtered set
console.log(result.meta.timingMs); // sub-millisecond query time
```

---

## Demo Output

```
IndexQL approach – 3 queries after init:
  Init (load+decode)    12.43 ms
  Query A               0.041 ms
  Query B               0.038 ms
  Query C               0.112 ms
  Total query time      0.191 ms

HTTP approach (simulated) – same 3 queries:
  Request A            ~154 ms
  Request B            ~189 ms
  Request C            ~201 ms
  Total                ~544 ms

IndexQL is ~300× faster per query after initialization.
```

See [`src/demo/output.txt`](src/demo/output.txt) for full output.

---

## Pros & Cons

### IndexQL (Static Artifact Approach)

| Pros | Cons |
|---|---|
| Sub-millisecond queries (zero network RTT) | One-time init cost (file load + decode) |
| Works offline after first load | Stale data until next artifact build |
| CDN-friendly: immutable, cacheable artifacts | All data in memory (unsuitable for very large catalogs) |
| Schema-driven: contract between build + client | Requires build pipeline to update |
| Pre-computed facets at no per-query cost | No server-side authorisation per query |
| Supports rich filtering, sorting, pagination, projection | |

### HTTP API (Conventional Approach)

| Pros | Cons |
|---|---|
| Always up-to-date data | Network RTT on every query (80–300 ms typical) |
| Fine-grained server-side authorisation | Server-side filter/facet cost per request |
| No client memory footprint | Complex caching (ETags, CDN, invalidation) |
| Suitable for very large catalogs | Latency makes instant-search feel sluggish |

---

## Architecture

```
Schema SDL
   │
   ▼
schema/parser.ts ──────────────── SchemaNode (fields + directives)
   │                                        │
   │                                        ▼
data/products.json ──► normalizer.ts ─► Product[]
                                           │
                       ◄── facet.ts ───────┤
                       ◄── encoder.ts ─────┤
                                           │
                                           ▼
                        artifacts/  ◄──  build.ts (CLI)
                       ├ manifest.json
                       ├ products.gz.json
                       └ facets.gz.json
                                           │
                                           ▼
                        indexqlClient.ts (load + decode)
                                           │
                                           ▼
                        query.ts (filter → sort → paginate → project)
                                           │
                                           ▼
                        QueryResult { data, facets, meta }
```
