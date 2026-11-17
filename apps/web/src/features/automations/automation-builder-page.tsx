import { zodResolver } from '@hookform/resolvers/zod';
import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/error-state';
import { FormField } from '@/components/common/form-field';
import { LoadingButton } from '@/components/common/loading-button';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useMembers } from '@/features/leads/use-leads';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import type { TriggerType } from '@/types/automations';
import { CONFIG_META, TRIGGERS, TRIGGER_GROUPS, TRIGGER_MAP, actionsFor, describeAction, describeCondition, describeTrigger, fieldsFor } from './automation-catalog';
import { defaultValues, formSchema, toPayload, workflowToForm, type FormValues } from './automation-schemas';
import { getErr } from './automation-ui';
import { ActionsStep } from './actions-step';
import { ConditionsStep } from './conditions-step';
import { useActivateWorkflow, useCreateWorkflow, useUpdateWorkflow, useWorkflow } from './use-automations';

const STEPS = [
  { key: 'basics', label: 'Basics', fields: ['name', 'description'] },
  { key: 'trigger', label: 'Trigger', fields: ['triggerType', 'triggerConfig'] },
  { key: 'conditions', label: 'Conditions', fields: ['conditions'] },
  { key: 'actions', label: 'Actions', fields: ['actions'] },
  { key: 'review', label: 'Review', fields: [] },
] as const;

export function AutomationBuilderPage() {
  const { workflowId } = useParams();
  const isEdit = Boolean(workflowId);
  const navigate = useNavigate();
  const { can } = useAuth();
  const existing = useWorkflow(workflowId);
  const members = useMembers(true);
  const create = useCreateWorkflow();
  const update = useUpdateWorkflow();
  const activate = useActivateWorkflow();
  const [step, setStep] = useState(0);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema) as never, defaultValues: defaultValues(), mode: 'onTouched' });
  const { register, watch, setValue, getValues, trigger, handleSubmit, reset, formState: { errors } } = form;

  useEffect(() => { if (existing.data) reset(workflowToForm(existing.data)); }, [existing.data, reset]);

  const triggerType = watch('triggerType') as TriggerType | '';
  const info = triggerType ? TRIGGER_MAP[triggerType] : undefined;
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.userId, m.name])), [members.data]);
  const nameOf = (id: string) => names.get(id);
  const saving = create.isPending || update.isPending || activate.isPending;

  if (isEdit && existing.isLoading) return <Skeleton className="h-96 w-full" />;
  if (isEdit && existing.isError) return <ErrorState title="Automation not found" message={errorMessage(existing.error)} onRetry={() => existing.refetch()} />;

  const chooseTrigger = (next: TriggerType) => {
    const nextInfo = TRIGGER_MAP[next];
    const fieldSet = new Set(fieldsFor(nextInfo).map((f) => f.value));
    setValue('triggerType', next, { shouldValidate: true });
    // Keep only what still makes sense for the new trigger.
    setValue('conditions', getValues('conditions').filter((c) => fieldSet.has(c.field)));
    const allowed = new Set(actionsFor(nextInfo.entity).map((a) => a.value));
    setValue('actions', getValues('actions').filter((a) => allowed.has(a.type)));
  };

  const next = async () => {
    const ok = await trigger(STEPS[step]!.fields as never);
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const save = (andActivate: boolean) =>
    handleSubmit(async (values) => {
      setServerErrors([]);
      try {
        const payload = toPayload(values);
        const saved = isEdit ? await update.mutateAsync({ id: workflowId!, payload }) : await create.mutateAsync(payload);
        if (andActivate) {
          try {
            await activate.mutateAsync(saved._id);
            toast.success('Automation saved and activated');
          } catch (err) {
            toast.error(`Saved as draft, but it could not be activated: ${errorMessage(err)}`);
          }
        } else {
          toast.success(isEdit ? 'Automation updated' : 'Draft saved');
        }
        navigate('/app/automations');
      } catch (err) {
        setServerErrors(err instanceof ApiError && err.errors.length ? err.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)) : [errorMessage(err)]);
      }
    }, () => toast.error('Fix the highlighted fields first'))();

  const values = watch();
  const conditions = values.conditions;

  return (
    <FormProvider {...form}>
      <PageHeader title={isEdit ? 'Edit automation' : 'New automation'} description="Build it step by step. Nothing runs until you activate it."
        actions={<Button variant="outline" asChild><Link to="/app/automations">Cancel</Link></Button>} />

      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <button type="button" onClick={() => i <= step && setStep(i)} aria-current={i === step ? 'step' : undefined}
              className={cn('flex items-center gap-2 rounded-full border px-3 py-1 text-sm', i === step ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground', i > step && 'cursor-default')}>
              <span className="grid size-5 place-items-center rounded-full bg-muted text-xs">{i < step ? <Check className="size-3" /> : i + 1}</span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>

      <Card><CardContent className="space-y-6 pt-6">
        {step === 0 && (
          <div className="space-y-4">
            <FormField id="wf-name" label="Name" error={errors.name?.message}>
              <Input id="wf-name" aria-invalid={Boolean(errors.name)} placeholder="e.g. Follow up on high-priority leads" {...register('name')} />
            </FormField>
            <FormField id="wf-description" label="Description" error={errors.description?.message} hint="Optional. Helps teammates understand what this does.">
              <Textarea id="wf-description" rows={3} {...register('description')} />
            </FormField>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            {errors.triggerType && <p role="alert" className="text-sm font-medium text-destructive">{errors.triggerType.message}</p>}
            {TRIGGER_GROUPS.map((group) => (
              <fieldset key={group} className="space-y-2">
                <legend className="mb-1 text-sm font-semibold">{group}</legend>
                <div role="radiogroup" aria-label={group} className="grid gap-2 sm:grid-cols-2">
                  {TRIGGERS.filter((t) => t.group === group).map((t) => (
                    <button key={t.value} type="button" role="radio" aria-checked={triggerType === t.value} onClick={() => chooseTrigger(t.value)}
                      className={cn('rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50', triggerType === t.value && 'border-primary bg-primary/5')}>
                      <span className="block font-medium">{t.label}</span>
                      <span className="block text-xs text-muted-foreground">{t.description}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            {info?.config && (
              <FormField id="wf-config" label={CONFIG_META[info.config].label} error={getErr(errors, `triggerConfig.${info.config}`)} hint={`Default ${CONFIG_META[info.config].fallback}. Allowed ${CONFIG_META[info.config].min}–${CONFIG_META[info.config].max}.`}>
                <Input id="wf-config" inputMode="numeric" {...register(`triggerConfig.${info.config}`)} />
              </FormField>
            )}
          </div>
        )}

        {step === 2 && <ConditionsStep />}
        {step === 3 && <ActionsStep />}

        {step === 4 && info && (
          <div className="space-y-5">
            <section aria-label="Summary" className="space-y-3 text-sm">
              <h2 className="text-base font-semibold">{values.name}</h2>
              {values.description && <p className="text-muted-foreground">{values.description}</p>}
              <div><span className="font-medium">When: </span>{describeTrigger(info.value, values.triggerConfig)}</div>
              <div>
                <span className="font-medium">Only if: </span>
                {conditions.length === 0 ? 'always (no conditions)' : (
                  <ul className="mt-1 list-disc pl-5">
                    {conditions.length > 1 && <li className="list-none -ml-5 text-muted-foreground">{values.conditionOperator === 'ALL' ? 'All of these are true:' : 'Any of these is true:'}</li>}
                    {conditions.map((c, i) => <li key={i}>{describeCondition(toPayload(values).conditions[i]!, info)}</li>)}
                  </ul>
                )}
              </div>
              <div>
                <span className="font-medium">Then: </span>
                <ol className="mt-1 list-decimal pl-5">{toPayload(values).actions.map((a, i) => <li key={i}>{describeAction(a, (id) => nameOf(id) ?? id)}</li>)}</ol>
              </div>
            </section>
            <div className="flex items-center gap-3">
              <Switch id="wf-notify" checked={values.notifyOnCompletion} onCheckedChange={(v) => setValue('notifyOnCompletion', v)} />
              <label htmlFor="wf-notify" className="text-sm">Notify me when an execution completes <span className="text-muted-foreground">(failures always notify you)</span></label>
            </div>
            {serverErrors.length > 0 && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <p className="font-medium">The server rejected this automation:</p>
                <ul className="list-disc pl-5">{serverErrors.map((m, i) => <li key={i}>{m}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={step === 0 || saving} onClick={() => setStep((s) => s - 1)}>Back</Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>Next</Button>
          ) : (
            <div className="flex gap-2">
              <LoadingButton type="button" variant="outline" loading={saving} onClick={() => save(false)}>{isEdit ? 'Save changes' : 'Save as draft'}</LoadingButton>
              {can('automations:activate') && (!isEdit || existing.data?.status !== 'ACTIVE') && (
                <LoadingButton type="button" loading={saving} onClick={() => save(true)}>{isEdit ? 'Save & activate' : 'Save & activate'}</LoadingButton>
              )}
            </div>
          )}
        </div>
      </CardContent></Card>
    </FormProvider>
  );
}