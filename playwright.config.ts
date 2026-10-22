import { defineConfig } from '@playwright/test';
import { LOCAL_PORT } from './src/endpoints';

export default defineConfig({
  testDir: './tests',
  // Platform-agnostic so schema snapshots recorded on Windows match on Linux CI.
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]],
  projects: [
    {
      name: 'local',
      testDir: './tests/local',
      fullyParallel: true,
    },
    {
      // Third-party hobby APIs: keep the load polite and absorb their flakiness.
      name: 'public',
      testDir: './tests/public',
      retries: 2,
      fullyParallel: false,
      timeout: 60_000,
    },
  ],
  workers: process.env.CI ? 2 : 4,
  webServer: {
    command: 'npx tsx server/server.ts',
    url: `http://localhost:${LOCAL_PORT}/graphql?query=%7B__typename%7D`,
    reuseExistingServer: !process.env.CI,
    env: { NODE_ENV: 'production' },
    timeout: 30_000,
  },
});
