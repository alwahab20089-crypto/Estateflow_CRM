import { useEffect, useState } from 'react';
import { DatePicker } from '@/components/common/date-picker';
import { FilterSelect } from '@/components/common/filter-select';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useMembers } from '@/features/leads/use-leads';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { humanize } from '@/lib/labels';
import { parseYmd, ymd } from '@/lib/datetime';
import { useAuth } from '@/providers/auth-provider';
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from './task-constants';
import type { TaskFilters } from './use-task-filters';

// The date picker works with local Date objects; only the Y-M-D parts matter (they are interpreted in the org timezone later).
const toYmd = (d: Date) => ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
const fromYmd = (s?: string) => { if (!s) return undefined; const { y, m, d } = parseYmd(s); return new Date(y, m - 1, d); };
const opts = (list: string[]) => list.map((v) => ({ value: v, label: humanize(v) }));

interface Props {
  filters: TaskFilters;
  hasActiveFilters: boolean;
  onChange: (patch: Record<string, string | undefined>) => void;
  onClear: () => void;
}

export function TaskFiltersBar({ filters, hasActiveFilters, onChange, onClear }: Props) {
  const { can } = useAuth();
  const seeAll = can('tasks:read_all') && can('members:read');
  const members = useMembers(seeAll);
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const debounced = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (debounced.trim() !== (filters.search ?? '')) onChange({ search: debounced.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="space-y-3 border-b p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search tasks" label="Search tasks" className="sm:col-span-2 lg:w-64" />
        <FilterSelect label="Status" allLabel="All statuses" value={filters.status} onChange={(v) => onChange({ status: v })} options={opts(TASK_STATUSES)} />
        <FilterSelect label="Priority" allLabel="All priorities" value={filters.priority} onChange={(v) => onChange({ priority: v })} options={opts(TASK_PRIORITIES)} />
        <FilterSelect label="Task type" allLabel="All types" value={filters.taskType} onChange={(v) => onChange({ taskType: v })} options={opts(TASK_TYPES)} />
        <FilterSelect
          label="Assigned member" allLabel="Everyone" value={filters.assignedTo} onChange={(v) => onChange({ assignedTo: v })}
          options={[{ value: 'me', label: 'Assigned to me' }, { value: 'unassigned', label: 'Unassigned' }, ...(seeAll ? (members.data ?? []).map((m) => ({ value: m.userId, label: m.name })) : [])]}
        />
        <DatePicker label="Due from" placeholder="Due from" value={fromYmd(filters.dueFrom)} onChange={(d) => onChange({ dueFrom: d ? toYmd(d) : undefined })} className="w-full lg:w-40" />
        <DatePicker label="Due to" placeholder="Due to" value={fromYmd(filters.dueTo)} onChange={(d) => onChange({ dueTo: d ? toYmd(d) : undefined })} className="w-full lg:w-40" />
        <div className="flex items-center gap-2">
          <Switch id="task-overdue" checked={filters.overdue} onCheckedChange={(on) => onChange({ overdue: on ? 'true' : undefined })} />
          <Label htmlFor="task-overdue" className="font-normal">Overdue only</Label>
        </div>
        {hasActiveFilters && <Button variant="ghost" onClick={() => { setSearchInput(''); onClear(); }}>Clear filters</Button>}
      </div>
    </div>
  );
}