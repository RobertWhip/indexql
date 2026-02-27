import { useState, useEffect } from 'react';
import { parseEntity } from '../../../../src/core/entity';
import { Product as ProductEntity } from '../../shared/product.entity';

export interface Specs {
  brands: string[];
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  brand: string;
  rating: number;
  inStock: boolean;
  tags: string[];
  description: string;
}

interface UseProductsResult {
  decoded: ProductEntity[];
  specs: Specs | null;
  totalProducts: number;
  loading: boolean;
  error: string | null;
  timingMs: number;
  categoryId: string | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useProducts(categoryId: string | null): UseProductsResult {
  const [decoded, setDecoded] = useState<ProductEntity[]>([]);
  const [specs, setSpecs] = useState<Specs | null>(null);
  const [totalProducts, setTotalProducts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timingMs, setTimingMs] = useState(0);

  useEffect(() => {
    if (!categoryId) {
      setDecoded([]);
      setSpecs(null);
      setTotalProducts(0);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const t0 = performance.now();

        // Fetch pre-built binary + specs in parallel
        const [binRes, specsRes] = await Promise.all([
          fetch(`/artifacts/products.${categoryId}.bin`),
          fetch(`/artifacts/specs.${categoryId}.json`),
        ]);

        if (!binRes.ok) throw new Error('Artifacts not found. Run POST /api/load_products first.');
        if (!specsRes.ok) throw new Error('Specs not found. Run POST /api/load_products first.');

        const [binBuf, specsData] = await Promise.all([
          binRes.arrayBuffer(),
          specsRes.json() as Promise<Specs>,
        ]);

        // Decode binary via IndexQL core
        const items = parseEntity(ProductEntity, binBuf);

        const totalMs = Math.round(performance.now() - t0);

        if (!cancelled) {
          setDecoded(items);
          setSpecs(specsData);
          setTotalProducts(items.length);
          setTimingMs(totalMs);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [categoryId]);

  return { decoded, specs, totalProducts, loading, error, timingMs, categoryId };
}
