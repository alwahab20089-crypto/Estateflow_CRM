import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PAGE_SIZES } from '@/features/leads/lead-constants';
import type { ContactListParams, ContactSortField } from '@/types/contacts';
import { CONTACT_STATUSES, CONTACT_TYPES } from './contact-constants';

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | undefined =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
const SORTS: ContactSortField[] = ['createdAt', 'name', 'contactType', 'status'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Filters, sorting and pagination live in the URL, so reloads, back/forward and shared links keep their state. */
export function useContactFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<ContactListParams>(() => {
    const limit = PAGE_SIZES.includes(Number(params.get('limit'))) ? Number(params.get('limit')) : 20;
    const from = params.get('createdFrom');
    const to = params.get('createdTo');
    const assignedTo = params.get('assignedTo');
    return {
      page: Math.max(1, Number(params.get('page')) || 1),
      limit,
      search: params.get('search')?.trim() || undefined,
      contactType: pick(params.get('contactType'), CONTACT_TYPES),
      status: pick(params.get('status'), CONTACT_STATUSES),
      assignedTo: assignedTo === 'unassigned' || (assignedTo && /^[a-f\d]{24}$/i.test(assignedTo)) ? assignedTo : undefined,
      tag: params.get('tag')?.trim().toLowerCase() || undefined,
      createdFrom: from && YMD.test(from) ? from : undefined,
      createdTo: to && YMD.test(to) ? to : undefined,
      sortBy: pick(params.get('sortBy'), SORTS) ?? 'createdAt',
      sortOrder: params.get('sortOrder') === 'asc' ? 'asc' : 'desc',
      view: params.get('view') === 'archived' ? 'archived' : 'active',
    };
  }, [params]);

  const update = useCallback(
    (patch: Partial<Record<keyof ContactListParams, string | number | undefined>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          if (!('page' in patch)) next.delete('page'); // any filter/sort change returns to page 1
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clear = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams();
        for (const keep of ['limit', 'view']) if (prev.get(keep)) next.set(keep, prev.get(keep)!);
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const hasActiveFilters = Boolean(
    filters.search || filters.contactType || filters.status || filters.assignedTo || filters.tag || filters.createdFrom || filters.createdTo,
  );
  return { filters, update, clear, hasActiveFilters };
}