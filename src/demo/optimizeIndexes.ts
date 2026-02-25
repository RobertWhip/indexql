/**
 * src/demo/optimizeIndexes.ts
 * Replaces the generic indexes with query-specific optimized ones.
 *
 * Drops (3):
 *   idx_products_in_stock        — boolean, too low-cardinality to be selective
 *   idx_products_cat_price_stock — superseded by new Query-A index
 *   idx_products_cat_brand       — superseded by new Query-C index
 *
 * Adds (3):
 *   idx_opt_a  (category, in_stock, rating DESC) INCLUDE (price, id, name, brand)
 *              Query A: equality on category+in_stock → scan rating DESC → filter
 *              price inline → LIMIT 10 stops after ~70 rows, not 104k.
 *
 *   idx_opt_b  (price) INCLUDE (id, name, brand, rating)
 *              Query B: converts bitmap heap scans to index-only scans, eliminating
 *              ~30k random block reads for the 76k matching rows.
 *
 *   idx_opt_c  (category, brand, price) INCLUDE (id, name, rating)
 *              Query C: index already sorted by price → no external merge sort,
 *              no disk spill, 166k rows delivered in order directly.
 *
 * Usage: npx ts-node src/demo/optimizeIndexes.ts
 */

import { Pool } from 'pg';
import { performance } from 'perf_hooks';

const pool = new Pool({
  host: 'localhost', port: 5432, database: 'indexql',
  user: 'postgres', password: 'postgres',
  connectionTimeoutMillis: 5000,
});

const BOLD  = '\x1b[1m';
const GREEN = '\x1b[32m';
const CYAN  = '\x1b[36m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ${CYAN}→${RESET}  ${label}… `);
  const t0 = performance.now();
  await fn();
  console.log(`${GREEN}done${RESET} ${DIM}(${((performance.now() - t0) / 1000).toFixed(1)} s)${RESET}`);
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}IndexQL – Index Optimizer${RESET}`);
  console.log('─'.repeat(52));

  const client = await pool.connect();
  try {
    // Row count for reference
    const { rows: cr } = await client.query('SELECT COUNT(*) AS n FROM products');
    console.log(`\n  Table: ${Number(cr[0].n).toLocaleString()} products\n`);

    console.log(`${BOLD}Dropping suboptimal indexes:${RESET}`);
    await step('idx_products_in_stock',        () => client.query('DROP INDEX IF EXISTS idx_products_in_stock'));
    await step('idx_products_cat_price_stock', () => client.query('DROP INDEX IF EXISTS idx_products_cat_price_stock'));
    await step('idx_products_cat_brand',       () => client.query('DROP INDEX IF EXISTS idx_products_cat_brand'));

    console.log(`\n${BOLD}Building optimized indexes:${RESET}`);

    await step(
      'idx_opt_a  (category, in_stock, rating DESC) INCLUDE (price, id, name, brand)',
      () => client.query(`
        CREATE INDEX idx_opt_a ON products (category, in_stock, rating DESC)
        INCLUDE (price, id, name, brand)
      `),
    );

    await step(
      'idx_opt_b  (price) INCLUDE (id, name, brand, rating)',
      () => client.query(`
        CREATE INDEX idx_opt_b ON products (price)
        INCLUDE (id, name, brand, rating)
      `),
    );

    await step(
      'idx_opt_c  (category, brand, price) INCLUDE (id, name, rating)',
      () => client.query(`
        CREATE INDEX idx_opt_c ON products (category, brand, price)
        INCLUDE (id, name, rating)
      `),
    );

    await step('ANALYZE', () => client.query('ANALYZE products'));

    // Show final index list
    const { rows: idxRows } = await client.query(`
      SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid)) AS size
      FROM pg_stat_user_indexes
      WHERE relname = 'products'
      ORDER BY indexname
    `);

    console.log(`\n${BOLD}Current indexes:${RESET}`);
    for (const r of idxRows) {
      console.log(`  ${r.indexname.padEnd(42)} ${DIM}${r.size}${RESET}`);
    }
    console.log();

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
