import { useState, useMemo } from 'react';
import { CategoryTree } from './CategoryTree';
import { ProductList } from './ProductList';
import { FilterSidebar } from './FilterSidebar';
import { useProducts } from './useProducts';
import { usePageProducts } from './usePageProducts';
import { FilterSystem, EMPTY_FILTER_STATE, type FilterState } from './FilterSystem';

const PAGE_SIZE = 50;

export function App() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterState, setFilterState] = useState<FilterState>(EMPTY_FILTER_STATE);

  const { decoded, specs, totalProducts, loading, error, timingMs, categoryId } = useProducts(selectedCategoryId);

  // Build FilterSystem once when decoded data changes
  const filterSystem = useMemo(() => {
    if (decoded.length === 0 || !specs) return null;
    return new FilterSystem(decoded, specs);
  }, [decoded, specs]);

  // Apply filters (runs on every filter state change — all client-side, no BE)
  const filterResult = useMemo(() => {
    if (!filterSystem) return null;
    return filterSystem.applyFilters(filterState);
  }, [filterSystem, filterState]);

  const filteredDecoded = useMemo(() => {
    if (!filterResult) return decoded;
    return filterResult.filteredIndices.map(i => decoded[i]);
  }, [filterResult, decoded]);

  const totalPages = Math.max(1, Math.ceil(filteredDecoded.length / PAGE_SIZE));

  const pageSeqs = useMemo(() => {
    const slice = filteredDecoded.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return slice.map(d => d.seq);
  }, [filteredDecoded, page]);

  const { products, loading: pageLoading } = usePageProducts(categoryId, pageSeqs);

  function handleSlugSelect(slug: string, categoryId: string) {
    setSelectedSlug(slug);
    setSelectedCategoryId(categoryId);
    setPage(1);
    setFilterState(EMPTY_FILTER_STATE);
  }

  function handleFilterChange(state: FilterState) {
    setFilterState(state);
    setPage(1);
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Category sidebar */}
      <div style={{
        width: 220,
        background: '#fff',
        borderRight: '1px solid #ddd',
        padding: '16px 0',
        overflowY: 'auto',
        flexShrink: 0,
      }}>
        <h2 style={{ padding: '0 16px 12px', fontSize: 18, color: '#111' }}>IndexQL Demo</h2>
        <CategoryTree
          selectedSlug={selectedSlug}
          onSelect={handleSlugSelect}
        />
      </div>

      {/* Filter sidebar — only when data is loaded */}
      {selectedSlug && !loading && filterResult && (
        <div style={{
          width: 240,
          background: '#fafafa',
          borderRight: '1px solid #eee',
          padding: 16,
          overflowY: 'auto',
          flexShrink: 0,
        }}>
          <FilterSidebar
            priceFilter={filterResult.priceFilter}
            ratingFilter={filterResult.ratingFilter}
            brandFilter={filterResult.brandFilter}
            inStockFilter={filterResult.inStockFilter}
            filterState={filterState}
            onFilterChange={handleFilterChange}
            totalFiltered={filteredDecoded.length}
            totalProducts={totalProducts}
          />
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, padding: 24, minWidth: 0 }}>
        {!selectedSlug && (
          <div style={{ color: '#888', marginTop: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 20 }}>Select a subcategory to load products</p>
            <p style={{ marginTop: 8, fontSize: 14 }}>
              Products are built on-demand from PostgreSQL into IndexQL binary artifacts,
              then filtered client-side with zero backend involvement.
            </p>
          </div>
        )}

        {selectedSlug && loading && (
          <div style={{ color: '#666', marginTop: 40, textAlign: 'center' }}>
            Building artifacts for <strong>{selectedSlug}</strong>...
          </div>
        )}

        {error && (
          <div style={{ color: '#c00', marginTop: 20, padding: 16, background: '#fee', borderRadius: 4 }}>
            {error}
          </div>
        )}

        {selectedSlug && !loading && filteredDecoded.length > 0 && (
          <ProductList
            products={products}
            slug={selectedSlug}
            timingMs={timingMs}
            totalProducts={filteredDecoded.length}
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            pageLoading={pageLoading}
          />
        )}

        {selectedSlug && !loading && !error && filteredDecoded.length === 0 && decoded.length > 0 && (
          <div style={{ color: '#888', marginTop: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 16 }}>No products match the current filters.</p>
            <button
              onClick={() => setFilterState(EMPTY_FILTER_STATE)}
              style={{ marginTop: 12, padding: '8px 16px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
