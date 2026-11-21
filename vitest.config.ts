import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      // the logic of the app: configuration, schedules, shortcuts, search, the engine and folder watches
      include: ['src/shared/**/*.ts', 'src/main/engine.ts', 'src/main/watcher.ts', 'src/main/alerts.ts'],
      reporter: ['text-summary', 'text'],
      skipFull: true,
      thresholds: { lines: 100, statements: 100, branches: 100, functions: 100 },
    },
  },
});
