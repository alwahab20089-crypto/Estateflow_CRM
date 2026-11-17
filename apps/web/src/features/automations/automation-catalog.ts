import { humanize } from '@/lib/labels';
import type { ActionDef, ActionType, Condition, ConditionOperator, Entity, Recipient, TriggerType } from '@/types/automations';

export interface TriggerInfo {
  value: TriggerType;
  label: string;
  description: string;
  entity: Entity;
  group: string;
  /** Provides "previous value" / "new value" to conditions. */
  change?: boolean;
  /** The one numeric option this trigger takes. */
  config?: 'withinMinutes' | 'inactiveDays' | 'withinDays';
}

const t = (value: TriggerType, label: string, description: string, entity: Entity, group: string, extra: Partial<TriggerInfo> = {}): TriggerInfo =>
  ({ value, label, description, entity, group, ...extra });

export const TRIGGERS: TriggerInfo[] = [
  t('LEAD_CREATED', 'A lead is created', 'Runs once for every new lead.', 'LEAD', 'Leads'),
  t('LEAD_STATUS_CHANGED', 'A lead changes status', 'Runs each time a lead moves to a new status.', 'LEAD', 'Leads', { change: true }),
  t('LEAD_ASSIGNED', 'A lead is assigned', 'Runs when a lead gets a new owner.', 'LEAD', 'Leads', { change: true }),
  t('LEAD_CONVERTED', 'A lead is converted', 'Runs when a lead is converted to a contact.', 'LEAD', 'Leads'),
  t('CONTACT_CREATED', 'A contact is created', 'Runs for every new contact.', 'CONTACT', 'Contacts'),
  t('CONTACT_UPDATED', 'A contact is updated', 'Runs when a contact is edited.', 'CONTACT', 'Contacts'),
  t('PROPERTY_CREATED', 'A property is created', 'Runs for every new property.', 'PROPERTY', 'Properties'),
  t('PROPERTY_STATUS_CHANGED', 'A property changes status', 'Runs when a property status changes.', 'PROPERTY', 'Properties', { change: true }),
  t('PROPERTY_ASSIGNED', 'A property is assigned', 'Runs when a property gets a new agent.', 'PROPERTY', 'Properties', { change: true }),
  t('DEAL_CREATED', 'A deal is created', 'Runs for every new deal.', 'DEAL', 'Deals'),
  t('DEAL_STAGE_CHANGED', 'A deal changes stage', 'Runs each time a deal moves to a new stage.', 'DEAL', 'Deals', { change: true }),
  t('DEAL_ASSIGNED', 'A deal is assigned', 'Runs when a deal gets a new owner.', 'DEAL', 'Deals', { change: true }),
  t('DEAL_WON', 'A deal is won', 'Runs when a deal is closed as won.', 'DEAL', 'Deals'),
  t('DEAL_LOST', 'A deal is lost', 'Runs when a deal is closed as lost.', 'DEAL', 'Deals'),
  t('TASK_CREATED', 'A task is created', 'Runs for every new task.', 'TASK', 'Tasks'),
  t('TASK_ASSIGNED', 'A task is assigned', 'Runs when a task gets a new assignee.', 'TASK', 'Tasks', { change: true }),
  t('TASK_COMPLETED', 'A task is completed', 'Runs when a task is marked completed.', 'TASK', 'Tasks'),
  t('TASK_OVERDUE', 'A task becomes overdue', 'Runs once when an open task passes its due date (checked within 7 days).', 'TASK', 'Time-based'),
  t('TASK_DUE_SOON', 'A task is due soon', 'Runs once when an open task is within the chosen window of its due date.', 'TASK', 'Time-based', { config: 'withinMinutes' }),
  t('LEAD_WITHOUT_ACTIVITY', 'A lead has no activity', 'Runs once when an open lead has had no activity for the chosen number of days.', 'LEAD', 'Time-based', { config: 'inactiveDays' }),
  t('DEAL_EXPECTED_CLOSING_SOON', 'A deal is expected to close soon', 'Runs once when an open deal\'s expected closing date is within the chosen window.', 'DEAL', 'Time-based', { config: 'withinDays' }),
];
export const TRIGGER_MAP = Object.fromEntries(TRIGGERS.map((x) => [x.value, x])) as Record<TriggerType, TriggerInfo>;
export const TRIGGER_GROUPS = ['Leads', 'Contacts', 'Properties', 'Deals', 'Tasks', 'Time-based'];

export const CONFIG_META = {
  withinMinutes: { label: 'Due within (minutes)', min: 5, max: 10_080, fallback: '60', unit: 'minutes' },
  inactiveDays: { label: 'No activity for (days)', min: 1, max: 90, fallback: '3', unit: 'days' },
  withinDays: { label: 'Closing within (days)', min: 1, max: 60, fallback: '7', unit: 'days' },
} as const;

/* ------------------------------------------------------------------ conditions */
export interface FieldInfo { value: string; label: string; type: 'string' | 'number'; options?: string[]; emptyOnly?: boolean }
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const assignee: FieldInfo = { value: 'assignedTo', label: 'Assignee', type: 'string', emptyOnly: true };
const f = (value: string, label: string, type: 'string' | 'number' = 'string', options?: string[]): FieldInfo => ({ value, label, type, options });

// Mirrors the API allowlist exactly: the server rejects anything else.
export const ENTITY_FIELDS: Record<Entity, FieldInfo[]> = {
  LEAD: [f('status', 'Status'), f('priority', 'Priority', 'string', PRIORITIES), f('leadType', 'Lead type'), f('leadSource', 'Lead source'), assignee],
  CONTACT: [f('status', 'Status'), f('contactType', 'Contact type'), f('source', 'Source'), assignee],
  PROPERTY: [f('propertyStatus', 'Property status'), f('propertyType', 'Property type'), f('listingType', 'Listing type'), f('priceAmount', 'Price (minor units)', 'number'), assignee],
  DEAL: [f('stage', 'Stage'), f('dealType', 'Deal type', 'string', ['SALE', 'RENT', 'LEASE']), f('currency', 'Currency'), f('valueAmount', 'Value (minor units)', 'number'), f('probability', 'Probability (%)', 'number'), assignee],
  TASK: [f('status', 'Status'), f('priority', 'Priority', 'string', PRIORITIES), f('taskType', 'Task type'), assignee],
};
export const fieldsFor = (trigger: TriggerInfo): FieldInfo[] => [
  ...ENTITY_FIELDS[trigger.entity],
  ...(trigger.change ? [f('from', 'Previous value'), f('to', 'New value')] : []),
];

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  EQUALS: 'equals', NOT_EQUALS: 'does not equal', CONTAINS: 'contains', NOT_CONTAINS: 'does not contain',
  GREATER_THAN: 'is greater than', GREATER_THAN_OR_EQUAL: 'is at least', LESS_THAN: 'is less than', LESS_THAN_OR_EQUAL: 'is at most',
  IS_EMPTY: 'is empty', IS_NOT_EMPTY: 'is not empty',
};
export const EMPTY_OPERATORS: ConditionOperator[] = ['IS_EMPTY', 'IS_NOT_EMPTY'];
export const operatorsFor = (field: FieldInfo): ConditionOperator[] =>
  field.emptyOnly ? EMPTY_OPERATORS
  : field.type === 'number' ? ['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'IS_EMPTY', 'IS_NOT_EMPTY']
  : ['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'IS_EMPTY', 'IS_NOT_EMPTY'];

/* ------------------------------------------------------------------ actions */
export interface ActionInfo { value: ActionType; label: string; description: string; entity?: Entity }
export const ACTIONS: ActionInfo[] = [
  { value: 'CREATE_TASK', label: 'Create a task', description: 'Creates a follow-up task linked to the record.' },
  { value: 'ASSIGN_TASK', label: 'Assign the task', description: 'Changes who the triggering task is assigned to.', entity: 'TASK' },
  { value: 'UPDATE_TASK_STATUS', label: 'Update the task status', description: 'Moves the triggering task to another status.', entity: 'TASK' },
  { value: 'CREATE_IN_APP_NOTIFICATION', label: 'Send an in-app notification', description: 'Notifies a team member inside EstateFlow.' },
  { value: 'SEND_EMAIL_NOTIFICATION', label: 'Send an email', description: 'Emails a team member. Needs a configured email provider.' },
  { value: 'ASSIGN_LEAD', label: 'Assign the lead', description: 'Changes who owns the triggering lead.', entity: 'LEAD' },
  { value: 'ASSIGN_DEAL', label: 'Assign the deal', description: 'Changes who owns the triggering (open) deal.', entity: 'DEAL' },
];
export const ACTION_MAP = Object.fromEntries(ACTIONS.map((a) => [a.value, a])) as Record<ActionType, ActionInfo>;
export const actionsFor = (entity: Entity) => ACTIONS.filter((a) => !a.entity || a.entity === entity);
export const TASK_STATUS_OPTIONS = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']; // keep in sync with your task statuses
export const PRIORITY_OPTIONS = PRIORITIES;

/* ------------------------------------------------------------------ human-readable summaries */
type Names = (userId: string) => string;
export function describeRecipient(r: Recipient, name?: Names) {
  if (r.mode === 'ASSIGNEE') return 'the assignee';
  if (r.mode === 'CREATOR') return 'the creator';
  if (r.mode === 'WORKFLOW_OWNER') return 'the automation owner';
  return (r.userId && name?.(r.userId)) || 'the selected member';
}
export function describeTrigger(type: TriggerType, config: Record<string, number | string> = {}) {
  const info = TRIGGER_MAP[type];
  const key = info.config;
  const n = key ? Number(config[key] ?? CONFIG_META[key].fallback) : null;
  return key && n !== null ? `${info.label} (${CONFIG_META[key].label.toLowerCase().replace(/ \(.*/, '')}: ${n} ${CONFIG_META[key].unit})` : info.label;
}
export function describeCondition(c: Condition, trigger: TriggerInfo) {
  const field = fieldsFor(trigger).find((x) => x.value === c.field)?.label ?? humanize(c.field);
  const op = OPERATOR_LABELS[c.operator];
  return EMPTY_OPERATORS.includes(c.operator) ? `${field} ${op}` : `${field} ${op} ${String(c.value)}`;
}
export function describeAction(a: ActionDef, name?: Names) {
  switch (a.type) {
    case 'CREATE_TASK': return `Create task "${a.title}" for ${describeRecipient(a.assignTo, name)}${a.dueInHours !== undefined ? `, due in ${a.dueInHours} hours` : ''}`;
    case 'ASSIGN_TASK': return `Assign the task to ${describeRecipient(a.assignTo, name)}`;
    case 'UPDATE_TASK_STATUS': return `Set the task status to ${humanize(a.status)}`;
    case 'CREATE_IN_APP_NOTIFICATION': return `Notify ${describeRecipient(a.recipient, name)} in the app: "${a.title}"`;
    case 'SEND_EMAIL_NOTIFICATION': return `Email ${describeRecipient(a.recipient, name)}: "${a.subject}"`;
    case 'ASSIGN_LEAD': return `Assign the lead to ${describeRecipient(a.assignTo, name)}`;
    case 'ASSIGN_DEAL': return `Assign the deal to ${describeRecipient(a.assignTo, name)}`;
  }
}