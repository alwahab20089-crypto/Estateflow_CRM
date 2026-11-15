import { describe, expect, it } from 'vitest';
import { Activity } from '../src/modules/activities/activity.model';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { memberOf, propertyBody, setupOrg } from './helpers';

type Api = Awaited<ReturnType<typeof setupOrg>>['api'];
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const newTask = (api: Api, over: Record<string, unknown> = {}) => api.post('/tasks', { title: 'Call buyer', ...over });

describe('tasks: create & validation', () => {
    it('creates a task, defaults the assignee to the creator and strips client-controlled fields', async () => {
        const { owner, org, api } = await setupOrg();
        const other = await setupOrg();
        const res = await newTask(api, { organizationId: other.org, createdBy: other.owner.user._id, status: 'COMPLETED', reminderStatus: 'DELIVERED', completedAt: new Date().toISOString() });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ status: 'TODO', taskType: 'GENERAL', priority: 'MEDIUM', createdBy: owner.user._id, assignedTo: owner.user._id, reminderStatus: 'NONE' });
        expect(res.body.data.organizationId).toBeUndefined();
        expect(res.body.data.completedAt).toBeNull();
        expect(await Task_countInOrg(org)).toBe(1);
    });

    it('rejects invalid dates, priority, status, type and reminder rules', async () => {
        const { api } = await setupOrg();
        expect((await newTask(api, { dueAt: 'tomorrow' })).status).toBe(422);
        expect((await newTask(api, { priority: 'CRITICAL' })).status).toBe(422);
        expect((await newTask(api, { taskType: 'LUNCH' })).status).toBe(422);
        expect((await newTask(api, { dueAt: inHours(2), reminderAt: inHours(3) })).status).toBe(422); // reminder after due
        expect((await newTask(api, { reminderAt: inHours(-5) })).status).toBe(422); // reminder in the past
        expect((await newTask(api, { relatedEntityType: 'LEAD' })).status).toBe(422); // type without id
        const t = (await newTask(api)).body.data;
        expect((await api.patch(`/tasks/${t._id}/status`, { status: 'DONE' })).status).toBe(422);
    });

    it('links to a lead and a property, rejects other-organization records, and filters by related entity', async () => {
        const a = await setupOrg();
        const b = await setupOrg();
        const lead = (await a.api.post('/leads', { firstName: 'Olivia', phone: '+15550100100', leadSource: 'WEBSITE', leadType: 'BUYER' })).body.data;
        const property = (await a.api.post('/properties', propertyBody())).body.data;
        const foreignLead = (await b.api.post('/leads', { firstName: 'Eve', phone: '+15550100101', leadSource: 'WEBSITE', leadType: 'BUYER' })).body.data;

        const t1 = await newTask(a.api, { relatedEntityType: 'LEAD', relatedEntityId: lead._id });
        expect(t1.status).toBe(201);
        expect(t1.body.data.related).toMatchObject({ type: 'LEAD', _id: lead._id });
        expect((await newTask(a.api, { relatedEntityType: 'PROPERTY', relatedEntityId: property._id })).status).toBe(201);
        expect((await newTask(a.api, { relatedEntityType: 'LEAD', relatedEntityId: foreignLead._id })).status).toBe(422);

        const list = await a.api.get(`/tasks?relatedEntityType=LEAD&relatedEntityId=${lead._id}`);
        expect(list.body.meta.total).toBe(1);
    });
});

describe('tasks: list, search, filter, pagination', () => {
    it('searches, filters, sorts, paginates and finds overdue tasks', async () => {
        const { api } = await setupOrg();
        await newTask(api, { title: 'Send contract to Lucas', priority: 'URGENT', taskType: 'EMAIL', dueAt: inHours(-3) });
        await newTask(api, { title: 'Property viewing Gulberg', priority: 'LOW', taskType: 'PROPERTY_VIEWING', dueAt: inHours(24) });
        await newTask(api, { title: 'Prepare documents', priority: 'HIGH', taskType: 'DOCUMENTATION' });

        expect((await api.get('/tasks?search=contr')).body.meta.total).toBe(1);
        expect((await api.get('/tasks?priority=URGENT')).body.meta.total).toBe(1);
        expect((await api.get('/tasks?taskType=PROPERTY_VIEWING')).body.meta.total).toBe(1);
        expect((await api.get('/tasks?overdue=true')).body.data.map((t: { title: string }) => t.title)).toEqual(['Send contract to Lucas']);
        expect((await api.get('/tasks?assignedTo=me')).body.meta.total).toBe(3);
        expect((await api.get('/tasks?bogus=1')).status).toBe(422); // strict query

        const byDue = (await api.get('/tasks?sortBy=dueAt&sortOrder=asc')).body.data.map((t: { title: string }) => t.title);
        expect(byDue[0]).toBe('Send contract to Lucas');
        expect(byDue[2]).toBe('Prepare documents'); // undated tasks sort last

        const page = await api.get('/tasks?limit=2&page=2');
        expect(page.body.data).toHaveLength(1);
        expect(page.body.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    });

    it('returns calendar tasks inside the range only', async () => {
        const { api } = await setupOrg();
        await newTask(api, { title: 'In range', dueAt: inHours(48) });
        await newTask(api, { title: 'Out of range', dueAt: inHours(24 * 60) });
        const res = await api.get(`/tasks/calendar?from=${encodeURIComponent(inHours(0))}&to=${encodeURIComponent(inHours(24 * 7))}`);
        expect(res.status).toBe(200);
        expect(res.body.data.map((t: { title: string }) => t.title)).toEqual(['In range']);
        expect((await api.get(`/tasks/calendar?from=${encodeURIComponent(inHours(0))}&to=${encodeURIComponent(inHours(24 * 200))}`)).status).toBe(422);
    });
});

describe('tasks: lifecycle', () => {
    it('updates, completes (idempotent), cancels, reopens, and writes activity + audit', async () => {
        const { org, api } = await setupOrg();
        const t = (await newTask(api)).body.data;

        const upd = await api.patch(`/tasks/${t._id}`, { title: 'Call buyer today', priority: 'HIGH', dueAt: inHours(5) });
        expect(upd.body.data).toMatchObject({ title: 'Call buyer today', priority: 'HIGH' });
        expect((await api.patch(`/tasks/${t._id}`, {})).status).toBe(422);
        const statusIgnored = await api.patch(`/tasks/${t._id}`, {
            priority: 'HIGH',
            status: 'COMPLETED',
        });

        expect(statusIgnored.status).toBe(200);
        expect(statusIgnored.body.data.status).toBe('TODO');
        const done = await api.patch(`/tasks/${t._id}/complete`, { note: 'Spoke to the buyer' });
        expect(done.body.data.status).toBe('COMPLETED');
        expect(done.body.data.completedAt).not.toBeNull();
        expect((await api.patch(`/tasks/${t._id}/complete`)).status).toBe(200); // idempotent
        expect((await api.patch(`/tasks/${t._id}`, { title: 'Nope' })).status).toBe(409); // closed

        const reopened = await api.patch(`/tasks/${t._id}/status`, { status: 'IN_PROGRESS' });
        expect(reopened.body.data).toMatchObject({ status: 'IN_PROGRESS', completedAt: null });
        expect((await api.patch(`/tasks/${t._id}/status`, { status: 'CANCELLED' })).body.data.status).toBe('CANCELLED');
        expect((await api.patch(`/tasks/${t._id}/complete`)).status).toBe(409);

        const actions = (await AuditLog.find({ organizationId: org, resource: 'task' })).map((a) => a.action);
        expect(actions).toEqual(expect.arrayContaining(['task.created', 'task.updated', 'task.completed', 'task.status_changed', 'task.cancelled']));
        expect(await Activity.countDocuments({ organizationId: org, entityType: 'TASK', entityId: t._id })).toBeGreaterThanOrEqual(5);
        const feed = await api.get(`/tasks/${t._id}/activities`);
        expect(feed.status).toBe(200);
        expect(feed.body.data.length).toBeGreaterThan(0);
    });

    it('soft-deletes and restores, hiding archived tasks from the default list', async () => {
        const { org, api } = await setupOrg();
        const t = (await newTask(api)).body.data;
        expect((await api.delete(`/tasks/${t._id}`)).status).toBe(200);
        expect((await api.get(`/tasks/${t._id}`)).status).toBe(404);
        expect((await api.get('/tasks')).body.meta.total).toBe(0);
        expect((await api.get('/tasks?view=archived')).body.meta.total).toBe(1);
        const restored = await api.patch(`/tasks/${t._id}/restore`);
        expect(restored.status).toBe(200);
        expect(restored.body.data.deletedAt).toBeNull();
        const actions = (await AuditLog.find({ organizationId: org, resource: 'task' })).map((a) => a.action);
        expect(actions).toEqual(expect.arrayContaining(['task.archived', 'task.restored']));
    });
});

describe('tasks: assignment, permissions and tenancy', () => {
    it('assigns and reassigns, notifies the assignee, and rejects non-members and other-organization users', async () => {
        const { org, api } = await setupOrg();
        const agent = await memberOf(org, 'AGENT');
        const manager = await memberOf(org, 'MANAGER');
        const outsider = await setupOrg();
        const t = (await newTask(api)).body.data;

        expect((await api.patch(`/tasks/${t._id}/assign`, { assignedTo: outsider.owner.user._id })).status).toBe(422);
        const a1 = await api.patch(`/tasks/${t._id}/assign`, { assignedTo: agent.user._id });
        expect(a1.status).toBe(200);
        expect(a1.body.data.assignee.name).toBeDefined();
        expect(await Notification.countDocuments({ recipientUserId: agent.user._id, type: 'TASK_ASSIGNED' })).toBe(1);

        expect((await api.patch(`/tasks/${t._id}/assign`, { assignedTo: manager.user._id })).status).toBe(200);
        expect((await api.patch(`/tasks/${t._id}/assign`, { assignedTo: null })).body.data.assignedTo).toBeNull();
        const actions = (await AuditLog.find({ organizationId: org, resource: 'task' })).map((a) => a.action);
        expect(actions).toEqual(expect.arrayContaining([
            'task.reassigned',
        ]));
    });

    it('enforces roles: agents see only their tasks and cannot assign others, delete or restore; managers can restore', async () => {
        const { owner, org, api } = await setupOrg();
        const agent = await memberOf(org, 'AGENT');
        const manager = await memberOf(org, 'MANAGER');
        const ownerTask = (await newTask(api, { title: 'Owner only' })).body.data;

        expect((await agent.api.get('/tasks')).body.meta.total).toBe(0);
        expect((await agent.api.get(`/tasks/${ownerTask._id}`)).status).toBe(404);
        expect((await agent.api.patch(`/tasks/${ownerTask._id}`, { title: 'x' })).status).toBe(404);
        expect((await manager.api.get('/tasks')).body.meta.total).toBe(1);

        expect((await newTask(agent.api, { assignedTo: owner.user._id })).status).toBe(403);
        const mine = (await newTask(agent.api, { title: 'Agent task' })).body.data;
        expect((await agent.api.patch(`/tasks/${mine._id}/assign`, { assignedTo: owner.user._id })).status).toBe(403);
        expect((await agent.api.delete(`/tasks/${mine._id}`)).status).toBe(403);
        expect((await agent.api.get('/tasks?view=archived')).status).toBe(403);

        await api.delete(`/tasks/${mine._id}`);
        expect((await agent.api.patch(`/tasks/${mine._id}/restore`)).status).toBe(403);
        expect((await manager.api.patch(`/tasks/${mine._id}/restore`)).status).toBe(200);
    });

    it('never exposes tasks across organizations', async () => {
        const a = await setupOrg();
        const b = await setupOrg();
        const t = (await newTask(a.api)).body.data;
        expect((await b.api.get(`/tasks/${t._id}`)).status).toBe(404);
        expect((await b.api.patch(`/tasks/${t._id}`, { title: 'hijack' })).status).toBe(404);
        expect((await b.api.delete(`/tasks/${t._id}`)).status).toBe(404);
        expect((await b.api.patch(`/tasks/${t._id}/complete`)).status).toBe(404);
        expect((await b.api.get('/tasks')).body.meta.total).toBe(0);
        expect((await b.api.get('/tasks/not-an-id')).status).toBe(404);
    });
});

async function Task_countInOrg(org: string) {
    const { Task } = await import('../src/modules/tasks/task.model');
    return Task.countDocuments({ organizationId: org });
}
