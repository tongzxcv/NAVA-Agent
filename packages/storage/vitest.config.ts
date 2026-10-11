import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Windows SQLite/WAL integration tests can contend on shared CI runners.
    // Keep independent test files sequential without weakening assertions.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
