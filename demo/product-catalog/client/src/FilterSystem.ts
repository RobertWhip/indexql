import type { Product } from '../../shared/product.entity';
import type { Specs } from './useProducts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RangeFilter {
  field: string;
  label: string;
  min: number;
  max: number;
  lower: number;
  upper: number;
}

export interface CheckboxOption {
  value: string;
  label: string;
  count: number | null;
  countPrefix: string;
  checked: boolean;
}

export interface CheckboxFilter {
  field: string;
  label: string;
  options: CheckboxOption[];
}

export interface FilterState {
  priceRange: { lower: number; upper: number } | null;
  ratingRange: { lower: number; upper: number } | null;
  brands: string[];       // selected brand names
  inStock: boolean | null; // null = any, true = in stock only, false = out of stock only
}

export interface FilterResult {
  priceFilter: RangeFilter;
  ratingFilter: RangeFilter;
  brandFilter: CheckboxFilter;
  inStockFilter: CheckboxFilter;
  filteredIndices: number[]; // indices into decoded[] that pass all filters
}

export const EMPTY_FILTER_STATE: FilterState = {
  priceRange: null,
  ratingRange: null,
  brands: [],
  inStock: null,
};

// ── Filter System ────────────────────────────────────────────────────────────

export class FilterSystem {
  private products: Product[];
  private brands: string[];

  // Precomputed member sets: brand name → Set of product indices
  private brandMembers: Map<string, Set<number>> = new Map();
  // inStock member sets
  private inStockMembers: Set<number> = new Set();
  private outOfStockMembers: Set<number> = new Set();
  // Full price/rating ranges
  private fullPriceRange: { min: number; max: number };
  private fullRatingRange: { min: number; max: number };

  constructor(products: Product[], specs: Specs) {
    this.products = products;
    this.brands = specs.brands;

    // Initialize brand member sets
    for (const brand of this.brands) {
      this.brandMembers.set(brand, new Set());
    }

    // Build member sets in single pass
    let priceMin = Infinity, priceMax = -Infinity;
    let ratingMin = Infinity, ratingMax = -Infinity;

    for (let i = 0; i < products.length; i++) {
      const p = products[i];

      // Brand
      const brandName = this.brands[p.brandIdx];
      if (brandName) this.brandMembers.get(brandName)!.add(i);

      // InStock
      if (p.inStock) this.inStockMembers.add(i);
      else this.outOfStockMembers.add(i);

      // Price/Rating ranges
      if (p.price < priceMin) priceMin = p.price;
      if (p.price > priceMax) priceMax = p.price;
      if (p.rating < ratingMin) ratingMin = p.rating;
      if (p.rating > ratingMax) ratingMax = p.rating;
    }

    this.fullPriceRange = { min: Math.floor(priceMin), max: Math.ceil(priceMax) };
    this.fullRatingRange = { min: Math.floor(ratingMin * 10) / 10, max: Math.ceil(ratingMax * 10) / 10 };
  }

  applyFilters(state: FilterState): FilterResult {
    const allIndices = new Set<number>(this.products.map((_, i) => i));

    // 1. Apply inStock filter
    let afterInStock: Set<number>;
    if (state.inStock === true) {
      afterInStock = this.inStockMembers;
    } else if (state.inStock === false) {
      afterInStock = this.outOfStockMembers;
    } else {
      afterInStock = allIndices;
    }

    // 2. Apply price range filter
    let afterPrice: Set<number>;
    if (state.priceRange) {
      afterPrice = new Set<number>();
      for (const idx of afterInStock) {
        const price = this.products[idx].price;
        if (price >= state.priceRange.lower && price <= state.priceRange.upper) {
          afterPrice.add(idx);
        }
      }
    } else {
      afterPrice = afterInStock;
    }

    // 3. Apply rating range filter
    let afterRating: Set<number>;
    if (state.ratingRange) {
      afterRating = new Set<number>();
      for (const idx of afterPrice) {
        const rating = this.products[idx].rating;
        if (rating >= state.ratingRange.lower && rating <= state.ratingRange.upper) {
          afterRating.add(idx);
        }
      }
    } else {
      afterRating = afterPrice;
    }

    // "Common filtered" = everything except brand filter (for computing brand facet counts)
    const commonFiltered = afterRating;

    // 4. Compute brand facet counts (against commonFiltered, with lookahead)
    const brandOptions: CheckboxOption[] = this.computeBrandFacets(
      state.brands,
      commonFiltered,
    );

    // 5. Apply brand filter (OR within brands)
    let afterBrand: Set<number>;
    if (state.brands.length > 0) {
      afterBrand = new Set<number>();
      for (const brand of state.brands) {
        const members = this.brandMembers.get(brand);
        if (members) {
          for (const idx of members) {
            if (commonFiltered.has(idx)) afterBrand.add(idx);
          }
        }
      }
    } else {
      afterBrand = commonFiltered;
    }

    // 6. Compute inStock facet counts (against afterBrand)
    const inStockOptions = this.computeInStockFacets(state.inStock, afterBrand);

    // 7. Compute live price/rating ranges from afterBrand
    const livePriceRange = this.computeRange(afterBrand, 'price');
    const liveRatingRange = this.computeRange(afterBrand, 'rating');

    // Build filter descriptors
    const priceFilter: RangeFilter = {
      field: 'price',
      label: 'Price',
      min: this.fullPriceRange.min,
      max: this.fullPriceRange.max,
      lower: state.priceRange?.lower ?? this.fullPriceRange.min,
      upper: state.priceRange?.upper ?? this.fullPriceRange.max,
    };

    const ratingFilter: RangeFilter = {
      field: 'rating',
      label: 'Rating',
      min: this.fullRatingRange.min,
      max: this.fullRatingRange.max,
      lower: state.ratingRange?.lower ?? this.fullRatingRange.min,
      upper: state.ratingRange?.upper ?? this.fullRatingRange.max,
    };

    const brandFilter: CheckboxFilter = {
      field: 'brand',
      label: 'Brand',
      options: brandOptions,
    };

    const inStockFilter: CheckboxFilter = {
      field: 'inStock',
      label: 'Availability',
      options: inStockOptions,
    };

    // Convert to sorted array of indices
    const filteredIndices = Array.from(afterBrand).sort((a, b) => a - b);

    return { priceFilter, ratingFilter, brandFilter, inStockFilter, filteredIndices };
  }

  private computeBrandFacets(
    selectedBrands: string[],
    commonFiltered: Set<number>,
  ): CheckboxOption[] {
    const selectedSet = new Set(selectedBrands);

    return this.brands.map(brand => {
      const members = this.brandMembers.get(brand)!;
      const checked = selectedSet.has(brand);

      // Count = how many products in commonFiltered have this brand
      let count = 0;
      for (const idx of members) {
        if (commonFiltered.has(idx)) count++;
      }

      let countPrefix = '';
      if (selectedBrands.length > 0 && !checked) {
        countPrefix = '+';
      }

      return {
        value: brand,
        label: brand,
        count,
        countPrefix,
        checked,
      };
    }).filter(o => o.count > 0 || o.checked);
  }

  private computeInStockFacets(
    currentInStock: boolean | null,
    filtered: Set<number>,
  ): CheckboxOption[] {
    let inStockCount = 0;
    let outOfStockCount = 0;
    for (const idx of filtered) {
      if (this.products[idx].inStock) inStockCount++;
      else outOfStockCount++;
    }

    return [
      {
        value: 'true',
        label: 'In Stock',
        count: inStockCount,
        countPrefix: '',
        checked: currentInStock === true,
      },
      {
        value: 'false',
        label: 'Out of Stock',
        count: outOfStockCount,
        countPrefix: '',
        checked: currentInStock === false,
      },
    ];
  }

  private computeRange(indices: Set<number>, field: 'price' | 'rating'): { min: number; max: number } {
    let min = Infinity, max = -Infinity;
    for (const idx of indices) {
      const v = this.products[idx][field];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Infinity) return { min: 0, max: 0 };
    return { min, max };
  }
}
