import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    fileParallelism: false, // test files share one test database
    testTimeout: 50_000,
    hookTimeout: 40_000,
  },
});