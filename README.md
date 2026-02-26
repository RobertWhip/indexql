# IndexQL – Schema-Driven Catalog Indexing for Node.js

Pre-build a compact binary artifact at deploy time, ship it to the client via CDN, and execute all filtering, sorting, and faceting **in-process** — zero network latency per query.

## How It Works

```
schema/indexql.iq          .iq schema (types + directives)
        │
        ▼
  data/products.json ──► normalizer ──► Product[]
                                           │
                          facet.ts ◄───────┤
                    binary-encoder.ts ◄────┤
                                           ▼
                         artifacts/  ◄── build.ts (CLI)
                         ├ manifest.json     build metadata + file hashes
                         ├ products.bin      column-major binary (~132 KB for 15k products)
                         ├ strings.json      parallel string arrays (~2.5 MB)
                         └ facets.json       pre-computed facets (~3.5 KB)
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
indexql-mvp/
├── data/
│   ├── products.json            15,000 seeded products (LCG seed=42)
│   └── seed.ts                  Regenerates products.json
│
├── schema/
│   ├── indexql.iq                IQ schema v2 (types + directives)
│   └── iq-parser.ts             Zero-dep .iq parser
│
├── artifacts/                   Build outputs (run "npm run build")
│   ├── products.bin             Column-major binary (Float32/Bool)
│   ├── strings.json             Parallel string arrays
│   ├── facets.json              Pre-computed TERMS + RANGE facets
│   └── manifest.json            Build metadata + file hashes
│
├── src/
│   ├── cli/
│   │   ├── build.ts             Artifact build pipeline
│   │   └── inspect.ts           Artifact inspector CLI
│   │
│   ├── core/
│   │   ├── types.ts             All shared TypeScript types
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
│   └── demo/
│       ├── indexqlDemo.ts       IndexQL local demo (Queries A–D)
│       ├── httpDemo.ts          Real PostgreSQL benchmark
│       ├── setupDb.ts           PostgreSQL table + indexes setup
│       ├── setupRedis.ts        Redis pipeline loader
│       └── redisServer.ts       HTTP proxy for Redis batch fetches
│
├── tests/
│   ├── runner.ts                Zero-dependency test runner
│   ├── core.test.ts             Encoder, parser, normalizer, facet tests
│   ├── client.test.ts           Query engine, hooks, projection tests
│   └── cli.test.ts              Pipeline integration tests
│
├── docker-compose.yml           PostgreSQL 16 + Redis 7
├── package.json
└── tsconfig.json
```

## Setup

```bash
npm install
```

## Commands

```bash
npm run seed               # Regenerate data/products.json (15k products, LCG seed=42)
npm run build              # Build artifacts/ (products.bin, strings.json, facets.json)
npm run inspect            # Inspect artifacts (column layout, facets, sample products)
npm run demo:indexql       # IndexQL local demo (Queries A–D)
npm run demo:http          # Real PostgreSQL benchmark (needs docker:up + setup-db)
npm run demo:compare       # Runs both demos sequentially
npm run docker:up          # Start PostgreSQL 16 + Redis 7
npm run docker:down        # Stop services
npm run setup-db           # Create table + 8 indexes + insert 15k rows
npm run setup-redis        # Pipeline SET product:{id} into Redis
npm run start-redis-server # HTTP proxy on port 3001 for Redis batch fetches
npm test                   # 65 tests
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

Binary fields (`Float32`, `Bool`) are column-major encoded into `products.bin`.
String fields (`String`, `String[]`) go to `strings.json` as parallel arrays.

| IQ Type | Bits | Binary file |
|---------|------|-------------|
| Bool | 8 | products.bin |
| Int8/16/32/64 | 8–64 | products.bin |
| Float32/Float64 | 32/64 | products.bin |
| String / String[] | — | strings.json |

Current stride: `price`(4) + `rating`(4) + `inStock`(1) = **9 bytes/product**.
15,000 products → **~132 KB** binary (vs ~5 MB as JSON).

## Client SDK

```typescript
import { IndexQLClient } from './src/client/indexqlClient';

// Load artifacts once (file reads + binary decode, ~50 ms)
const client = IndexQLClient.load();

// Query — sub-millisecond after init
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

result.data;            // projected products
result.facets;          // facets on filtered set
result.meta.timingMs;   // ~1–2 ms warm
```

## Deploying Artifacts to S3/CDN

The build output in `artifacts/` is a set of static files designed to be served from any CDN or object store. Example using the AWS CLI:

```bash
# Build artifacts locally
npm run build

# Upload to S3
aws s3 cp artifacts/manifest.json  s3://my-bucket/catalog/manifest.json  --content-type application/json
aws s3 cp artifacts/products.bin   s3://my-bucket/catalog/products.bin   --content-type application/octet-stream
aws s3 cp artifacts/strings.json   s3://my-bucket/catalog/strings.json   --content-type application/json
aws s3 cp artifacts/facets.json    s3://my-bucket/catalog/facets.json    --content-type application/json
```

Or with `@aws-sdk/client-s3` in Node:

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';

const s3 = new S3Client({ region: 'us-east-1' });
const bucket = 'my-bucket';
const prefix = 'catalog';

const files = [
  { key: 'manifest.json', type: 'application/json' },
  { key: 'products.bin',  type: 'application/octet-stream' },
  { key: 'strings.json',  type: 'application/json' },
  { key: 'facets.json',   type: 'application/json' },
];

for (const f of files) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${prefix}/${f.key}`,
    Body: fs.readFileSync(`artifacts/${f.key}`),
    ContentType: f.type,
  }));
}
```

## Fetching Artifacts Over HTTP (Browser or Node 18+)

Once artifacts are on a CDN, the client can hydrate from HTTP using `fetch`:

```typescript
const BASE = 'https://cdn.example.com/catalog';

// 1. Fetch manifest
const manifest = await fetch(`${BASE}/manifest.json`).then(r => r.json());

// 2. Fetch data files in parallel
const [binBuf, strings, facets] = await Promise.all([
  fetch(`${BASE}/products.bin`).then(r => r.arrayBuffer()),
  fetch(`${BASE}/strings.json`).then(r => r.json()),
  fetch(`${BASE}/facets.json`).then(r => r.json()),
]);

// 3. Reconstruct products using the binary decoder
import { reconstructProducts } from './src/core/binary-encoder';
const products = reconstructProducts(Buffer.from(binBuf), strings);

// Now query in-memory — same API as the local client
```

This works identically in browsers (using the native `fetch` and `ArrayBuffer`) and in Node 18+ (using the built-in `fetch`).

## Artifact Sizes (15k products)

| File | Size |
|------|------|
| products.bin | 131.9 KB |
| strings.json | 2.48 MB |
| facets.json | 3.5 KB |
| manifest.json | <1 KB |
| **Total** | **~2.6 MB** |

With gzip/brotli on the CDN, transfer size drops significantly (strings.json compresses well).

## Performance

| Metric | Value |
|--------|-------|
| Init (load + decode) | ~50 ms |
| Warm query | 0.9–2 ms |
| Products | 15,000 |
| Binary size | 132 KB |

Compare to a typical PostgreSQL query over HTTP: 80–300 ms per round-trip.
