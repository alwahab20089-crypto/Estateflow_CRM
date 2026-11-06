import { useEffect, useState } from 'react';
import { DatePicker } from '@/components/common/date-picker';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMembers } from '@/features/leads/use-leads';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { humanize } from '@/lib/labels';
import { useAuth } from '@/providers/auth-provider';
import type { ContactListParams } from '@/types/contacts';
import { CONTACT_STATUSES, CONTACT_TYPES } from './contact-constants';
import { useContactTags } from './use-contacts';

const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s?: string) => {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

function FilterSelect({ label, allLabel, value, options, onChange }: {
  label: string;
  allLabel: string;
  value: string | undefined;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string | undefined) => void;
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

interface ContactFiltersBarProps {
  filters: ContactListParams;
  hasActiveFilters: boolean;
  onChange: (patch: Partial<Record<keyof ContactListParams, string | undefined>>) => void;
  onClear: () => void;
}

export function ContactFiltersBar({ filters, hasActiveFilters, onChange, onClear }: ContactFiltersBarProps) {
  const { can } = useAuth();
  const seeAll = can('contacts:read_all') && can('members:read');
  const members = useMembers(seeAll);
  const tags = useContactTags();
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const debounced = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (debounced.trim() !== (filters.search ?? '')) onChange({ search: debounced.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="space-y-3 border-b p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search name, email, phone or company" label="Search contacts" className="sm:col-span-2 lg:w-72" />
        <FilterSelect label="Contact type" allLabel="All types" value={filters.contactType} onChange={(v) => onChange({ contactType: v })} options={CONTACT_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
        <FilterSelect label="Status" allLabel="All statuses" value={filters.status} onChange={(v) => onChange({ status: v })} options={CONTACT_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        {seeAll && (
          <FilterSelect
            label="Assigned member"
            allLabel="All members"
            value={filters.assignedTo}
            onChange={(v) => onChange({ assignedTo: v })}
            options={[{ value: 'unassigned', label: 'Unassigned' }, ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.name }))]}
          />
        )}
        {(tags.data?.length ?? 0) > 0 && (
          <FilterSelect label="Tag" allLabel="All tags" value={filters.tag} onChange={(v) => onChange({ tag: v })} options={(tags.data ?? []).map((t) => ({ value: t, label: t }))} />
        )}
        <DatePicker label="Created from" placeholder="Created from" value={fromYmd(filters.createdFrom)} onChange={(d) => onChange({ createdFrom: d ? toYmd(d) : undefined })} className="w-full lg:w-40" />
        <DatePicker label="Created to" placeholder="Created to" value={fromYmd(filters.createdTo)} onChange={(d) => onChange({ createdTo: d ? toYmd(d) : undefined })} className="w-full lg:w-40" />
        {hasActiveFilters && (
          <Button variant="ghost" onClick={() => { setSearchInput(''); onClear(); }}>Clear filters</Button>
        )}
      </div>
    </div>
  );
}