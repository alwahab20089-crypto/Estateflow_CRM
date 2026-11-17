export const WORKFLOW_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export const EXECUTION_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED'] as const;
export const EVENT_STATUSES = ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'] as const;
export const CONDITION_OPERATORS = [
  'EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL',
  'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'IS_EMPTY', 'IS_NOT_EMPTY',
] as const;
export const ACTION_TYPES = [
  'CREATE_TASK', 'ASSIGN_TASK', 'UPDATE_TASK_STATUS', 'CREATE_IN_APP_NOTIFICATION',
  'SEND_EMAIL_NOTIFICATION', 'ASSIGN_LEAD', 'ASSIGN_DEAL',
] as const;

export const TRIGGER_TYPES = [
  'LEAD_CREATED', 'LEAD_STATUS_CHANGED', 'LEAD_ASSIGNED', 'LEAD_CONVERTED',
  'CONTACT_CREATED', 'CONTACT_UPDATED',
  'PROPERTY_CREATED', 'PROPERTY_STATUS_CHANGED', 'PROPERTY_ASSIGNED',
  'DEAL_CREATED', 'DEAL_STAGE_CHANGED', 'DEAL_ASSIGNED', 'DEAL_WON', 'DEAL_LOST',
  'TASK_CREATED', 'TASK_ASSIGNED', 'TASK_COMPLETED', 'TASK_OVERDUE',
  'TASK_DUE_SOON', 'LEAD_WITHOUT_ACTIVITY', 'DEAL_EXPECTED_CLOSING_SOON',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];
export type AutomationEntity = 'LEAD' | 'CONTACT' | 'PROPERTY' | 'DEAL' | 'TASK';

export const TRIGGER_ENTITY: Record<TriggerType, AutomationEntity> = {
  LEAD_CREATED: 'LEAD', LEAD_STATUS_CHANGED: 'LEAD', LEAD_ASSIGNED: 'LEAD', LEAD_CONVERTED: 'LEAD',
  CONTACT_CREATED: 'CONTACT', CONTACT_UPDATED: 'CONTACT',
  PROPERTY_CREATED: 'PROPERTY', PROPERTY_STATUS_CHANGED: 'PROPERTY', PROPERTY_ASSIGNED: 'PROPERTY',
  DEAL_CREATED: 'DEAL', DEAL_STAGE_CHANGED: 'DEAL', DEAL_ASSIGNED: 'DEAL', DEAL_WON: 'DEAL', DEAL_LOST: 'DEAL',
  TASK_CREATED: 'TASK', TASK_ASSIGNED: 'TASK', TASK_COMPLETED: 'TASK', TASK_OVERDUE: 'TASK',
  TASK_DUE_SOON: 'TASK', LEAD_WITHOUT_ACTIVITY: 'LEAD', DEAL_EXPECTED_CLOSING_SOON: 'DEAL',
};

/** Triggers that are produced by the DB-backed scanner rather than by a service call. */
export const TIME_TRIGGERS: readonly TriggerType[] = ['TASK_OVERDUE', 'TASK_DUE_SOON', 'LEAD_WITHOUT_ACTIVITY', 'DEAL_EXPECTED_CLOSING_SOON'];

type FieldType = 'string' | 'number';
/** The ONLY fields a condition may reference. Everything is evaluated against the event payload snapshot. */
export const ENTITY_FIELDS: Record<AutomationEntity, Record<string, FieldType>> = {
  LEAD: { status: 'string', priority: 'string', leadType: 'string', leadSource: 'string', assignedTo: 'string' },
  CONTACT: { status: 'string', contactType: 'string', source: 'string', assignedTo: 'string' },
  PROPERTY: { propertyStatus: 'string', propertyType: 'string', listingType: 'string', assignedTo: 'string', priceAmount: 'number' },
  DEAL: { stage: 'string', dealType: 'string', currency: 'string', assignedTo: 'string', valueAmount: 'number', probability: 'number' },
  TASK: { status: 'string', priority: 'string', taskType: 'string', assignedTo: 'string' },
};
/** Present on changed/assigned events: the previous and new value. */
export const EVENT_FIELDS: Record<string, FieldType> = { from: 'string', to: 'string' };

export const MAX_CONDITIONS = 10; // conditions are a flat list: depth is always 1 (no nesting, no raw queries)
export const MAX_ACTIONS = 5;
export const MAX_WORKFLOWS_PER_ORG = 100;

export const DEFAULT_SETTINGS = { maxAttempts: 3, notifyOnCompletion: false, maxExecutionsPerHour: 100 };
export const withSettingsDefaults = (s?: Partial<typeof DEFAULT_SETTINGS> | null) => ({ ...DEFAULT_SETTINGS, ...(s ?? {}) });