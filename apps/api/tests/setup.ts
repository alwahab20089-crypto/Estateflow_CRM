import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll } from 'vitest';

dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
});

// Environment must be set BEFORE any application module is imported.
const baseUri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/estateflow_test';

/**
 * Vitest runs test FILES in parallel workers. Every file wipes all collections in afterEach, so sharing one database
 * made files delete each other's organizations and memberships mid-test (random 403/404s). Each worker
 * therefore gets its own database. Files inside one worker run sequentially.
 */
const workerId = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0';

const parsed = new URL(baseUri);
const baseName = parsed.pathname.replace(/^\//, '');

if (!baseName.endsWith('_test')) {
  throw new Error(`Refusing to run tests: database "${baseName}" must end with "_test".`);
}

parsed.pathname = `/${baseName.replace(/_test$/, '')}_w${workerId}_test`;

const testUri = parsed.toString();
const dbName = parsed.pathname.replace('/', '');

if (!dbName.endsWith('_test')) {
  throw new Error(`Refusing to run tests: database "${dbName}" must end with "_test".`);
}

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = testUri;
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789-abcdefghijklmnop';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-9876543210-ponmlkjihgfedcba';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.LOGIN_FAILURE_LIMIT_MAX = '1000';

beforeAll(async () => {
  const mongoose = (await import('mongoose')).default;
  const { connectDatabase } = await import('../src/config/database');

  await connectDatabase();

  await mongoose.connection.dropDatabase(); // safe: name verified above

  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

afterEach(async () => {
  const mongoose = (await import('mongoose')).default;

  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
});

afterAll(async () => {
  const { disconnectDatabase } = await import('../src/config/database');

  await disconnectDatabase();
});