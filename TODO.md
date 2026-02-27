# IndexQL — Roadmap

## Milestone 1: Publishable npm Package

The library is architecturally solid but can't actually be installed and used by anyone yet. This milestone removes every blocker between `npm install indexql` and a working import.

### 1.1 Create barrel export (`src/index.ts`)

`package.json` points to `dist/index.js` but the file doesn't exist. Without it, `import { IndexQLClient } from 'indexql'` fails immediately. This is the single most critical gap — users literally cannot use the library.

Export surface should include:
- Core types (`Entity`, `QueryFilter`, `QueryOptions`, `QueryResult`, facet types)
- Decorators (`@Entity`, `@Column`, `@Facet`, `DataType`)
- Encoder (`encodeColumns`, `decodeColumns`, `reconstruct`, `reconstructFromArrayBuffer`)
- Client (`IndexQLClient`)
- Hooks (`createQueryHook`, `toggleFacetValue`)
- Schema parser (`parseIQSchema`, `toSchemaNode`)

### 1.2 Fix `package.json` metadata

Current state is missing fields that npm and users depend on:

- **`types`** — Without `"types": "dist/index.d.ts"`, TypeScript users get no autocompletion or type checking. This alone would make many developers skip the library.
- **`exports`** — Modern bundlers (Vite, Next.js, esbuild) need the `exports` map to resolve entry points. Without it, tree-shaking and ESM imports break.
- **`files`** — Without it, `npm publish` ships tests, raw data, demo code, and `.claude/` config. The package balloons in size and leaks internals.
- **`license`** — npm warns on missing license. Many companies have policies against using unlicensed packages.
- **`repository`, `homepage`, `keywords`** — Discoverability. A package without keywords doesn't show up in npm search.
- **Rename from `indexql-mvp`** to `indexql` — The `-mvp` suffix signals "not ready" to potential users.

### 1.3 Move demo dependencies out of core

`pg` and `ioredis` are listed as runtime dependencies but only used in `demo/`. Anyone who `npm install indexql` today downloads PostgreSQL and Redis drivers they'll never use. This adds ~2MB of unnecessary downloads and creates a false impression that the library requires a database. Move them to `demo/product-catalog/package.json` (which already exists).

### 1.4 Add LICENSE file

No license = legally unusable. Most companies won't touch code without an explicit license. MIT is the standard choice for utility libraries — permissive, well-understood, zero friction.

### 1.5 Configure build for dual CJS/ESM output

The current build outputs only CommonJS. Modern frontend tooling (Vite, Next.js app router, Deno) expects ESM. A dual-format package with proper `exports` map covers both worlds. This likely means a second tsconfig for ESM output or switching to a bundler like `tsup`.

### 1.6 `.npmignore` or `files` field

Verify what `npm pack` actually produces. The published tarball should contain only `dist/`, `README.md`, `LICENSE`, and `package.json`. Nothing else.

---

## Milestone 2: Developer Experience

A publishable package is necessary but not sufficient. Developers choose libraries based on how fast they can go from zero to working code. This milestone makes that path frictionless.

### 2.1 `npx indexql init` CLI scaffolding

A single command that:
1. Creates a `.iq` schema file with a commented example
2. Generates a starter entity class with decorators
3. Adds build/inspect scripts to the user's `package.json`

Why: The current setup requires reading docs, manually creating schema files, and wiring up the CLI. An `init` command drops time-to-first-artifact from 30 minutes to 30 seconds.

### 2.2 Improve error messages

Binary format errors currently surface as cryptic buffer offset issues. Schema parse errors give line numbers but no context. Adding human-readable error messages with suggestions ("Did you mean `Float32` instead of `Float`?") is the difference between a library people fight with and one they trust.

### 2.3 API reference documentation

The README shows examples but doesn't document every option. Generate or write a complete API reference covering:
- Every public function's signature, parameters, return type
- Every decorator's options
- `QueryFilter` conventions (`*Min`, `*Max`, `search`, set-match, boolean)
- Binary format spec (for advanced users who want to write their own decoders)

### 2.4 Add CHANGELOG.md

Users upgrading between versions need to know what changed. Start with a v1.0.0 entry summarizing current capabilities. Going forward, maintain it per release.

---

## Milestone 3: Features That Justify the Dependency

The core value proposition — "zero-latency faceted search in the browser" — is strong. But users comparing IndexQL to alternatives (Algolia, Meilisearch, client-side SQLite) need more reasons to choose it. These features widen the gap.

### 3.1 Streaming decode for large datasets

Current `reconstructFromArrayBuffer()` blocks the main thread while decoding the entire buffer. For datasets over 50k items, this causes visible UI jank. A streaming decoder that yields chunks via `AsyncIterableIterator<Entity[]>` lets the UI stay responsive and show progressive results.

Why it matters: The library's pitch is "works in the browser." If it freezes the browser on load, that pitch falls apart.

### 3.2 Web Worker support

Provide a pre-built worker wrapper (`indexql/worker`) that runs decode + query off the main thread. The API stays the same (`client.query(filter)`), but execution happens in a worker with postMessage bridging. This is the expected pattern for any library that processes significant data in the browser.

### 3.3 Incremental / delta updates

Currently, any data change requires rebuilding and re-downloading the entire binary artifact. For datasets that change frequently (inventory, pricing), this is wasteful. A delta format that encodes only changed rows — identified by a hash or version column — would allow partial updates. The client merges the delta into its local buffer.

Why it matters: This is the feature that moves IndexQL from "static catalogs" to "near-real-time faceted search," which is a much larger market.

### 3.4 Compression (gzip/brotli awareness)

The binary format is already compact, but HTTP compression can shrink it further. Add a `Content-Encoding` aware loader that handles decompression transparently. Document recommended CDN/S3 compression settings. This is low effort but directly reduces bandwidth costs for users — an easy selling point.

### 3.5 String field encoding in binary format

Strings are currently excluded from the binary artifact entirely. This means the client must still fetch product names, descriptions, etc. separately (or embed them in JSON). Adding a string table (dictionary-encoded, varint-length-prefixed) to the IQBN format would make `products.bin` fully self-contained. One file, one fetch, complete data.

### 3.6 Compound sort and secondary sort keys

`query()` currently supports single-field sorting. Real catalog UIs need "sort by price, then by rating" or "sort by relevance, then alphabetical." Adding an array-based sort option (`sort: [{ field: 'price', dir: 'asc' }, { field: 'rating', dir: 'desc' }]`) is a small change with big UX impact.

### 3.7 Projection push-down

`query()` accepts a `fields` projection but still decodes all columns first, then picks fields. For wide schemas (20+ columns), decoding only the requested columns from the binary buffer would significantly reduce memory allocation and decode time.

---

## Milestone 4: Ecosystem & Trust

Open-source libraries live or die by community trust. This milestone builds the signals that tell developers "this is maintained, tested, and safe to depend on."

### 4.1 GitHub Actions CI

Run tests on every push and PR. Badge in README. This is table stakes — any library without CI looks abandoned.

Matrix: Node 18, 20, 22 on ubuntu-latest.

### 4.2 Automated npm publishing

GitHub Actions workflow triggered by git tags (`v*`). Runs tests, builds, publishes to npm. Prevents human error in the release process and ensures every published version passes tests.

### 4.3 Benchmark suite

Create a reproducible benchmark that measures:
- Encode time (items/sec at various dataset sizes: 1k, 10k, 100k)
- Decode time (browser ArrayBuffer → entities)
- Query throughput (queries/sec with various filter complexity)
- Binary size vs JSON size at each dataset scale

Publish results in README. This gives users hard numbers to compare against alternatives and gives maintainers regression detection.

### 4.4 Bundle size tracking

Add `size-limit` or similar to CI. Report the gzip'd size of the client-side bundle. IndexQL's value prop includes being lightweight — prove it with numbers and prevent regressions.

### 4.5 Real-world example: e-commerce template

The existing demo is good but tightly coupled to the repo. Create a standalone template repo (`indexql-ecommerce-starter`) that users can clone and run. It should demonstrate:
- Schema definition with decorators
- Server-side build pipeline
- CDN deployment of artifacts
- Client-side decode + faceted search UI
- Filter state management with hooks

This serves as both documentation and proof that the library works end-to-end.

---

## Milestone 5: Articles & Content

Technical content serves two purposes: it drives adoption (SEO, social sharing) and it forces clarity in the library's value proposition. Each article targets a different audience.

### 5.1 "Zero-Latency Faceted Search: How IndexQL Eliminates the Network from Product Filtering"

**Audience:** Frontend engineers building e-commerce or catalog UIs.
**Angle:** Most faceted search requires a server round-trip per filter change. IndexQL moves the entire dataset to the client in a single binary fetch, making every subsequent filter instant. Walk through the architecture, show before/after latency numbers, and demonstrate the user experience difference.
**Publish on:** Blog, dev.to, Hacker News.

### 5.2 "Designing a Column-Major Binary Format for the Browser"

**Audience:** Systems-minded developers, binary format enthusiasts, performance engineers.
**Angle:** Deep technical dive into the IQBN format — why column-major beats row-major for filter queries, how the stride calculation works, the trade-offs of fixed-width encoding, and how `ArrayBuffer` + `DataView` make this viable in JavaScript. Include diagrams of the binary layout.
**Publish on:** Blog, Medium engineering section, r/programming.

### 5.3 "TypeScript Decorators for Schema-Driven Data: Lessons from Building IndexQL"

**Audience:** TypeScript developers interested in metaprogramming and decorator patterns.
**Angle:** How `@Entity`, `@Column`, and `@Facet` decorators extract a schema from class definitions, why `experimentalDecorators` was chosen, and the pattern for converting decorator metadata to binary column definitions. Practical guide to building decorator-based systems.
**Publish on:** Blog, dev.to, TypeScript community.

### 5.4 "Replacing Algolia with a 132KB Binary File"

**Audience:** Startup CTOs, indie hackers, cost-conscious developers.
**Angle:** Provocative comparison. For catalogs under 100k items, IndexQL eliminates the search service entirely — no monthly bill, no API keys, no rate limits. Walk through migrating a real product catalog from Algolia to IndexQL, showing cost savings and latency improvements. Be honest about trade-offs (no typo tolerance, no synonyms, no ranking ML).
**Publish on:** Blog, Hacker News, Indie Hackers.

### 5.5 "Building Offline-First Product Search with IndexQL and Service Workers"

**Audience:** PWA developers, mobile-first teams.
**Angle:** Because IndexQL runs entirely client-side, it works offline after the initial binary fetch. Show how to cache `products.bin` in a Service Worker, handle updates with cache-busting hashes, and provide a seamless offline search experience. This is a unique capability that server-based search can never match.
**Publish on:** Blog, web.dev community, PWA forums.

---

## Priority Order

```
Milestone 1 (Publishable)     ← Do this first. Nothing else matters if users can't install it.
Milestone 4.1–4.2 (CI + Publish) ← Automate quality and releases before adding features.
Milestone 2 (DX)              ← Make the first 5 minutes great.
Milestone 5.1 + 5.4 (Articles)← Drive initial awareness with the two strongest hooks.
Milestone 3.1–3.2 (Streaming) ← Remove the biggest technical limitation.
Milestone 3.5 (Strings)       ← Complete the binary format.
Milestone 3.3 (Deltas)        ← Expand addressable market.
Remaining articles             ← Sustain awareness over time.
Milestone 4.3–4.5 (Trust)     ← Build long-term credibility.
Milestone 3.6–3.7 (Polish)    ← Nice-to-have optimizations.
```
