import * as fs   from 'fs';
import * as path from 'path';
import { getProductsByCategory, getCategoryBySlug } from './db';
import { storeProducts } from './redis';
import { encodeEntity } from '../../../../src/core/entity';
import { Product } from '../../shared/product.entity';

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

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

  // 3. Map PG rows → product objects with brandIdx
  const products = rawRows.map((r: Record<string, unknown>) => ({
    // Indexable fields (saving them to binary file)
    seq:         Number(r.seq),
    price:       Number(r.price),
    brandIdx:    brandToIdx.get(r.brand as string)!,
    rating:      Number(r.rating),
    inStock:     r.in_stock === true,
    // Other fields (saving them to redis)
    id:          r.id,
    name:        r.name,
    category:    slug,
    brand:       r.brand,
    tags:        r.tags ?? [],
    description: r.description ?? '',
  } as Product));

  // 4. Generate binary file
  const productsBin = encodeEntity(Product, products);

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
