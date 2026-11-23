import mongoose from 'mongoose';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { logger } from './config/logger';
import { startReminderScheduler } from './modules/tasks/reminder.scheduler';


async function main() {
  await connectDatabase(); // never accept requests before the database is ready
  await Promise.all(Object.values(mongoose.models).map((model) => model.init())); // make sure indexes exist

  const server = createApp().listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'EstateFlow API listening');
  });
  const scheduler = env.REMINDER_SCHEDULER_ENABLED
    ? startReminderScheduler({ intervalMs: env.REMINDER_POLL_INTERVAL_MS, batchSize: env.REMINDER_BATCH_SIZE, leaseMs: env.REMINDER_LOCK_LEASE_MS })
    : null;

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      await scheduler?.stop();
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    shutdown('unhandledRejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});