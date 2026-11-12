// src/features/properties/use-property-filters.ts
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toMinorUnits } from '@/lib/money';
import type { PropertyListParams, PropertySortField } from '@/types/properties';
import { LISTING_TYPES, PAGE_SIZES, PROPERTY_STATUSES, PROPERTY_TYPES } from './property-constants';

const pick = <T extends string>(v: string | null, allowed: readonly T[]): T | undefined => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
const SORTS: PropertySortField[] = ['createdAt', 'price', 'title', 'area'];
const posNumber = (v: string | null) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);

/** UI-side filters: price is in MAJOR units (what people type). apiParams() converts to the API's minor units. */
export type PropertyFilters = Omit<PropertyListParams, 'minPrice' | 'maxPrice'> & { minPrice?: number; maxPrice?: number };

export const apiParams = (f: PropertyFilters, currency: string): PropertyListParams => ({
  ...f,
  minPrice: f.minPrice === undefined ? undefined : toMinorUnits(f.minPrice, currency),
  maxPrice: f.maxPrice === undefined ? undefined : toMinorUnits(f.maxPrice, currency),
});

export function usePropertyFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<PropertyFilters>(() => {
    const assignedTo = params.get('assignedTo');
    return {
      page: Math.max(1, Number(params.get('page')) || 1),
      limit: PAGE_SIZES.includes(Number(params.get('limit'))) ? Number(params.get('limit')) : 20,
      search: params.get('search')?.trim() || undefined,
      propertyType: pick(params.get('propertyType'), PROPERTY_TYPES),
      listingType: pick(params.get('listingType'), LISTING_TYPES),
      propertyStatus: pick(params.get('propertyStatus'), PROPERTY_STATUSES),
      assignedTo: assignedTo === 'unassigned' || (assignedTo && /^[a-f\d]{24}$/i.test(assignedTo)) ? assignedTo : undefined,
      city: params.get('city')?.trim() || undefined,
      minPrice: posNumber(params.get('minPrice')), maxPrice: posNumber(params.get('maxPrice')),
      minArea: posNumber(params.get('minArea')), maxArea: posNumber(params.get('maxArea')),
      includeClosed: params.get('includeClosed') === 'true',
      sortBy: pick(params.get('sortBy'), SORTS) ?? 'createdAt',
      sortOrder: params.get('sortOrder') === 'asc' ? 'asc' : 'desc',
      view: params.get('view') === 'archived' ? 'archived' : 'active',
    };
  }, [params]);

  const update = useCallback(
    (patch: Partial<Record<keyof PropertyFilters, string | number | boolean | undefined>>) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === '' || v === false) next.delete(k);
          else next.set(k, String(v));
        }
        if (!('page' in patch)) next.delete('page');
        return next;
      }, { replace: true });
    },
    [setParams],
  );

  const clear = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams();
      for (const keep of ['limit', 'view']) if (prev.get(keep)) next.set(keep, prev.get(keep)!);
      return next;
    }, { replace: true });
  }, [setParams]);

  const hasActiveFilters = Boolean(
    filters.search || filters.propertyType || filters.listingType || filters.propertyStatus || filters.assignedTo || filters.city ||
      filters.minPrice !== undefined || filters.maxPrice !== undefined || filters.minArea !== undefined || filters.maxArea !== undefined || filters.includeClosed,
  );
  return { filters, update, clear, hasActiveFilters };
}