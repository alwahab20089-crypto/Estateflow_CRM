import { z } from 'zod';
import { fromLocalInput, toLocalInput } from '@/lib/datetime';
import type { TaskDto, TaskPayload, TaskRelatedType } from '@/types/tasks';
import { RELATED_TYPES, TASK_PRIORITIES, TASK_TYPES } from './task-constants';

const dateTime = z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v), 'Enter a valid date and time');
const RELATED_OR_NONE = ['', 'LEAD', 'CONTACT', 'PROPERTY', 'DEAL'] as const;

export const parseTags = (s: string) => [...new Set(s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];

/** tz: the organization's timezone. originalReminder: the stored value (so an unchanged past reminder is not rejected on edit). */
export function createTaskFormSchema({ tz, originalReminder = '' }: { tz: string; originalReminder?: string }) {
  return z
    .object({
      title: z.string().trim().min(1, 'Title is required').max(200, 'At most 200 characters'),
      description: z.string().max(5000, 'At most 5000 characters'),
      taskType: z.enum(TASK_TYPES as [string, ...string[]]),
      priority: z.enum(TASK_PRIORITIES as [string, ...string[]]),
      dueAt: dateTime,
      reminderAt: dateTime,
      assignedTo: z.string(), // '' = me (server default)
      relatedEntityType: z.enum(RELATED_OR_NONE),
      relatedEntityId: z.string(),
      tags: z.string().max(400, 'Too many tags'),
    })
    .superRefine((v, ctx) => {
      if ((v.relatedEntityType === '') !== (v.relatedEntityId === '')) {
        ctx.addIssue({ code: 'custom', path: ['relatedEntityId'], message: 'Select a record' });
      }
      if (v.reminderAt && v.dueAt && v.reminderAt > v.dueAt) {
        ctx.addIssue({ code: 'custom', path: ['reminderAt'], message: 'The reminder must not be after the due date' });
      }
      if (v.reminderAt && v.reminderAt !== originalReminder) {
        const iso = fromLocalInput(v.reminderAt, tz);
        if (iso && new Date(iso).getTime() < Date.now() - 60_000) {
          ctx.addIssue({ code: 'custom', path: ['reminderAt'], message: 'The reminder must be in the future' });
        }
      }
      const tags = parseTags(v.tags);
      if (tags.length > 10 || tags.some((t) => t.length > 30)) {
        ctx.addIssue({ code: 'custom', path: ['tags'], message: 'Use up to 10 tags of 30 characters each' });
      }
    });
}
export type TaskFormValues = z.infer<ReturnType<typeof createTaskFormSchema>>;

export const defaultTaskValues = (over: Partial<TaskFormValues> = {}): TaskFormValues => ({
  title: '', description: '', taskType: 'GENERAL', priority: 'MEDIUM', dueAt: '', reminderAt: '', assignedTo: '',
  relatedEntityType: '', relatedEntityId: '', tags: '', ...over,
});

export const taskToFormValues = (t: TaskDto, tz: string): TaskFormValues => ({
  title: t.title, description: t.description ?? '', taskType: t.taskType, priority: t.priority,
  dueAt: toLocalInput(t.dueAt, tz), reminderAt: toLocalInput(t.reminderAt, tz), assignedTo: t.assignedTo ?? '',
  relatedEntityType: t.relatedEntityType ?? '', relatedEntityId: t.relatedEntityId ?? '', tags: t.tags.join(', '),
});

/**
 * Create omits empty fields. Edit sends null for cleared ones, and leaves dueAt/reminderAt out when the user did not touch them
 * (so a stored value with seconds is never re-sent truncated and mistaken for a changed reminder).
 */
export function toTaskPayload(v: TaskFormValues, { tz, original }: { tz: string; original?: TaskDto }): TaskPayload {
  const clear = Boolean(original);
  const empty = clear ? null : undefined;
  const payload: TaskPayload = {
    title: v.title.trim(),
    description: v.description.trim() || empty,
    taskType: v.taskType as TaskPayload['taskType'],
    priority: v.priority as TaskPayload['priority'],
    tags: parseTags(v.tags),
  };
  if (!original || v.dueAt !== toLocalInput(original.dueAt, tz)) payload.dueAt = v.dueAt ? fromLocalInput(v.dueAt, tz) : empty;
  if (!original || v.reminderAt !== toLocalInput(original.reminderAt, tz)) payload.reminderAt = v.reminderAt ? fromLocalInput(v.reminderAt, tz) : empty;
  if (v.relatedEntityType && v.relatedEntityId) {
    payload.relatedEntityType = v.relatedEntityType as TaskRelatedType;
    payload.relatedEntityId = v.relatedEntityId;
  } else if (clear) {
    payload.relatedEntityType = null;
    payload.relatedEntityId = null;
  }
  return payload;
}

export const SERVER_FIELD_MAP: Record<string, keyof TaskFormValues> = {
  title: 'title', description: 'description', taskType: 'taskType', priority: 'priority', dueAt: 'dueAt', reminderAt: 'reminderAt',
  assignedTo: 'assignedTo', relatedEntityType: 'relatedEntityType', relatedEntityId: 'relatedEntityId', tags: 'tags',
};
export { RELATED_TYPES };