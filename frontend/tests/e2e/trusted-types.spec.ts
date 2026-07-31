/** 跨浏览器验证安全渲染链路与匿名入口、改密入口的最小 smoke。 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const productId = '10000000-0000-4000-8000-000000000001';
const productionBaseUrl = process.env.PARTSIGNAL_E2E_PRODUCTION_BASE_URL
  ?? 'http://127.0.0.1:4173';
const securityHeaders = readFileSync(
  fileURLToPath(new URL('../../../deploy/nginx/partsignal-security-headers.conf', import.meta.url)),
  'utf8',
);
const productionCsp = securityHeaders.match(
  /^add_header Content-Security-Policy "([^"]+)" always;$/m,
)?.[1];
if (!productionCsp) throw new Error('无法从权威 Nginx snippet 读取生产 CSP');

test('注入权威完整 CSP 后命名策略支持 Ant 交互并清洗 Markdown', async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true },
    });
    Object.defineProperty(globalThis, '__partsignalTrustedTypesViolations', {
      configurable: true,
      value: violations,
    });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.effectiveDirective}: ${event.blockedURI}`);
    });
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/me') {
      await route.fulfill({ json: {
        id: '30000000-0000-4000-8000-000000000001',
        username: 'admin',
        display_name: '系统管理员',
        account_type: 'ADMIN',
        is_active: true,
        must_change_password: false,
        revision: 1,
        created_at: '2026-07-10T08:00:00+08:00',
      } });
      return;
    }
    if (path === '/api/v1/auth/csrf') {
      await route.fulfill({ json: { csrf_token: 'x'.repeat(32) } });
      return;
    }
    if (path === `/api/v1/products/${productId}`) {
      await route.fulfill({ json: {
        id: productId,
        part_number: 'TT-001',
        brand: 'PartSignal',
        category: '测试',
        status: 'ACTIVE',
        revision: 1,
        facts_revision: 1,
        created_at: '2026-07-16T00:00:00Z',
        updated_at: '2026-07-16T00:00:00Z',
      } });
      return;
    }
    if (path === `/api/v1/products/${productId}/facts`) {
      await route.fulfill({ json: {
        product_id: productId,
        body_markdown: '# 安全正文\n\n<img src="x" onerror="alert(1)">\n\n<script>alert(2)</script>',
        classification: 'PUBLIC',
        revision: 1,
      } });
      return;
    }
    if (path === `/api/v1/products/${productId}/fact-versions`) {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    if (request.resourceType() === 'document') {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'content-security-policy': productionCsp,
        },
      });
      return;
    }
    await route.continue();
  });

  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await page.goto(`${productionBaseUrl}/products/${productId}`);
  await expect(page.getByRole('heading', { name: 'TT-001' })).toBeVisible();
  await page.getByRole('tab', { name: '安全预览' }).click();
  const preview = page.getByRole('region', { name: '事实 Markdown 安全预览' });
  await expect(preview.getByRole('heading', { name: '安全正文' })).toBeVisible();
  await expect(preview.locator('script')).toHaveCount(0);
  await expect(preview.locator('[onerror]')).toHaveCount(0);
  await page.getByRole('button', { name: /主题：/ }).click();
  await page.getByRole('menuitem', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  expect(await page.evaluate(() => (
    globalThis as typeof globalThis & { __partsignalTrustedTypesViolations: string[] }
  ).__partsignalTrustedTypesViolations)).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test('登录和改密入口保持可访问且不加载工作台资源', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 204 }));
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /登\s*录/ })).toBeEnabled();

  await page.unroute('**/api/v1/auth/me');
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: {
    id: '30000000-0000-4000-8000-000000000001',
    username: 'admin',
    display_name: '系统管理员',
    account_type: 'ADMIN',
    is_active: true,
    must_change_password: false,
    revision: 1,
    created_at: '2026-07-10T08:00:00+08:00',
  } }));
  await page.route('**/api/v1/auth/csrf', (route) => route.fulfill({
    json: { csrf_token: 'x'.repeat(32) },
  }));
  await page.goto('/change-password');
  await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => /AppLayout|workspace\.css/.test(name)))).toEqual([]);
});
