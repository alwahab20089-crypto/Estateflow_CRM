import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { reportService } from '@/services/analytics-service';
import type { ReportParams } from '@/types/analytics';

const root = ['api', 'reports'] as const;
export const reportKeys = {
  all: root,
  catalog: [...root, 'catalog'] as const,
  run: (id: string, p: ReportParams) => [...root, 'run', id, p] as const,
};
const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && count < 1;

export const useReportCatalog = (enabled = true) =>
  useQuery({ queryKey: reportKeys.catalog, queryFn: ({ signal }) => reportService.catalog(signal), enabled, staleTime: 5 * 60_000, retry });

export const useReport = (id: string, p: ReportParams, enabled = true) =>
  useQuery({ queryKey: reportKeys.run(id, p), queryFn: ({ signal }) => reportService.run(id, p, signal), enabled: enabled && Boolean(id), staleTime: 30_000, placeholderData: keepPreviousData, retry });

export const useLeadPerformanceReport = (p: ReportParams, enabled = true) => useReport('lead-performance', p, enabled);
export const useDealPipelineReport = (p: ReportParams, enabled = true) => useReport('deal-pipeline', p, enabled);
export const usePropertyInventoryReport = (p: ReportParams, enabled = true) => useReport('property-inventory', p, enabled);
export const useAgentPerformanceReport = (p: ReportParams, enabled = true) => useReport('agent-performance', p, enabled);
export const useTaskProductivityReport = (p: ReportParams, enabled = true) => useReport('task-productivity', p, enabled);