import { z } from 'zod';
import { TASK_PRIORITIES, TASK_RELATED_ENTITY_TYPES, TASK_STATUSES, TASK_TYPES } from '../../constants';
import { objectIdSchema } from '../../utils/object-id';
import { isoDate, optionalText } from '../leads/lead.validation';

const boundedDate = isoDate.refine((d) => d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100, 'Date is out of range');
const title = z.string().trim().min(1, 'Title is required').max(200);
const tags = z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).transform((t) => [...new Set(t)]);
const DAY = 86_400_000;

type Dates = { dueAt?: Date | null; reminderAt?: Date | null };
type Link = { relatedEntityType?: string | null; relatedEntityId?: string | null };
const reminderBeforeDue = (v: Dates) => !v.dueAt || !v.reminderAt || v.reminderAt.getTime() <= v.dueAt.getTime();
const linkTogether = (v: Link) => (v.relatedEntityType == null) === (v.relatedEntityId == null);
const linkKeysTogether = (v: Link) => (v.relatedEntityType === undefined) === (v.relatedEntityId === undefined);
const REMINDER_MSG = { message: 'The reminder must not be after the due date', path: ['reminderAt'] };
const LINK_MSG = { message: 'Select both a record type and a record', path: ['relatedEntityId'] };

const fields = {
  description: optionalText(5000),
  taskType: z.enum(TASK_TYPES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: boundedDate.nullable().optional(),
  reminderAt: boundedDate.nullable().optional(),
  relatedEntityType: z.enum(TASK_RELATED_ENTITY_TYPES).nullable().optional(),
  relatedEntityId: objectIdSchema.nullable().optional(),
  tags: tags.optional(),
};

// No .default(): defaults live in the service so PATCH never overwrites by accident.
// Unknown keys (organizationId, createdBy, status, completedAt, reminderStatus...) are stripped.
export const createTaskSchema = z
  .object({ title, ...fields, assignedTo: objectIdSchema.nullable().optional() })
  .refine(linkTogether, LINK_MSG)
  .refine(reminderBeforeDue, REMINDER_MSG);

// Status and assignment have dedicated endpoints.
export const updateTaskSchema = z
  .object({ title: title.optional(), ...fields })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update')
  .refine(linkKeysTogether, LINK_MSG)
  .refine(linkTogether, LINK_MSG)
  .refine(reminderBeforeDue, REMINDER_MSG);

export const taskStatusSchema = z.object({
  status: z.enum(TASK_STATUSES),
  note: z.string().trim().min(1).max(1000).optional(),
});

export const completeTaskSchema = z
  .object({ note: z.string().trim().min(1).max(1000).optional() })
  .optional()
  .transform((v) => v ?? {});

const assigneeFilter = z.union([objectIdSchema, z.literal('unassigned'), z.literal('me')]);

export const listTasksQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    taskType: z.enum(TASK_TYPES).optional(),
    assignedTo: assigneeFilter.optional(),
    dueFrom: isoDate.optional(),
    dueTo: isoDate.optional(),
    overdue: z.literal('true').transform(() => true).optional(),
    relatedEntityType: z.enum(TASK_RELATED_ENTITY_TYPES).optional(),
    relatedEntityId: objectIdSchema.optional(),
    createdFrom: isoDate.optional(),
    createdTo: isoDate.optional(),
    sortBy: z.enum(['createdAt', 'dueAt', 'priority', 'status', 'title']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    view: z.enum(['active', 'archived']).default('active'),
  })
  .strict()
  .refine((v) => !v.relatedEntityId || v.relatedEntityType, { message: 'relatedEntityType is required with relatedEntityId', path: ['relatedEntityType'] });

export const calendarQuerySchema = z
  .object({
    from: boundedDate,
    to: boundedDate,
    assignedTo: assigneeFilter.optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    taskType: z.enum(TASK_TYPES).optional(),
  })
  .strict()
  .refine((v) => v.to.getTime() > v.from.getTime(), { message: '"to" must be after "from"', path: ['to'] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 93 * DAY, { message: 'The range may not exceed 93 days', path: ['to'] });

export const summaryQuerySchema = z
  .object({
    dayStart: boundedDate.optional(), // the client's local day, expressed in UTC
    dayEnd: boundedDate.optional(),
    scope: z.enum(['mine', 'team']).default('mine'),
  })
  .strict()
  .refine((v) => (v.dayStart === undefined) === (v.dayEnd === undefined), { message: 'Provide dayStart and dayEnd together', path: ['dayEnd'] })
  .refine((v) => !v.dayStart || !v.dayEnd || (v.dayEnd.getTime() > v.dayStart.getTime() && v.dayEnd.getTime() - v.dayStart.getTime() <= 2 * DAY), { message: 'Invalid day range', path: ['dayEnd'] });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskStatusInput = z.infer<typeof taskStatusSchema>;
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;