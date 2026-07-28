/** Playwright 只连接本地/CI PartSignal 栈，不启动或访问生产服务。 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  projects: [
    { name: 'setup', testMatch: /shared-data\.setup\.ts/ },
    { name: 'e2e', testIgnore: /shared-data\.setup\.ts/, dependencies: ['setup'] },
    { name: 'trusted-types-firefox', testMatch: /(trusted-types|compatibility)\.spec\.ts/, use: devices['Desktop Firefox'] },
    { name: 'trusted-types-webkit', testMatch: /(trusted-types|compatibility)\.spec\.ts/, use: devices['Desktop Safari'] },
    {
      name: 'compatibility-firefox-no-backdrop',
      testMatch: /compatibility\.spec\.ts/,
      grep: /登录装饰/,
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: { firefoxUserPrefs: { 'layout.css.backdrop-filter.enabled': false } },
      },
    },
  ],
  expect: {
    toHaveScreenshot: {
      pathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}',
    },
  },
  use: {
    baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
