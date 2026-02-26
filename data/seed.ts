import * as fs   from 'fs';
import * as path from 'path';
import { Product } from '../src/core/types';

// ── Deterministic LCG RNG ─────────────────────────────────────────────────────

class LCG {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }

  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x100000000; // uniform [0, 1)
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

// ── Category Definitions ──────────────────────────────────────────────────────

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

// Counts: 2500+2500+2000+1750+1500+1500+1500+1750 = 15,000
const categories: CategoryDef[] = [
  {
    name: 'Electronics', count: 2500,
    brands:  ['Apple', 'Samsung', 'Sony', 'LG', 'Bose', 'Logitech', 'Asus', 'Dell', 'HP', 'Microsoft'],
    types:   ['Laptop', 'Smartphone', 'Headphones', 'Earbuds', 'Tablet', 'Monitor', 'Camera', 'Speaker', 'Smartwatch', 'Keyboard'],
    adjs:    ['Pro', 'Ultra', 'Max', 'Elite', 'Air', 'Plus', 'Advanced', 'Smart', 'Turbo', 'Edge'],
    series:  ['X1', 'S3', 'Z5', 'V7', 'A9', 'M2'],
    priceMin: 49, priceMax: 2999, inStockRate: 0.85,
  },
  {
    name: 'Clothing', count: 2500,
    brands:  ['Nike', 'Adidas', 'Zara', 'H&M', "Levi's", 'Under Armour', 'Puma', 'Gap', 'Calvin Klein', 'Ralph Lauren'],
    types:   ['T-Shirt', 'Jeans', 'Jacket', 'Dress', 'Hoodie', 'Sneakers', 'Boots', 'Shorts', 'Coat', 'Sweater'],
    adjs:    ['Slim', 'Classic', 'Athletic', 'Premium', 'Vintage', 'Casual', 'Sport', 'Urban', 'Essential', 'Comfort'],
    series:  ['2022', '2023', '2024', 'Pro', 'Plus', 'Original'],
    priceMin: 15, priceMax: 500, inStockRate: 0.80,
  },
  {
    name: 'Home & Garden', count: 2000,
    brands:  ['IKEA', 'Dyson', 'KitchenAid', 'Black+Decker', 'Bosch', 'Philips', 'Weber', 'Gardena', 'iRobot', 'Cuisinart'],
    types:   ['Blender', 'Vacuum', 'Drill', 'Mixer', 'Fan', 'Lamp', 'Shelf', 'Chair', 'Table', 'Mower'],
    adjs:    ['Compact', 'Professional', 'Smart', 'Cordless', 'Silent', 'Digital', 'Classic', 'Deluxe', 'Mini', 'Power'],
    series:  ['100', '200', '300', '400', '500', '600'],
    priceMin: 20, priceMax: 999, inStockRate: 0.75,
  },
  {
    name: 'Books', count: 1750,
    brands:  ["O'Reilly", 'Penguin', 'HarperCollins', 'Wiley', 'Manning', 'Apress', 'Packt', 'MIT Press', 'Dover', 'Vintage'],
    types:   ['Guide', 'Handbook', 'Tutorial', 'Reference', 'Introduction', 'Mastery', 'Deep Dive', 'Fundamentals', 'Essentials', 'Cookbook'],
    adjs:    ['Practical', 'Advanced', 'Modern', 'Definitive', 'Expert', 'Learning', 'Applied', 'Professional', 'Concise', 'Comprehensive'],
    series:  ['Python', 'JavaScript', 'React', 'Systems', 'Data', 'Cloud'],
    priceMin: 9, priceMax: 89, inStockRate: 0.90,
  },
  {
    name: 'Sports', count: 1500,
    brands:  ['Nike', 'Adidas', 'Under Armour', 'Wilson', 'Callaway', 'Puma', 'Reebok', 'New Balance', 'Mizuno', 'Asics'],
    types:   ['Shoes', 'Shorts', 'Jersey', 'Ball', 'Racket', 'Bag', 'Gloves', 'Mat', 'Watch', 'Helmet'],
    adjs:    ['Pro', 'Elite', 'Performance', 'Speed', 'Power', 'Trail', 'Court', 'Tour', 'Race', 'Team'],
    series:  ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'],
    priceMin: 20, priceMax: 600, inStockRate: 0.85,
  },
  {
    name: 'Beauty', count: 1500,
    brands:  ["L'Oreal", 'Estée Lauder', 'Neutrogena', 'The Ordinary', 'MAC', 'Clinique', 'Olay', 'Dove', 'Maybelline', 'CeraVe'],
    types:   ['Serum', 'Moisturizer', 'Foundation', 'Mascara', 'Cleanser', 'Toner', 'Sunscreen', 'Lipstick', 'Concealer', 'Primer'],
    adjs:    ['Hydrating', 'Anti-Aging', 'Brightening', 'Nourishing', 'Ultra', 'Pure', 'Natural', 'Advanced', 'Intensive', 'Radiant'],
    series:  ['01', '02', '03', '04', '05', '06'],
    priceMin: 6, priceMax: 150, inStockRate: 0.80,
  },
  {
    name: 'Toys', count: 1500,
    brands:  ['LEGO', 'Hasbro', 'Mattel', 'Fisher-Price', 'Playmobil', 'Nerf', 'Funko', 'Hot Wheels', 'Barbie', 'Play-Doh'],
    types:   ['Set', 'Game', 'Figure', 'Puzzle', 'Kit', 'Pack', 'Collection', 'Builder', 'Playset', 'World'],
    adjs:    ['Ultimate', 'Classic', 'Deluxe', 'Junior', 'Expert', 'Creative', 'Adventure', 'Super', 'Mega', 'Mini'],
    series:  ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'],
    priceMin: 10, priceMax: 500, inStockRate: 0.70,
  },
  {
    name: 'Food & Drink', count: 1750,
    brands:  ['Starbucks', 'Nespresso', 'Vitamix', 'Cuisinart', 'Hamilton Beach', 'Breville', 'Keurig', 'Ninja', 'Instant Pot', 'OXO'],
    types:   ['Coffee', 'Machine', 'Blender', 'Kettle', 'Toaster', 'Grinder', 'Frother', 'Press', 'Brewer', 'Roast'],
    adjs:    ['Premium', 'Classic', 'Original', 'Reserve', 'Bold', 'Smooth', 'Rich', 'Select', 'Artisan', 'Signature'],
    series:  ['Gold', 'Silver', 'Bronze', 'Platinum', 'Diamond', 'Pearl'],
    priceMin: 8, priceMax: 700, inStockRate: 0.85,
  },
];

// Verify total = 15,000
const TOTAL = categories.reduce((s, c) => s + c.count, 0);
if (TOTAL !== 15000) throw new Error(`Category counts sum to ${TOTAL}, expected 15000`);

// ── Generator ─────────────────────────────────────────────────────────────────

function generateProducts(rng: LCG): Product[] {
  const products: Product[] = [];
  let idCounter = 1;

  for (const cat of categories) {
    // Cartesian product: brand × adj × type × series (10×10×10×6 = 6000 combos)
    const combos: [string, string, string, string][] = [];
    for (const brand of cat.brands) {
      for (const adj of cat.adjs) {
        for (const type of cat.types) {
          for (const series of cat.series) {
            combos.push([brand, adj, type, series]);
          }
        }
      }
    }

    if (combos.length < cat.count) {
      throw new Error(`${cat.name}: only ${combos.length} combos but need ${cat.count}`);
    }

    const selected = rng.shuffle(combos).slice(0, cat.count);

    for (const [brand, adj, type, series] of selected) {
      const price    = rng.nextFloat(cat.priceMin, cat.priceMax, 2);
      const rating   = rng.nextFloat(3.0, 5.0, 1);
      const inStock  = rng.next() < cat.inStockRate;
      const name     = `${brand} ${adj} ${type} ${series}`;
      const desc     = `${adj} ${type.toLowerCase()} from ${brand}. Exceptional quality in the ${cat.name.toLowerCase()} category.`;

      // 2-3 tags: category slug, type slug, brand slug
      const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const tags = [toSlug(cat.name), toSlug(type), toSlug(brand)];

      products.push({
        id:          `prod-${String(idCounter++).padStart(5, '0')}`,
        name,
        price,
        category:    cat.name,
        brand,
        rating,
        inStock,
        tags,
        description: desc,
      });
    }
  }

  return products;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const rng      = new LCG(42);
const products = generateProducts(rng);

const outPath = path.resolve(__dirname, 'products.json');
fs.writeFileSync(outPath, JSON.stringify(products, null, 2), 'utf8');

const byCategory = categories.map(c => {
  const n = products.filter(p => p.category === c.name).length;
  return `  ${c.name.padEnd(18)} ${n}`;
}).join('\n');

console.log(`Seeded ${products.length} products → ${outPath}`);
console.log(`\nCategory breakdown:\n${byCategory}`);
