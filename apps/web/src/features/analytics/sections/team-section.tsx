import { ErrorState } from '@/components/common/error-state';
import { Card } from '@/components/ui/card';
import { humanize } from '@/lib/labels';
import { fromMinorUnits } from '@/lib/money';
import { amountFor, formatMoneyList, formatPercent } from '../analytics-format';
import { ChartCard, Fade, NUM, Notes, SectionSkeleton, SimpleTable, type TableColumn } from '../analytics-ui';
import { GroupedBarChart, wholeCurrency } from '../charts';
import { useTeamAnalytics } from '../use-analytics';
import type { TeamMember } from '@/types/analytics';
import type { SectionProps } from './section-props';

export function TeamSection({ range }: SectionProps) {
  const q = useTeamAnalytics(range);
  if (q.isError) return <Card><ErrorState onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <SectionSkeleton />;
  const { data: d, meta } = q.data;
  const cur = meta.currency;
  const rows = d.members;
  const showLeads = rows.some((r) => r.leads);
  const showDeals = rows.some((r) => r.deals);
  const showTasks = rows.some((r) => r.tasks);
  const dash = (v: unknown) => (v === null || v === undefined ? '—' : String(v));

  const columns: TableColumn<TeamMember>[] = [
    { header: 'Member', cell: (r) => r.name },
    { header: 'Role', cell: (r) => (r.role ? humanize(r.role) : '—') },
    ...(showLeads ? ([
      { header: 'Leads', cell: (r) => dash(r.leads?.assigned), className: NUM },
      { header: 'Qualified', cell: (r) => dash(r.leads?.qualified), className: NUM },
      { header: 'Converted', cell: (r) => dash(r.leads?.converted), className: NUM },
      { header: 'Lead conversion', cell: (r) => (r.leads ? formatPercent(r.leads.conversionRate) : '—'), className: NUM },
    ] as TableColumn<TeamMember>[]) : []),
    ...(showDeals ? ([
      { header: 'Open deals', cell: (r) => dash(r.deals?.open), className: NUM },
      { header: 'Won deals', cell: (r) => dash(r.deals?.won), className: NUM },
      { header: 'Won deal value', cell: (r) => (r.deals ? formatMoneyList(r.deals.wonValue) : '—'), className: NUM },
    ] as TableColumn<TeamMember>[]) : []),
    ...(showTasks ? ([
      { header: 'Completed', cell: (r) => dash(r.tasks?.completed), className: NUM },
      { header: 'Pending', cell: (r) => dash(r.tasks?.pending), className: NUM },
      { header: 'Overdue', cell: (r) => dash(r.tasks?.overdue), className: NUM },
      { header: 'Completion rate', cell: (r) => (r.tasks ? formatPercent(r.tasks.completionRate) : '—'), className: NUM },
    ] as TableColumn<TeamMember>[]) : []),
  ];
  const money = (n: number) => wholeCurrency(Math.round(n * 100), cur);

  return (
    <Fade fetching={q.isPlaceholderData}>
      <Notes title="How members are attributed" items={[d.attribution, 'Members are listed alphabetically. No ranking is shown because the metrics cover different record types and periods.']} />
      <ChartCard title="Agent performance">
        <div className="overflow-x-auto">
          <SimpleTable caption="Agent performance" rows={rows} columns={columns} getKey={(r, i) => `${r.kind}-${r.userId ?? i}`} />
        </div>
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Agent performance comparison" className="lg:col-span-2">
          <GroupedBarChart
            title="Agent performance comparison"
            rows={rows.map((r) => ({ name: r.name, leads: r.leads?.assigned ?? 0, won: r.deals?.won ?? 0, completed: r.tasks?.completed ?? 0 }))}
            bars={[...(showLeads ? [{ key: 'leads', label: 'Leads' }] : []), ...(showDeals ? [{ key: 'won', label: 'Deals won' }] : []), ...(showTasks ? [{ key: 'completed', label: 'Tasks completed' }] : [])]}
          />
        </ChartCard>
        {showLeads && (
          <ChartCard title="Leads by agent">
            <GroupedBarChart title="Leads by agent" rows={rows.map((r) => ({ name: r.name, assigned: r.leads?.assigned ?? 0, converted: r.leads?.converted ?? 0 }))} bars={[{ key: 'assigned', label: 'Assigned' }, { key: 'converted', label: 'Converted' }]} />
          </ChartCard>
        )}
        {showDeals && (
          <ChartCard title="Deals won by agent">
            <GroupedBarChart title="Deals won by agent" rows={rows.map((r) => ({ name: r.name, won: r.deals?.won ?? 0 }))} bars={[{ key: 'won', label: 'Won' }]} />
          </ChartCard>
        )}
        {showDeals && (
          <ChartCard title="Won deal value by agent" description={`${cur} only; other currencies are in the table and never converted. Agreed value, not cash collected.`}>
            <GroupedBarChart title="Won deal value by agent" rows={rows.map((r) => ({ name: r.name, value: fromMinorUnits(amountFor(r.deals?.wonValue, cur), cur) }))} bars={[{ key: 'value', label: 'Won deal value' }]} valueFormatter={money} />
          </ChartCard>
        )}
        {showTasks && (
          <ChartCard title="Task completion by agent">
            <GroupedBarChart title="Task completion by agent" rows={rows.map((r) => ({ name: r.name, completed: r.tasks?.completed ?? 0, pending: r.tasks?.pending ?? 0, overdue: r.tasks?.overdue ?? 0 }))} bars={[{ key: 'completed', label: 'Completed' }, { key: 'pending', label: 'Pending' }, { key: 'overdue', label: 'Overdue' }]} />
          </ChartCard>
        )}
      </div>
    </Fade>
  );
}