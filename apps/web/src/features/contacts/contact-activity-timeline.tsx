import { CalendarClock, FileText, Pencil, Repeat, UserCheck, UserPlus, Zap, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingButton } from '@/components/common/loading-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import type { LeadActivityType } from '@/types/leads';
import { useAddContactNote, useContactActivities } from './use-contacts';

const icons: Partial<Record<LeadActivityType, LucideIcon>> = {
  CREATED: UserPlus, UPDATE: Pencil, STATUS_CHANGE: Repeat, ASSIGNMENT: UserCheck, NOTE: FileText, FOLLOW_UP: CalendarClock, CONVERTED: UserCheck,
};
const NOTE_MAX = 2000;
const PAGE = 20;

function NoteComposer({ contactId, inputRef }: { contactId: string; inputRef?: React.Ref<HTMLTextAreaElement> }) {
  const [body, setBody] = useState('');
  const add = useAddContactNote();
  const trimmed = body.trim();

  const submit = async () => {
    if (!trimmed || add.isPending) return;
    try {
      await add.mutateAsync({ id: contactId, body: trimmed });
      setBody('');
      toast.success('Note added');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not add the note'));
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor="contact-note" className="sr-only">Add a note</label>
      <Textarea id="contact-note" ref={inputRef} rows={3} maxLength={NOTE_MAX} placeholder="Add a note about this contact…" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex items-center justify-between">
        <span className="text-caption">{body.length}/{NOTE_MAX}</span>
        <LoadingButton size="sm" onClick={submit} loading={add.isPending} disabled={!trimmed}>Add note</LoadingButton>
      </div>
    </div>
  );
}

export function ContactActivityTimeline({ contactId, canNote, noteRef }: { contactId: string; canNote: boolean; noteRef?: React.Ref<HTMLTextAreaElement> }) {
  const [tab, setTab] = useState<'all' | 'NOTE'>('all');
  const [limit, setLimit] = useState(PAGE);
  const query = useContactActivities(contactId, tab === 'NOTE' ? 'NOTE' : undefined, limit);
  const items = query.data?.data ?? [];
  const total = query.data?.meta.total ?? 0;

  return (
    <div className="space-y-4">
      {canNote && <NoteComposer contactId={contactId} inputRef={noteRef} />}
      <Tabs value={tab} onValueChange={(v) => { setTab(v as 'all' | 'NOTE'); setLimit(PAGE); }}>
        <TabsList aria-label="Activity filter">
          <TabsTrigger value="all">All activity</TabsTrigger>
          <TabsTrigger value="NOTE">Notes</TabsTrigger>
        </TabsList>
      </Tabs>

      {query.isLoading ? (
        <div aria-busy="true" aria-label="Loading activity" className="space-y-3">
          <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error, 'Could not load activity.')} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={tab === 'NOTE' ? 'No notes yet' : 'No activity yet'} description="Notes and changes will appear here." />
      ) : (
        <>
          <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px before:bg-border">
            {items.map((item) => {
              const Icon = icons[item.activityType] ?? Zap;
              return (
                <li key={item._id} className="relative flex gap-3">
                  <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground"><Icon className="size-3.5" aria-hidden /></span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm break-words whitespace-pre-wrap">{item.description}</p>
                    <p className="text-caption">{item.user?.name ?? 'Former member'} · <time dateTime={item.createdAt}>{formatRelative(item.createdAt)}</time></p>
                  </div>
                </li>
              );
            })}
          </ol>
          {items.length < total && <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>Show more</Button>}
        </>
      )}
    </div>
  );
}