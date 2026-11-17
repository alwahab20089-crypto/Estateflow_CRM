import { toast } from 'sonner';
import { ErrorState } from '@/components/common/error-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { usePreferences, useUpdatePreferences } from '@/features/automations/use-automations';
import { errorMessage } from '@/lib/errors';
import { humanize } from '@/lib/labels';
import { useAuth } from '@/providers/auth-provider';
import type { NotificationPreference } from '@/types/automations';

export function NotificationPreferences() {
  const { can } = useAuth();
  const canEdit = can('notifications:preferences_update');
  const prefs = usePreferences();
  const update = useUpdatePreferences();

  const toggle = (p: NotificationPreference, channel: 'inApp' | 'email', value: boolean) =>
    update.mutate([{ type: p.type, [channel]: value }], {
      onSuccess: () => toast.success('Preferences saved'),
      onError: (err) => toast.error(errorMessage(err)),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Choose which notifications you receive. Required ones, such as assignments and failed automations, can't be turned off.</CardDescription>
      </CardHeader>
      <CardContent>
        {prefs.isLoading ? <div role="status" aria-label="Loading preferences"><Skeleton className="h-40 w-full" /></div>
          : prefs.isError ? <ErrorState message={errorMessage(prefs.error)} onRetry={() => prefs.refetch()} />
          : (
            <ul className="divide-y">
              {prefs.data!.map((p) => (
                <li key={p.type} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{humanize(p.type)}</p>
                    {p.mandatory && <p className="text-xs text-muted-foreground">Required</p>}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      In-app
                      <Switch aria-label={`${humanize(p.type)} in-app`} checked={p.inApp} disabled={p.mandatory || !canEdit || update.isPending} onCheckedChange={(v) => toggle(p, 'inApp', v)} />
                    </label>
                    {p.email !== null && (
                      <label className="flex items-center gap-2">
                        Email
                        <Switch aria-label={`${humanize(p.type)} email`} checked={p.email} disabled={p.mandatory || !canEdit || update.isPending} onCheckedChange={(v) => toggle(p, 'email', v)} />
                      </label>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </CardContent>
    </Card>
  );
}