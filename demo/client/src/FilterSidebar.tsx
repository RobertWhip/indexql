import { useState } from 'react';
import type { RangeFilter, CheckboxFilter, FilterState } from './FilterSystem';

interface Props {
  priceFilter: RangeFilter;
  ratingFilter: RangeFilter;
  brandFilter: CheckboxFilter;
  inStockFilter: CheckboxFilter;
  filterState: FilterState;
  onFilterChange: (state: FilterState) => void;
  totalFiltered: number;
  totalProducts: number;
}

export function FilterSidebar({
  priceFilter,
  ratingFilter,
  brandFilter,
  inStockFilter,
  filterState,
  onFilterChange,
  totalFiltered,
  totalProducts,
}: Props) {
  const hasActiveFilters =
    filterState.priceRange !== null ||
    filterState.ratingRange !== null ||
    filterState.brands.length > 0 ||
    filterState.inStock !== null;

  function clearAll() {
    onFilterChange({
      priceRange: null,
      ratingRange: null,
      brands: [],
      inStock: null,
    });
  }

  return (
    <div style={{ fontSize: 13 }}>
      {/* Active filter summary */}
      {hasActiveFilters && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: '#666', fontSize: 12 }}>
              {totalFiltered} of {totalProducts} products
            </span>
            <button onClick={clearAll} style={clearBtn}>Clear all</button>
          </div>
          <ActiveChips filterState={filterState} onFilterChange={onFilterChange} priceFilter={priceFilter} ratingFilter={ratingFilter} />
        </div>
      )}

      {/* Price range */}
      <RangeSection
        filter={priceFilter}
        value={filterState.priceRange}
        onChange={(range) => onFilterChange({ ...filterState, priceRange: range })}
        format={(v) => `$${v.toFixed(0)}`}
      />

      {/* Rating range */}
      <RangeSection
        filter={ratingFilter}
        value={filterState.ratingRange}
        onChange={(range) => onFilterChange({ ...filterState, ratingRange: range })}
        format={(v) => v.toFixed(1)}
        step={0.1}
      />

      {/* Brand checkboxes */}
      <CheckboxSection
        filter={brandFilter}
        onToggle={(value) => {
          const brands = filterState.brands.includes(value)
            ? filterState.brands.filter(b => b !== value)
            : [...filterState.brands, value];
          onFilterChange({ ...filterState, brands });
        }}
      />

      {/* In Stock */}
      <CheckboxSection
        filter={inStockFilter}
        onToggle={(value) => {
          const boolVal = value === 'true';
          const inStock = filterState.inStock === boolVal ? null : boolVal;
          onFilterChange({ ...filterState, inStock });
        }}
      />
    </div>
  );
}

// ── Range Filter ─────────────────────────────────────────────────────────────

function RangeSection({
  filter,
  value,
  onChange,
  format,
  step = 1,
}: {
  filter: RangeFilter;
  value: { lower: number; upper: number } | null;
  onChange: (v: { lower: number; upper: number } | null) => void;
  format: (v: number) => string;
  step?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const lower = value?.lower ?? filter.min;
  const upper = value?.upper ?? filter.max;
  const isActive = value !== null;

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setExpanded(!expanded)} style={sectionHeader}>
        <span>{expanded ? '▼' : '▶'} {filter.label}</span>
        {isActive && <span style={activeDot} />}
      </button>
      {expanded && (
        <div style={{ padding: '8px 0' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              type="number"
              value={lower}
              min={filter.min}
              max={filter.max}
              step={step}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ lower: v, upper });
              }}
              style={rangeInput}
            />
            <span style={{ color: '#999' }}>–</span>
            <input
              type="number"
              value={upper}
              min={filter.min}
              max={filter.max}
              step={step}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ lower, upper: v });
              }}
              style={rangeInput}
            />
          </div>
          <div style={{ padding: '0 4px' }}>
            <input
              type="range"
              min={filter.min}
              max={filter.max}
              step={step}
              value={lower}
              onChange={(e) => onChange({ lower: Number(e.target.value), upper })}
              style={{ width: '100%', margin: 0 }}
            />
            <input
              type="range"
              min={filter.min}
              max={filter.max}
              step={step}
              value={upper}
              onChange={(e) => onChange({ lower, upper: Number(e.target.value) })}
              style={{ width: '100%', margin: 0 }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#999' }}>
            <span>{format(filter.min)}</span>
            <span>{format(filter.max)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Checkbox Filter ──────────────────────────────────────────────────────────

function CheckboxSection({
  filter,
  onToggle,
}: {
  filter: CheckboxFilter;
  onToggle: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChecked = filter.options.some(o => o.checked);

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setExpanded(!expanded)} style={sectionHeader}>
        <span>{expanded ? '▼' : '▶'} {filter.label}</span>
        {hasChecked && <span style={activeDot} />}
      </button>
      {expanded && (
        <div style={{ padding: '4px 0' }}>
          {filter.options.map(opt => (
            <label
              key={opt.value}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '3px 0',
                cursor: opt.count === 0 && !opt.checked ? 'default' : 'pointer',
                opacity: opt.count === 0 && !opt.checked ? 0.4 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={opt.checked}
                disabled={opt.count === 0 && !opt.checked}
                onChange={() => onToggle(opt.value)}
                style={{ marginRight: 8 }}
              />
              <span style={{ flex: 1 }}>{opt.label}</span>
              {opt.count !== null && (
                <span style={{ color: '#999', fontSize: 12 }}>
                  {opt.countPrefix}{opt.count}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Active Filter Chips ──────────────────────────────────────────────────────

function ActiveChips({
  filterState,
  onFilterChange,
  priceFilter,
  ratingFilter,
}: {
  filterState: FilterState;
  onFilterChange: (s: FilterState) => void;
  priceFilter: RangeFilter;
  ratingFilter: RangeFilter;
}) {
  const chips: { label: string; onRemove: () => void }[] = [];

  if (filterState.priceRange) {
    chips.push({
      label: `Price: $${filterState.priceRange.lower}–$${filterState.priceRange.upper}`,
      onRemove: () => onFilterChange({ ...filterState, priceRange: null }),
    });
  }

  if (filterState.ratingRange) {
    chips.push({
      label: `Rating: ${filterState.ratingRange.lower}–${filterState.ratingRange.upper}`,
      onRemove: () => onFilterChange({ ...filterState, ratingRange: null }),
    });
  }

  for (const brand of filterState.brands) {
    chips.push({
      label: brand,
      onRemove: () => onFilterChange({
        ...filterState,
        brands: filterState.brands.filter(b => b !== brand),
      }),
    });
  }

  if (filterState.inStock !== null) {
    chips.push({
      label: filterState.inStock ? 'In Stock' : 'Out of Stock',
      onRemove: () => onFilterChange({ ...filterState, inStock: null }),
    });
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {chips.map((chip, i) => (
        <span key={i} style={chipStyle}>
          {chip.label}
          <button onClick={chip.onRemove} style={chipX}>&times;</button>
        </span>
      ))}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const sectionHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  padding: '8px 0',
  background: 'none',
  border: 'none',
  borderBottom: '1px solid #eee',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  color: '#333',
  textAlign: 'left',
};

const activeDot: React.CSSProperties = {
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: '#1a73e8',
};

const rangeInput: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  border: '1px solid #ddd',
  borderRadius: 4,
  fontSize: 13,
};

const clearBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#c00',
  cursor: 'pointer',
  fontSize: 12,
  padding: 0,
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  background: '#e8f0fe',
  borderRadius: 12,
  fontSize: 11,
  color: '#1a73e8',
};

const chipX: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#1a73e8',
  fontWeight: 'bold',
  fontSize: 14,
  padding: 0,
  lineHeight: 1,
};
