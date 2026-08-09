/** V2 Foundation smoke 只验证当前 production build artifact，不连接真实业务后端。 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '.cache/playwright-results',
  projects: [
    {
      name: 'foundation-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 900 } },
    },
    {
      name: 'foundation-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm exec -- vite preview --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
