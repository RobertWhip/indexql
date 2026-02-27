# IndexQL Demo

Full-stack demo: PostgreSQL → on-demand binary artifact build → static serving → React client-side decode.

- **80k products** across 8 parent categories, ~10 subcategories each
- Server builds IndexQL binary artifacts per subcategory on demand
- Client fetches artifacts and decodes them using the IndexQL binary format

## Quick Start

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Install server deps + seed database
cd server
npm install
npx ts-node src/seed.ts

# 3. Start API server (port 3000)
npx ts-node src/index.ts

# 4. In another terminal — install client deps + start Vite (port 5173)
cd ../client
npm install
npm run dev
```

Open http://localhost:5173, expand a category, click a subcategory.

## Architecture

```
Browser (React)                    Express (:3000)              PostgreSQL
     │                                  │                           │
     │  POST /api/load_products {slug}  │                           │
     │ ──────────────────────────────►  │  SELECT * FROM products   │
     │                                  │ ─────────────────────────►│
     │                                  │  ◄──── rows ──────────────│
     │                                  │                           │
     │                                  │  normalize → encode →     │
     │                                  │  write products.bin,      │
     │                                  │  strings.json, facets.json│
     │  ◄── { ok, manifest, timingMs }  │                           │
     │                                  │                           │
     │  GET /artifacts/<slug>/*.bin|json │                           │
     │ ──────────────────────────────►  │  (express.static)         │
     │  ◄──── binary + JSON ────────── │                           │
     │                                  │                           │
     │  decodeBinary(arrayBuf, strings) │                           │
     │  → Product[]  (client-side)      │                           │
```

## Cleanup

```bash
docker compose down -v
```
