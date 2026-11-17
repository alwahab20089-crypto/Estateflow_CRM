export type Entity = 'LEAD' | 'CONTACT' | 'PROPERTY' | 'DEAL' | 'TASK';
export type TriggerType =
  | 'LEAD_CREATED' | 'LEAD_STATUS_CHANGED' | 'LEAD_ASSIGNED' | 'LEAD_CONVERTED'
  | 'CONTACT_CREATED' | 'CONTACT_UPDATED'
  | 'PROPERTY_CREATED' | 'PROPERTY_STATUS_CHANGED' | 'PROPERTY_ASSIGNED'
  | 'DEAL_CREATED' | 'DEAL_STAGE_CHANGED' | 'DEAL_ASSIGNED' | 'DEAL_WON' | 'DEAL_LOST'
  | 'TASK_CREATED' | 'TASK_ASSIGNED' | 'TASK_COMPLETED' | 'TASK_OVERDUE'
  | 'TASK_DUE_SOON' | 'LEAD_WITHOUT_ACTIVITY' | 'DEAL_EXPECTED_CLOSING_SOON';
export type WorkflowStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PARTIALLY_FAILED' | 'FAILED' | 'CANCELLED';
export type ConditionOperator =
  | 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'NOT_CONTAINS' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL'
  | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL' | 'IS_EMPTY' | 'IS_NOT_EMPTY';
export type ActionType =
  | 'CREATE_TASK' | 'ASSIGN_TASK' | 'UPDATE_TASK_STATUS' | 'CREATE_IN_APP_NOTIFICATION'
  | 'SEND_EMAIL_NOTIFICATION' | 'ASSIGN_LEAD' | 'ASSIGN_DEAL';

export type RecipientMode = 'ASSIGNEE' | 'CREATOR' | 'WORKFLOW_OWNER' | 'USER';
export interface Recipient { mode: RecipientMode; userId?: string }

export interface Condition { field: string; operator: ConditionOperator; value?: string | number | boolean | null }

export type ActionDef =
  | { type: 'CREATE_TASK'; title: string; description?: string; priority?: string; dueInHours?: number; assignTo: Recipient }
  | { type: 'ASSIGN_TASK'; assignTo: Recipient }
  | { type: 'UPDATE_TASK_STATUS'; status: string }
  | { type: 'CREATE_IN_APP_NOTIFICATION'; recipient: Recipient; title: string; message: string }
  | { type: 'SEND_EMAIL_NOTIFICATION'; recipient: Recipient; subject: string; body: string }
  | { type: 'ASSIGN_LEAD'; assignTo: Recipient }
  | { type: 'ASSIGN_DEAL'; assignTo: Recipient };

export interface ExecutionSettings { maxAttempts: number; notifyOnCompletion: boolean; maxExecutionsPerHour: number }

export interface WorkflowDto {
  _id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  version: number;
  triggerType: TriggerType;
  triggerConfig: Record<string, number>;
  conditions: Condition[];
  conditionOperator: 'ALL' | 'ANY';
  actions: ActionDef[];
  executionSettings: ExecutionSettings;
  createdBy: string;
  updatedBy: string | null;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: { total: number; completed: number; failed: number };
}

export interface WorkflowPayload {
  name: string;
  description?: string | null;
  triggerType: TriggerType;
  triggerConfig?: Record<string, number>;
  conditions: Condition[];
  conditionOperator: 'ALL' | 'ANY';
  actions: ActionDef[];
  executionSettings?: { notifyOnCompletion?: boolean };
}

export interface ActionResult {
  index: number;
  type: ActionType;
  status: 'PENDING' | 'SUCCESS' | 'SKIPPED' | 'FAILED';
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  output?: Record<string, unknown> | null;
  reason?: string | null;
  error?: string;
  retryable?: boolean;
}

export interface ExecutionDto {
  _id: string;
  workflowId: string;
  workflowVersion: number;
  triggerEventId: string;
  triggerType: TriggerType;
  status: ExecutionStatus;
  attemptCount: number;
  maxAttempts: number;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  nextRetryAt: string | null;
  errorSummary: string | null;
  actionResults: ActionResult[];
  createdAt: string;
  actions?: ActionDef[];
  payload?: Record<string, unknown>;
}

export interface PagedMeta { page: number; limit: number; total: number; totalPages: number }
export interface PagedResult<T> { data: T[]; meta: PagedMeta }
export interface WorkflowListParams { page: number; limit: number; q?: string; status?: string; triggerType?: string }
export interface ExecutionListParams { page: number; limit: number; status?: string }
export interface TestResult {
  matched: boolean;
  dryRun: true;
  conditions: { field: string; operator: ConditionOperator; value: unknown; passed: boolean }[];
  plannedActions: { index: number; type: ActionType }[];
}

export interface NotificationPreference { type: string; mandatory: boolean; inApp: boolean; email: boolean | null }
export interface PreferenceUpdate { type: string; inApp?: boolean; email?: boolean }