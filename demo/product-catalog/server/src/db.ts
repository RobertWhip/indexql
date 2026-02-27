import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST ?? 'localhost',
      port: parseInt(process.env.PGPORT ?? '5433'),
      database: process.env.PGDATABASE ?? 'indexql_demo',
      user: process.env.PGUSER ?? 'postgres',
      password: process.env.PGPASSWORD ?? 'postgres',
    });
  }
  return pool;
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
}

export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  children: { id: string; name: string; slug: string }[];
}

export async function getCategories(trx?: Pool): Promise<CategoryRow[]> {
  const db = trx ?? getPool();
   const { rows } = await db.query<CategoryRow>(
    'SELECT id, name, slug, parent_id FROM categories ORDER BY name'
  );

  return rows;
}

export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  const rows = await getCategories();
  const parents = rows.filter(r => r.parent_id === null);
  const children = rows.filter(r => r.parent_id !== null);

  return parents.map(p => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    children: children
      .filter(c => c.parent_id === p.id)
      .map(c => ({ id: c.id, name: c.name, slug: c.slug })),
  }));
}

export async function getProductsByCategory(categoryId: string) {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT seq, id, name, price, brand, rating, in_stock, tags, description
     FROM products WHERE category_id = $1 ORDER BY seq`,
    [categoryId]
  );
  return rows;
}

export async function getCategoryBySlug(slug: string): Promise<CategoryRow | null> {
  const db = getPool();
  const { rows } = await db.query<CategoryRow>(
    'SELECT id, name, slug, parent_id FROM categories WHERE slug = $1',
    [slug]
  );
  return rows[0] ?? null;
}
