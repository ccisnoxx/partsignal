/** 通过 V2 production preview 读取独立创建的真实 Content Version。 */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIResponse,
  type Page,
} from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';

type AuthSession = components['schemas']['AuthSession'];
type ContentTask = components['schemas']['ContentTask'];
type ContentVersion = components['schemas']['ContentVersion'];
type FactVersion = components['schemas']['FactVersion'];
type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformType = components['schemas']['PlatformType'];
type Product = components['schemas']['Product'];
type ProductFactsDraft = components['schemas']['ProductFactsDraft'];

const realStackEnabled = process.env.PARTSIGNAL_E2E_REAL_STACK === '1';
const apiBaseUrl = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';

test.skip(!realStackEnabled, '只由隔离真实栈入口运行');
test.setTimeout(90_000);

async function responseBody<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(`真实 E2E API 请求失败：${response.status()} ${response.url()} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function login(page: Page): Promise<AuthSession> {
  return responseBody<AuthSession>(await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { username: 'admin', password },
  }));
}

async function post<T>(
  page: Page,
  csrfToken: string,
  path: string,
  data: unknown,
  headers: Record<string, string> = {},
) {
  return responseBody<T>(await page.request.post(`${apiBaseUrl}${path}`, {
    data,
    headers: { 'X-CSRF-Token': csrfToken, ...headers },
  }));
}

async function createReadableVersion(page: Page, session: AuthSession, suffix: string) {
  const platformType = await post<PlatformType>(
    page,
    session.csrf_token,
    '/api/v1/platform-types',
    { name: `Version Detail 类型 ${suffix}`, slug: `version-detail-${suffix}` },
  );
  const platform = await post<PlatformProfile>(
    page,
    session.csrf_token,
    '/api/v1/platform-profiles',
    {
      allowed_domains: [`${suffix}.example.invalid`],
      name: `Version Detail 平台 ${suffix}`,
      platform_prompt_id: null,
      platform_type_id: platformType.id,
      slug: `version-detail-platform-${suffix}`,
    },
  );
  const product = await post<Product>(page, session.csrf_token, '/api/v1/products', {
    brand: 'PartSignal E2E',
    category: 'Content Version Detail 真实读取',
    part_number: `CVD-${suffix}`,
  });
  const initialFacts = await responseBody<ProductFactsDraft>(await page.request.get(
    `${apiBaseUrl}/api/v1/products/${product.id}/facts`,
  ));
  const savedFacts = await responseBody<ProductFactsDraft>(await page.request.put(
    `${apiBaseUrl}/api/v1/products/${product.id}/facts`,
    {
      data: {
        body_markdown: `# CVD-${suffix}\n\n- 工作电压：3.3 V`,
        classification: 'PUBLIC',
        expected_revision: initialFacts.revision,
      },
      headers: { 'X-CSRF-Token': session.csrf_token },
    },
  ));
  const fact = await post<FactVersion>(
    page,
    session.csrf_token,
    `/api/v1/products/${product.id}/fact-review-submissions`,
    { change_summary: `真实读取事实 ${suffix}`, expected_revision: savedFacts.revision },
  );
  await post<FactVersion>(
    page,
    session.csrf_token,
    `/api/v1/fact-versions/${fact.id}/approve`,
    { comment: '', expected_revision: fact.revision },
  );
  const task = await post<ContentTask>(
    page,
    session.csrf_token,
    '/api/v1/content-tasks',
    {
      fact_version_id: fact.id,
      platform_profile_id: platform.id,
      product_id: product.id,
    },
    { 'Idempotency-Key': `content-version-detail-${suffix}` },
  );
  const title = `CVD-${suffix} 不可变内容`;
  const version = await post<ContentVersion>(
    page,
    session.csrf_token,
    `/api/v1/content-tasks/${task.id}/manual-versions`,
    {
      body_markdown: `# ${title}\n\n真实 PostgreSQL 内容版本。`,
      change_summary: `创建只读版本 ${suffix}`,
      summary: 'Content Version Detail 独立真实栈摘要',
      tags: ['真实栈', '只读'],
      title,
    },
  );
  return { task, title, version };
}

test('独立真实栈：单一 detail GET 读取 HUMAN 当前版本且页面无写入口', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const { task, title, version } = await createReadableVersion(page, session, suffix);
  const browserApiRequests: Array<{ method: string; pathname: string }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(apiBaseUrl).origin && url.pathname.startsWith('/api/v1/')) {
      browserApiRequests.push({ method: request.method(), pathname: url.pathname });
    }
  });

  await page.goto(`/content/versions/${version.id}`);
  await expect(page.locator('#content-version-title')).toHaveText(title);
  await expect(page.getByText('人工创作', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('当前主线', { exact: true })).toBeVisible();
  await expect(page.getByText('只读 · 不可变快照')).toBeVisible();
  await expect(page.getByLabel(`内容版本 v${version.version} Markdown 快照`))
    .toContainText('真实 PostgreSQL 内容版本');
  await expect(page.getByText('该版本没有生成、Prompt 或模型快照。')).toBeVisible();
  await expect(page.getByRole('link', { name: '返回所属 Content Task' })).toHaveAttribute(
    'href',
    `/content/tasks/${task.id}`,
  );
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('.cm-editor, [contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /保存|删除|批准|退回|放弃/ })).toHaveCount(0);

  expect(browserApiRequests.filter(({ pathname }) => (
    pathname === `/api/v1/content-versions/${version.id}/detail`
  ))).toHaveLength(1);
  expect(browserApiRequests.filter(({ pathname }) => (
    pathname.includes('/review-context')
    || pathname.includes('/editor-context')
    || pathname.includes('/generation-jobs')
    || pathname.endsWith(`/content-versions/${version.id}`)
  ))).toEqual([]);
  expect(browserApiRequests.every(({ method }) => method === 'GET')).toBe(true);
});
