import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatYmd } from '@/lib/datetime';
import { formatNumber } from '@/lib/format';
import { humanize } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { ReportColumn, ReportRow } from '@/types/analytics';

const ENUM_KEYS = new Set(['source', 'type', 'status', 'priority', 'dealType', 'stage', 'outcome', 'propertyType', 'listingType', 'propertyStatus', 'rentPeriod', 'role']);

/** Report money cells are MAJOR units (the API already converted them) and are shown in the row's own currency. */
export function formatCell(col: ReportColumn, row: ReportRow): string {
  const v = row[col.key];
  if (v === null || v === undefined || v === '') return '—';
  switch (col.type) {
    case 'number':
      return typeof v === 'number' ? formatNumber(v) : String(v);
    case 'percent':
      return `${v}%`;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? formatYmd(String(v), { month: 'short', day: 'numeric', year: 'numeric' }) : String(v);
    case 'money': {
      const currency = typeof row.currency === 'string' ? row.currency : 'USD';
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(v));
      } catch {
        return String(v);
      }
    }
    default:
      return typeof v === 'string' && ENUM_KEYS.has(col.key) && /^[A-Z][A-Z_]*$/.test(v) ? humanize(v) : String(v);
  }
}

interface Props {
  columns: ReportColumn[];
  rows: ReportRow[];
  sortable: string[];
  sort: { key: string; order: 'asc' | 'desc' };
  onSort: (col: ReportColumn) => void;
  busy?: boolean;
}

export function ReportTable({ columns, rows, sortable, sort, onSort, busy }: Props) {
  if (rows.length === 0) return <EmptyState title="No rows match these filters" description="Try a wider date range or clear some filters." />;
  return (
    <Table aria-busy={busy}>
      <TableHeader>
        <TableRow>
          {columns.map((c) => {
            const numeric = c.type !== 'text' && c.type !== 'date';
            const active = sort.key === c.key;
            return (
              <TableHead key={c.key} className={cn(numeric && 'text-right')} aria-sort={active ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                {sortable.includes(c.key) ? (
                  <button type="button" onClick={() => onSort(c)} className="inline-flex items-center gap-1 font-medium hover:underline">
                    {c.label}
                    {active ? sort.order === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-50" aria-hidden />}
                  </button>
                ) : (
                  c.label
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {columns.map((c) => (
              <TableCell key={c.key} className={cn(c.type !== 'text' && c.type !== 'date' && 'text-right tabular-nums')}>
                {formatCell(c, r)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}