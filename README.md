# IndexQL – Schema-Driven Catalog Indexing for Node.js

Pre-build a compact binary artifact at deploy time, ship it to the client via CDN, and execute all filtering, sorting, and faceting **in-process** — zero network latency per query.

## How It Works

```
schema/indexql.iq          .iq schema (types + directives)
        │
        ▼
  data/products.json ──► normalizer ──► Entity[]
                                           │
                    binary-encoder.ts ◄────┘
                                           │
                                           ▼
                         artifacts/  ◄── build.ts (CLI)
                         └ products.bin      column-major binary (~132 KB for 15k items)
                                           │
                            CDN / S3 / local file
                                           │
                                           ▼
                         indexqlClient.ts  (load + decode)
                                           │
                                           ▼
                         query.ts  (filter → sort → paginate → project)
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
├── schema/
│   ├── indexql.iq                IQ schema v2 (types + directives)
│   └── iq-parser.ts             Zero-dep .iq parser
│
├── artifacts/                   Build outputs (run "npm run build")
│   └── products.bin             Column-major binary (Float32/Bool)
│
├── src/
│   ├── cli/
│   │   ├── build.ts             Artifact build pipeline
│   │   └── inspect.ts           Artifact inspector CLI
│   │
│   ├── core/
│   │   ├── types.ts             All shared TypeScript types
│   │   ├── entity.ts            @Entity/@Column/@Facet decorators
│   │   ├── binary-encoder.ts    Column-major encode/decode
│   │   ├── normalizer.ts        Schema-driven record normalization
│   │   ├── facet.ts             TERMS + RANGE facet computation
│   │   └── resolver.ts          Collection registry
│   │
│   ├── client/
│   │   ├── indexqlClient.ts     Client SDK – loads artifacts, exposes query API
│   │   ├── query.ts             Local query engine
│   │   ├── hooks.ts             Framework-agnostic reactive query hooks
│   │   └── utils.ts             Client utilities
│   │
│   └── fmt.ts                   ANSI formatting + logging utilities
│
├── demo/
│   └── product-catalog/         Full-stack demo (see demo/README.md)
│       ├── shared/              Decorator-based entity definition
│       ├── server/              Express + PostgreSQL + Redis
│       └── client/              Vite + React
│
├── tests/
│   ├── runner.ts                Zero-dependency test runner
│   ├── core.test.ts             Encoder, parser, normalizer, facet tests
│   ├── client.test.ts           Query engine, hooks, projection tests
│   └── cli.test.ts              Pipeline integration tests
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
npm run seed               # Regenerate data/products.json (15k items, LCG seed=42)
npm run build              # Build artifacts/ (products.bin)
npm run inspect            # Inspect artifacts (column layout, sample items)
npm test                   # 64 tests
```

## Schema (.iq format)

```
@collection(products)
type Product {
  id:          String
  name:        String
  price:       Float32   @facet(RANGE)
  category:    String    @facet(TERMS)
  brand:       String    @facet(TERMS)
  rating:      Float32   @facet(RANGE)
  inStock:     Bool
  tags:        String[]
  description: String
}
```

Binary fields (`Bool`, `Int*`, `Float*`) are column-major encoded into `products.bin`.
String fields (`String`, `String[]`) are not included in the binary artifact — the build pipeline encodes only numeric/bool columns.

| IQ Type | Bits | Artifact |
|---------|------|----------|
| Bool | 8 | products.bin |
| Int8/16/32/64 | 8–64 | products.bin |
| Float32/Float64 | 32/64 | products.bin |
| String / String[] | — | not encoded |

Current stride: `price`(4) + `rating`(4) + `inStock`(1) = **9 bytes/item**.
15,000 items → **~132 KB** binary.

## Entity Decorators

Define entities with decorators instead of `.iq` files:

```typescript
import { Entity, Column, Facet, DataType } from './src/core/entity';

@Entity('products')
class Product {
  @Column({ type: DataType.Float32 })
  @Facet('RANGE')
  price!: number;

  @Column({ type: DataType.Bool })
  inStock!: boolean;

  @Column({ type: DataType.Int8 })
  @Facet('TERMS')
  brandIdx!: number;
}
```

## Client SDK

```typescript
import { IndexQLClient } from './src/client/indexqlClient';

// Load artifacts once (file reads + binary decode, ~50 ms)
const client = IndexQLClient.load();

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
```

## Deploying Artifacts to S3/CDN

The build output in `artifacts/` is a single binary file designed to be served from any CDN or object store. Example using the AWS CLI:

```bash
# Build artifacts locally
npm run build

# Upload to S3
aws s3 cp artifacts/products.bin s3://my-bucket/catalog/products.bin --content-type application/octet-stream
```

## Fetching Artifacts Over HTTP (Browser or Node 18+)

Once the artifact is on a CDN, the client can hydrate from HTTP using `fetch`:

```typescript
const BASE = 'https://cdn.example.com/catalog';

// Fetch binary artifact
const binBuf = await fetch(`${BASE}/products.bin`).then(r => r.arrayBuffer());

// Reconstruct entities using the binary decoder
import { reconstructFromArrayBuffer } from './src/core/binary-encoder';
const items = reconstructFromArrayBuffer(binBuf);

// Now query in-memory — same API as the local client
```

This works identically in browsers (using the native `fetch` and `ArrayBuffer`) and in Node 18+ (using the built-in `fetch`).

## Artifact Sizes (15k items)

| File | Size |
|------|------|
| products.bin | ~132 KB |

## Performance

| Metric | Value |
|--------|-------|
| Init (load + decode) | ~50 ms |
| Warm query | 0.9–2 ms |
| Items | 15,000 |
| Binary size | 132 KB |

Compare to a typical PostgreSQL query over HTTP: 80–300 ms per round-trip.
