import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { EntityPicker, type PickerOption } from '@/components/common/entity-picker';
import { fieldA11y } from '@/components/common/field-a11y';
import { FormField } from '@/components/common/form-field';
import { LoadingButton } from '@/components/common/loading-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useMembers } from '@/features/leads/use-leads';
import { useTimezone } from '@/hooks/use-timezone';
import { ApiError } from '@/lib/api-client';
import { toLocalInput } from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { humanize } from '@/lib/labels';
import { useAuth } from '@/providers/auth-provider';
import { contactService } from '@/services/contact-service';
import { dealService } from '@/services/deal-service';
import { leadService } from '@/services/lead-service';
import { propertyService } from '@/services/property-service';
import type { TaskDto, TaskRelatedType } from '@/types/tasks';
import { RELATED_LABELS, RELATED_READ_PERMISSION, RELATED_TYPES, TASK_PRIORITIES, TASK_TYPES } from './task-constants';
import { createTaskFormSchema, defaultTaskValues, SERVER_FIELD_MAP, taskToFormValues, toTaskPayload, type TaskFormValues } from './task-schemas';
import { useCreateTask, useUpdateTask } from './use-tasks';

const NONE = 'none';
export interface TaskDefaults {
  /** yyyy-mm-ddTHH:mm in the organization's timezone */
  dueAt?: string;
  related?: { type: TaskRelatedType; id: string; label: string };
}
interface Props { open: boolean; onOpenChange: (open: boolean) => void; task?: TaskDto | null; defaults?: TaskDefaults; onCreated?: (task: TaskDto) => void }

export function TaskFormDialog({ open, onOpenChange, task, defaults, onCreated }: Props) {
  const isEdit = Boolean(task);
  const tz = useTimezone();
  const { can } = useAuth();
  const canAssign = can('tasks:assign') && !isEdit;
  const members = useMembers(open && canAssign);
  const create = useCreateTask();
  const update = useUpdateTask();
  const saving = create.isPending || update.isPending;
  const [relatedLabel, setRelatedLabel] = useState<string | undefined>();

  const originalReminder = task ? toLocalInput(task.reminderAt, tz) : '';
  const schema = useMemo(() => createTaskFormSchema({ tz, originalReminder }), [tz, originalReminder]);
  const initial = () =>
    task
      ? taskToFormValues(task, tz)
      : defaultTaskValues({ dueAt: defaults?.dueAt ?? '', relatedEntityType: defaults?.related?.type ?? '', relatedEntityId: defaults?.related?.id ?? '' });

  const { register, control, handleSubmit, reset, setError, setValue, watch, formState: { errors } } = useForm<TaskFormValues>({ resolver: zodResolver(schema), defaultValues: initial() });

  useEffect(() => {
    if (!open) return;
    reset(initial());
    setRelatedLabel(task?.related?.label ?? defaults?.related?.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, defaults, reset]);

  const relType = watch('relatedEntityType');
  const allowedTypes = RELATED_TYPES.filter((t) => can(RELATED_READ_PERMISSION[t]) || t === relType);

  const searchRelated = async (text: string): Promise<PickerOption[]> => {
    const search = text || undefined;
    switch (relType) {
      case 'LEAD': {
        const { data } = await leadService.list({ page: 1, limit: 20, search, sortBy: 'createdAt', sortOrder: 'desc' } as never);
        return data.map((l) => ({ id: l._id, label: `${l.firstName} ${l.lastName}`.trim(), description: humanize(l.status) }));
      }
      case 'CONTACT': {
        const { data } = await contactService.list({ page: 1, limit: 20, search, sortBy: 'name', sortOrder: 'asc', view: 'active' } as never);
        return data.map((c) => ({ id: c._id, label: c.fullName, description: c.company ?? c.email ?? undefined }));
      }
      case 'PROPERTY': {
        const { data } = await propertyService.list({ page: 1, limit: 20, search, sortBy: 'title', sortOrder: 'asc', view: 'active' } as never);
        return data.map((p) => ({ id: p._id, label: p.title, description: p.city ?? undefined }));
      }
      case 'DEAL': {
        const { data } = await dealService.list({ page: 1, limit: 20, search, sortBy: 'title', sortOrder: 'asc' } as never);
        return data.map((d) => ({ id: d._id, label: d.title, description: humanize(d.stage) }));
      }
      default:
        return [];
    }
  };

  const onSubmit = async (values: TaskFormValues) => {
    if (saving) return;
    try {
      const payload = toTaskPayload(values, { tz, original: task ?? undefined });
      if (task) {
        await update.mutateAsync({ id: task._id, payload });
        toast.success('Task updated');
      } else {
        const created = await create.mutateAsync({ ...payload, assignedTo: values.assignedTo || undefined });
        toast.success('Task created');
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        for (const d of err.errors) {
          const field = d.path ? SERVER_FIELD_MAP[d.path] : undefined;
          if (field) setError(field, { message: d.message });
        }
      }
      toast.error(errorMessage(err, 'Could not save the task'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit task' : 'New task'}</DialogTitle>
            <DialogDescription>{isEdit ? 'Update the task. Use the task actions to change its status or owner.' : 'Create a task, optionally linked to a lead, contact, property or deal.'}</DialogDescription>
          </DialogHeader>

          <FormField id="task-title" label="Title *" error={errors.title?.message}>
            <Input autoComplete="off" {...fieldA11y('task-title', errors.title?.message)} {...register('title')} />
          </FormField>

          <FormField id="task-description" label="Description" error={errors.description?.message}>
            <Textarea rows={3} {...fieldA11y('task-description', errors.description?.message)} {...register('description')} />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="task-type" label="Task type">
              <Controller control={control} name="taskType" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="task-type" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{TASK_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField id="task-priority" label="Priority">
              <Controller control={control} name="priority" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="task-priority" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{humanize(p)}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField id="task-due" label="Due date and time" error={errors.dueAt?.message} hint={`Times are in ${tz}`}>
              <Input type="datetime-local" {...fieldA11y('task-due', errors.dueAt?.message)} {...register('dueAt')} />
            </FormField>
            <FormField id="task-reminder" label="Reminder" error={errors.reminderAt?.message} hint="An in-app notification is sent at this time">
              <Input type="datetime-local" {...fieldA11y('task-reminder', errors.reminderAt?.message)} {...register('reminderAt')} />
            </FormField>

            {canAssign && (
              <FormField id="task-assignee" label="Assigned member" className="sm:col-span-2">
                <Controller control={control} name="assignedTo" render={({ field }) => (
                  <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                    <SelectTrigger id="task-assignee" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Me</SelectItem>
                      {(members.data ?? []).map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </FormField>
            )}

            <FormField id="task-related-type" label="Related to">
              <Controller control={control} name="relatedEntityType" render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => { field.onChange(v === NONE ? '' : v); setValue('relatedEntityId', ''); setRelatedLabel(undefined); }}>
                  <SelectTrigger id="task-related-type" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nothing</SelectItem>
                    {allowedTypes.map((t) => <SelectItem key={t} value={t}>{RELATED_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField id="task-related" label="Record" error={errors.relatedEntityId?.message}>
              <Controller control={control} name="relatedEntityId" render={({ field }) => (
                <EntityPicker
                  key={relType || 'none'} id={`task-related-${relType || 'none'}`} label="Related record" value={field.value} valueLabel={relatedLabel}
                  placeholder={relType ? `Select a ${RELATED_LABELS[relType as TaskRelatedType].toLowerCase()}` : 'Choose a type first'}
                  search={searchRelated} disabled={!relType} allowClear invalid={Boolean(errors.relatedEntityId)}
                  onChange={(id, o) => { field.onChange(id); setRelatedLabel(o?.label); }}
                />
              )} />
            </FormField>

            <FormField id="task-tags" label="Tags" error={errors.tags?.message} hint="Comma separated" className="sm:col-span-2">
              <Input autoComplete="off" {...fieldA11y('task-tags', errors.tags?.message)} {...register('tags')} />
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <LoadingButton type="submit" loading={saving}>{isEdit ? 'Save changes' : 'Create task'}</LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}