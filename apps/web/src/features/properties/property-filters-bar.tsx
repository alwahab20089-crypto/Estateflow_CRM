// src/features/properties/property-filters-bar.tsx
import { useEffect, useState } from 'react';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMembers } from '@/features/leads/use-leads';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { humanize } from '@/lib/labels';
import { useAuth } from '@/providers/auth-provider';
import { LISTING_TYPES, PROPERTY_STATUSES, PROPERTY_TYPES, SORT_OPTIONS } from './property-constants';
import type { PropertyFilters } from './use-property-filters';

function FilterSelect({ label, allLabel, value, options, onChange }: {
  label: string; allLabel: string; value: string | undefined; options: Array<{ value: string; label: string }>; onChange: (v: string | undefined) => void;
}) {
  return (
    <Select value={value ?? 'ALL'} onValueChange={(v) => onChange(v === 'ALL' ? undefined : v)}>
      <SelectTrigger aria-label={label} className="w-full lg:w-40"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">{allLabel}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Commits on blur or Enter so typing "250000" does not fire six requests. */
function NumberFilter({ id, label, value, onCommit }: { id: string; label: string; value: number | undefined; onCommit: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    const n = text.trim() === '' ? undefined : Number(text);
    if (n === undefined || (Number.isFinite(n) && n >= 0)) onCommit(n);
  };
  return (
    <div>
      <Label htmlFor={id} className="sr-only">{label}</Label>
      <Input id={id} inputMode="decimal" placeholder={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className="w-full lg:w-32" />
    </div>
  );
}

interface Props {
  filters: PropertyFilters;
  hasActiveFilters: boolean;
  onChange: (patch: Partial<Record<keyof PropertyFilters, string | number | boolean | undefined>>) => void;
  onClear: () => void;
}

export function PropertyFiltersBar({ filters, hasActiveFilters, onChange, onClear }: Props) {
  const { can } = useAuth();
  const members = useMembers(can('members:read'));
  const [search, setSearch] = useState(filters.search ?? '');
  const [city, setCity] = useState(filters.city ?? '');
  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedCity = useDebouncedValue(city, 300);

  useEffect(() => {
    if (debouncedSearch.trim() !== (filters.search ?? '')) onChange({ search: debouncedSearch.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  useEffect(() => {
    if (debouncedCity.trim() !== (filters.city ?? '')) onChange({ city: debouncedCity.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedCity]);
  useEffect(() => { if (!filters.search) setSearch(''); if (!filters.city) setCity(''); }, [filters.search, filters.city]);

  return (
    <div className="space-y-3 border-b p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Search title, city, address…" label="Search properties" className="lg:w-80" />
        <Select value={`${filters.sortBy}:${filters.sortOrder}`} onValueChange={(v) => { const [sortBy, sortOrder] = v.split(':'); onChange({ sortBy, sortOrder }); }}>
          <SelectTrigger aria-label="Sort properties" className="w-full lg:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col flex-wrap gap-3 lg:flex-row lg:items-center">
        <FilterSelect label="Property type" allLabel="All types" value={filters.propertyType} onChange={(v) => onChange({ propertyType: v })} options={PROPERTY_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
        <FilterSelect label="Listing type" allLabel="All listings" value={filters.listingType} onChange={(v) => onChange({ listingType: v })} options={LISTING_TYPES.map((t) => ({ value: t, label: `For ${t.toLowerCase()}` }))} />
        <FilterSelect label="Property status" allLabel="Active listings" value={filters.propertyStatus} onChange={(v) => onChange({ propertyStatus: v })} options={PROPERTY_STATUSES.map((t) => ({ value: t, label: humanize(t) }))} />
        {can('members:read') && (
          <FilterSelect label="Assigned agent" allLabel="All agents" value={filters.assignedTo} onChange={(v) => onChange({ assignedTo: v })}
            options={[{ value: 'unassigned', label: 'Unassigned' }, ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.name }))]} />
        )}
        <Input aria-label="City" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} className="w-full lg:w-36" />
        <NumberFilter id="pf-min-price" label="Min price" value={filters.minPrice} onCommit={(v) => onChange({ minPrice: v })} />
        <NumberFilter id="pf-max-price" label="Max price" value={filters.maxPrice} onCommit={(v) => onChange({ maxPrice: v })} />
        <NumberFilter id="pf-min-area" label="Min area" value={filters.minArea} onCommit={(v) => onChange({ minArea: v })} />
        <NumberFilter id="pf-max-area" label="Max area" value={filters.maxArea} onCommit={(v) => onChange({ maxArea: v })} />
        <div className="flex items-center gap-2">
          <input id="pf-closed" type="checkbox" className="size-4 accent-primary" checked={filters.includeClosed} onChange={(e) => onChange({ includeClosed: e.target.checked })} />
          <Label htmlFor="pf-closed" className="font-normal">Include sold / rented</Label>
        </div>
        {hasActiveFilters && <Button variant="ghost" onClick={onClear}>Clear filters</Button>}
      </div>
    </div>
  );
}