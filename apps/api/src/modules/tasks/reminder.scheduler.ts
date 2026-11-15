import { logger } from '../../config/logger';
import { runReminderCycle, type ProcessOptions } from './reminder.processor';

/**
 * Scheduler abstraction. The processor (reminder.processor.ts) is the real mechanism and is independent of how it is
 * triggered: this in-process poller, an external cron calling `scripts/run-reminders.ts`, or a queue worker can all call
 * runReminderCycle(). Correctness never depends on timers: due reminders live in MongoDB and are claimed atomically, so
 * restarts, missed ticks and several API instances are all safe. A timer only decides how LATE a reminder can be.
 */
export interface ReminderScheduler { stop(): Promise<void> }

export function startReminderScheduler(opts: { intervalMs: number } & ProcessOptions): ReminderScheduler {
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const r = await runReminderCycle(opts);
      if (r.reminders.claimed || r.overdue.notified) logger.info(r, 'reminder cycle');
    } catch (err) {
      logger.error({ err }, 'reminder cycle failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), opts.intervalMs);
  timer.unref();
  void tick(); // catch up immediately after a (re)start

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      for (let i = 0; i < 100 && running; i += 1) await new Promise((r) => setTimeout(r, 50)); // wait up to 5s for an in-flight cycle
    },
  };
}