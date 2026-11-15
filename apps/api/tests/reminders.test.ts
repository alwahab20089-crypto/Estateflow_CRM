
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { Notification } from '../src/modules/notifications/notification.model';
import {
  processDueReminders,
  processOverdueNotifications,
} from '../src/modules/tasks/reminder.processor';
import { Task } from '../src/modules/tasks/task.model';
import { memberOf, setupOrg } from './helpers';

const at = (h: number) => new Date(Date.now() + h * 3_600_000);
const iso = (h: number) => at(h).toISOString();
const later = (h: number) => ({ now: at(h) });

describe('reminders', () => {
  it('delivers exactly once to the assignee, even when processed repeatedly or concurrently', async () => {
    const { org, api } = await setupOrg();
    const agent = await memberOf(org, 'AGENT');

    const t = (
      await api.post('/tasks', {
        title: 'Send brochure',
        assignedTo: agent.user._id,
        dueAt: iso(5),
        reminderAt: iso(1),
      })
    ).body.data;

    expect((await processDueReminders(later(0))).claimed).toBe(0);

    await Promise.all([
      processDueReminders(later(2)),
      processDueReminders(later(2)),
    ]);

    await processDueReminders(later(3));

    const notes = await Notification.find({
      taskId: t._id,
      type: 'TASK_REMINDER',
    });

    expect(notes).toHaveLength(1);
    expect(String(notes[0]!.recipientUserId)).toBe(agent.user._id);

    const task = await Task.findById(t._id);
    expect(task!.reminderStatus).toBe('DELIVERED');

    expect(
      await AuditLog.countDocuments({
        organizationId: org,
        action: 'task.reminder_delivered',
      }),
    ).toBe(1);

    expect(
      (await agent.api.get(`/tasks/${t._id}`)).body.data.reminderStatus,
    ).toBe('DELIVERED');
  });

  it('suppresses reminders for completed, cancelled and deleted tasks', async () => {
    const { api } = await setupOrg();

    const done = (
      await api.post('/tasks', {
        title: 'done',
        reminderAt: iso(1),
      })
    ).body.data;

    const cancelled = (
      await api.post('/tasks', {
        title: 'cancelled',
        reminderAt: iso(1),
      })
    ).body.data;

    const deleted = (
      await api.post('/tasks', {
        title: 'deleted',
        reminderAt: iso(1),
      })
    ).body.data;

    await api.patch(`/tasks/${done._id}/complete`);
    await api.patch(`/tasks/${cancelled._id}/status`, {
      status: 'CANCELLED',
    });
    await api.delete(`/tasks/${deleted._id}`);

    const r = await processDueReminders(later(2));

    expect(r.claimed).toBe(0);
    expect(
      await Notification.countDocuments({ type: 'TASK_REMINDER' }),
    ).toBe(0);

    expect((await Task.findById(done._id))!.reminderStatus).toBe('CANCELLED');
  });

  it('drops the old reminder when reminderAt changes and delivers only the new one; clearing cancels it', async () => {
    const { api } = await setupOrg();

    const t = (
      await api.post('/tasks', {
        title: 'moved',
        reminderAt: iso(1),
      })
    ).body.data;

    await api.patch(`/tasks/${t._id}`, {
      reminderAt: iso(10),
    });

    expect((await processDueReminders(later(2))).claimed).toBe(0);
    expect(await Notification.countDocuments({ taskId: t._id })).toBe(0);

    expect((await processDueReminders(later(11))).delivered).toBe(1);

    const t2 = (
      await api.post('/tasks', {
        title: 'cleared',
        reminderAt: iso(1),
      })
    ).body.data;

    await api.patch(`/tasks/${t2._id}`, {
      reminderAt: null,
    });

    expect((await processDueReminders(later(5))).claimed).toBe(0);
    expect((await Task.findById(t2._id))!.reminderStatus).toBe('NONE');
  });

  it('delivers a re-armed reminder as a new event after the time is changed post-delivery', async () => {
    const { api } = await setupOrg();

    const t = (
      await api.post('/tasks', {
        title: 'again',
        reminderAt: iso(1),
      })
    ).body.data;

    await processDueReminders(later(2));

    await api.patch(`/tasks/${t._id}`, {
      reminderAt: iso(20),
    });

    await processDueReminders(later(21));

    expect(
      await Notification.countDocuments({
        taskId: t._id,
        type: 'TASK_REMINDER',
      }),
    ).toBe(2);
  });

  it('recovers a reminder abandoned by a crashed worker, without duplicating it', async () => {
    const { api } = await setupOrg();

    const t = (
      await api.post('/tasks', {
        title: 'crashed worker',
        reminderAt: iso(1),
      })
    ).body.data;

    await Task.updateOne(
      { _id: t._id },
      {
        $set: {
          reminderStatus: 'PROCESSING',
          reminderLockedAt: at(1.5),
          reminderLockedBy: 'dead-worker',
        },
      },
    );

    // The lock is still valid after 6 minutes, but expires after 90 minutes.
    const leaseMs = 30 * 60_000;

    expect(
      (await processDueReminders({ now: at(1.6), leaseMs })).claimed,
    ).toBe(0);

    expect(
      (await processDueReminders({ now: at(3), leaseMs })).delivered,
    ).toBe(1);

    expect(
      await Notification.countDocuments({
        taskId: t._id,
        type: 'TASK_REMINDER',
      }),
    ).toBe(1);
  });

  it('reminds the creator when a task is unassigned', async () => {
    const { owner, api } = await setupOrg();

    const t = (
      await api.post('/tasks', {
        title: 'nobody',
        reminderAt: iso(1),
      })
    ).body.data;

    await api.patch(`/tasks/${t._id}/assign`, {
      assignedTo: null,
    });

    await processDueReminders(later(2));

    const n = await Notification.findOne({
      taskId: t._id,
      type: 'TASK_REMINDER',
    });

    expect(String(n!.recipientUserId)).toBe(owner.user._id);
  });

  it('sends one overdue notice per due date', async () => {
    const { api } = await setupOrg();

    const t = (
      await api.post('/tasks', {
        title: 'late',
        dueAt: iso(-2),
      })
    ).body.data;

    await processOverdueNotifications();
    await processOverdueNotifications();

    expect(
      await Notification.countDocuments({
        taskId: t._id,
        type: 'TASK_OVERDUE',
      }),
    ).toBe(1);
  });
});

describe('notifications', () => {
  it('lists, counts, marks read, marks all read and deletes only the recipient\'s own notifications', async () => {
    const { org, api } = await setupOrg();

    const agent = await memberOf(org, 'AGENT');
    const manager = await memberOf(org, 'MANAGER');

    for (const title of ['one', 'two', 'three']) {
      await api.post('/tasks', {
        title,
        assignedTo: agent.user._id,
      });
    }

    expect(
      (await agent.api.get('/notifications/unread-count')).body.data.count,
    ).toBe(3);

    expect(
      (await manager.api.get('/notifications/unread-count')).body.data.count,
    ).toBe(0);

    const list = await agent.api.get('/notifications?limit=2');

    expect(list.body.data).toHaveLength(2);
    expect(list.body.meta).toMatchObject({
      total: 3,
      unreadCount: 3,
    });

    const id = list.body.data[0]._id as string;

    // Another member or organization cannot read or change this notification.
    expect(
      (await manager.api.patch(`/notifications/${id}/read`)).status,
    ).toBe(404);

    expect(
      (await manager.api.delete(`/notifications/${id}`)).status,
    ).toBe(404);

    const stranger = await setupOrg();

    expect(
      (await stranger.api.patch(`/notifications/${id}/read`)).status,
    ).toBe(404);

    expect(
      (await agent.api.patch(`/notifications/${id}/read`)).body.data.isRead,
    ).toBe(true);

    expect(
      (await agent.api.get('/notifications/unread-count')).body.data.count,
    ).toBe(2);

    expect(
      (await agent.api.get('/notifications?unread=true')).body.meta.total,
    ).toBe(2);

    expect(
      (await agent.api.patch('/notifications/read-all')).body.data.updated,
    ).toBe(2);

    expect(
      (await agent.api.get('/notifications/unread-count')).body.data.count,
    ).toBe(0);

    expect(
      (await agent.api.delete(`/notifications/${id}`)).status,
    ).toBe(200);

    expect(
      (await agent.api.get('/notifications')).body.meta.total,
    ).toBe(2);

    expect(
      (await agent.api.get('/notifications?page=0')).status,
    ).toBe(422);
  });
});
