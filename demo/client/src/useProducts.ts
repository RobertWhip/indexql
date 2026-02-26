import { useState, useEffect } from 'react';
import { decodeColumnsFromArrayBuffer } from '@indexql/binary-encoder';

export interface DecodedProduct {
  seq: number;
  price: number;
  rating: number;
  inStock: boolean;
  brandIdx: number;
}

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
  decoded: DecodedProduct[];
  specs: Specs | null;
  totalProducts: number;
  loading: boolean;
  error: string | null;
  buildTimingMs: number;
  categoryId: string | null;
}

function decodeBinary(ab: ArrayBuffer): DecodedProduct[] {
  const { meta, numRows, getValue } = decodeColumnsFromArrayBuffer(ab);

  const products: DecodedProduct[] = new Array(numRows);
  for (let ri = 0; ri < numRows; ri++) {
    const obj: Record<string, number | boolean> = {};
    for (let ci = 0; ci < meta.length; ci++) {
      const col = meta[ci];
      const val = getValue(ci, ri);
      obj[col.name] = col.typeName === 'Bool' ? Boolean(val) : Number(val);
    }
    products[ri] = obj as unknown as DecodedProduct;
  }
  return products;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useProducts(slug: string | null): UseProductsResult {
  const [decoded, setDecoded] = useState<DecodedProduct[]>([]);
  const [specs, setSpecs] = useState<Specs | null>(null);
  const [totalProducts, setTotalProducts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildTimingMs, setBuildTimingMs] = useState(0);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setDecoded([]);
      setSpecs(null);
      setTotalProducts(0);
      setError(null);
      setCategoryId(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const t0 = performance.now();

        // 1. Trigger server-side build + Redis store
        const buildRes = await fetch('/api/load_products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug }),
        });

        if (!buildRes.ok) {
          const body = await buildRes.json();
          throw new Error(body.error ?? 'Build failed');
        }

        const { categoryId: catId, numProducts } = await buildRes.json();

        // 2. Fetch binary + specs in parallel
        const [binRes, specsRes] = await Promise.all([
          fetch(`/artifacts/products.${catId}.bin`),
          fetch(`/artifacts/specs.${catId}.json`),
        ]);

        if (!binRes.ok) throw new Error('Failed to fetch binary artifact');
        if (!specsRes.ok) throw new Error('Failed to fetch specs');

        const [binBuf, specsData] = await Promise.all([
          binRes.arrayBuffer(),
          specsRes.json() as Promise<Specs>,
        ]);

        // 3. Decode binary via IndexQL
        const decoded = decodeBinary(binBuf);

        const totalMs = Math.round(performance.now() - t0);

        if (!cancelled) {
          setDecoded(decoded);
          setSpecs(specsData);
          setTotalProducts(numProducts);
          setBuildTimingMs(totalMs);
          setCategoryId(catId);
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
  }, [slug]);

  return { decoded, specs, totalProducts, loading, error, buildTimingMs, categoryId };
}
