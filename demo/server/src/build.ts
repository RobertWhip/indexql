import * as fs   from 'fs';
import * as path from 'path';
import { getProductsByCategory, getCategoryBySlug } from './db';
import { storeProducts } from './redis';
import { encodeColumns, ColumnMeta } from '../../../src/core/binary-encoder';
import type { Product } from '../../../src/core/types';

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// Binary columns: seq (Int32), price (Float32), rating (Float32), inStock (Bool), brandIdx (Int8)
const COLUMNS: ColumnMeta[] = [
  { name: 'seq',      typeName: 'Int32',   bits: 32 },
  { name: 'price',    typeName: 'Float32', bits: 32 },
  { name: 'rating',   typeName: 'Float32', bits: 32 },
  { name: 'inStock',  typeName: 'Bool',    bits: 8  },
  { name: 'brandIdx', typeName: 'Int8',    bits: 8  },
];

export async function buildForCategory(slug: string): Promise<{ categoryId: string; numProducts: number; timingMs: number }> {
  const t0 = performance.now();

  // 1. Get category + products from PG
  const cat = await getCategoryBySlug(slug);
  if (!cat) throw new Error(`Category not found: ${slug}`);

  const rawRows = await getProductsByCategory(cat.id);
  if (rawRows.length === 0) throw new Error(`No products for category: ${slug}`);

  // 2. Compute unique brands → index mapping
  const brandSet = new Set<string>();
  for (const r of rawRows) brandSet.add(r.brand as string);
  const brands = Array.from(brandSet).sort();
  const brandToIdx = new Map<string, number>();
  brands.forEach((b, i) => brandToIdx.set(b, i));

  // 3. Map PG rows → product objects with seq + brandIdx
  const products = rawRows.map((r: Record<string, unknown>, i: number) => ({
    seq:         i,
    id:          r.id,
    name:        r.name,
    price:       Number(r.price),
    category:    slug,
    brand:       r.brand,
    brandIdx:    brandToIdx.get(r.brand as string)!,
    rating:      Number(r.rating),
    inStock:     r.in_stock === true,
    tags:        r.tags ?? [],
    description: r.description ?? '',
  }));

  // 4. Encode binary (seq, price, rating, inStock, brandIdx)
  const productsBin = encodeColumns(products as unknown as Product[], COLUMNS);

  // 5. Write artifacts
  const outDir = path.join(PUBLIC_DIR, 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `products.${cat.id}.bin`), productsBin);

  // 6. Write specs metadata (brand list for client-side filter labels)
  const specs = { brands };
  fs.writeFileSync(path.join(outDir, `specs.${cat.id}.json`), JSON.stringify(specs), 'utf8');

  // 7. Store full product JSON in Redis keyed by categoryId:seq
  await storeProducts(cat.id, products as unknown as Record<string, unknown>[]);

  const timingMs = Math.round(performance.now() - t0);
  return { categoryId: cat.id, numProducts: products.length, timingMs };
}
