
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import { AppError } from '../../utils/app-error';
import { emailEnabled } from '../../utils/email-provider';
import type { RequestMeta } from '../../utils/request-meta';
import { runUnitOfWork } from '../../utils/transaction';
import { recordActivity } from '../activities/activity.service';
import { recordAudit } from '../audit/audit.service';
import { assertActiveMember, type TenantContext } from '../members/member.service';
import { MAX_WORKFLOWS_PER_ORG, TRIGGER_ENTITY, withSettingsDefaults } from './automation.constants';
import { snapshotEntity } from './automation.events';
import { AutomationExecution, AutomationWorkflow } from './automation.model';
import { createWorkflowSchema, parseTriggerConfig, type Action, type CreateWorkflowInput, type UpdateWorkflowInput } from './automation.validation';
import { evaluateConditions, evaluateEach } from './condition.evaluator';

const oid = (v: string) => new Types.ObjectId(v);
const scope = (t: TenantContext) => ({ organizationId: oid(t.organizationId), deletedAt: null });
const notFound = () => AppError.notFound('Automation not found');
const page = (p: number, l: number, total: number) => ({
  page: p,
  limit: l,
  total,
  totalPages: Math.max(1, Math.ceil(total / l)),
});

const toDto = (w: any) => ({
  _id: String(w._id),
  name: w.name,
  description: w.description ?? null,
  status: w.status,
  version: w.version,
  triggerType: w.triggerType,
  triggerConfig: w.triggerConfig ?? {},
  conditions: w.conditions ?? [],
  conditionOperator: w.conditionOperator,
  actions: w.actions ?? [],
  executionSettings: withSettingsDefaults(w.executionSettings),
  createdBy: String(w.createdBy),
  updatedBy: w.updatedBy ? String(w.updatedBy) : null,
  lastExecutedAt: w.lastExecutedAt ?? null,
  createdAt: w.createdAt,
  updatedAt: w.updatedAt,
});

const toExecutionDto = (e: any, full = false) => ({
  _id: String(e._id),
  workflowId: String(e.workflowId),
  workflowVersion: e.workflowVersion,
  triggerEventId: String(e.triggerEventId),
  triggerType: e.triggerType,
  status: e.status,
  attemptCount: e.attemptCount,
  maxAttempts: e.maxAttempts,
  retryCount: e.retryCount ?? 0,
  startedAt: e.startedAt ?? null,
  completedAt: e.completedAt ?? null,
  nextRetryAt: e.nextRetryAt ?? null,
  errorSummary: e.errorSummary ?? null,
  actionResults: e.actionResults ?? [],
  createdAt: e.createdAt,
  ...(full ? { actions: e.actions ?? [], payload: e.payload ?? {} } : {}),
});

/** Every member an action names must be an ACTIVE member of THIS organization. */
async function assertReferencedMembers(t: TenantContext, actions: Action[]) {
  const ids = new Set<string>();

  for (const a of actions as any[]) {
    for (const r of [a.assignTo, a.recipient]) {
      if (r?.mode === 'USER') ids.add(r.userId);
    }
  }

  for (const id of ids) {
    await assertActiveMember(t.organizationId, id);
  }
}

/**
 * Validate that a workflow can be activated.
 * Email actions require both a configured email provider and
 * the advancedNotifications subscription entitlement.
 */
/**
 * Validate that a workflow can be activated.
 * Email actions require a configured email provider.
 */
function assertActivatable(actions: Action[]) {
  const hasEmailAction = actions.some(
    (action) => action.type === 'SEND_EMAIL_NOTIFICATION',
  );

  if (hasEmailAction && !emailEnabled()) {
    throw AppError.conflict(
      'This automation sends email, but no email provider is configured.',
      'EMAIL_PROVIDER_DISABLED',
    );
  }
}

async function find(t: TenantContext, id: string) {
  const w = await AutomationWorkflow.findOne({
    _id: id,
    ...scope(t),
  });

  if (!w) throw notFound();

  return w;
}

const log = (
  t: TenantContext,
  userId: string,
  w: any,
  action: string,
  description: string,
  meta: RequestMeta,
  session: any,
  extra: object = {},
) =>
  Promise.all([
    recordActivity({
      organizationId: t.organizationId,
      userId,
      entityType: 'AUTOMATION',
      entityId: w._id,
      activityType: action === 'automation.created' ? 'CREATED' : 'UPDATE',
      description,
    } as any, session),

    recordAudit({
      organizationId: t.organizationId,
      actorId: userId,
      action,
      resource: 'automation',
      resourceId: w._id,
      after: {
        name: w.name,
        status: w.status,
        triggerType: w.triggerType,
        version: w.version,
        ...extra,
      },
      meta,
    } as any, session),
  ]);

/* ------------------------------------------------------------------ CRUD */

export async function createWorkflow(
  t: TenantContext,
  userId: string,
  input: CreateWorkflowInput,
  meta: RequestMeta,
) {
  if (
    (await AutomationWorkflow.countDocuments(scope(t))) >=
    MAX_WORKFLOWS_PER_ORG
  ) {
    throw AppError.conflict(
      'Automation limit reached for this organization.',
      'AUTOMATION_LIMIT',
    );
  }

  await assertReferencedMembers(t, input.actions);

  const doc = {
    organizationId: t.organizationId,
    name: input.name,
    description: input.description ?? undefined,
    status: 'DRAFT' as const,
    version: 1,
    triggerType: input.triggerType,
    triggerConfig: parseTriggerConfig(input.triggerType, input.triggerConfig),
    conditions: input.conditions ?? [],
    conditionOperator: input.conditionOperator ?? 'ALL',
    actions: input.actions,
    executionSettings: withSettingsDefaults(input.executionSettings),
    createdBy: userId,
    updatedBy: userId,
  };

  const w = await runUnitOfWork(async (uow) => {
    const [c] = await AutomationWorkflow.create(
      [doc],
      { session: uow.session },
    );

    uow.onRollback(() =>
      AutomationWorkflow.deleteOne({ _id: c!._id }),
    );

    await log(
      t,
      userId,
      c,
      'automation.created',
      `Automation "${c!.name}" created`,
      meta,
      uow.session,
    );

    return c!;
  });

  return toDto(w);
}

export async function listWorkflows(
  t: TenantContext,
  q: {
    page: number;
    limit: number;
    status?: string;
    triggerType?: string;
  },
) {
  const filter: any = {
    ...scope(t),
    ...(q.status ? { status: q.status } : {}),
    ...(q.triggerType ? { triggerType: q.triggerType } : {}),
  };

  const [items, total] = await Promise.all([
    AutomationWorkflow.find(filter)
      .sort({ updatedAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),

    AutomationWorkflow.countDocuments(filter),
  ]);

  return {
    items: items.map(toDto),
    meta: page(q.page, q.limit, total),
  };
}

export async function getWorkflow(t: TenantContext, id: string) {
  return toDto(await find(t, id));
}

export async function updateWorkflow(
  t: TenantContext,
  userId: string,
  id: string,
  patch: UpdateWorkflowInput,
  meta: RequestMeta,
) {
  const w: any = await find(t, id);

  const triggerChanged =
    patch.triggerType !== undefined &&
    patch.triggerType !== w.triggerType;

  const merged = createWorkflowSchema.parse({
    // Re-validate the WHOLE definition, not just the patch.
    name: patch.name ?? w.name,
    description: patch.description === undefined
      ? w.description
      : patch.description,
    triggerType: patch.triggerType ?? w.triggerType,
    triggerConfig: patch.triggerConfig ?? (
      triggerChanged ? {} : w.triggerConfig
    ),
    conditions: patch.conditions ?? w.conditions,
    conditionOperator: patch.conditionOperator ?? w.conditionOperator,
    actions: patch.actions ?? w.actions,
    executionSettings: {
      ...(w.executionSettings ?? {}),
      ...(patch.executionSettings ?? {}),
    },
  });

  await assertReferencedMembers(t, merged.actions);

  // An active workflow must keep satisfying the activation requirements.
  if (w.status === 'ACTIVE') {
    assertActivatable(merged.actions);
  }

  const definitionChanged = [
    'triggerType',
    'triggerConfig',
    'conditions',
    'conditionOperator',
    'actions',
    'executionSettings',
  ].some((k) => (patch as any)[k] !== undefined);

  const set = {
    name: merged.name,
    description: merged.description ?? undefined,
    triggerType: merged.triggerType,
    triggerConfig: parseTriggerConfig(
      merged.triggerType,
      merged.triggerConfig,
    ),
    conditions: merged.conditions ?? [],
    conditionOperator: merged.conditionOperator ?? 'ALL',
    actions: merged.actions,
    executionSettings: withSettingsDefaults(merged.executionSettings),
    updatedBy: userId,
    version: w.version + (definitionChanged ? 1 : 0),
  };

  const updated = await runUnitOfWork(async (uow) => {
    // Compare-and-set on version: two concurrent edits cannot silently overwrite each other.
    const u = await AutomationWorkflow.findOneAndUpdate(
      {
        _id: w._id,
        ...scope(t),
        version: w.version,
      },
      { $set: set },
      {
        returnDocument: 'after',
        session: uow.session,
      },
    );

    if (!u) {
      throw AppError.conflict(
        'This automation was changed by someone else. Reload and try again.',
        'AUTOMATION_STALE',
      );
    }

    await log(
      t,
      userId,
      u,
      'automation.updated',
      `Automation "${u.name}" updated`,
      meta,
      uow.session,
    );

    return u;
  });

  return toDto(updated);
}

async function cancelPending(
  t: TenantContext,
  workflowId: Types.ObjectId,
  reason: string,
) {
  await AutomationExecution.updateMany(
    {
      organizationId: oid(t.organizationId),
      workflowId,
      status: 'PENDING',
    },
    {
      $set: {
        status: 'CANCELLED',
        completedAt: new Date(),
        errorSummary: reason,
      },
    },
  );
}

export async function removeWorkflow(
  t: TenantContext,
  userId: string,
  id: string,
  meta: RequestMeta,
) {
  const w: any = await find(t, id);

  await runUnitOfWork(async (uow) => {
    await AutomationWorkflow.updateOne(
      { _id: w._id, ...scope(t) },
      {
        $set: {
          status: 'ARCHIVED',
          deletedAt: new Date(),
          updatedBy: userId,
        },
      },
      { session: uow.session },
    );

    await log(
      t,
      userId,
      { ...w.toObject(), status: 'ARCHIVED' },
      'automation.deleted',
      `Automation "${w.name}" deleted`,
      meta,
      uow.session,
    );
  });

  await cancelPending(t, w._id, 'Automation deleted');
}

export async function activateWorkflow(
  t: TenantContext,
  userId: string,
  id: string,
  meta: RequestMeta,
) {
  const w: any = await find(t, id);

  if (w.status === 'ACTIVE') {
    return toDto(w);
  }

  await assertReferencedMembers(t, w.actions);

  // Check the email provider configuration before activation.
  assertActivatable(w.actions);
  const u: any = await AutomationWorkflow.findOneAndUpdate(
    {
      _id: w._id,
      ...scope(t),
      status: { $in: ['DRAFT', 'PAUSED'] },
    },
    {
      $set: {
        status: 'ACTIVE',
        updatedBy: userId,
      },
    },
    { returnDocument: 'after' },
  );

  if (!u) {
    throw AppError.conflict(
      'Automation cannot be activated from its current state.',
      'AUTOMATION_STATE',
    );
  }

  await Promise.all([
    log(
      t,
      userId,
      u,
      'automation.activated',
      `Automation "${u.name}" activated`,
      meta,
      undefined,
    ),
  ]);

  return toDto(u);
}

export async function pauseWorkflow(
  t: TenantContext,
  userId: string,
  id: string,
  meta: RequestMeta,
) {
  const w: any = await find(t, id);

  if (w.status === 'PAUSED') {
    return toDto(w);
  }

  const u: any = await AutomationWorkflow.findOneAndUpdate(
    {
      _id: w._id,
      ...scope(t),
      status: 'ACTIVE',
    },
    {
      $set: {
        status: 'PAUSED',
        updatedBy: userId,
      },
    },
    { returnDocument: 'after' },
  );

  if (!u) {
    throw AppError.conflict(
      'Only active automations can be paused.',
      'AUTOMATION_STATE',
    );
  }

  await cancelPending(t, w._id, 'Automation paused');

  await log(
    t,
    userId,
    u,
    'automation.paused',
    `Automation "${u.name}" paused`,
    meta,
    undefined,
  );

  return toDto(u);
}

/**
 * Dry run: evaluates the conditions against a real record (tenant-scoped) or a sample and reports the actions that
 * WOULD run. Nothing is executed, created or sent.
 */
export async function testWorkflow(
  t: TenantContext,
  id: string,
  input: {
    entityId?: string;
    sample?: Record<string, unknown>;
  },
) {
  const w: any = await find(t, id);

  let payload: Record<string, unknown> = {
    ...(input.sample ?? {}),
  };

  if (input.entityId) {
    const snap = await snapshotEntity(
      TRIGGER_ENTITY[w.triggerType as keyof typeof TRIGGER_ENTITY],
      oid(t.organizationId),
      oid(input.entityId),
    );

    if (!snap) {
      throw AppError.notFound('Record not found');
    }

    payload = {
      ...snap,
      ...payload,
    };
  }

  return {
    matched: evaluateConditions(
      w.conditions,
      w.conditionOperator,
      payload,
    ),
    conditions: evaluateEach(w.conditions ?? [], payload),
    plannedActions: (w.actions as any[]).map((a, i) => ({
      index: i,
      type: a.type,
    })),
    dryRun: true,
  };
}

/* ------------------------------------------------------------------ executions */

export async function listExecutions(
  t: TenantContext,
  workflowId: string,
  q: {
    page: number;
    limit: number;
    status?: string;
  },
) {
  const w: any = await find(t, workflowId);

  const filter: any = {
    organizationId: oid(t.organizationId),
    workflowId: w._id,
    ...(q.status ? { status: q.status } : {}),
  };

  const [items, total] = await Promise.all([
    AutomationExecution.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .select('-actions -payload')
      .lean(),

    AutomationExecution.countDocuments(filter),
  ]);

  return {
    items: items.map((e) => toExecutionDto(e)),
    meta: page(q.page, q.limit, total),
  };
}

async function findExecution(
  t: TenantContext,
  workflowId: string,
  executionId: string,
) {
  const w: any = await find(t, workflowId);

  const e = await AutomationExecution.findOne({
    _id: executionId,
    workflowId: w._id,
    organizationId: oid(t.organizationId),
  }).lean();

  if (!e) {
    throw AppError.notFound('Execution not found');
  }

  return e;
}

export async function getExecution(
  t: TenantContext,
  workflowId: string,
  executionId: string,
) {
  return toExecutionDto(
    await findExecution(t, workflowId, executionId),
    true,
  );
}

/** Manual retry: atomic FAILED/PARTIALLY_FAILED -> PENDING. Actions that already succeeded are NOT repeated. */
export async function retryExecution(
  t: TenantContext,
  userId: string,
  workflowId: string,
  executionId: string,
  meta: RequestMeta,
) {
  const e: any = await findExecution(t, workflowId, executionId);

  const r: any = await AutomationExecution.findOneAndUpdate(
    {
      _id: e._id,
      organizationId: e.organizationId,
      status: { $in: ['FAILED', 'PARTIALLY_FAILED'] },
    },
    {
      $set: {
        status: 'PENDING',
        nextRetryAt: new Date(),
        attemptCount: 0,
        lockedAt: null,
        lockedBy: null,
      },
      $inc: {
        retryCount: 1,
      },
      $unset: {
        completedAt: 1,
        errorSummary: 1,
      },
    },
    { returnDocument: 'after' },
  ).lean();

  if (!r) {
    throw AppError.conflict(
      'Only failed executions can be retried.',
      'EXECUTION_NOT_RETRYABLE',
    );
  }

  await recordAudit({
    organizationId: t.organizationId,
    actorId: userId,
    action: 'automation.execution_retried',
    resource: 'automation',
    resourceId: e.workflowId,
    after: {
      executionId: String(e._id),
      retryCount: r.retryCount,
    },
    meta,
  } as any);

  return toExecutionDto(r);
}
