import { CalendarDays, Lock } from 'lucide-react';
import { useMemo } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FeatureGate } from '@/features/license/feature-gate';
import { useMembers } from '@/features/leads/use-leads';
import { useAuth } from '@/providers/auth-provider';
import { AnalyticsToolbar } from './analytics-toolbar';
import {
  ANALYTICS_TABS,
  rangeError,
  toRangeParams,
  useAnalyticsFilters,
  type AnalyticsTab,
} from './analytics-params';
import { DealsSection } from './sections/deals-section';
import { LeadsSection } from './sections/leads-section';
import { OverviewSection } from './sections/overview-section';
import { PropertiesSection } from './sections/properties-section';
import { RevenueSection } from './sections/revenue-section';
import { TasksSection } from './sections/tasks-section';
import { TeamSection } from './sections/team-section';
import { useAnalyticsOverview } from './use-analytics';

const DESCRIPTION = 'Performance across leads, deals, properties, team and tasks.';

const TABS: Array<{ value: AnalyticsTab; label: string; needs: string[] }> = [
  { value: 'overview', label: 'Overview', needs: ['analytics:read'] },
  { value: 'leads', label: 'Leads', needs: ['analytics:read', 'leads:read'] },
  { value: 'deals', label: 'Deals', needs: ['analytics:read', 'deals:read'] },
  { value: 'properties', label: 'Properties', needs: ['analytics:read', 'properties:read'] },
  { value: 'team', label: 'Team', needs: ['analytics:read', 'analytics:team'] },
  { value: 'tasks', label: 'Tasks', needs: ['analytics:read', 'tasks:read'] },
  { value: 'revenue', label: 'Deal value', needs: ['analytics:read', 'deals:read'] },
];

void ANALYTICS_TABS;

/**
 * The license must include analytics.
 * Locked installs never mount the analytics content, so no analytics requests are sent.
 */
export function AnalyticsPage() {
  return (
    <FeatureGate feature="analytics" title="Analytics" description={DESCRIPTION}>
      <AnalyticsContent />
    </FeatureGate>
  );
}

function AnalyticsContent() {
  const { can } = useAuth();
  const { filters, update } = useAnalyticsFilters();
  const allowed = can('analytics:read');
  const teamWide = can('analytics:team');
  const members = useMembers(teamWide);

  // Never send assignedTo without analytics:team: the API would answer 403.
  const range = useMemo(
    () => toRangeParams({ ...filters, assignedTo: teamWide ? filters.assignedTo : undefined }),
    [filters, teamWide],
  );
  const error = rangeError(filters);
  const overview = useAnalyticsOverview(range, allowed && !error);

  const tabs = TABS.filter((t) => t.needs.every((p) => can(p)));
  const active = tabs.some((t) => t.value === filters.tab) ? filters.tab : 'overview';

  if (!allowed) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" description={DESCRIPTION} />
        <Card>
          <EmptyState
            icon={Lock}
            title="You don't have access to analytics"
            description="Ask an organization admin to grant the analytics permission."
          />
        </Card>
      </div>
    );
  }

  const props = { range, compare: filters.compare };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Performance across leads, deals, properties, team and tasks. Deal values are agreed values, not collected revenue."
      />

      <AnalyticsToolbar
        filters={filters}
        update={update}
        meta={overview.data?.meta}
        teamWide={teamWide}
        members={members.data ?? []}
      />

      {error ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Choose a valid date range"
            description="Fix the dates above to load analytics."
          />
        </Card>
      ) : (
        <Tabs
          value={active}
          onValueChange={(v) => update({ tab: v === 'overview' ? undefined : v })}
        >
          <TabsList aria-label="Analytics sections" className="h-auto flex-wrap justify-start">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview">
            <OverviewSection query={overview} {...props} />
          </TabsContent>

          {tabs.some((t) => t.value === 'leads') && (
            <TabsContent value="leads">
              <LeadsSection {...props} />
            </TabsContent>
          )}

          {tabs.some((t) => t.value === 'deals') && (
            <TabsContent value="deals">
              <DealsSection {...props} />
            </TabsContent>
          )}

          {tabs.some((t) => t.value === 'properties') && (
            <TabsContent value="properties">
              <PropertiesSection {...props} />
            </TabsContent>
          )}

          {tabs.some((t) => t.value === 'team') && (
            <TabsContent value="team">
              <TeamSection {...props} />
            </TabsContent>
          )}

          {tabs.some((t) => t.value === 'tasks') && (
            <TabsContent value="tasks">
              <TasksSection {...props} />
            </TabsContent>
          )}

          {tabs.some((t) => t.value === 'revenue') && (
            <TabsContent value="revenue">
              <RevenueSection {...props} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
