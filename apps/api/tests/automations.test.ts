import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { AutomationEvent, AutomationExecution } from '../src/modules/automations/automation.model';
import { runAutomationCycle } from '../src/modules/automations/automation.engine';
import { evaluateConditions } from '../src/modules/automations/condition.evaluator';
import { Lead } from '../src/modules/leads/lead.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { createNotification } from '../src/modules/notifications/notification.service';
import { Task } from '../src/modules/tasks/task.model';
import { outbox, setEmailProvider } from '../src/utils/email-provider';
import { memberOf, setupOrg } from './helpers';

type Api = Awaited<ReturnType<typeof setupOrg>>['api'];
const lead = (api: Api, o: Record<string, unknown> = {}) => api.post('/leads', { firstName: 'Olivia', phone: '+15550100100', leadSource: 'WEBSITE', leadType: 'BUYER', ...o });
const wfBody = (userId: string, o: Record<string, unknown> = {}) => ({
    name: 'High priority follow-up', triggerType: 'LEAD_CREATED',
    conditions: [{ field: 'priority', operator: 'EQUALS', value: 'HIGH' }],
    actions: [{ type: 'CREATE_TASK', title: 'Call {{name}}', assignTo: { mode: 'USER', userId } }], ...o,
});
async function activeWorkflow(api: Api, userId: string, o: Record<string, unknown> = {}) {
    const w = (await api.post('/automations', wfBody(userId, o))).body.data;
    expect((await api.post(`/automations/${w._id}/activate`)).status).toBe(200);
    return w as { _id: string };
}

beforeEach(() => setEmailProvider(null));

describe('condition evaluator', () => {
    const p = { status: 'NEW', priority: 'HIGH', valueAmount: 500, assignedTo: null };
    it('supports ALL/ANY and the operators', () => {
        expect(evaluateConditions([{ field: 'priority', operator: 'EQUALS', value: 'high' }, { field: 'valueAmount', operator: 'GREATER_THAN', value: 100 }], 'ALL', p)).toBe(true);
        expect(evaluateConditions([{ field: 'status', operator: 'EQUALS', value: 'X' }, { field: 'valueAmount', operator: 'LESS_THAN_OR_EQUAL', value: 500 }], 'ANY', p)).toBe(true);
        expect(evaluateConditions([{ field: 'status', operator: 'EQUALS', value: 'X' }], 'ALL', p)).toBe(false);
        expect(evaluateConditions([{ field: 'assignedTo', operator: 'IS_EMPTY' }], 'ALL', p)).toBe(true);
        expect(evaluateConditions([{ field: 'status', operator: 'NOT_CONTAINS', value: 'OLD' }], 'ALL', p)).toBe(true);
        expect(evaluateConditions(undefined, 'ALL', p)).toBe(true);
    });
    it('never reads inherited properties', () => {
        expect(evaluateConditions([{ field: 'constructor', operator: 'IS_NOT_EMPTY' }], 'ALL', {})).toBe(false);
    });
});

describe('automations: API', () => {
    it('enforces permissions', async () => {
        const { org, owner, api } = await setupOrg();
        const agent = await memberOf(org, 'AGENT');
        const manager = await memberOf(org, 'MANAGER');
        expect((await agent.api.get('/automations')).status).toBe(403);
        expect((await manager.api.get('/automations')).status).toBe(200);
        expect((await manager.api.post('/automations', wfBody(owner.user._id))).status).toBe(403);
        expect((await api.post('/automations', wfBody(owner.user._id))).status).toBe(201);
    });

    it('rejects raw queries, unknown fields, bad operators and mismatched actions; ignores client-controlled fields', async () => {
        const { owner, api } = await setupOrg();
        const u = owner.user._id;
        const bad = (o: Record<string, unknown>) => api.post('/automations', wfBody(u, o));
        expect((await bad({ conditions: [{ field: 'priority', operator: 'EQUALS', value: { $ne: null } }] })).status).toBe(422);
        expect((await bad({ conditions: [{ field: 'passwordHash', operator: 'EQUALS', value: 'x' }] })).status).toBe(422);
        expect((await bad({ conditions: [{ field: 'priority', operator: 'GREATER_THAN', value: 1 }] })).status).toBe(422);
        expect((await bad({ conditions: Array.from({ length: 11 }, () => ({ field: 'priority', operator: 'EQUALS', value: 'HIGH' })) })).status).toBe(422);
        expect((await bad({ triggerType: 'LEAD_CREATED', actions: [{ type: 'UPDATE_TASK_STATUS', status: 'COMPLETED' }] })).status).toBe(422);
        expect((await bad({ triggerType: 'NOT_A_TRIGGER' })).status).toBe(422);
        expect((await bad({ actions: [{ type: 'DELETE_LEAD' }] })).status).toBe(422);
        const other = await setupOrg();
        const ok = await bad({ organizationId: other.org, status: 'ACTIVE', createdBy: other.owner.user._id });
        expect(ok.status).toBe(201);
        expect(ok.body.data.status).toBe('DRAFT');
        expect(ok.body.data.createdBy).toBe(u);
    });

    it('is tenant-isolated, and activate/pause/delete are audited', async () => {
        const a = await setupOrg();
        const b = await setupOrg();
        const w = await activeWorkflow(a.api, a.owner.user._id);
        expect((await b.api.get(`/automations/${w._id}`)).status).toBe(404);
        expect((await b.api.patch(`/automations/${w._id}`, { name: 'x' })).status).toBe(404);
        expect((await b.api.get(`/automations/${w._id}/executions`)).status).toBe(404);
        expect((await a.api.post(`/automations/${w._id}/pause`)).body.data.status).toBe('PAUSED');
        expect((await a.api.post(`/automations/${w._id}/pause`)).status).toBe(200); // idempotent
        expect((await a.api.delete(`/automations/${w._id}`)).status).toBe(200);
        expect((await a.api.get(`/automations/${w._id}`)).status).toBe(404);
        const actions = (await AuditLog.find({ resource: 'automation' }).lean()).map((x) => x.action);
        expect(actions).toEqual(expect.arrayContaining(['automation.created', 'automation.activated', 'automation.paused', 'automation.deleted']));
    });

    it('dry-run test evaluates conditions and executes nothing', async () => {
        const { owner, api } = await setupOrg();
        const w = await activeWorkflow(api, owner.user._id);
        const r = await api.post(`/automations/${w._id}/test`, { sample: { priority: 'HIGH' } });
        expect(r.body.data).toMatchObject({ matched: true, dryRun: true });
        expect(await Task.countDocuments({})).toBe(0);
        expect(await AutomationExecution.countDocuments({})).toBe(0);
    });
});

describe('automations: engine', () => {
    it('runs a matching workflow exactly once, even with concurrent workers and repeated cycles', async () => {
        const { owner, org, api } = await setupOrg();
        const w = await activeWorkflow(api, owner.user._id);
        await lead(api, { priority: 'LOW' }); // does not match
        await lead(api, { priority: 'HIGH' });
        expect(await AutomationEvent.countDocuments({})).toBe(2);
        await Promise.all([runAutomationCycle(), runAutomationCycle()]);
        await runAutomationCycle();
        const execs = await AutomationExecution.find({ workflowId: w._id }).lean();
        expect(execs).toHaveLength(1);
        expect(execs[0]!.status).toBe('COMPLETED');
        const tasks = await Task.find({ organizationId: org }).lean();
        expect(tasks).toHaveLength(1);
        expect(tasks[0]!.title).toBe('Call Olivia');
    });

    it('does not run paused workflows and never crosses organizations', async () => {
        const a = await setupOrg();
        const b = await setupOrg();
        const w = await activeWorkflow(a.api, a.owner.user._id);
        await a.api.post(`/automations/${w._id}/pause`);
        await lead(a.api, { priority: 'HIGH' });
        await lead(b.api, { priority: 'HIGH' });
        await runAutomationCycle();
        expect(await AutomationExecution.countDocuments({})).toBe(0);
        await a.api.post(`/automations/${w._id}/activate`);
        await lead(b.api, { priority: 'HIGH' });
        await runAutomationCycle();
        expect(await AutomationExecution.countDocuments({})).toBe(0); // org B's leads never match org A's workflow
    });

    it('retries only the failed action, and a partial failure is not reported as success', async () => {
        const { owner, api } = await setupOrg();
        let calls = 0;
        let failing = true;
        setEmailProvider({ name: 'test', async send(m) { calls += 1; if (failing) throw new Error('smtp down'); outbox.push(m); return { messageId: 'm1' }; } });
        const me = { mode: 'USER', userId: owner.user._id };
        const w = await activeWorkflow(api, owner.user._id, {
            executionSettings: { maxAttempts: 2 },
            actions: [
                { type: 'CREATE_IN_APP_NOTIFICATION', recipient: me, title: 'Hi {{name}}', message: 'new lead' },
                { type: 'SEND_EMAIL_NOTIFICATION', recipient: me, subject: 'Lead', body: 'A lead arrived' },
            ],
        });
        await lead(api, { priority: 'HIGH' });
        await runAutomationCycle();
        let e = (await AutomationExecution.findOne({ workflowId: w._id }).lean())!;
        expect(e.status).toBe('PENDING'); // waiting for backoff, not "completed"
        expect(e.actionResults[0].status).toBe('SUCCESS');
        expect(e.actionResults[1].status).toBe('FAILED');
        await AutomationExecution.updateOne({ _id: e._id }, { $set: { nextRetryAt: new Date(Date.now() - 1000) } });
        await runAutomationCycle(); // attempt 2 fails again -> attempts exhausted
        e = (await AutomationExecution.findOne({ _id: e._id }).lean())!;
        expect(e.status).toBe('PARTIALLY_FAILED');
        expect(await Notification.countDocuments({ type: 'AUTOMATION' })).toBe(1); // the successful action was not repeated
        expect(await Notification.countDocuments({ type: 'AUTOMATION_FAILED' })).toBe(1);

        failing = false;
        const r = await api.post(`/automations/${w._id}/executions/${e._id}/retry`);
        expect(r.body.data.status).toBe('PENDING');
        await runAutomationCycle();
        e = (await AutomationExecution.findOne({ _id: e._id }).lean())!;
        expect(e.status).toBe('COMPLETED');
        expect(await Notification.countDocuments({ type: 'AUTOMATION' })).toBe(1);
        expect(outbox).toHaveLength(1);
        expect(calls).toBe(3);
        expect((await api.post(`/automations/${w._id}/executions/${e._id}/retry`)).status).toBe(409);
    });

    it('prevents automation loops', async () => {
        const { org, owner, api } = await setupOrg();
        const m1 = await memberOf(org, 'AGENT');
        const m2 = await memberOf(org, 'AGENT');
        const w = await activeWorkflow(api, owner.user._id, {
            triggerType: 'LEAD_ASSIGNED', conditions: [],
            actions: [{ type: 'ASSIGN_LEAD', assignTo: { mode: 'USER', userId: m2.user._id } }],
        });
        const l = (await lead(api)).body.data;
        expect((await api.patch(`/leads/${l._id}/assign`, { assignedTo: m1.user._id })).status).toBe(200);
        for (let i = 0; i < 4; i += 1) await runAutomationCycle();
        expect(await AutomationExecution.countDocuments({ workflowId: w._id })).toBe(1); // its own event never re-triggers it
        expect(String((await Lead.findById(l._id).lean())!.assignedTo)).toBe(m2.user._id);
    });
});

describe('notification preferences', () => {
    it('has defaults, allows opting out, and refuses to disable mandatory types', async () => {
        const { org, owner, api } = await setupOrg();
        const list = (await api.get('/notifications/preferences')).body.data as { type: string; inApp: boolean; mandatory: boolean }[];
        expect(list.find((p) => p.type === 'TASK_REMINDER')).toMatchObject({ inApp: true, mandatory: false });
        expect((await api.patch('/notifications/preferences', { preferences: [{ type: 'TASK_ASSIGNED', inApp: false }] })).status).toBe(409);
        expect((await api.patch('/notifications/preferences', { preferences: [{ type: 'TASK_REMINDER', inApp: false }] })).status).toBe(200);
        const send = (type: 'TASK_REMINDER' | 'TASK_ASSIGNED') => createNotification({ organizationId: org, recipientUserId: owner.user._id, type, title: 't', message: 'm' });
        expect(await send('TASK_REMINDER')).toBe(false);
        expect(await send('TASK_ASSIGNED')).toBe(true);
    });
});