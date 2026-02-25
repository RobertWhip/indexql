/**
 * src/demo/setupDb.ts
 * Creates the products table in PostgreSQL, bulk-inserts products, then builds indexes.
 *
 * Indexes are created AFTER all inserts for much faster load on large tables.
 *
 * Usage:
 *   npm run setup-db           → 15,000 products (default)
 *   npm run setup-db-5m        → 5,000,000 products
 *   npx ts-node src/demo/setupDb.ts --count 1000000
 */

import { Pool } from 'pg';

// ── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(): { count: number } {
  const args = process.argv.slice(2);
  let count = 15_000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) count = parseInt(args[++i], 10);
  }
  return { count };
}

// ── Deterministic LCG RNG ─────────────────────────────────────────────────────

class LCG {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }

  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  nextFloat(min: number, max: number, decimals = 2): number {
    return parseFloat((this.next() * (max - min) + min).toFixed(decimals));
  }
}

// ── Category Definitions ──────────────────────────────────────────────────────

interface CategoryDef {
  name:        string;
  weight:      number;   // proportional share of total
  brands:      string[];
  types:       string[];
  adjs:        string[];
  series:      string[];
  priceMin:    number;
  priceMax:    number;
  inStockRate: number;
}

const CATEGORIES: CategoryDef[] = [
  {
    name: 'Electronics', weight: 2500,
    brands:  ['Apple', 'Samsung', 'Sony', 'LG', 'Bose', 'Logitech', 'Asus', 'Dell', 'HP', 'Microsoft'],
    types:   ['Laptop', 'Smartphone', 'Headphones', 'Earbuds', 'Tablet', 'Monitor', 'Camera', 'Speaker', 'Smartwatch', 'Keyboard'],
    adjs:    ['Pro', 'Ultra', 'Max', 'Elite', 'Air', 'Plus', 'Advanced', 'Smart', 'Turbo', 'Edge'],
    series:  ['X1', 'S3', 'Z5', 'V7', 'A9', 'M2'],
    priceMin: 49, priceMax: 2999, inStockRate: 0.85,
  },
  {
    name: 'Clothing', weight: 2500,
    brands:  ['Nike', 'Adidas', 'Zara', 'H&M', "Levi's", 'Under Armour', 'Puma', 'Gap', 'Calvin Klein', 'Ralph Lauren'],
    types:   ['T-Shirt', 'Jeans', 'Jacket', 'Dress', 'Hoodie', 'Sneakers', 'Boots', 'Shorts', 'Coat', 'Sweater'],
    adjs:    ['Slim', 'Classic', 'Athletic', 'Premium', 'Vintage', 'Casual', 'Sport', 'Urban', 'Essential', 'Comfort'],
    series:  ['2022', '2023', '2024', 'Pro', 'Plus', 'Original'],
    priceMin: 15, priceMax: 500, inStockRate: 0.80,
  },
  {
    name: 'Home & Garden', weight: 2000,
    brands:  ['IKEA', 'Dyson', 'KitchenAid', 'Black+Decker', 'Bosch', 'Philips', 'Weber', 'Gardena', 'iRobot', 'Cuisinart'],
    types:   ['Blender', 'Vacuum', 'Drill', 'Mixer', 'Fan', 'Lamp', 'Shelf', 'Chair', 'Table', 'Mower'],
    adjs:    ['Compact', 'Professional', 'Smart', 'Cordless', 'Silent', 'Digital', 'Classic', 'Deluxe', 'Mini', 'Power'],
    series:  ['100', '200', '300', '400', '500', '600'],
    priceMin: 20, priceMax: 999, inStockRate: 0.75,
  },
  {
    name: 'Books', weight: 1750,
    brands:  ["O'Reilly", 'Penguin', 'HarperCollins', 'Wiley', 'Manning', 'Apress', 'Packt', 'MIT Press', 'Dover', 'Vintage'],
    types:   ['Guide', 'Handbook', 'Tutorial', 'Reference', 'Introduction', 'Mastery', 'Deep Dive', 'Fundamentals', 'Essentials', 'Cookbook'],
    adjs:    ['Practical', 'Advanced', 'Modern', 'Definitive', 'Expert', 'Learning', 'Applied', 'Professional', 'Concise', 'Comprehensive'],
    series:  ['Python', 'JavaScript', 'React', 'Systems', 'Data', 'Cloud'],
    priceMin: 9, priceMax: 89, inStockRate: 0.90,
  },
  {
    name: 'Sports', weight: 1500,
    brands:  ['Nike', 'Adidas', 'Under Armour', 'Wilson', 'Callaway', 'Puma', 'Reebok', 'New Balance', 'Mizuno', 'Asics'],
    types:   ['Shoes', 'Shorts', 'Jersey', 'Ball', 'Racket', 'Bag', 'Gloves', 'Mat', 'Watch', 'Helmet'],
    adjs:    ['Pro', 'Elite', 'Performance', 'Speed', 'Power', 'Trail', 'Court', 'Tour', 'Race', 'Team'],
    series:  ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'],
    priceMin: 20, priceMax: 600, inStockRate: 0.85,
  },
  {
    name: 'Beauty', weight: 1500,
    brands:  ["L'Oreal", 'Estée Lauder', 'Neutrogena', 'The Ordinary', 'MAC', 'Clinique', 'Olay', 'Dove', 'Maybelline', 'CeraVe'],
    types:   ['Serum', 'Moisturizer', 'Foundation', 'Mascara', 'Cleanser', 'Toner', 'Sunscreen', 'Lipstick', 'Concealer', 'Primer'],
    adjs:    ['Hydrating', 'Anti-Aging', 'Brightening', 'Nourishing', 'Ultra', 'Pure', 'Natural', 'Advanced', 'Intensive', 'Radiant'],
    series:  ['01', '02', '03', '04', '05', '06'],
    priceMin: 6, priceMax: 150, inStockRate: 0.80,
  },
  {
    name: 'Toys', weight: 1500,
    brands:  ['LEGO', 'Hasbro', 'Mattel', 'Fisher-Price', 'Playmobil', 'Nerf', 'Funko', 'Hot Wheels', 'Barbie', 'Play-Doh'],
    types:   ['Set', 'Game', 'Figure', 'Puzzle', 'Kit', 'Pack', 'Collection', 'Builder', 'Playset', 'World'],
    adjs:    ['Ultimate', 'Classic', 'Deluxe', 'Junior', 'Expert', 'Creative', 'Adventure', 'Super', 'Mega', 'Mini'],
    series:  ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'],
    priceMin: 10, priceMax: 500, inStockRate: 0.70,
  },
  {
    name: 'Food & Drink', weight: 1750,
    brands:  ['Starbucks', 'Nespresso', 'Vitamix', 'Cuisinart', 'Hamilton Beach', 'Breville', 'Keurig', 'Ninja', 'Instant Pot', 'OXO'],
    types:   ['Coffee', 'Machine', 'Blender', 'Kettle', 'Toaster', 'Grinder', 'Frother', 'Press', 'Brewer', 'Roast'],
    adjs:    ['Premium', 'Classic', 'Original', 'Reserve', 'Bold', 'Smooth', 'Rich', 'Select', 'Artisan', 'Signature'],
    series:  ['Gold', 'Silver', 'Bronze', 'Platinum', 'Diamond', 'Pearl'],
    priceMin: 8, priceMax: 700, inStockRate: 0.85,
  },
];

const TOTAL_WEIGHT = CATEGORIES.reduce((s, c) => s + c.weight, 0);  // 15,000

// ── Product generator (streaming, batch-oriented) ────────────────────────────

interface RawProduct {
  id:          string;
  name:        string;
  price:       number;
  category:    string;
  brand:       string;
  rating:      number;
  inStock:     boolean;
  tags:        string[];
  description: string;
}

function* generateStream(totalCount: number, seed = 42): Generator<RawProduct> {
  const rng  = new LCG(seed);
  const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let idCounter = 1;

  // Pre-build combo lists per category (brand × adj × type × series)
  const combosPerCat = CATEGORIES.map(cat => {
    const combos: [string, string, string, string][] = [];
    for (const brand of cat.brands)
      for (const adj  of cat.adjs)
        for (const type of cat.types)
          for (const ser of cat.series)
            combos.push([brand, adj, type, ser]);
    return combos;
  });

  // Distribute totalCount proportionally across categories
  const counts = CATEGORIES.map((c, i) => {
    const exact = (c.weight / TOTAL_WEIGHT) * totalCount;
    return i < CATEGORIES.length - 1 ? Math.round(exact) : 0;
  });
  // Last category gets the remainder to hit exact total
  counts[CATEGORIES.length - 1] = totalCount - counts.slice(0, -1).reduce((a, b) => a + b, 0);

  for (let ci = 0; ci < CATEGORIES.length; ci++) {
    const cat    = CATEGORIES[ci];
    const combos = combosPerCat[ci];
    const count  = counts[ci];

    for (let i = 0; i < count; i++) {
      const [brand, adj, type, series] = combos[i % combos.length];

      // When cycling past first pass, differentiate name with a cycle suffix
      const cycle = Math.floor(i / combos.length);
      const name  = cycle === 0
        ? `${brand} ${adj} ${type} ${series}`
        : `${brand} ${adj} ${type} ${series} Ed.${cycle + 1}`;

      const price   = rng.nextFloat(cat.priceMin, cat.priceMax, 2);
      const rating  = rng.nextFloat(3.0, 5.0, 1);
      const inStock = rng.next() < cat.inStockRate;
      const desc    = `${adj} ${type.toLowerCase()} from ${brand}. Exceptional quality in the ${cat.name.toLowerCase()} category.`;
      const tags    = [toSlug(cat.name), toSlug(type), toSlug(brand)];

      yield {
        id:       `prod-${String(idCounter++).padStart(7, '0')}`,
        name,
        price,
        category: cat.name,
        brand,
        rating,
        inStock,
        tags,
        description: desc,
      };
    }
  }
}

// ── PostgreSQL setup ──────────────────────────────────────────────────────────

const pool = new Pool({
  host:                    'localhost',
  port:                    5432,
  database:                'indexql',
  user:                    'postgres',
  password:                'postgres',
  connectionTimeoutMillis: 5000,
});

async function setup(): Promise<void> {
  const { count } = parseArgs();
  const BATCH = 2000;

  console.log(`\nIndexQL – PostgreSQL Setup (${count.toLocaleString()} products)`);
  console.log('─'.repeat(52));

  const client = await pool.connect();
  try {
    // ── Drop + recreate table (no indexes yet) ──────────────────────────────
    console.log('\nRecreating products table…');
    await client.query('DROP TABLE IF EXISTS products');
    await client.query(`
      CREATE TABLE products (
        id          TEXT           PRIMARY KEY,
        name        TEXT           NOT NULL,
        price       NUMERIC(10,2)  NOT NULL,
        category    TEXT           NOT NULL,
        brand       TEXT           NOT NULL,
        rating      NUMERIC(3,1)   NOT NULL,
        in_stock    BOOLEAN        NOT NULL,
        tags        TEXT[]         NOT NULL,
        description TEXT           NOT NULL
      )
    `);
    console.log('  Table created (indexes deferred until after insert).\n');

    // ── Bulk insert ─────────────────────────────────────────────────────────
    console.log(`Inserting ${count.toLocaleString()} products in batches of ${BATCH.toLocaleString()}…`);
    const t1      = Date.now();
    const gen     = generateStream(count);
    let   inserted = 0;
    let   batch: RawProduct[] = [];

    const flushBatch = async (b: RawProduct[]) => {
      const values: unknown[] = [];
      const placeholders = b.map((p, j) => {
        const o = j * 9;
        values.push(p.id, p.name, p.price, p.category, p.brand, p.rating, p.inStock, p.tags, p.description);
        return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9})`;
      }).join(',');
      await client.query(
        `INSERT INTO products(id,name,price,category,brand,rating,in_stock,tags,description) VALUES ${placeholders}`,
        values,
      );
    };

    for (const product of gen) {
      batch.push(product);
      if (batch.length === BATCH) {
        await flushBatch(batch);
        inserted += batch.length;
        batch = [];
        if (inserted % 100_000 === 0 || inserted === count) {
          const elapsed = (Date.now() - t1) / 1000;
          const rps     = Math.round(inserted / elapsed);
          process.stdout.write(`\r  ${inserted.toLocaleString().padStart(9)} / ${count.toLocaleString()}  (${rps.toLocaleString()} rows/s)`);
        }
      }
    }
    if (batch.length > 0) {
      await flushBatch(batch);
      inserted += batch.length;
    }

    const insertMs     = Date.now() - t1;
    const rowsPerSec   = Math.round(inserted / insertMs * 1000);
    console.log(`\n  Inserted ${inserted.toLocaleString()} rows in ${(insertMs / 1000).toFixed(1)} s (${rowsPerSec.toLocaleString()} rows/s).\n`);

    // ── Build indexes after all inserts ─────────────────────────────────────
    console.log('Building indexes…');
    const t2 = Date.now();

    await client.query('CREATE INDEX idx_products_category    ON products(category)');
    process.stdout.write('  [1/8] category');
    await client.query('CREATE INDEX idx_products_brand       ON products(brand)');
    process.stdout.write('  [2/8] brand');
    await client.query('CREATE INDEX idx_products_price       ON products(price)');
    process.stdout.write('  [3/8] price');
    await client.query('CREATE INDEX idx_products_rating      ON products(rating)');
    process.stdout.write('  [4/8] rating\n');
    await client.query('CREATE INDEX idx_products_in_stock    ON products(in_stock)');
    process.stdout.write('  [5/8] in_stock');
    await client.query('CREATE INDEX idx_products_cat_price_stock ON products(category, price, in_stock)');
    process.stdout.write('  [6/8] (cat,price,stock)');
    await client.query('CREATE INDEX idx_products_cat_brand   ON products(category, brand)');
    process.stdout.write('  [7/8] (cat,brand)');
    await client.query(`
      CREATE INDEX idx_products_fts ON products
        USING GIN(to_tsvector('english', name || ' ' || description))
    `);
    process.stdout.write('  [8/8] GIN fts\n');

    console.log(`\n  8 indexes built in ${((Date.now() - t2) / 1000).toFixed(1)} s.\n`);

    // ── ANALYZE ─────────────────────────────────────────────────────────────
    console.log('Running ANALYZE…');
    await client.query('ANALYZE products');
    console.log('  Done.\n');

    // ── Verify ──────────────────────────────────────────────────────────────
    const { rows } = await client.query('SELECT COUNT(*) AS n FROM products');
    const actual   = Number(rows[0].n);
    console.log(`Verification: ${actual.toLocaleString()} rows in products table.`);
    console.log('\nSetup complete.');
    console.log('  Run "npm run demo:http" to benchmark PostgreSQL.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch(err => {
  console.error('\nSetup failed:', err instanceof Error ? err.message : String(err));
  if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
    console.error('  PostgreSQL is not reachable. Run "npm run docker:up" first.');
  }
  process.exit(1);
});
