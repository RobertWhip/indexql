import * as http            from 'http';
import { IndexQLClient }    from '../client/indexqlClient';
import { now }              from '../client/utils';
import { TermsFacet, Product } from '../core/types';
import { bold, cyan, green, yellow, dim, hr, row } from '../fmt';

/** Run a query fn 3× and return the warm average (last 2 runs). */
function warmAvg(fn: () => number): number {
  fn(); // cold run (discarded)
  const r1 = fn();
  const r2 = fn();
  return (r1 + r2) / 2;
}

// ── Redis HTTP helper ─────────────────────────────────────────────────────────

/** HTTP POST to the Redis server to batch-fetch products by ID. */
function batchFetchFromRedis(ids: string[]): Promise<Product[]> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ids });
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port:     3001,
      path:     '/products/batch',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve((parsed as { products: Product[] }).products ?? []);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(new Error('Redis server timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Demo ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log();
  console.log(bold('╔══════════════════════════════════════════════════════════╗'));
  console.log(bold('║     IndexQL – Static Artifact Demo (15,000 products)   ║'));
  console.log(bold('╚══════════════════════════════════════════════════════════╝'));

  // ── Init ──────────────────────────────────────────────────────────────────
  hr('1. Client Initialization');
  const t0     = now();
  const client = IndexQLClient.load();
  const initMs = now() - t0;
  const stats  = client.getStats();

  const manifest    = client.getManifest();
  const formatKB    = (n: number) => `${(n / 1024).toFixed(1)} KB`;

  row('Load time',          green(`${initMs.toFixed(2)} ms`));
  row('Products',           String(stats.productCount));
  row('Facets',             String(stats.facetCount));
  row('products.bin',       dim(`${formatKB(manifest.files.products.sizeBytes)}`));
  row('strings.json',       dim(`${formatKB(manifest.files.strings.sizeBytes)}`));
  row('facets.json',        dim(`${formatKB(manifest.files.facets.sizeBytes)}`));
  row('Artifacts dir',      dim(stats.artifactsDir));

  // ── Query A: Electronics ≤ $500, in stock, top-10 by rating ─────────────
  hr('2. Query A – Electronics ≤ $500, in stock, sort rating↓');

  let rA = client.queryProducts({
    filter:     { category: 'Electronics', priceMax: 500, inStock: true },
    sort:       { field: 'rating', order: 'desc' },
    pagination: { page: 1, pageSize: 10 },
    fields:     ['id', 'name', 'price', 'rating', 'brand'],
    includeFacets: false,
  });
  const avgA = warmAvg(() => {
    rA = client.queryProducts({
      filter:     { category: 'Electronics', priceMax: 500, inStock: true },
      sort:       { field: 'rating', order: 'desc' },
      pagination: { page: 1, pageSize: 10 },
      fields:     ['id', 'name', 'price', 'rating', 'brand'],
      includeFacets: false,
    });
    return rA.meta.timingMs;
  });

  row('Matching',    `${rA.meta.total} products`);
  row('Warm avg',    green(`${avgA.toFixed(3)} ms`));
  console.log();
  rA.data.slice(0, 5).forEach((p, i) =>
    console.log(`  ${i + 1}. ${cyan(p.name!)} – $${p.price}  ★${p.rating}  ${p.brand}`)
  );

  // ── Query B: full-text search "blender", $100–$600, sort price asc ───────
  hr('3. Query B – FTS "blender", $100–$600, sort price↑');

  let rB = client.queryProducts({
    filter: { search: 'blender', priceMin: 100, priceMax: 600 },
    sort:   { field: 'price', order: 'asc' },
    fields: ['id', 'name', 'price', 'brand', 'rating'],
  });
  const avgB = warmAvg(() => {
    rB = client.queryProducts({
      filter: { search: 'blender', priceMin: 100, priceMax: 600 },
      sort:   { field: 'price', order: 'asc' },
      fields: ['id', 'name', 'price', 'brand', 'rating'],
    });
    return rB.meta.timingMs;
  });

  row('Matching',  `${rB.meta.total} products`);
  row('Warm avg',  green(`${avgB.toFixed(3)} ms`));
  console.log();
  rB.data.slice(0, 5).forEach((p, i) =>
    console.log(`  ${i + 1}. ${cyan(p.name!)} – $${p.price}  (${p.brand})  ★${p.rating}`)
  );

  // ── Query C: Clothing, Nike|Adidas, with facets ──────────────────────────
  hr('4. Query C – Clothing, Nike|Adidas, with facets');

  let rC = client.queryProducts({
    filter:        { category: 'Clothing', brand: ['Nike', 'Adidas'] },
    sort:          { field: 'price', order: 'asc' },
    includeFacets: true,
  });
  const avgC = warmAvg(() => {
    rC = client.queryProducts({
      filter:        { category: 'Clothing', brand: ['Nike', 'Adidas'] },
      sort:          { field: 'price', order: 'asc' },
      includeFacets: true,
    });
    return rC.meta.timingMs;
  });

  row('Matching',  `${rC.meta.total} products`);
  row('Warm avg',  green(`${avgC.toFixed(3)} ms`));

  const brandFacet = rC.facets?.find(f => f.field === 'brand') as TermsFacet | undefined;
  if (brandFacet) {
    console.log(`\n  Brand facet (${brandFacet.buckets.length} values):`);
    brandFacet.buckets.forEach(bk =>
      console.log(`    ${bk.value.padEnd(16)} ${bk.count} items`)
    );
  }

  // ── Query D: local filter → HTTP batch fetch from Redis ──────────────────
  hr('5. Query D – local filter → HTTP batch fetch from Redis');

  // Local filter: Electronics ≤ $500, in stock
  const t0D     = now();
  const filtered = client.getAllProducts().filter(p =>
    p.category === 'Electronics' && p.price <= 500 && p.inStock
  );
  const filterMs = now() - t0D;
  const matchIds = filtered.map(p => p.id);

  row('Local filter (Elec ≤ $500, in stock)', '');
  row('  Matching IDs', String(matchIds.length));
  row('  Filter time',  green(`${filterMs.toFixed(2)} ms`));

  // HTTP batch fetch from Redis
  let httpMs = 0;
  let redisSkipped = false;
  try {
    const t0H      = now();
    const redisPr  = await batchFetchFromRedis(matchIds);
    httpMs         = now() - t0H;

    console.log();
    row('  POST /products/batch', dim(`{ ids: [${matchIds.length} IDs] }`));
    row('  HTTP + Redis time',    green(`${httpMs.toFixed(2)} ms`));
    row('  Total (filter+fetch)', green(`${(filterMs + httpMs).toFixed(2)} ms`));
    row('  Products returned',    String(redisPr.length));
    console.log();
    console.log(dim('  (IndexQL does filtering; Redis delivers full records in one round-trip)'));
  } catch {
    redisSkipped = true;
    console.log(dim('\n  (Redis server not reachable – skipping HTTP fetch)'));
    console.log(dim('  Start with: npm run start-redis-server'));
  }

  // ── Timing Summary ────────────────────────────────────────────────────────
  hr('6. Timing Summary');
  const totalQueryMs = avgA + avgB + avgC;
  row('Init (load + decode)', yellow(`${initMs.toFixed(2)} ms`));
  row('Query A (warm avg)',   green(`${avgA.toFixed(3)} ms`));
  row('Query B (warm avg)',   green(`${avgB.toFixed(3)} ms`));
  row('Query C (warm avg)',   green(`${avgC.toFixed(3)} ms`));
  row('Total A+B+C',          green(`${totalQueryMs.toFixed(3)} ms`));
  row('Query D filter',       green(`${filterMs.toFixed(2)} ms`));
  if (!redisSkipped && httpMs > 0) {
    row('Query D HTTP+Redis',   green(`${httpMs.toFixed(2)} ms`));
  }
  console.log();
  console.log(dim('  All queries executed locally — zero network latency.'));
  console.log(dim('  Init cost is one-time; subsequent queries reuse in-memory data.'));
  console.log();
}

run().catch(err => { console.error(err); process.exit(1); });
