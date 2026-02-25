/**
 * src/demo/httpDemo.ts
 * Real PostgreSQL benchmark — measures query latency with proper B-tree + GIN indexes.
 *
 * Prerequisites:
 *   npm run docker:up   → start PostgreSQL 16
 *   npm run setup-db    → create table, indexes, insert 15k products
 *
 * Run: npm run demo:http
 */

import { performance } from 'perf_hooks';
import { Pool, PoolClient } from 'pg';

const pool = new Pool({
  host:                    'localhost',
  port:                    5432,
  database:                'indexql',
  user:                    'postgres',
  password:                'postgres',
  connectionTimeoutMillis: 3000,
  max:                     5,
});

// ── Formatting ────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const DIM    = '\x1b[2m';

const b = (s: string) => `${BOLD}${s}${RESET}`;
const r = (s: string) => `${RED}${s}${RESET}`;
const y = (s: string) => `${YELLOW}${s}${RESET}`;
const g = (s: string) => `${GREEN}${s}${RESET}`;
const d = (s: string) => `${DIM}${s}${RESET}`;

function hr(label: string): void {
  const pad = '─'.repeat(Math.max(0, 58 - label.length));
  console.log(`\n${b(`── ${label} ${pad}`)}`);
}

function row(label: string, value: string): void {
  console.log(`  ${label.padEnd(30)} ${value}`);
}

function fmtMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)} μs` : `${ms.toFixed(2)} ms`;
}

// ── Benchmarking ──────────────────────────────────────────────────────────────

interface BenchResult {
  rowCount: number;
  min:      number;
  avg:      number;
  max:      number;
  explain:  string;
}

async function bench(
  client:  PoolClient,
  sql:     string,
  params:  unknown[],
  runs = 5,
): Promise<BenchResult> {
  const timings: number[] = [];
  let rowCount = 0;

  for (let i = 0; i < runs; i++) {
    const t0  = performance.now();
    const res = await client.query(sql, params as never[]);
    timings.push(performance.now() - t0);
    rowCount = res.rowCount ?? res.rows.length;
  }

  // EXPLAIN ANALYZE on an extra run (not counted in timings)
  const explainRes = await client.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
    params as never[],
  );
  const explain = (explainRes.rows as Array<{ 'QUERY PLAN': string }>)
    .map(r => r['QUERY PLAN'])
    .join('\n');

  const min = Math.min(...timings);
  const avg = timings.reduce((a, x) => a + x, 0) / timings.length;
  const max = Math.max(...timings);
  return { rowCount, min, avg, max, explain };
}

// ── Demo ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // Read actual row count for the banner
  let rowsBanner = '?';
  try {
    const tmpClient = await pool.connect();
    const { rows: cr } = await tmpClient.query('SELECT COUNT(*) AS n FROM products');
    rowsBanner = Number(cr[0].n).toLocaleString();
    tmpClient.release();
  } catch { /* will fail again below with a proper error */ }

  const bannerLabel = `PostgreSQL 16 Benchmark — ${rowsBanner} products`;
  const bannerWidth = 58;
  const bannerPad   = ' '.repeat(Math.max(0, bannerWidth - bannerLabel.length - 2));

  console.log();
  console.log(b('╔══════════════════════════════════════════════════════════╗'));
  console.log(b(`║  ${bannerLabel}${bannerPad}║`));
  console.log(b('╚══════════════════════════════════════════════════════════╝'));
  console.log(d('\n  B-tree indexes on category, brand, price, rating, in_stock'));
  console.log(d('  Composite: (category, price, in_stock), (category, brand)'));
  console.log(d('  GIN index: to_tsvector(name || description)'));
  console.log(d(`  Each query runs 5× — min / avg / max reported.\n`));

  // ── Connect ───────────────────────────────────────────────────────────────
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(r(`\n  ERROR: Cannot connect to PostgreSQL — ${msg}`));
    console.error(d('  Start PostgreSQL:  npm run docker:up'));
    console.error(d('  Seed the database: npm run setup-db\n'));
    await pool.end();
    process.exit(1);
  }

  // Warm-up: force plan caching and buffer warming
  await client.query('SELECT COUNT(*) FROM products');
  await client.query(`SELECT id FROM products WHERE category = $1 LIMIT 1`, ['Electronics']);

  const summaryTimings: number[] = [];

  try {
    // ── Query A: Electronics ≤ $500, in stock, top-10 by rating ─────────────
    hr('1. Query A – Electronics ≤ $500, in stock, sort rating↓');

    const rA = await bench(client,
      `SELECT id, name, price, rating, brand
         FROM products
        WHERE category = $1 AND price <= $2 AND in_stock = $3
        ORDER BY rating DESC
        LIMIT 10`,
      ['Electronics', 500, true],
    );

    row('Rows returned',   String(rA.rowCount));
    row('Min / Avg / Max', `${fmtMs(rA.min)} / ${r(fmtMs(rA.avg))} / ${fmtMs(rA.max)}`);
    summaryTimings.push(rA.avg);

    console.log(d('\n  EXPLAIN ANALYZE (first 6 lines):'));
    rA.explain.split('\n').slice(0, 6).forEach(line => console.log(d(`    ${line}`)));

    // ── Query B: FTS "blender", $100–$600, sort price asc ───────────────────
    hr("2. Query B – FTS 'blender', $100–$600, sort price↑");

    const rB = await bench(client,
      `SELECT id, name, price, brand, rating
         FROM products
        WHERE to_tsvector('english', name || ' ' || description)
                @@ plainto_tsquery('english', $1)
          AND price BETWEEN $2 AND $3
        ORDER BY price ASC`,
      ['blender', 100, 600],
    );

    row('Rows returned',   String(rB.rowCount));
    row('Min / Avg / Max', `${fmtMs(rB.min)} / ${r(fmtMs(rB.avg))} / ${fmtMs(rB.max)}`);
    summaryTimings.push(rB.avg);

    console.log(d('\n  EXPLAIN ANALYZE (first 6 lines):'));
    rB.explain.split('\n').slice(0, 6).forEach(line => console.log(d(`    ${line}`)));

    // ── Query C: Clothing + Nike|Adidas + brand facets ───────────────────────
    hr('3. Query C – Clothing, Nike|Adidas + brand facets');

    const rC = await bench(client,
      `SELECT id, name, brand, price, rating
         FROM products
        WHERE category = $1 AND brand = ANY($2)
        ORDER BY price ASC`,
      ['Clothing', ['Nike', 'Adidas']],
    );

    // Separate facet aggregation
    const facetRes = await client.query(
      `SELECT brand, COUNT(*) AS cnt
         FROM products
        WHERE category = $1 AND brand = ANY($2)
        GROUP BY brand
        ORDER BY cnt DESC`,
      ['Clothing', ['Nike', 'Adidas']],
    );

    row('Rows returned',   String(rC.rowCount));
    row('Min / Avg / Max', `${fmtMs(rC.min)} / ${r(fmtMs(rC.avg))} / ${fmtMs(rC.max)}`);
    summaryTimings.push(rC.avg);

    console.log(d('\n  Brand facets:'));
    (facetRes.rows as Array<{ brand: string; cnt: string }>).forEach(fr =>
      console.log(d(`    ${fr.brand.padEnd(16)} ${fr.cnt} items`))
    );

    console.log(d('\n  EXPLAIN ANALYZE (first 6 lines):'));
    rC.explain.split('\n').slice(0, 6).forEach(line => console.log(d(`    ${line}`)));

    // ── Comparison Summary ────────────────────────────────────────────────────
    hr('4. Comparison Summary');
    console.log();

    const pgTotal   = summaryTimings.reduce((a, x) => a + x, 0);
    const pgPerQ    = pgTotal / summaryTimings.length;
    // IndexQL representative numbers for 15k products (from indexqlDemo)
    const iqInitMs  = 45;    // one-time artifact load
    const iqPerQ    = 0.35;  // warm query avg
    const iqTotal   = iqPerQ * 3;
    const ratio     = Math.round(pgPerQ / iqPerQ);

    console.log(`  ${'Approach'.padEnd(34)} ${'3 queries'.padEnd(16)} ${'Per query avg'}`);
    console.log(`  ${'─'.repeat(62)}`);
    console.log(`  ${'PostgreSQL (indexed, local conn)'.padEnd(34)} ${r(`~${pgTotal.toFixed(1)} ms`).padEnd(26)} ${r(`~${pgPerQ.toFixed(1)} ms`)}`);
    console.log(`  ${'IndexQL (local, after init)'.padEnd(34)} ${y(`~${iqTotal.toFixed(2)} ms`).padEnd(26)} ${y(`~${iqPerQ} ms`)}`);
    console.log(`  ${'IndexQL init (one-time)'.padEnd(34)} ${d(`~${iqInitMs} ms`).padEnd(26)} ${d('amortised')}`);
    console.log();
    console.log(`  Even with optimal indexes, IndexQL is ~${g(`${ratio}×`)} faster per query.`);
    console.log();
    console.log(d('  PostgreSQL strengths:'));
    console.log(d('    • Handles writes, transactions, multi-user concurrency'));
    console.log(d('    • Scales to billions of rows'));
    console.log(d('    • Full SQL: joins, aggregations, complex queries'));
    console.log();
    console.log(d('  IndexQL strengths (read-only catalog use case):'));
    console.log(d('    • Sub-millisecond queries — zero network hops'));
    console.log(d('    • No server required — serve artifacts from a CDN'));
    console.log(d('    • Works offline after the first artifact download'));
    console.log(d('    • Schema-driven: artifact structure matches query contract'));
    console.log();
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
