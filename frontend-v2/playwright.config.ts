/** 默认自建 production artifact；真实栈模式复用 E2E orchestration 已启动的 preview。 */
import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PARTSIGNAL_E2E_V2_BASE_URL;

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
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
  },
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run build && npm exec -- vite preview --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
