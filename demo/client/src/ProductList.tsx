import type { Product } from './useProducts';

interface Props {
  products: Product[];
  slug: string;
  timingMs: number;
  totalProducts: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageLoading: boolean;
}

const PAGE_SIZE = 50;

export function ProductList({
  products,
  slug,
  timingMs,
  totalProducts,
  page,
  totalPages,
  onPageChange,
  pageLoading,
}: Props) {
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalProducts);

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 18 }}>
          {slug} <span style={{ color: '#888', fontWeight: 400, fontSize: 14 }}>({totalProducts} products)</span>
        </h2>
        <span style={{ color: '#666', fontSize: 13 }}>
          Build + fetch: {timingMs}ms
        </span>
      </div>

      {/* Pagination controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        padding: '8px 12px',
        background: '#f8f8f8',
        borderRadius: 4,
        fontSize: 13,
      }}>
        <span style={{ color: '#666' }}>
          Showing {start}–{end} of {totalProducts}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || pageLoading}
            style={navBtn}
          >
            Prev
          </button>
          <span style={{ color: '#444' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || pageLoading}
            style={navBtn}
          >
            Next
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', opacity: pageLoading ? 0.5 : 1, transition: 'opacity 0.15s' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          background: '#fff',
          fontSize: 13,
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '2px solid #e0e0e0' }}>
              <th style={th}>Name</th>
              <th style={{ ...th, width: 90, textAlign: 'right' }}>Price</th>
              <th style={{ ...th, width: 120 }}>Brand</th>
              <th style={{ ...th, width: 70, textAlign: 'right' }}>Rating</th>
              <th style={{ ...th, width: 80, textAlign: 'center' }}>In Stock</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={p.id ?? i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={td}>{p.name}</td>
                <td style={{ ...td, textAlign: 'right' }}>${Number(p.price).toFixed(2)}</td>
                <td style={td}>{p.brand}</td>
                <td style={{ ...td, textAlign: 'right' }}>{Number(p.rating).toFixed(1)}</td>
                <td style={{ ...td, textAlign: 'center' }}>{p.inStock ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: '#555',
};

const td: React.CSSProperties = {
  padding: '8px 12px',
};

const navBtn: React.CSSProperties = {
  padding: '4px 12px',
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
};
