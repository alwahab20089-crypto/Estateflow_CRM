import { apiDownload, apiRequest, apiRequestPaged } from '@/lib/api-client';
import type {
  AnalyticsMeta, DealAnalytics, DealsParams, LeadAnalytics, LeadsParams, OverviewData, PropertiesParams, PropertyAnalytics, RangeParams,
  ReportData, ReportDefinition, ReportMeta, ReportParams, RevenueAnalytics, RevenueParams, TaskAnalytics, TasksParams, TeamAnalytics, TrendsData, TrendsParams,
} from '@/types/analytics';
import { toQuery } from './lead-service';

const q = (p: object) => toQuery(p as Record<string, string | number | undefined>);
const get = <T>(path: string, params: object, signal?: AbortSignal) =>
  apiRequestPaged<T, AnalyticsMeta>(`/analytics/${path}${q(params)}`, { signal });

export const analyticsService = {
  overview: (p: RangeParams, signal?: AbortSignal) => get<OverviewData>('overview', p, signal),
  leads: (p: LeadsParams, signal?: AbortSignal) => get<LeadAnalytics>('leads', p, signal),
  deals: (p: DealsParams, signal?: AbortSignal) => get<DealAnalytics>('deals', p, signal),
  properties: (p: PropertiesParams, signal?: AbortSignal) => get<PropertyAnalytics>('properties', p, signal),
  team: (p: RangeParams, signal?: AbortSignal) => get<TeamAnalytics>('team', p, signal),
  tasks: (p: TasksParams, signal?: AbortSignal) => get<TaskAnalytics>('tasks', p, signal),
  revenue: (p: RevenueParams, signal?: AbortSignal) => get<RevenueAnalytics>('revenue', p, signal),
  trends: (p: TrendsParams, signal?: AbortSignal) => get<TrendsData>('trends', p, signal),
};

export const reportService = {
  catalog: (signal?: AbortSignal) => apiRequest<ReportDefinition[]>('/reports', { signal }),
  run: (id: string, p: ReportParams, signal?: AbortSignal) =>
    apiRequestPaged<ReportData, ReportMeta>(`/reports/${encodeURIComponent(id)}${q(p)}`, { signal }),
  /** Full filtered dataset as CSV (the API ignores page/limit for exports). */
  exportCsv: (id: string, p: ReportParams, signal?: AbortSignal) =>
    apiDownload(`/reports/${encodeURIComponent(id)}/export${q(p)}`, signal),
};