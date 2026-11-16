import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { analyticsService } from '@/services/analytics-service';
import type { DealsParams, LeadsParams, PropertiesParams, RangeParams, RevenueParams, TasksParams, TrendsParams } from '@/types/analytics';

const root = ['api', 'analytics'] as const;
export const analyticsKeys = {
  all: root,
  overview: (p: RangeParams) => [...root, 'overview', p] as const,
  leads: (p: LeadsParams) => [...root, 'leads', p] as const,
  deals: (p: DealsParams) => [...root, 'deals', p] as const,
  properties: (p: PropertiesParams) => [...root, 'properties', p] as const,
  team: (p: RangeParams) => [...root, 'team', p] as const,
  tasks: (p: TasksParams) => [...root, 'tasks', p] as const,
  revenue: (p: RevenueParams) => [...root, 'revenue', p] as const,
  trends: (p: TrendsParams) => [...root, 'trends', p] as const,
};

const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && count < 1;
const STALE_MS = 60_000;
const common = { staleTime: STALE_MS, placeholderData: keepPreviousData, retry } as const;

export const useAnalyticsOverview = (p: RangeParams, enabled = true) =>
  useQuery({ queryKey: analyticsKeys.overview(p), queryFn: ({ signal }) => analyticsService.overview(p, signal), enabled, ...common });
export type OverviewQuery = ReturnType<typeof useAnalyticsOverview>;

export const useLeadAnalytics = (p: LeadsParams, enabled = true) =>
  useQuery({ queryKey: analyticsKeys.leads(p), queryFn: ({ signal }) => analyticsService.leads(p, signal), enabled, ...common });

export const useDealAnalytics = (p: DealsParams, enabled = true) =>
  useQuery({ queryKey: analyticsKeys.deals(p), queryFn: ({ signal }) => analyticsService.deals(p, signal), enabled, ...common });

export const usePropertyAnalytics = (p: PropertiesParams, enabled = true) =>
  useQuery({ queryKey: analyticsKeys.properties(p), queryFn: ({ signal }) => analyticsService.properties(p, signal), enabled, ...common });

export const useTeamAnalytics = (p: RangeParams, enabled = true) =>
  useQuery({ queryKey: analyticsKeys.team(p), queryFn: ({ signal }) => analyticsService.team(p, signal), enabled, ...common });

export const useTaskAnalytics = (p: TasksParams, enabled = true) =>
  useQuery({ queryKey: analyticsKeys.tasks(p), queryFn: ({ signal }) => analyticsService.tasks(p, signal), enabled, ...common });

export const useRevenueAnalytics = (p: RevenueParams, enabled = true) =>
  useQuery({ queryKey: analyticsKeys.revenue(p), queryFn: ({ signal }) => analyticsService.revenue(p, signal), enabled, ...common });

export const useAnalyticsTrends = (p: TrendsParams, enabled = true) =>
  useQuery({ queryKey: analyticsKeys.trends(p), queryFn: ({ signal }) => analyticsService.trends(p, signal), enabled, ...common });