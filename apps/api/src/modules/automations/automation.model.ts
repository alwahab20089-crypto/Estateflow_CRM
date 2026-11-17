import { model, Schema, type InferSchemaType, type Types } from 'mongoose';
import { EVENT_STATUSES, EXECUTION_STATUSES, TRIGGER_TYPES, WORKFLOW_STATUSES } from './automation.constants';

const ref = (to: string, required = false) => ({ type: Schema.Types.ObjectId, ref: to, required });

/* ------------------------------------------------------------------ workflow */
const workflowSchema = new Schema(
  {
    organizationId: ref('Organization', true),
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    status: { type: String, enum: WORKFLOW_STATUSES, default: 'DRAFT' },
    /** Bumped on every definition change; executions record the version (and a snapshot of the actions) they ran. */
    version: { type: Number, default: 1 },
    triggerType: { type: String, enum: TRIGGER_TYPES, required: true },
    triggerConfig: { type: Schema.Types.Mixed, default: {} },
    conditions: { type: [Schema.Types.Mixed], default: [] },
    conditionOperator: { type: String, enum: ['ALL', 'ANY'], default: 'ALL' },
    actions: { type: [Schema.Types.Mixed], default: [] },
    executionSettings: { type: Schema.Types.Mixed, default: {} },
    createdBy: ref('User', true),
    updatedBy: ref('User'),
    lastExecutedAt: { type: Date },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);
workflowSchema.index({ organizationId: 1, deletedAt: 1, status: 1, updatedAt: -1 }); // list
workflowSchema.index({ organizationId: 1, triggerType: 1, status: 1, deletedAt: 1 }); // event matching
workflowSchema.index({ status: 1, triggerType: 1, deletedAt: 1 }); // time-trigger scanner

/* ------------------------------------------------------------------ event */
const eventSchema = new Schema(
  {
    organizationId: ref('Organization', true),
    type: { type: String, enum: TRIGGER_TYPES, required: true },
    entityType: { type: String, required: true },
    entityId: ref('Entity', true),
    /** Set only for time-based events: they target the one workflow whose config produced them. */
    workflowId: { type: Schema.Types.ObjectId, default: null },
    actorId: { type: Schema.Types.ObjectId, default: null },
    payload: { type: Schema.Types.Mixed, default: {} },
    idempotencyKey: { type: String, required: true, maxlength: 250 },
    depth: { type: Number, default: 0 },
    chain: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: EVENT_STATUSES, default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    processedAt: { type: Date },
    lastError: { type: String, maxlength: 500 },
  },
  { timestamps: true, minimize: false },
);
eventSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, name: 'unique_event_key' });
eventSchema.index({ status: 1, nextAttemptAt: 1 }); // claim
eventSchema.index({ status: 1, lockedAt: 1 }); // lease recovery
eventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 30 * 86_400 }); // events are kept 30 days after processing

/* ------------------------------------------------------------------ execution */
const executionSchema = new Schema(
  {
    organizationId: ref('Organization', true),
    workflowId: ref('AutomationWorkflow', true),
    workflowVersion: { type: Number, required: true },
    triggerEventId: ref('AutomationEvent', true),
    triggerType: { type: String, enum: TRIGGER_TYPES, required: true },
    status: { type: String, enum: EXECUTION_STATUSES, default: 'PENDING' },
    /** Snapshots: a retry always runs the version that matched, with the data that matched. */
    actions: { type: [Schema.Types.Mixed], default: [] },
    payload: { type: Schema.Types.Mixed, default: {} },
    actionResults: { type: [Schema.Types.Mixed], default: [] },
    attemptCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    retryCount: { type: Number, default: 0 }, // manual retries
    depth: { type: Number, default: 0 },
    chain: { type: [Schema.Types.ObjectId], default: [] },
    nextRetryAt: { type: Date, default: Date.now },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    startedAt: { type: Date },
    completedAt: { type: Date },
    errorSummary: { type: String, maxlength: 500 },
  },
  { timestamps: true, minimize: false },
);
executionSchema.index({ organizationId: 1, workflowId: 1, triggerEventId: 1 }, { unique: true, name: 'unique_execution_per_event' });
executionSchema.index({ organizationId: 1, workflowId: 1, createdAt: -1 }); // history + hourly rate limit
executionSchema.index({ status: 1, nextRetryAt: 1 }); // claim
executionSchema.index({ status: 1, lockedAt: 1 }); // lease recovery

/* ------------------------------------------------------------------ email delivery tracking */
const emailDeliverySchema = new Schema(
  {
    organizationId: ref('Organization', true),
    userId: ref('User', true), // recipient reference only; the address is not copied
    deliveryKey: { type: String, required: true, maxlength: 200 },
    provider: { type: String, required: true },
    subject: { type: String, maxlength: 200 },
    status: { type: String, enum: ['QUEUED', 'SENT', 'FAILED'], default: 'QUEUED' },
    attempts: { type: Number, default: 0 },
    providerMessageId: { type: String },
    error: { type: String, maxlength: 500, default: null },
    lastAttemptAt: { type: Date },
    sentAt: { type: Date },
  },
  { timestamps: true },
);
emailDeliverySchema.index({ organizationId: 1, deliveryKey: 1 }, { unique: true });

export type WorkflowRecord = InferSchemaType<typeof workflowSchema> & { _id: Types.ObjectId };
export const AutomationWorkflow = model('AutomationWorkflow', workflowSchema);
export const AutomationEvent = model('AutomationEvent', eventSchema);
export const AutomationExecution = model('AutomationExecution', executionSchema);
export const EmailDelivery = model('EmailDelivery', emailDeliverySchema);