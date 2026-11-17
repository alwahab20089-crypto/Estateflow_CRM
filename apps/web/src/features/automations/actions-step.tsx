import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useMembers } from '@/features/leads/use-leads';
import type { ActionType } from '@/types/automations';
import { ACTION_MAP, PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, TRIGGER_MAP, actionsFor } from './automation-catalog';
import { Pick, getErr, useBind } from './automation-ui';
import { newAction, type FormValues } from './automation-schemas';

function Target({ base, allowAssignee, label }: { base: `actions.${number}`; allowAssignee: boolean; label: string }) {
  const { watch, formState: { errors } } = useFormContext<FormValues>();
  const bind = useBind();
  const members = useMembers(true);
  const mode = watch(`${base}.target.mode`);
  const modes = [
    ...(allowAssignee ? [{ value: 'ASSIGNEE', label: "The record's assignee" }, { value: 'CREATOR', label: "The record's creator" }] : [{ value: 'CREATOR', label: "The record's creator" }]),
    { value: 'WORKFLOW_OWNER', label: 'The automation owner' },
    { value: 'USER', label: 'A specific team member' },
  ];
  const err = getErr(errors, `${base}.target`);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField id={`${base}-mode`} label={label}>
        <Pick id={`${base}-mode`} placeholder="Choose…" options={modes} {...bind(`${base}.target.mode`)} />
      </FormField>
      {mode === 'USER' && (
        <FormField id={`${base}-user`} label="Team member" error={err}>
          <Pick id={`${base}-user`} placeholder="Choose a member…" aria-invalid={Boolean(err)}
            options={(members.data ?? []).map((m) => ({ value: m.userId, label: m.name }))} {...bind(`${base}.target.userId`)} />
        </FormField>
      )}
      {mode !== 'USER' && err && <p role="alert" className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

export function ActionsStep() {
  const { control, register, watch, formState: { errors } } = useFormContext<FormValues>();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'actions' });
  const bind = useBind();
  const trigger = TRIGGER_MAP[watch('triggerType') as keyof typeof TRIGGER_MAP];
  const options = trigger ? actionsFor(trigger.entity) : [];
  const [toAdd, setToAdd] = useState<ActionType>('CREATE_TASK');
  if (!trigger) return <p className="text-sm text-muted-foreground">Choose a trigger first.</p>;
  const listError = getErr(errors, 'actions') ?? (errors.actions as { root?: { message?: string } } | undefined)?.root?.message;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Actions run in order. If one fails, the others still run and only the failed one is retried.</p>
      {fields.map((row, i) => {
        const base = `actions.${i}` as const;
        const type = watch(`${base}.type`);
        const err = (k: string) => getErr(errors, `${base}.${k}`);
        return (
          <section key={row.id} aria-label={`Action ${i + 1}`} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{i + 1}. {ACTION_MAP[type].label}</h3>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label={`Move action ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp className="size-4" /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Move action ${i + 1} down`} disabled={i === fields.length - 1} onClick={() => move(i, i + 1)}><ArrowDown className="size-4" /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove action ${i + 1}`} onClick={() => remove(i)}><Trash2 className="size-4" /></Button>
              </div>
            </div>
            {err('type') && <p role="alert" className="text-xs text-destructive">{err('type')}</p>}

            {type === 'CREATE_TASK' && (
              <>
                <FormField id={`${base}-title`} label="Task title" error={err('title')} hint="You can use {{name}} for the record's name.">
                  <Input id={`${base}-title`} aria-invalid={Boolean(err('title'))} {...register(`${base}.title`)} />
                </FormField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField id={`${base}-priority`} label="Priority"><Pick id={`${base}-priority`} options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))} {...bind(`${base}.priority`)} /></FormField>
                  <FormField id={`${base}-due`} label="Due in (hours)" error={err('dueInHours')} hint="Leave empty for no due date.">
                    <Input id={`${base}-due`} inputMode="numeric" {...register(`${base}.dueInHours`)} />
                  </FormField>
                </div>
                <Target base={base} allowAssignee label="Assign the task to" />
              </>
            )}
            {type === 'UPDATE_TASK_STATUS' && (
              <FormField id={`${base}-status`} label="New status" error={err('status')}>
                <Pick id={`${base}-status`} options={TASK_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} {...bind(`${base}.status`)} />
              </FormField>
            )}
            {type === 'CREATE_IN_APP_NOTIFICATION' && (
              <>
                <Target base={base} allowAssignee label="Notify" />
                <FormField id={`${base}-ntitle`} label="Title" error={err('title')}><Input id={`${base}-ntitle`} {...register(`${base}.title`)} /></FormField>
                <FormField id={`${base}-message`} label="Message" error={err('message')}><Textarea id={`${base}-message`} rows={2} {...register(`${base}.message`)} /></FormField>
              </>
            )}
            {type === 'SEND_EMAIL_NOTIFICATION' && (
              <>
                <Target base={base} allowAssignee label="Email" />
                <FormField id={`${base}-subject`} label="Subject" error={err('subject')}><Input id={`${base}-subject`} {...register(`${base}.subject`)} /></FormField>
                <FormField id={`${base}-body`} label="Body" error={err('body')} hint="Plain text. Needs a configured email provider to activate."><Textarea id={`${base}-body`} rows={3} {...register(`${base}.body`)} /></FormField>
              </>
            )}
            {(type === 'ASSIGN_TASK' || type === 'ASSIGN_LEAD' || type === 'ASSIGN_DEAL') && <Target base={base} allowAssignee={false} label="Assign to" />}
          </section>
        );
      })}
      {listError && <p role="alert" className="text-sm font-medium text-destructive">{listError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Pick aria-label="Action type to add" className="w-auto min-w-56" value={toAdd} onChange={(e) => setToAdd(e.target.value as ActionType)}
          options={options.map((a) => ({ value: a.value, label: a.label }))} />
        <Button type="button" variant="outline" size="sm" disabled={fields.length >= 5} onClick={() => append(newAction(options.some((o) => o.value === toAdd) ? toAdd : options[0]!.value))}>
          <Plus className="mr-1 size-4" /> Add action
        </Button>
      </div>
    </div>
  );
}