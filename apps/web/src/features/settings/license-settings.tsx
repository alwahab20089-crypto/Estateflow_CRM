import { zodResolver } from '@hookform/resolvers/zod';
import { Check, KeyRound, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { ErrorState } from '@/components/common/error-state';
import { fieldA11y } from '@/components/common/field-a11y';
import { FormField } from '@/components/common/form-field';
import { LoadingButton } from '@/components/common/loading-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { featureLabels, formatLimit, isRestricted, limitLabels, stateLabels } from '@/features/license/license-utils';
import { useActivateLicense, useDeactivateLicense, useLicenseOverview } from '@/features/license/use-license';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { FEATURE_KEYS, type LicenseOverview } from '@/types/license';

const schema = z.object({
  licenseKey: z.string().trim().min(20, 'Paste the full license key').max(4000, 'This is too long to be a license key'),
});
type Values = z.infer<typeof schema>;

const badgeVariant = (state: LicenseOverview['state']) =>
  state === 'ACTIVE' ? 'default' : state === 'GRACE' ? 'secondary' : 'destructive';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export function LicenseSettings() {
  const { can } = useAuth();
  const canManage = can('license:manage');
  const overview = useLicenseOverview(can('license:read'));
  const activate = useActivateLicense();
  const deactivate = useDeactivateLicense();
  const [confirmOff, setConfirmOff] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { licenseKey: '' } });

  if (overview.isLoading) return <Skeleton className="h-96 w-full" aria-busy="true" />;
  if (overview.isError || !overview.data) {
    return <Card><ErrorState message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} /></Card>;
  }

  const data = overview.data;
  const lic = data.license;

  const onActivate = async (values: Values) => {
    try {
      await activate.mutateAsync(values.licenseKey);
      toast.success('License activated');
      reset();
    } catch (err) {
      // Key problems (invalid, expired, used elsewhere, revoked) belong next to the field. Everything else is a toast.
      if (err instanceof ApiError && [409, 422].includes(err.status)) setError('licenseKey', { message: err.message });
      else if (err instanceof ApiError && err.code === 'LICENSE_NOT_CONFIGURED') toast.error(err.message);
      else toast.error(errorMessage(err, 'Could not activate the license. Please try again.'));
    }
  };

  const onDeactivate = async () => {
    try {
      await deactivate.mutateAsync();
      toast.success('License deactivated');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not deactivate the license.'));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>License</CardTitle>
            <Badge variant={badgeVariant(data.state)}>{stateLabels[data.state]}</Badge>
          </div>
          <CardDescription>
            {isRestricted(data.state)
              ? 'Your data stays readable, but nothing new can be added and licensed features are off.'
              : 'What this installation is licensed to do.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lic ? (
            <dl className="space-y-3">
              <Row label="Edition">{data.edition ?? '—'}</Row>
              <Row label="Licensee">{lic.licensee}</Row>
              <Row label="Key"><span className="font-mono">••••{lic.keyLast4}</span></Row>
              <Row label="Activated">{formatDate(lic.activatedAt)}</Row>
              <Row label="Valid until">{data.validUntil ? formatDate(data.validUntil) : 'No end date'}</Row>
              {data.state === 'GRACE' && data.graceEndsAt && <Row label="Grace period ends">{formatDate(data.graceEndsAt)}</Row>}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No license has been activated yet.</p>
          )}
        </CardContent>
        {canManage && lic?.status === 'ACTIVE' && (
          <CardFooter>
            <Button variant="outline" className="text-destructive" onClick={() => setConfirmOff(true)}>Deactivate license</Button>
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
          <CardDescription>Reaching a limit stops you adding more. It never deletes or hides anything you already have.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {data.usage.map((row) => {
            const percent = row.limit === null ? 0 : row.limit === 0 ? 100 : Math.min(100, Math.round((row.used / row.limit) * 100));
            const name = limitLabels[row.key].plural;
            return (
              <div key={row.key} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium capitalize">{name}</span>
                  <span className="text-muted-foreground">
                    {row.used.toLocaleString('en-US')} of {formatLimit(row.limit)}
                  </span>
                </div>
                {row.limit !== null && (
                  <Progress
                    value={percent}
                    aria-label={`${name} used`}
                    className={cn(row.atLimit && 'bg-destructive/20 [&_[data-slot=progress-indicator]]:bg-destructive')}
                  />
                )}
                {row.overLimit && <p className="text-xs text-destructive">Over the limit: your records are safe, but you cannot add more until you are under it.</p>}
                {row.atLimit && !row.overLimit && <p className="text-xs text-destructive">Limit reached.</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Included features</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {FEATURE_KEYS.map((key) => {
              const on = data.features[key];
              return (
                <li key={key} className="flex items-start gap-3">
                  {on ? <Check className="mt-0.5 size-4 text-success" aria-hidden /> : <X className="mt-0.5 size-4 text-muted-foreground" aria-hidden />}
                  <div>
                    <p className="text-sm font-medium">
                      {featureLabels[key].label}
                      <span className="sr-only">{on ? ' (included)' : ' (not included)'}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">{featureLabels[key].description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <form onSubmit={handleSubmit(onActivate)} noValidate>
            <CardHeader>
              <CardTitle>{lic ? 'Replace or reactivate license' : 'Activate license'}</CardTitle>
              <CardDescription>Paste the license key you received. Activating a new key replaces the current one.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!data.configured && (
                <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  This installation cannot activate licenses yet: the server has no license public key configured. Ask whoever runs the server to set LICENSE_PUBLIC_KEY.
                </div>
              )}
              <FormField id="licenseKey" label="License key" error={errors.licenseKey?.message}>
                <Textarea
                  rows={4}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="EF1.…"
                  className="font-mono text-xs"
                  disabled={!data.configured}
                  {...fieldA11y('licenseKey', errors.licenseKey?.message)}
                  {...register('licenseKey')}
                />
              </FormField>
            </CardContent>
            <CardFooter>
              <LoadingButton type="submit" loading={isSubmitting} disabled={!data.configured}>
                <KeyRound /> Activate
              </LoadingButton>
            </CardFooter>
          </form>
        </Card>
      )}

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Deactivate the license?"
        description="Your data stays, but nobody can add new records and licensed features turn off until a license is activated again. You can paste the same key later to turn it back on."
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => void onDeactivate()}
      />
    </div>
  );
}