import { z } from 'zod';
import type { ActionDef, ActionType, Condition, ConditionOperator, Recipient, RecipientMode, TriggerType, WorkflowDto, WorkflowPayload } from '@/types/automations';
import { ACTION_MAP, CONFIG_META, EMPTY_OPERATORS, TRIGGER_MAP, fieldsFor, operatorsFor } from './automation-catalog';

export interface TargetForm { mode: RecipientMode | ''; userId: string }
export interface ActionForm {
  type: ActionType;
  title: string; description: string; priority: string; dueInHours: string;
  target: TargetForm;
  status: string; message: string; subject: string; body: string;
}
export interface FormValues {
  name: string;
  description: string;
  triggerType: TriggerType | '';
  triggerConfig: { withinMinutes: string; inactiveDays: string; withinDays: string };
  conditionOperator: 'ALL' | 'ANY';
  conditions: { field: string; operator: ConditionOperator | ''; value: string }[];
  actions: ActionForm[];
  notifyOnCompletion: boolean;
}

export const newAction = (type: ActionType): ActionForm => ({
  type, title: '', description: '', priority: 'MEDIUM', dueInHours: '',
  target: { mode: type === 'CREATE_TASK' || type === 'CREATE_IN_APP_NOTIFICATION' || type === 'SEND_EMAIL_NOTIFICATION' ? 'ASSIGNEE' : 'USER', userId: '' },
  status: 'COMPLETED', message: '', subject: '', body: '',
});
export const defaultValues = (): FormValues => ({
  name: '', description: '', triggerType: '',
  triggerConfig: { withinMinutes: '', inactiveDays: '', withinDays: '' },
  conditionOperator: 'ALL', conditions: [], actions: [], notifyOnCompletion: false,
});

const text = (max: number) => z.string().max(max);
const formSchemaBase = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Keep the name under 120 characters'),
  description: text(1000),
  triggerType: z.string().min(1, 'Choose a trigger'),
  triggerConfig: z.object({ withinMinutes: z.string(), inactiveDays: z.string(), withinDays: z.string() }),
  conditionOperator: z.enum(['ALL', 'ANY']),
  conditions: z.array(z.object({ field: z.string(), operator: z.string(), value: text(200) })).max(10, 'At most 10 conditions'),
  actions: z.array(z.object({
    type: z.string(), title: text(200), description: text(2000), priority: z.string(), dueInHours: z.string(),
    target: z.object({ mode: z.string(), userId: z.string() }),
    status: z.string(), message: text(500), subject: text(200), body: text(5000),
  })).min(1, 'Add at least one action').max(5, 'At most 5 actions'),
  notifyOnCompletion: z.boolean(),
});

export const formSchema = formSchemaBase.superRefine((v, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const trigger = TRIGGER_MAP[v.triggerType as TriggerType];
  if (!trigger) return;
  const fields = fieldsFor(trigger);

  if (trigger.config) {
    const meta = CONFIG_META[trigger.config];
    const raw = v.triggerConfig[trigger.config].trim();
    const n = Number(raw || meta.fallback);
    if (!Number.isInteger(n) || n < meta.min || n > meta.max) issue(['triggerConfig', trigger.config], `Enter a whole number from ${meta.min} to ${meta.max}`);
  }

  v.conditions.forEach((c, i) => {
    const field = fields.find((x) => x.value === c.field);
    if (!field) return issue(['conditions', i, 'field'], 'Choose a field');
    if (!operatorsFor(field).includes(c.operator as ConditionOperator)) return issue(['conditions', i, 'operator'], 'Choose an operator');
    if (EMPTY_OPERATORS.includes(c.operator as ConditionOperator)) return;
    if (!c.value.trim()) return issue(['conditions', i, 'value'], 'Enter a value');
    if (field.type === 'number' && !Number.isFinite(Number(c.value))) issue(['conditions', i, 'value'], 'Enter a number');
  });

  v.actions.forEach((a, i) => {
    const info = ACTION_MAP[a.type as ActionType];
    const need = (key: string, ok: boolean, message: string) => !ok && issue(['actions', i, key], message);
    if (!info) return issue(['actions', i, 'type'], 'Unknown action');
    if (info.entity && info.entity !== trigger.entity) issue(['actions', i, 'type'], `${info.label} only works with ${info.entity.toLowerCase()} triggers`);
    const targetOk = Boolean(a.target.mode) && (a.target.mode !== 'USER' || Boolean(a.target.userId));
    const t = a.type as ActionType;
    if (t === 'CREATE_TASK') {
      need('title', a.title.trim().length > 0, 'Task title is required');
      const h = a.dueInHours.trim();
      need('dueInHours', h === '' || (Number.isInteger(Number(h)) && Number(h) >= 0 && Number(h) <= 8760), 'Enter whole hours from 0 to 8760');
    }
    if (t === 'UPDATE_TASK_STATUS') need('status', Boolean(a.status), 'Choose a status');
    if (t === 'CREATE_IN_APP_NOTIFICATION') { need('title', a.title.trim().length > 0, 'Title is required'); need('message', a.message.trim().length > 0, 'Message is required'); }
    if (t === 'SEND_EMAIL_NOTIFICATION') { need('subject', a.subject.trim().length > 0, 'Subject is required'); need('body', a.body.trim().length > 0, 'Email body is required'); }
    if (t !== 'UPDATE_TASK_STATUS') need('target', targetOk, a.target.mode === 'USER' ? 'Choose a team member' : 'Choose who this is for');
  });
});

/* ------------------------------------------------------------------ form <-> API */
const recipient = (t: TargetForm): Recipient => (t.mode === 'USER' ? { mode: 'USER', userId: t.userId } : { mode: t.mode as Exclude<RecipientMode, 'USER'> });

export function toPayload(v: FormValues): WorkflowPayload {
  const trigger = TRIGGER_MAP[v.triggerType as TriggerType];
  const fields = fieldsFor(trigger);
  const conditions: Condition[] = v.conditions.map((c) => {
    const op = c.operator as ConditionOperator;
    if (EMPTY_OPERATORS.includes(op)) return { field: c.field, operator: op };
    const isNumber = fields.find((x) => x.value === c.field)?.type === 'number';
    return { field: c.field, operator: op, value: isNumber ? Number(c.value) : c.value.trim() };
  });
  const actions: ActionDef[] = v.actions.map((a): ActionDef => {
    switch (a.type) {
      case 'CREATE_TASK': return {
        type: 'CREATE_TASK', title: a.title.trim(), priority: a.priority || undefined,
        ...(a.description.trim() ? { description: a.description.trim() } : {}),
        ...(a.dueInHours.trim() !== '' ? { dueInHours: Number(a.dueInHours) } : {}), assignTo: recipient(a.target),
      };
      case 'ASSIGN_TASK': return { type: 'ASSIGN_TASK', assignTo: recipient(a.target) };
      case 'UPDATE_TASK_STATUS': return { type: 'UPDATE_TASK_STATUS', status: a.status };
      case 'CREATE_IN_APP_NOTIFICATION': return { type: 'CREATE_IN_APP_NOTIFICATION', recipient: recipient(a.target), title: a.title.trim(), message: a.message.trim() };
      case 'SEND_EMAIL_NOTIFICATION': return { type: 'SEND_EMAIL_NOTIFICATION', recipient: recipient(a.target), subject: a.subject.trim(), body: a.body.trim() };
      case 'ASSIGN_LEAD': return { type: 'ASSIGN_LEAD', assignTo: recipient(a.target) };
      default: return { type: 'ASSIGN_DEAL', assignTo: recipient(a.target) };
    }
  });
  const key = trigger.config;
  return {
    name: v.name.trim(),
    description: v.description.trim() || null,
    triggerType: trigger.value,
    ...(key ? { triggerConfig: { [key]: Number(v.triggerConfig[key].trim() || CONFIG_META[key].fallback) } } : { triggerConfig: {} }),
    conditions, conditionOperator: v.conditionOperator, actions,
    executionSettings: { notifyOnCompletion: v.notifyOnCompletion },
  };
}

export function workflowToForm(w: WorkflowDto): FormValues {
  const base = defaultValues();
  const cfg = w.triggerConfig ?? {};
  return {
    ...base,
    name: w.name, description: w.description ?? '', triggerType: w.triggerType,
    triggerConfig: { withinMinutes: String(cfg.withinMinutes ?? ''), inactiveDays: String(cfg.inactiveDays ?? ''), withinDays: String(cfg.withinDays ?? '') },
    conditionOperator: w.conditionOperator,
    conditions: w.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value === undefined || c.value === null ? '' : String(c.value) })),
    actions: w.actions.map((a) => {
      const f = newAction(a.type);
      const r = 'assignTo' in a ? a.assignTo : 'recipient' in a ? a.recipient : null;
      const target: TargetForm = r ? { mode: r.mode, userId: r.userId ?? '' } : f.target;
      switch (a.type) {
        case 'CREATE_TASK': return { ...f, target, title: a.title, description: a.description ?? '', priority: a.priority ?? 'MEDIUM', dueInHours: a.dueInHours === undefined ? '' : String(a.dueInHours) };
        case 'UPDATE_TASK_STATUS': return { ...f, status: a.status };
        case 'CREATE_IN_APP_NOTIFICATION': return { ...f, target, title: a.title, message: a.message };
        case 'SEND_EMAIL_NOTIFICATION': return { ...f, target, subject: a.subject, body: a.body };
        default: return { ...f, target };
      }
    }),
    notifyOnCompletion: w.executionSettings?.notifyOnCompletion ?? false,
  };
}