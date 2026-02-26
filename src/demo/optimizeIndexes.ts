/**
 * Drops 3 generic indexes and replaces them with query-specific covering indexes:
 *
 *   idx_opt_a  (category, in_stock, rating DESC) INCLUDE (price, id, name, brand)
 *              Equality on category+in_stock → scan rating DESC → filter price inline.
 *
 *   idx_opt_b  (price) INCLUDE (id, name, brand, rating)
 *              Converts bitmap heap scans to index-only scans.
 *
 *   idx_opt_c  (category, brand, price) INCLUDE (id, name, rating)
 *              Already sorted by price → no external merge sort.
 */

import { Pool } from 'pg';
import { performance } from 'perf_hooks';
import { BOLD, GREEN, CYAN, DIM, RESET } from '../fmt';

const pool = new Pool({
  host: 'localhost', port: 5432, database: 'indexql',
  user: 'postgres', password: 'postgres',
  connectionTimeoutMillis: 5000,
});

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
    for (const idx of idxRows) {
      console.log(`  ${idx.indexname.padEnd(42)} ${DIM}${idx.size}${RESET}`);
    }
    console.log();

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
