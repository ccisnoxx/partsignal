/** 通过 V2 页面验证真实 cookie、CSRF、首次改密、权限边界与退出。 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { expectSecretsAbsent } from './secret-artifact';

const realStackEnabled = process.env.PARTSIGNAL_E2E_REAL_STACK === '1';
const initialPassword = process.env.PARTSIGNAL_SEED_ENGINEER_PASSWORD ?? 'partsignal-engineer-dev';

test.skip(!realStackEnabled, '只由隔离真实栈入口运行');
test.use({ trace: 'off' });
test.setTimeout(60_000);

test('Auth 真实栈完成 login → forced change → admin 403 → logout', async ({ page }, testInfo) => {
  const newPassword = `auth-real-${randomUUID()}`;
  const runtimeErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    const pathname = new URL(request.url()).pathname;
    const noContentAuthPost = request.method() === 'POST'
      && ['/api/v1/auth/change-password', '/api/v1/auth/logout'].includes(pathname);
    // Chromium 会把已返回 204 的 Auth POST 记为 aborted；页面结果断言继续证明请求成功。
    if (!noContentAuthPost) runtimeErrors.push(`requestfailed: ${request.method()} ${pathname}`);
  });

  try {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '用户名' }).fill('content_editor');
    await page.getByLabel(/^密码/).fill(initialPassword);
    await page.getByRole('button', { name: '登录' }).click();

    await expect(page).toHaveURL('/account/security');
    await expect(page.getByText('首次登录必须修改临时密码，完成前不能进入业务页面。')).toBeVisible();
    await page.getByLabel(/^当前密码/).fill(initialPassword);
    await page.getByLabel(/^新密码/).fill(newPassword);
    await page.getByRole('button', { name: '确认修改' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
    await page.goto('/system/users');
    const forbidden = page.getByRole('heading', { name: '无权访问系统管理' });
    await expect(forbidden).toBeVisible();
    await expect(forbidden.locator('xpath=ancestor::section[1]')).toBeFocused();

    await page.getByRole('button', { name: /内容运营/ }).click();
    await page.getByRole('menuitem', { name: '退出登录' }).click();
    await expect(page).toHaveURL('/login');
    expect(runtimeErrors, 'Auth 真实栈不得出现未捕获异常或失败资源').toEqual([]);
  } finally {
    await expectSecretsAbsent(testInfo.outputDir, [initialPassword, newPassword]);
  }
});
