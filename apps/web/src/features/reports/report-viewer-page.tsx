import { ArrowLeft, Download, FileText, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { FilterSelect } from '@/components/common/filter-select';
import { LoadingButton } from '@/components/common/loading-button';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembers } from '@/features/leads/use-leads';
import { useTimezone } from '@/hooks/use-timezone';
import { formatDateTimeTz } from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { humanize } from '@/lib/labels';
import { useAuth } from '@/providers/auth-provider';
import { reportService } from '@/services/analytics-service';
import type { ReportColumn, ReportDefinition } from '@/types/analytics';
import { rangeText } from '../analytics/analytics-format';
import { DateRangeControl } from '../analytics/date-range-control';
import { downloadBlob, exportFilename, FILTER_LABELS, FILTER_OPTIONS, PAGE_SIZES, toReportParams, useReportFilters } from './report-filters';
import { ReportSummary } from './report-summary';
import { ReportTable } from './report-table';
import { useReport, useReportCatalog } from './use-reports';

function Viewer({ def }: { def: ReportDefinition }) {
  const { can } = useAuth();
  const tz = useTimezone();
  const { filters, update } = useReportFilters();
  const teamWide = can('analytics:team');
  const members = useMembers(teamWide && def.filters.includes('assignedTo'));
  const params = toReportParams(def, { ...filters, assignedTo: teamWide ? filters.assignedTo : undefined });
  const q = useReport(def.id, params);
  const [exporting, setExporting] = useState(false);
  const canExport = def.canExport && can('reports:export');

  const onSort = (col: ReportColumn) => {
    const cur = q.data?.meta.sort;
    const order = cur?.key === col.key ? (cur.order === 'asc' ? 'desc' : 'asc') : col.type === 'text' ? 'asc' : 'desc';
    update({ sortBy: col.key, sortOrder: order });
  };

  async function onExport() {
    setExporting(true);
    try {
      const blob = await reportService.exportCsv(def.id, toReportParams(def, { ...filters, assignedTo: teamWide ? filters.assignedTo : undefined }, { forExport: true }));
      downloadBlob(blob, exportFilename(def, q.data?.meta, tz));
      toast.success('CSV export downloaded');
    } catch (err) {
      toast.error(errorMessage(err, 'The export failed. Please try again.'));
    } finally {
      setExporting(false);
    }
  }

  const meta = q.data?.meta;
  const memberOptions = [{ value: 'me', label: 'My records' }, { value: 'unassigned', label: 'Unassigned' }, ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.name }))];

  return (
    <div className="space-y-6">
      <PageHeader
        title={def.title}
        description={def.description}
        actions={
          <>
            <Button asChild variant="outline" size="sm"><Link to="/app/reports"><ArrowLeft /> All reports</Link></Button>
            {canExport && (
              <LoadingButton size="sm" loading={exporting} onClick={() => void onExport()} disabled={meta?.total === 0}>
                <Download /> Export CSV
              </LoadingButton>
            )}
          </>
        }
      />

      <div className="space-y-3 rounded-xl border bg-card p-4">
        {def.usesDateRange && <DateRangeControl value={filters} onChange={update} />}
        <div className="flex flex-wrap items-center gap-3">
          {(['leadSource', 'dealType', 'listingType', 'propertyType'] as const).filter((k) => def.filters.includes(k)).map((k) => (
            <FilterSelect key={k} label={FILTER_LABELS[k][0]} allLabel={FILTER_LABELS[k][1]} value={filters[k]} options={FILTER_OPTIONS[k]} onChange={(v) => update({ [k]: v })} className="w-full sm:w-44" />
          ))}
          {def.filters.includes('status') && def.statuses && (
            <FilterSelect label="Status" allLabel="All statuses" value={filters.status} options={def.statuses.map((s) => ({ value: s, label: humanize(s) }))} onChange={(v) => update({ status: v })} className="w-full sm:w-44" />
          )}
          {teamWide && def.filters.includes('assignedTo') && (
            <FilterSelect label="Assigned to" allLabel="Everyone" value={filters.assignedTo} options={memberOptions} onChange={(v) => update({ assignedTo: v })} className="w-full sm:w-48" />
          )}
        </div>
        <p className="text-caption">
          {!def.usesDateRange
            ? `Snapshot${meta ? ` as of ${formatDateTimeTz(meta.generatedAt, tz)}` : ''}: the date range does not apply to this report.`
            : meta?.dateRange
              ? `${rangeText(meta.dateRange)} · ${meta.dateRange.timezone}`
              : ''}
          {canExport && ' · Export includes all rows matching the filters, not just this page.'}
        </p>
      </div>

      {q.isError ? (
        <Card><ErrorState onRetry={() => void q.refetch()} /></Card>
      ) : !q.data ? (
        <div role="status" aria-label="Loading report" className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
      ) : (
        <>
          <ReportSummary summary={q.data.data.summary} />
          <Card className="overflow-hidden">
            <ReportTable columns={q.data.data.columns} rows={q.data.data.rows} sortable={def.sortable} sort={q.data.meta.sort} onSort={onSort} busy={q.isPlaceholderData} />
            {q.data.meta.total > 0 && (
              <Pagination
                page={q.data.meta.page}
                pageCount={q.data.meta.totalPages}
                total={q.data.meta.total}
                pageSize={q.data.meta.limit}
                onPageChange={(p) => update({ page: String(p) })}
                pageSizeOptions={PAGE_SIZES}
                onPageSizeChange={(n) => update({ limit: String(n) })}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export function ReportViewerPage() {
  const { reportId = '' } = useParams();
  const { can } = useAuth();
  const allowed = can('reports:read');
  const catalog = useReportCatalog(allowed);
  const def = catalog.data?.find((r) => r.id === reportId);

  if (!allowed) return <Card><EmptyState icon={Lock} title="You don't have access to reports" /></Card>;
  if (catalog.isError) return <Card><ErrorState onRetry={() => void catalog.refetch()} /></Card>;
  if (!catalog.data) return <div role="status" aria-label="Loading report"><Skeleton className="h-64" /></div>;
  if (!def) {
    return (
      <Card>
        <EmptyState icon={FileText} title="Report not found" description="It does not exist or your role cannot access it." action={<Button asChild variant="outline"><Link to="/app/reports">Back to reports</Link></Button>} />
      </Card>
    );
  }
  return <Viewer def={def} />;
}