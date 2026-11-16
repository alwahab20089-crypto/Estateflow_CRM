export type AnalyticsPeriod = '7d' | '30d' | '90d' | '12m' | 'custom';
export type GroupBy = 'day' | 'week' | 'month' | 'year';

/** Only fields the API accepts: from/to are sent only with period=custom. */
export interface RangeParams {
  period: AnalyticsPeriod;
  from?: string;
  to?: string;
  groupBy?: GroupBy;
  assignedTo?: string;
}
export type LeadsParams = RangeParams & { leadSource?: string; status?: string };
export type DealsParams = RangeParams & { dealType?: string; status?: string };
export type PropertiesParams = RangeParams & { propertyType?: string; status?: string };
export type TasksParams = RangeParams & { status?: string };
export type RevenueParams = RangeParams & { dealType?: string };
export type TrendsParams = RangeParams & { metrics?: string };

export interface YmdRange { from: string; to: string; days: number }
export interface AnalyticsMeta {
  range: YmdRange;
  previousRange: YmdRange;
  timezone: string;
  groupBy: GroupBy;
  currency: string;
  scope: 'organization' | 'self';
  generatedAt: string;
}

export type ChangeDirection = 'up' | 'down' | 'flat' | 'new' | 'unknown';
export interface Comparison {
  previous: number | null;
  changePct: number | null;
  changePoints: number | null;
  direction: ChangeDirection;
}

export interface Kpi {
  key: string;
  label: string;
  description: string;
  section: 'leads' | 'deals' | 'properties' | 'tasks';
  kind: 'count' | 'rate' | 'money';
  value: number | null;
  amounts?: Array<{ currency: string; amount: number }>;
  comparison: Comparison | null;
  period: 'range' | 'snapshot';
}
export interface OverviewData {
  kpis: Kpi[];
  unavailable: string[];
  limitations: string[];
}

export interface DistributionItem { key: string; count: number; share: number }
export interface SeriesPoint { bucket: string; value: number; count?: number; byCurrency?: Record<string, number> }
export interface Series { key: string; label: string; unit: 'count' | 'money'; points: SeriesPoint[] }
export interface CurrencyAmount { currency: string; count: number; amount: number }

/* ---------------- leads ---------------- */
export interface LeadSummary {
  newLeads: number;
  qualified: number;
  converted: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  qualifiedRate: number | null;
  convertedInPeriod: number;
  avgDaysToConvert: number | null;
}
export interface LeadAgentRow {
  userId: string | null;
  name: string;
  total: number;
  qualified: number;
  converted: number;
  won: number;
  lost: number;
  conversionRate: number | null;
}
export interface LeadAnalytics {
  summary: LeadSummary & { totalLeads: number };
  previous: LeadSummary;
  comparison: { newLeads: Comparison; qualified: Comparison; converted: Comparison; conversionRate: Comparison };
  byStatus: DistributionItem[];
  bySource: DistributionItem[];
  byType: DistributionItem[];
  byPriority: DistributionItem[];
  byAgent: LeadAgentRow[];
  series: Series[];
}

/* ---------------- deals ---------------- */
export interface DealSummary {
  created: number;
  won: { count: number; byCurrency: CurrencyAmount[] };
  lost: number;
  closed: number;
  winRate: number | null;
  avgDaysToClose: number | null;
  closeSample: number;
}
export interface DealAnalytics {
  summary: DealSummary;
  previous: DealSummary;
  comparison: { created: Comparison; won: Comparison; lost: Comparison; winRate: Comparison };
  pipeline: { open: number; pipeline: Array<CurrencyAmount & { weighted: number }> };
  expectedClosing: {
    openDueInPeriod: { count: number; byCurrency: CurrencyAmount[] };
    openPastExpectedDate: number;
    wonWithExpectedDate: number;
    wonOnOrBeforeExpectedDate: number;
    onTimeRate: number | null;
  };
  byStage: Array<{ stage: string; count: number; values: CurrencyAmount[] }>;
  wonVsLost: { won: number; lost: number };
  byType: Array<{ type: string; count: number; values: CurrencyAmount[] }>;
  byAgent: Array<{
    userId: string | null;
    name: string;
    open: number;
    won: number;
    lost: number;
    wonValue: CurrencyAmount[];
    winRate: number | null;
  }>;
  series: Series[];
  definitions: Record<string, string>;
}

/* ---------------- properties ---------------- */
export interface PropertyAnalytics {
  totals: { total: number; active: number; available: number };
  byStatus: DistributionItem[];
  byType: DistributionItem[];
  byListingType: DistributionItem[];
  byCity: { top: DistributionItem[]; distinctCities: number; otherCount: number };
  byAgent: Array<{ userId: string | null; name: string; count: number }>;
  averageListingPrice: Array<{ currency: string; listingType: string; rentPeriod: string | null; count: number; average: number }>;
  added: { count: number; comparison: Comparison };
  series: Series[];
  definitions: Record<string, string>;
}

/* ---------------- team ---------------- */
export interface TeamMember {
  kind: 'member' | 'unassigned' | 'former';
  userId: string | null;
  name: string;
  role: string | null;
  leads: { assigned: number; qualified: number; converted: number; won: number; lost: number; conversionRate: number | null } | null;
  deals: { open: number; won: number; lost: number; wonValue: CurrencyAmount[]; winRate: number | null } | null;
  tasks: { completed: number; pending: number; overdue: number; cohort: number; completionRate: number | null; onTimeRate: number | null; sample: number } | null;
}
export interface TeamAnalytics { members: TeamMember[]; attribution: string }

/* ---------------- tasks ---------------- */
export interface TaskSummary {
  cohort: number;
  completedInPeriod: number;
  createdInPeriod: number;
  matured: number;
  completionRate: number | null;
  onTimeRate: number | null;
}
export interface TaskAnalytics {
  summary: TaskSummary & { open: number; todo: number; inProgress: number; overdue: number; dueToday: number };
  previous: TaskSummary;
  comparison: { completedInPeriod: Comparison; completionRate: Comparison };
  byStatus: DistributionItem[];
  byPriority: DistributionItem[];
  byType: DistributionItem[];
  byAgent: Array<{
    userId: string | null;
    name: string;
    cohort: number;
    completed: number;
    pending: number;
    overdue: number;
    completionRate: number | null;
    onTimeRate: number | null;
    sample: number;
  }>;
  series: Series[];
  definitions: Record<string, string>;
}

/* ---------------- revenue (won deal value) ---------------- */
export interface RevenueAnalytics {
  wonDealValue: {
    byCurrency: Array<{ currency: string; count: number; amount: number; previousAmount: number; comparison: Comparison }>;
    byDealType: Array<{ type: string; values: CurrencyAmount[] }>;
  };
  pipeline: DealAnalytics['pipeline'];
  series: Series[];
  collectedRevenue: null;
  isCollectedRevenue: false;
  notes: string[];
}

/* ---------------- trends ---------------- */
export const TREND_METRICS = [
  'leadsCreated', 'leadsConverted', 'dealsCreated', 'dealsWon', 'dealsWonValue', 'propertiesAdded', 'tasksCreated', 'tasksCompleted',
] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];
export interface TrendsData { groupBy: GroupBy; buckets: string[]; series: Series[]; unavailable: string[] }

/* ---------------- reports ---------------- */
export type ReportColumnType = 'text' | 'number' | 'money' | 'date' | 'percent';
export interface ReportColumn { key: string; label: string; type: ReportColumnType }
export type ReportFilterKey = 'leadSource' | 'status' | 'dealType' | 'propertyType' | 'listingType' | 'assignedTo';
export interface ReportDefinition {
  id: string;
  title: string;
  description: string;
  usesDateRange: boolean;
  filters: ReportFilterKey[];
  statuses: string[] | null;
  columns: ReportColumn[];
  sortable: string[];
  defaultSort: { key: string; order: 'asc' | 'desc' };
  canExport: boolean;
}
export type ReportRow = Record<string, string | number | null>;
export interface ReportData { columns: ReportColumn[]; rows: ReportRow[]; summary: Record<string, unknown> }
export interface ReportMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  report: { id: string; title: string; usesDateRange: boolean };
  dateRange: { from: string; to: string; timezone: string } | null;
  sort: { key: string; order: 'asc' | 'desc' };
  scope: 'organization' | 'self';
  generatedAt: string;
}
export interface ReportParams {
  period?: AnalyticsPeriod;
  from?: string;
  to?: string;
  leadSource?: string;
  status?: string;
  dealType?: string;
  propertyType?: string;
  listingType?: string;
  assignedTo?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}