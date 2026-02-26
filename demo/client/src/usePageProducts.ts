import { useState, useEffect } from 'react';
import type { Product } from './useProducts';

interface UsePageProductsResult {
  products: Product[];
  loading: boolean;
}

export function usePageProducts(categoryId: string | null, seqs: number[]): UsePageProductsResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!categoryId || seqs.length === 0) {
      setProducts([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch('/products/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoryId, seqs }),
        });

        if (!res.ok) throw new Error('Failed to fetch products');

        const data = await res.json();

        if (!cancelled) {
          setProducts(data.products as Product[]);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setProducts([]);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [categoryId, JSON.stringify(seqs)]);

  return { products, loading };
}
