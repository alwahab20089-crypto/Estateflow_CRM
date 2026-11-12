// src/features/properties/activity-list.tsx  (shared by property and deal pages)
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import type { LeadActivityDto } from '@/types/leads';

export function ActivityList({ items, isLoading, isError, onRetry }: { items: LeadActivityDto[] | undefined; isLoading: boolean; isError: boolean; onRetry: () => void }) {
  if (isLoading) return <div role="status" aria-label="Loading activity" className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
  if (isError) return <ErrorState message="We could not load the activity." onRetry={onRetry} />;
  if (!items || items.length === 0) return <EmptyState title="No activity yet" description="Changes to this record are recorded here." />;
  return (
    <ol className="space-y-4 border-l pl-4">
      {items.map((a) => (
        <li key={a._id} className="relative">
          <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
          <p className="text-sm">{a.description}</p>
          <p className="text-caption">{a.user?.name ?? 'System'} · {formatDateTime(a.createdAt)}</p>
        </li>
      ))}
    </ol>
  );
}