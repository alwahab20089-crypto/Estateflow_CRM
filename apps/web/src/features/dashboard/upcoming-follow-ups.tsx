import { AsyncCard } from '@/components/common/async-card';
import { TaskList, useDashboardTasks } from './task-widgets';

/** Real follow-up tasks from the summary endpoint (shares one request with the other task widgets). */
export function UpcomingFollowUps() {
  const { data, isLoading, isError, refetch, tz, allowed } = useDashboardTasks();
  if (!allowed) return null;
  return (
    <AsyncCard title="Upcoming follow-ups" description="Your next follow-up tasks" isLoading={isLoading} isError={isError} onRetry={() => refetch()} skeletonHeight="h-72">
      <TaskList tasks={data?.upcomingFollowUps.items ?? []} tz={tz} emptyTitle="No follow-ups scheduled" emptyDescription="You are all caught up." />
    </AsyncCard>
  );
}