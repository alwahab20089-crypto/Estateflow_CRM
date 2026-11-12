// src/features/deals/use-deal-filters.ts
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DealListParams, DealStage } from '@/types/deals';
import type { ListingKind } from '@/types/properties';
import { DEAL_STAGES } from './deal-constants';

const STAGES = DEAL_STAGES.map((s) => s.value);
const TYPES: ListingKind[] = ['SALE', 'RENT', 'LEASE'];

/** The board loads up to 100 deals (the API maximum). Stage counts in the header always cover every matching deal. */
export function useDealFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo<DealListParams>(() => {
    const stage = params.get('stage') as DealStage | null;
    const dealType = params.get('dealType') as ListingKind | null;
    const assignedTo = params.get('assignedTo');
    return {
      page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'desc',
      search: params.get('search')?.trim() || undefined,
      stage: stage && STAGES.includes(stage) ? stage : undefined,
      dealType: dealType && TYPES.includes(dealType) ? dealType : undefined,
      assignedTo: assignedTo === 'unassigned' || (assignedTo && /^[a-f\d]{24}$/i.test(assignedTo)) ? assignedTo : undefined,
    };
  }, [params]);

  const update = useCallback((patch: Partial<Record<'search' | 'stage' | 'dealType' | 'assignedTo', string | undefined>>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v) {
          next.set(k, v);
        } else {
          next.delete(k);
        }
      }
      return next;
    }, { replace: true });
  }, [setParams]);
  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  const hasActiveFilters = Boolean(filters.search || filters.stage || filters.dealType || filters.assignedTo);
  return { filters, update, clear, hasActiveFilters };
}