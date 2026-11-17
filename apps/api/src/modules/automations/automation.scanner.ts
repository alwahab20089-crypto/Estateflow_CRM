/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEAL_STAGES, OPEN_TASK_STATUSES } from '../../constants';
import { logger } from '../../config/logger';
import { Activity } from '../activities/activity.model';
import { Deal } from '../deals/deal.model';
import { Lead } from '../leads/lead.model';
import { Task } from '../tasks/task.model';
import { TIME_TRIGGERS } from './automation.constants';
import { emitEntityEvent } from './automation.events';
import { AutomationWorkflow } from './automation.model';

const PAGE = 200;
const CAP_PER_WORKFLOW = 1000; // bounded work per cycle; the rest is picked up next cycle (events are idempotent)
const OPEN_DEAL_STAGES = DEAL_STAGES.filter((s) => s !== 'WON' && s !== 'LOST');
const DAY = 86_400_000;

/** Pages through candidates by _id so a large backlog can never starve later records. */
async function* pages(fetch: (afterId: unknown) => Promise<any[]>) {
  let after: unknown = null;
  let seen = 0;
  while (seen < CAP_PER_WORKFLOW) {
    const rows = await fetch(after);
    if (!rows.length) return;
    seen += rows.length;
    after = rows[rows.length - 1]._id;
    yield rows;
    if (rows.length < PAGE) return;
  }
}

/**
 * Time-based triggers are derived from database state on every cycle (no setTimeout, nothing in memory), so they
 * survive restarts and run on any worker. Each emitted event is keyed by workflow + entity + the value that made it
 * due (due date, last activity, closing date), so it fires once per condition, not once per cycle.
 */
export async function scanTimeTriggers(): Promise<number> {
  const workflows: any[] = await AutomationWorkflow.find({ status: 'ACTIVE', deletedAt: null, triggerType: { $in: TIME_TRIGGERS } }).limit(500).lean();
  let emitted = 0;
  const now = Date.now();

  for (const wf of workflows) {
    const org = wf.organizationId;
    const cfg = wf.triggerConfig ?? {};
    const emit = async (entityType: any, id: unknown, discriminator: unknown) => {
      await emitEntityEvent({ type: wf.triggerType, entityType, entityId: id as any, organizationId: org, workflowId: wf._id, key: String(discriminator) });
      emitted += 1;
    };
    try {
      if (wf.triggerType === 'TASK_DUE_SOON' || wf.triggerType === 'TASK_OVERDUE') {
        const soon = wf.triggerType === 'TASK_DUE_SOON';
        const dueAt = soon ? { $gt: new Date(now), $lte: new Date(now + (cfg.withinMinutes ?? 60) * 60_000) } : { $lt: new Date(now), $gte: new Date(now - 7 * DAY) };
        for await (const rows of pages((after) => Task.find({ organizationId: org, deletedAt: null, status: { $in: OPEN_TASK_STATUSES }, dueAt, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(PAGE).select('_id dueAt').lean())) {
          for (const t of rows) await emit('TASK', t._id, t.dueAt.getTime());
        }
      } else if (wf.triggerType === 'DEAL_EXPECTED_CLOSING_SOON') {
        const closing = { $gt: new Date(now), $lte: new Date(now + (cfg.withinDays ?? 7) * DAY) };
        for await (const rows of pages((after) => Deal.find({ organizationId: org, deletedAt: null, stage: { $in: OPEN_DEAL_STAGES }, expectedClosingDate: closing, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(PAGE).select('_id expectedClosingDate').lean())) {
          for (const d of rows) await emit('DEAL', d._id, d.expectedClosingDate.getTime());
        }
      } else if (wf.triggerType === 'LEAD_WITHOUT_ACTIVITY') {
        const cutoff = new Date(now - (cfg.inactiveDays ?? 3) * DAY);
        for await (const rows of pages((after) => Lead.find({ organizationId: org, deletedAt: null, convertedContactId: null, wonAt: null, lostAt: null, createdAt: { $lte: cutoff }, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(PAGE).select('_id createdAt').lean())) {
          const last = new Map<string, number>((await Activity.aggregate([
            { $match: { organizationId: org, entityType: 'LEAD', entityId: { $in: rows.map((r) => r._id) } } },
            { $group: { _id: '$entityId', last: { $max: '$createdAt' } } },
          ])).map((a: any) => [String(a._id), new Date(a.last).getTime()]));
          for (const l of rows) {
            const lastAt = Math.max(last.get(String(l._id)) ?? 0, new Date(l.createdAt).getTime());
            if (lastAt <= cutoff.getTime()) await emit('LEAD', l._id, lastAt); // new activity changes the key, so a later lull fires again
          }
        }
      }
    } catch (err) {
      logger.error({ err, workflowId: String(wf._id) }, 'time-trigger scan failed');
    }
  }
  return emitted;
}