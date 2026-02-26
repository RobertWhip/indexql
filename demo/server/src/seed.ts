import { getPool } from './db';

// ── Deterministic LCG RNG ────────────────────────────────────────────────────

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

  shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// ── Category Definitions ─────────────────────────────────────────────────────

interface CategoryDef {
  name: string;
  count: number;
  brands: string[];
  types: string[];
  adjs: string[];
  series: string[];
  priceMin: number;
  priceMax: number;
  inStockRate: number;
}

const categories: CategoryDef[] = [
  {
    name: 'Electronics', count: 10000,
    brands:  ['Apple', 'Samsung', 'Sony', 'LG', 'Bose', 'Logitech', 'Asus', 'Dell', 'HP', 'Microsoft'],
    types:   ['Laptop', 'Smartphone', 'Headphones', 'Earbuds', 'Tablet', 'Monitor', 'Camera', 'Speaker', 'Smartwatch', 'Keyboard'],
    adjs:    ['Pro', 'Ultra', 'Max', 'Elite', 'Air', 'Plus', 'Advanced', 'Smart', 'Turbo', 'Edge'],
    series:  ['X1', 'S3', 'Z5', 'V7', 'A9', 'M2', 'R4', 'T8', 'K6', 'W3'],
    priceMin: 49, priceMax: 2999, inStockRate: 0.85,
  },
  {
    name: 'Clothing', count: 10000,
    brands:  ['Nike', 'Adidas', 'Zara', 'H&M', "Levi's", 'Under Armour', 'Puma', 'Gap', 'Calvin Klein', 'Ralph Lauren'],
    types:   ['T-Shirt', 'Jeans', 'Jacket', 'Dress', 'Hoodie', 'Sneakers', 'Boots', 'Shorts', 'Coat', 'Sweater'],
    adjs:    ['Slim', 'Classic', 'Athletic', 'Premium', 'Vintage', 'Casual', 'Sport', 'Urban', 'Essential', 'Comfort'],
    series:  ['2022', '2023', '2024', 'Pro', 'Plus', 'Original', 'Core', 'Flex', 'Impact', 'Wave'],
    priceMin: 15, priceMax: 500, inStockRate: 0.80,
  },
  {
    name: 'Home & Garden', count: 10000,
    brands:  ['IKEA', 'Dyson', 'KitchenAid', 'Black+Decker', 'Bosch', 'Philips', 'Weber', 'Gardena', 'iRobot', 'Cuisinart'],
    types:   ['Blender', 'Vacuum', 'Drill', 'Mixer', 'Fan', 'Lamp', 'Shelf', 'Chair', 'Table', 'Mower'],
    adjs:    ['Compact', 'Professional', 'Smart', 'Cordless', 'Silent', 'Digital', 'Classic', 'Deluxe', 'Mini', 'Power'],
    series:  ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'X'],
    priceMin: 20, priceMax: 999, inStockRate: 0.75,
  },
  {
    name: 'Books', count: 10000,
    brands:  ["O'Reilly", 'Penguin', 'HarperCollins', 'Wiley', 'Manning', 'Apress', 'Packt', 'MIT Press', 'Dover', 'Vintage'],
    types:   ['Guide', 'Handbook', 'Tutorial', 'Reference', 'Introduction', 'Mastery', 'Deep Dive', 'Fundamentals', 'Essentials', 'Cookbook'],
    adjs:    ['Practical', 'Advanced', 'Modern', 'Definitive', 'Expert', 'Learning', 'Applied', 'Professional', 'Concise', 'Comprehensive'],
    series:  ['Python', 'JavaScript', 'React', 'Systems', 'Data', 'Cloud', 'DevOps', 'Security', 'Mobile', 'AI'],
    priceMin: 9, priceMax: 89, inStockRate: 0.90,
  },
  {
    name: 'Sports', count: 10000,
    brands:  ['Nike', 'Adidas', 'Under Armour', 'Wilson', 'Callaway', 'Puma', 'Reebok', 'New Balance', 'Mizuno', 'Asics'],
    types:   ['Shoes', 'Shorts', 'Jersey', 'Ball', 'Racket', 'Bag', 'Gloves', 'Mat', 'Watch', 'Helmet'],
    adjs:    ['Pro', 'Elite', 'Performance', 'Speed', 'Power', 'Trail', 'Court', 'Tour', 'Race', 'Team'],
    series:  ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10'],
    priceMin: 20, priceMax: 600, inStockRate: 0.85,
  },
  {
    name: 'Beauty', count: 10000,
    brands:  ["L'Oreal", 'Estée Lauder', 'Neutrogena', 'The Ordinary', 'MAC', 'Clinique', 'Olay', 'Dove', 'Maybelline', 'CeraVe'],
    types:   ['Serum', 'Moisturizer', 'Foundation', 'Mascara', 'Cleanser', 'Toner', 'Sunscreen', 'Lipstick', 'Concealer', 'Primer'],
    adjs:    ['Hydrating', 'Anti-Aging', 'Brightening', 'Nourishing', 'Ultra', 'Pure', 'Natural', 'Advanced', 'Intensive', 'Radiant'],
    series:  ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'],
    priceMin: 6, priceMax: 150, inStockRate: 0.80,
  },
  {
    name: 'Toys', count: 10000,
    brands:  ['LEGO', 'Hasbro', 'Mattel', 'Fisher-Price', 'Playmobil', 'Nerf', 'Funko', 'Hot Wheels', 'Barbie', 'Play-Doh'],
    types:   ['Set', 'Game', 'Figure', 'Puzzle', 'Kit', 'Pack', 'Collection', 'Builder', 'Playset', 'World'],
    adjs:    ['Ultimate', 'Classic', 'Deluxe', 'Junior', 'Expert', 'Creative', 'Adventure', 'Super', 'Mega', 'Mini'],
    series:  ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Theta', 'Omega', 'Sigma', 'Lambda'],
    priceMin: 10, priceMax: 500, inStockRate: 0.70,
  },
  {
    name: 'Food & Drink', count: 10000,
    brands:  ['Starbucks', 'Nespresso', 'Vitamix', 'Cuisinart', 'Hamilton Beach', 'Breville', 'Keurig', 'Ninja', 'Instant Pot', 'OXO'],
    types:   ['Coffee', 'Machine', 'Blender', 'Kettle', 'Toaster', 'Grinder', 'Frother', 'Press', 'Brewer', 'Roast'],
    adjs:    ['Premium', 'Classic', 'Original', 'Reserve', 'Bold', 'Smooth', 'Rich', 'Select', 'Artisan', 'Signature'],
    series:  ['Gold', 'Silver', 'Bronze', 'Platinum', 'Diamond', 'Pearl', 'Ruby', 'Emerald', 'Sapphire', 'Onyx'],
    priceMin: 8, priceMax: 700, inStockRate: 0.85,
  },
];

const TOTAL = categories.reduce((s, c) => s + c.count, 0);

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pool = getPool();
  const rng = new LCG(42);

  console.log(`Seeding ${TOTAL} products across ${categories.length} parent categories...`);

  // Drop existing tables
  await pool.query('DROP TABLE IF EXISTS products CASCADE');
  await pool.query('DROP TABLE IF EXISTS categories CASCADE');

  // Create tables
  await pool.query(`
    CREATE TABLE categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      parent_id UUID REFERENCES categories(id)
    )
  `);

  await pool.query(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC NOT NULL,
      category_id UUID REFERENCES categories(id),
      brand TEXT NOT NULL,
      rating NUMERIC NOT NULL,
      in_stock BOOLEAN NOT NULL DEFAULT true,
      tags TEXT[] DEFAULT '{}',
      description TEXT DEFAULT ''
    )
  `);

  // Seed categories
  const parentIds: Map<string, string> = new Map();
  const subcatMap: Map<string, { id: string; slug: string }[]> = new Map();

  for (const cat of categories) {
    const parentSlug = toSlug(cat.name);
    const res = await pool.query(
      'INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id',
      [cat.name, parentSlug]
    );
    const parentId = res.rows[0].id;
    parentIds.set(cat.name, parentId);

    const subcats: { id: string; slug: string }[] = [];
    for (const type of cat.types) {
      const subSlug = `${parentSlug}-${toSlug(type)}`;
      const subRes = await pool.query(
        'INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id',
        [type, subSlug, parentId]
      );
      subcats.push({ id: subRes.rows[0].id, slug: subSlug });
    }
    subcatMap.set(cat.name, subcats);
  }

  // Seed products
  let totalInserted = 0;
  let idCounter = 1;

  for (const cat of categories) {
    const subcats = subcatMap.get(cat.name)!;

    // Generate combos: brand × adj × type × series (10×10×10×10 = 10000)
    const combos: [string, string, string, string, number][] = [];
    for (let bi = 0; bi < cat.brands.length; bi++) {
      for (let ai = 0; ai < cat.adjs.length; ai++) {
        for (let ti = 0; ti < cat.types.length; ti++) {
          for (let si = 0; si < cat.series.length; si++) {
            combos.push([cat.brands[bi], cat.adjs[ai], cat.types[ti], cat.series[si], ti]);
          }
        }
      }
    }

    const selected = rng.shuffle(combos).slice(0, cat.count);

    // Batch insert
    const BATCH = 2000;
    for (let i = 0; i < selected.length; i += BATCH) {
      const batch = selected.slice(i, i + BATCH);
      const values: string[] = [];
      const params: unknown[] = [];
      let pi = 1;

      for (const [brand, adj, type, series, typeIdx] of batch) {
        const price = rng.nextFloat(cat.priceMin, cat.priceMax, 2);
        const rating = rng.nextFloat(3.0, 5.0, 1);
        const inStock = rng.next() < cat.inStockRate;
        const name = `${brand} ${adj} ${type} ${series}`;
        const desc = `${adj} ${type.toLowerCase()} from ${brand}. Exceptional quality in the ${cat.name.toLowerCase()} category.`;
        const tags = [toSlug(cat.name), toSlug(type), toSlug(brand)];
        const prodId = `prod-${String(idCounter++).padStart(6, '0')}`;
        const subcat = subcats[typeIdx];

        values.push(`($${pi}, $${pi+1}, $${pi+2}, $${pi+3}, $${pi+4}, $${pi+5}, $${pi+6}, $${pi+7}, $${pi+8})`);
        params.push(prodId, name, price, subcat.id, brand, rating, inStock, tags, desc);
        pi += 9;
      }

      await pool.query(
        `INSERT INTO products (id, name, price, category_id, brand, rating, in_stock, tags, description)
         VALUES ${values.join(', ')}`,
        params
      );
      totalInserted += batch.length;
      process.stdout.write(`\r  Inserted ${totalInserted}/${TOTAL} products`);
    }
  }

  console.log(`\n\nDone! Seeded:`);
  console.log(`  ${categories.length} parent categories`);
  console.log(`  ${categories.length * 10} subcategories`);
  console.log(`  ${totalInserted} products`);

  // Show breakdown
  const { rows } = await pool.query(`
    SELECT p.name AS parent, COUNT(pr.id) AS count
    FROM categories p
    JOIN categories c ON c.parent_id = p.id
    JOIN products pr ON pr.category_id = c.id
    WHERE p.parent_id IS NULL
    GROUP BY p.name ORDER BY p.name
  `);
  for (const r of rows) {
    console.log(`  ${String(r.parent).padEnd(18)} ${r.count}`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
