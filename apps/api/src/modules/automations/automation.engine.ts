
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { recordActivity } from '../activities/activity.service';
import { recordAudit } from '../audit/audit.service';
import { createNotification } from '../notifications/notification.service';
import { withSettingsDefaults } from './automation.constants';
import { runAction } from './automation.actions';
import { automationContext } from './automation.context';
import { AutomationEvent, AutomationExecution, AutomationWorkflow } from './automation.model';
import { scanTimeTriggers } from './automation.scanner';
import { evaluateConditions } from './condition.evaluator';
import { hasFeature } from '../licensing/entitlements.service';

/** Same shape as the Phase 7 reminder worker id. */
const workerId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const MAX_EVENT_ATTEMPTS = 5;

const backoffMs = (attempts: number) =>
    Math.min(2 ** attempts, 30) * 60_000;

const clip = (s: string, n = 500) =>
    s.length > n ? `${s.slice(0, n - 1)}…` : s;

export interface AutomationOptions {
    batchSize?: number;
    leaseMs?: number;
}

export interface AutomationCycleResult {
    scanned: number;
    events: number;
    created: number;
    executions: number;
}

class LeaseLost extends Error { }

/* ------------------------------------------------------------------ built-in notifications */

/** Notifications that exist regardless of workflows. Deduplicated per event+recipient through deliveryKey. */
function builtinNotifications(ev: any): {
    to: string;
    type: any;
    title: string;
    message: string;
}[] {
    const p = ev.payload ?? {};
    const actor = ev.actorId ? String(ev.actorId) : null;
    const name = String(p.name ?? 'a record');

    const uniq = (ids: (string | null | undefined)[]) =>
        [...new Set(ids.filter((x): x is string => Boolean(x) && x !== actor))];

    switch (ev.type) {
        case 'LEAD_ASSIGNED':
            return uniq([p.to]).map((to) => ({
                to,
                type: 'LEAD_ASSIGNED',
                title: `Lead assigned: ${name}`,
                message: 'A lead was assigned to you.',
            }));

        case 'DEAL_ASSIGNED':
            return uniq([p.to]).map((to) => ({
                to,
                type: 'DEAL_ASSIGNED',
                title: `Deal assigned: ${name}`,
                message: 'A deal was assigned to you.',
            }));

        case 'DEAL_WON':
            return uniq([p.assignedTo, p.createdBy]).map((to) => ({
                to,
                type: 'DEAL_WON',
                title: `Deal won: ${name}`,
                message: 'A deal was closed as won.',
            }));

        case 'DEAL_LOST':
            return uniq([p.assignedTo, p.createdBy]).map((to) => ({
                to,
                type: 'DEAL_LOST',
                title: `Deal lost: ${name}`,
                message: 'A deal was closed as lost.',
            }));

        case 'PROPERTY_STATUS_CHANGED':
            return uniq([p.assignedTo]).map((to) => ({
                to,
                type: 'PROPERTY_STATUS_CHANGED',
                title: `Property status changed: ${name}`,
                message: `Status changed to ${p.to ?? 'a new status'}.`,
            }));

        case 'TASK_DUE_SOON':
            return uniq([p.assignedTo]).map((to) => ({
                to,
                type: 'TASK_DUE_SOON',
                title: `Task due soon: ${name}`,
                message: 'A task assigned to you is due soon.',
            }));

        default:
            return []; // TASK_ASSIGNED / TASK_COMPLETED / TASK_OVERDUE are already notified by Phase 7
    }
}

/* ------------------------------------------------------------------ events -> executions */

const claimEvent = (now: Date, leaseMs: number) =>
    AutomationEvent.findOneAndUpdate(
        {
            $or: [
                { status: 'PENDING', nextAttemptAt: { $lte: now } },
                {
                    status: 'PROCESSING',
                    lockedAt: { $lt: new Date(now.getTime() - leaseMs) },
                },
            ],
        },
        {
            $set: {
                status: 'PROCESSING',
                lockedAt: now,
                lockedBy: workerId,
            },
            $inc: { attempts: 1 },
        },
        {
            sort: { nextAttemptAt: 1 },
            returnDocument: 'after',
        },
    ).lean<any>();

async function handleEvent(ev: any): Promise<number> {
    for (const n of builtinNotifications(ev)) {
        const type = n.type as string;

        await createNotification({
            organizationId: ev.organizationId,
            recipientUserId: n.to,
            type: type as any,
            title: n.title,
            message: n.message,
            relatedEntityType: ['LEAD', 'DEAL', 'PROPERTY', 'CONTACT'].includes(ev.entityType)
                ? ev.entityType
                : null,
            relatedEntityId: ev.entityId,
            deliveryKey: `evt:${ev._id}:${type}:${n.to}`,
        });
    }

        // Without the "automations" license feature (no license, expired, or an edition that excludes it) nothing runs.
    // Events that arrive in that period are consumed without creating executions.
    const licensed = await hasFeature(String(ev.organizationId), 'automations');
    const workflows: any[] = licensed
        ? await AutomationWorkflow.find({
            organizationId: ev.organizationId,
            status: 'ACTIVE',
            triggerType: ev.type,
            deletedAt: null,
            ...(ev.workflowId ? { _id: ev.workflowId } : {}),
        })
            .limit(200)
            .lean()
        : [];

    let created = 0;

    for (const wf of workflows) {
        if ((ev.chain ?? []).some((c: any) => String(c) === String(wf._id))) {
            continue; // loop prevention
        }

        if (!evaluateConditions(
            wf.conditions,
            wf.conditionOperator,
            ev.payload ?? {},
        )) {
            continue;
        }

        const settings = withSettingsDefaults(wf.executionSettings);

        const recent = await AutomationExecution.countDocuments({
            organizationId: ev.organizationId,
            workflowId: wf._id,
            createdAt: {
                $gte: new Date(Date.now() - 3_600_000),
            },
        });

        if (recent >= settings.maxExecutionsPerHour) {
            logger.warn(
                { workflowId: String(wf._id) },
                'automation hourly execution limit reached; event skipped',
            );
            continue;
        }



        // Unique (workflow, event): re-handling an event after a crash cannot create a second execution.
        const res = await AutomationExecution.updateOne(
            {
                organizationId: ev.organizationId,
                workflowId: wf._id,
                triggerEventId: ev._id,
            },
            {
                $setOnInsert: {
                    workflowVersion: wf.version,
                    triggerType: ev.type,
                    status: 'PENDING',
                    actions: wf.actions,
                    payload: ev.payload,
                    actionResults: wf.actions.map((a: any, i: number) => ({
                        index: i,
                        type: a.type,
                        status: 'PENDING',
                        attempts: 0,
                    })),
                    attemptCount: 0,
                    maxAttempts: settings.maxAttempts,
                    retryCount: 0,
                    depth: ev.depth ?? 0,
                    chain: [...(ev.chain ?? []), wf._id],
                    nextRetryAt: new Date(),
                },
            },
            { upsert: true },
        );

        if (res.upsertedCount) {
            created += 1;
        }
    }

    return created;
}

async function processEvents(now: Date, batch: number, leaseMs: number) {
    let events = 0;
    let created = 0;

    for (let i = 0; i < batch; i += 1) {
        const ev = await claimEvent(now, leaseMs);

        if (!ev) break;

        events += 1;

        const fence = {
            _id: ev._id,
            status: 'PROCESSING' as const,
            lockedBy: workerId,
        };

        try {
            if (ev.attempts > MAX_EVENT_ATTEMPTS) {
                throw new Error('Event attempt limit reached');
            }

            created += await handleEvent(ev);

            await AutomationEvent.updateOne(fence, {
                $set: {
                    status: 'PROCESSED',
                    processedAt: new Date(),
                    lockedAt: null,
                    lockedBy: null,
                },
            });
        } catch (err) {
            const message = clip(
                err instanceof Error ? err.message : 'event failed',
            );

            logger.error(
                { err, eventId: String(ev._id) },
                'automation event failed',
            );

            const dead = ev.attempts >= MAX_EVENT_ATTEMPTS;

            await AutomationEvent.updateOne(fence, {
                $set: dead
                    ? {
                        status: 'FAILED',
                        processedAt: new Date(),
                        lastError: message,
                        lockedAt: null,
                        lockedBy: null,
                    }
                    : {
                        status: 'PENDING',
                        nextAttemptAt: new Date(
                            Date.now() + backoffMs(ev.attempts),
                        ),
                        lastError: message,
                        lockedAt: null,
                        lockedBy: null,
                    },
            });
        }
    }

    return { events, created };
}

/* ------------------------------------------------------------------ executions */

const claimExecution = (now: Date, leaseMs: number) =>
    AutomationExecution.findOneAndUpdate(
        {
            $or: [
                { status: 'PENDING', nextRetryAt: { $lte: now } },
                {
                    status: 'RUNNING',
                    lockedAt: { $lt: new Date(now.getTime() - leaseMs) },
                },
            ],
        },
        {
            $set: {
                status: 'RUNNING',
                lockedAt: now,
                lockedBy: workerId,
            },
            $inc: { attemptCount: 1 },
            $min: { startedAt: now },
        },
        {
            sort: { nextRetryAt: 1 },
            returnDocument: 'after',
        },
    ).lean<any>();

const retryable = (err: unknown) => {
    const code = Number(
        (err as any)?.statusCode ?? (err as any)?.status ?? 500,
    );

    return !(code >= 400 && code < 500);
};

async function runExecution(exec: any) {
    const save = async (update: Record<string, unknown>) => {
        // Fenced write: a worker whose lease was taken over can never overwrite the new owner's state.
        const r = await AutomationExecution.updateOne(
            {
                _id: exec._id,
                status: 'RUNNING',
                lockedBy: workerId,
            },
            update,
        );

        if (!r.matchedCount) throw new LeaseLost();
    };

    const wf: any = await AutomationWorkflow.findOne({
        _id: exec.workflowId,
        organizationId: exec.organizationId,
    }).lean();

    if (!wf || wf.deletedAt || wf.status === 'ARCHIVED') {
        await save({
            $set: {
                status: 'CANCELLED',
                completedAt: new Date(),
                errorSummary: 'Automation no longer exists',
                lockedAt: null,
                lockedBy: null,
            },
        });

        return;
    }

    const results: any[] = exec.actionResults ?? [];
    const exhausted = exec.attemptCount > exec.maxAttempts;

    if (!exhausted) {
        for (const [i, action] of (exec.actions as any[]).entries()) {
            const prev = results[i];

            if (prev && (
                prev.status === 'SUCCESS' ||
                prev.status === 'SKIPPED'
            )) {
                continue; // never repeat finished actions
            }

            const startedAt = new Date();
            let result: any;

            try {
                const out = await automationContext.run(
                    {
                        depth: exec.depth ?? 0,
                        chain: (exec.chain ?? []).map(String),
                        executionId: String(exec._id),
                    },
                    () => runAction(
                        {
                            organizationId: exec.organizationId,
                            workflow: wf,
                            executionId: String(exec._id),
                            index: i,
                            payload: exec.payload ?? {},
                        },
                        action,
                    ),
                );

                result = {
                    index: i,
                    type: action.type,
                    status: out.status,
                    attempts: (prev?.attempts ?? 0) + 1,
                    startedAt,
                    completedAt: new Date(),
                    output: out.output ?? null,
                    reason: out.reason ?? null,
                };
            } catch (err) {
                result = {
                    index: i,
                    type: action.type,
                    status: 'FAILED',
                    attempts: (prev?.attempts ?? 0) + 1,
                    startedAt,
                    completedAt: new Date(),
                    error: clip(
                        err instanceof Error ? err.message : 'Action failed',
                        300,
                    ),
                    retryable: retryable(err),
                };
            }

            results[i] = result;

            await save({
                $set: {
                    [`actionResults.${i}`]: result,
                },
            }); // per-action result recorded immediately
        }
    }

    const incomplete = (exec.actions as any[])
        .map((_, i) => results[i])
        .filter((r) => !r || r.status === 'PENDING' || r.status === 'FAILED');

    if (!incomplete.length) {
        return finish(exec, wf, results, 'COMPLETED', null, save);
    }

    const summary = clip(
        exhausted
            ? 'Attempt limit reached'
            : incomplete
                .map((r) => `${r?.type ?? 'action'}: ${r?.error ?? 'not run'}`)
                .join('; '),
    );

    const canRetry =
        !exhausted &&
        exec.attemptCount < exec.maxAttempts &&
        incomplete.every((r) => r?.retryable !== false);

    if (canRetry) {
        await save({
            $set: {
                status: 'PENDING',
                nextRetryAt: new Date(
                    Date.now() + backoffMs(exec.attemptCount),
                ),
                errorSummary: summary,
                lockedAt: null,
                lockedBy: null,
            },
        });

        return;
    }

    const anySuccess = results.some((r) => r?.status === 'SUCCESS');

    return finish(
        exec,
        wf,
        results,
        anySuccess ? 'PARTIALLY_FAILED' : 'FAILED',
        summary,
        save,
    );
}

async function finish(
    exec: any,
    wf: any,
    _results: any[],
    status: 'COMPLETED' | 'PARTIALLY_FAILED' | 'FAILED',
    summary: string | null,
    save: (u: Record<string, unknown>) => Promise<void>,
) {
    await save({
        $set: {
            status,
            completedAt: new Date(),
            errorSummary: summary,
            lockedAt: null,
            lockedBy: null,
        },
    });

    // Post-terminal bookkeeping is best-effort and idempotent where it matters (deliveryKey); it must never undo the result.
    try {
        await AutomationWorkflow.updateOne(
            { _id: wf._id },
            { $set: { lastExecutedAt: new Date() } },
        );

        await recordActivity({
            organizationId: exec.organizationId,
            userId: wf.createdBy,
            entityType: 'AUTOMATION',
            entityId: wf._id,
            activityType: 'STATUS_CHANGE',
            description: `Execution ${status.toLowerCase().replace('_', ' ')}`,
            metadata: {
                executionId: String(exec._id),
                status,
            },
        } as any);

        await recordAudit({
            organizationId: exec.organizationId,
            actorId: wf.createdBy,
            action: `automation.execution_${status.toLowerCase()}`,
            resource: 'automation',
            resourceId: wf._id,
            after: {
                executionId: String(exec._id),
                status,
                attempts: exec.attemptCount,
            },
            meta: {
                requestId: String(exec._id),
            },
        } as any);

        const settings = withSettingsDefaults(wf.executionSettings);

        if (status !== 'COMPLETED' || settings.notifyOnCompletion) {
            await createNotification({
                organizationId: exec.organizationId,
                recipientUserId: wf.createdBy,
                type: status === 'COMPLETED'
                    ? 'AUTOMATION_COMPLETED'
                    : 'AUTOMATION_FAILED',
                title: status === 'COMPLETED'
                    ? `Automation completed: ${wf.name}`
                    : `Automation ${status === 'FAILED' ? 'failed' : 'partially failed'}: ${wf.name}`,
                message: summary ?? 'All actions finished.',
                deliveryKey: `exec:${exec._id}:r${exec.retryCount ?? 0}:${status}`,
            });
        }
    } catch (err) {
        logger.error(
            { err, executionId: String(exec._id) },
            'automation post-execution bookkeeping failed',
        );
    }
}

async function processExecutions(
    now: Date,
    batch: number,
    leaseMs: number,
) {
    let executions = 0;

    for (let i = 0; i < batch; i += 1) {
        const exec = await claimExecution(now, leaseMs);

        if (!exec) break;

        executions += 1;

        try {
            await runExecution(exec);
        } catch (err) {
            if (err instanceof LeaseLost) {
                logger.warn(
                    { executionId: String(exec._id) },
                    'automation lease lost; another worker owns it now',
                );
            } else {
                logger.error(
                    { err, executionId: String(exec._id) },
                    'automation execution crashed; it will be re-claimed after the lease expires',
                );
            }
        }
    }

    return executions;
}

/**
 * One automation pass: scan time-based triggers -> turn events into executions -> run executions.
 * Safe to call from several workers/processes at once (every step is an atomic claim) and after any restart.
 */
export async function runAutomationCycle(
    opts: AutomationOptions = {},
): Promise<AutomationCycleResult> {
    if (!env.AUTOMATION_ENGINE_ENABLED) {
        return {
            scanned: 0,
            events: 0,
            created: 0,
            executions: 0,
        };
    }

    const batch = opts.batchSize ?? env.AUTOMATION_BATCH_SIZE;
    const leaseMs = opts.leaseMs ?? env.REMINDER_LOCK_LEASE_MS;

    const scanned = await scanTimeTriggers();

    const { events, created } = await processEvents(
        new Date(),
        batch,
        leaseMs,
    );

    // fresh "now": executions created above are due immediately
    const executions = await processExecutions(
        new Date(),
        batch,
        leaseMs,
    );

    return {
        scanned,
        events,
        created,
        executions,
    };
}
