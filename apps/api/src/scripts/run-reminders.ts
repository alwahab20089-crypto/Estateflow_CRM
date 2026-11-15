import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { runReminderCycle } from '../modules/tasks/reminder.processor';

async function main() {
  await connectDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const result = await runReminderCycle();
  logger.info(result, 'reminder run complete');
  await disconnectDatabase();
}

main().catch((err) => {
  logger.fatal({ err }, 'reminder run failed');
  process.exit(1);
});