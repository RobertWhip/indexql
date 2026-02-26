import express from 'express';
import cors from 'cors';
import path from 'path';
import { getCategoryTree } from './db';
import { buildForCategory } from './build';
import { fetchProductsBySeq } from './redis';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000');

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Serve built artifacts as static files
app.use('/artifacts', express.static(path.resolve(__dirname, '..', 'public', 'artifacts')));

// ── API Routes ───────────────────────────────────────────────────────────────

app.get('/products/categories', async (_req, res) => {
  try {
    const tree = await getCategoryTree();
    res.json(tree);
  } catch (err) {
    console.error('GET /products/categories error:', err);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

app.post('/api/load_products', async (req, res) => {
  try {
    const { slug } = req.body;
    if (!slug || typeof slug !== 'string') {
      res.status(400).json({ error: 'Missing slug' });
      return;
    }

    console.log(`Building artifacts for: ${slug}`);
    const { categoryId, numProducts, timingMs } = await buildForCategory(slug);
    console.log(`  → ${numProducts} products in ${timingMs}ms`);

    res.json({ categoryId, numProducts, timingMs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/load_products error:', message);
    res.status(500).json({ error: message });
  }
});

app.post('/products/batch', async (req, res) => {
  try {
    const { categoryId, seqs } = req.body;
    if (!categoryId || typeof categoryId !== 'string') {
      res.status(400).json({ error: 'Missing categoryId' });
      return;
    }
    if (!Array.isArray(seqs) || seqs.length === 0) {
      res.status(400).json({ error: 'Missing or empty seqs array' });
      return;
    }

    const products = await fetchProductsBySeq(categoryId, seqs);
    res.json({ products });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /products/batch error:', message);
    res.status(500).json({ error: message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`IndexQL Demo server running on http://localhost:${PORT}`);
});
