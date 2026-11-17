import { z } from 'zod';
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from '../../constants';
import { objectIdSchema } from '../../utils/object-id';
import {
  CONDITION_OPERATORS, ENTITY_FIELDS, EVENT_FIELDS, EXECUTION_STATUSES, MAX_ACTIONS, MAX_CONDITIONS,
  TRIGGER_ENTITY, TRIGGER_TYPES, WORKFLOW_STATUSES, type TriggerType,
} from './automation.constants';

// No .default() anywhere: defaults live in the service so PATCH can never overwrite by accident.
const text = (max: number) => z.string().trim().min(1).max(max);

const recipient = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ASSIGNEE') }).strict(),
  z.object({ mode: z.literal('CREATOR') }).strict(),
  z.object({ mode: z.literal('WORKFLOW_OWNER') }).strict(),
  z.object({ mode: z.literal('USER'), userId: objectIdSchema }).strict(),
]);
const assignTarget = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('WORKFLOW_OWNER') }).strict(),
  z.object({ mode: z.literal('CREATOR') }).strict(),
  z.object({ mode: z.literal('USER'), userId: objectIdSchema }).strict(),
]);

// Only the actions below exist: no deletion, no financial changes, no arbitrary code.
export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CREATE_TASK'), title: text(200), description: z.string().trim().max(2000).optional(),
    taskType: z.enum(TASK_TYPES).optional(), priority: z.enum(TASK_PRIORITIES).optional(),
    dueInHours: z.number().int().min(0).max(8760).optional(), assignTo: recipient,
  }).strict(),
  z.object({ type: z.literal('ASSIGN_TASK'), assignTo: assignTarget }).strict(),
  z.object({ type: z.literal('UPDATE_TASK_STATUS'), status: z.enum(TASK_STATUSES) }).strict(),
  z.object({ type: z.literal('CREATE_IN_APP_NOTIFICATION'), recipient, title: text(200), message: text(500) }).strict(),
  z.object({ type: z.literal('SEND_EMAIL_NOTIFICATION'), recipient, subject: text(200), body: text(5000) }).strict(),
  z.object({ type: z.literal('ASSIGN_LEAD'), assignTo: assignTarget }).strict(),
  z.object({ type: z.literal('ASSIGN_DEAL'), assignTo: assignTarget }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export type Recipient = z.infer<typeof recipient>;

// A condition value is a primitive. Objects ({ "$gt": 1 }) cannot pass, so raw Mongo operators are impossible.
export const conditionSchema = z.object({
  field: z.string().min(1).max(50),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string().max(200), z.number().finite(), z.boolean()]).nullable().optional(),
}).strict();
export type Condition = z.infer<typeof conditionSchema>;

const settingsSchema = z.object({
  maxAttempts: z.number().int().min(1).max(5).optional(),
  notifyOnCompletion: z.boolean().optional(),
  maxExecutionsPerHour: z.number().int().min(1).max(1000).optional(),
}).strict();

const empty = z.object({}).strict();
const CONFIG_SCHEMAS: Partial<Record<TriggerType, z.ZodType<Record<string, unknown>>>> = {
  TASK_DUE_SOON: z.object({ withinMinutes: z.number().int().min(5).max(10_080).optional() }).strict(),
  LEAD_WITHOUT_ACTIVITY: z.object({ inactiveDays: z.number().int().min(1).max(90).optional() }).strict(),
  DEAL_EXPECTED_CLOSING_SOON: z.object({ withinDays: z.number().int().min(1).max(60).optional() }).strict(),
};
const CONFIG_DEFAULTS: Partial<Record<TriggerType, Record<string, number>>> = {
  TASK_DUE_SOON: { withinMinutes: 60 }, LEAD_WITHOUT_ACTIVITY: { inactiveDays: 3 }, DEAL_EXPECTED_CLOSING_SOON: { withinDays: 7 },
};
export const parseTriggerConfig = (type: TriggerType, config: Record<string, unknown> | undefined) =>
  ({ ...(CONFIG_DEFAULTS[type] ?? {}), ...((CONFIG_SCHEMAS[type] ?? empty).parse(config ?? {})) });

const NUMERIC_OPS = ['GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL'];
const TEXT_OPS = ['CONTAINS', 'NOT_CONTAINS'];
const EMPTY_OPS = ['IS_EMPTY', 'IS_NOT_EMPTY'];
const ACTION_ENTITY = { ASSIGN_LEAD: 'LEAD', ASSIGN_DEAL: 'DEAL', ASSIGN_TASK: 'TASK', UPDATE_TASK_STATUS: 'TASK' } as const;

type Definition = { triggerType: TriggerType; triggerConfig?: Record<string, unknown>; conditions?: Condition[]; actions: Action[] };

function checkDefinition(v: Definition, ctx: z.RefinementCtx) {
  const entity = TRIGGER_ENTITY[v.triggerType];
  const fields = { ...ENTITY_FIELDS[entity], ...EVENT_FIELDS };
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });

  (v.conditions ?? []).forEach((c, i) => {
    const type = Object.prototype.hasOwnProperty.call(fields, c.field) ? fields[c.field] : undefined;
    if (!type) return issue(`Field "${c.field}" is not available for ${v.triggerType}`, ['conditions', i, 'field']);
    if (EMPTY_OPS.includes(c.operator)) return;
    if (c.value === undefined || c.value === null) return issue('A value is required', ['conditions', i, 'value']);
    if (NUMERIC_OPS.includes(c.operator) && (type !== 'number' || typeof c.value !== 'number')) {
      return issue('Comparison operators need a numeric field and a numeric value', ['conditions', i, 'operator']);
    }
    if (TEXT_OPS.includes(c.operator) && (type !== 'string' || typeof c.value !== 'string')) {
      return issue('CONTAINS operators need a text field and a text value', ['conditions', i, 'operator']);
    }
    if (type === 'number' && typeof c.value !== 'number') issue('This field needs a numeric value', ['conditions', i, 'value']);
  });

  const cfg = (CONFIG_SCHEMAS[v.triggerType] ?? empty).safeParse(v.triggerConfig ?? {});
  if (!cfg.success) issue('Invalid trigger configuration for this trigger', ['triggerConfig']);

  v.actions.forEach((a, i) => {
    const needs = ACTION_ENTITY[a.type as keyof typeof ACTION_ENTITY];
    if (needs && needs !== entity) issue(`${a.type} can only be used with ${needs.toLowerCase()} triggers`, ['actions', i, 'type']);
  });
}

const shape = {
  name: text(120),
  description: z.string().trim().max(1000).nullable().optional(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  conditions: z.array(conditionSchema).max(MAX_CONDITIONS).optional(),
  conditionOperator: z.enum(['ALL', 'ANY']).optional(),
  actions: z.array(actionSchema).min(1, 'Add at least one action').max(MAX_ACTIONS),
  executionSettings: settingsSchema.optional(),
};

export const createWorkflowSchema = z.object(shape).superRefine(checkDefinition);
export const updateWorkflowSchema = z.object(shape).partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const testWorkflowSchema = z.object({
  entityId: objectIdSchema.optional(),
  sample: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
}).strict();

export const listWorkflowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(WORKFLOW_STATUSES).optional(),
  triggerType: z.enum(TRIGGER_TYPES).optional(),
}).strict();

export const listExecutionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(EXECUTION_STATUSES).optional(),
}).strict();

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;