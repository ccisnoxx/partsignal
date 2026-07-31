/** 为依赖动态路由的浏览器验收准备一套真实、可复用的最小业务数据。 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';

async function body<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`${response.status()} ${response.url()}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function post<T>(page: Page, path: string, csrf: string, data: unknown): Promise<T> {
  return body<T>(await page.request.post(path, {
    headers: { 'X-CSRF-Token': csrf },
    data,
  }));
}

async function hasSharedData(page: Page): Promise<boolean> {
  const [products, tasks, profiles, channels] = await Promise.all([
    body<{ items: unknown[] }>(await page.request.get('/api/v1/products')),
    body<{ items: Array<{ id: string }> }>(await page.request.get('/api/v1/content-tasks')),
    body<{ items: unknown[] }>(await page.request.get('/api/v1/platform-profiles')),
    body<{ items: unknown[] }>(await page.request.get('/api/v1/ai-channels?page=1&page_size=10')),
  ]);
  for (const task of tasks.items) {
    const versions = await body<{ items: unknown[] }>(
      await page.request.get(`/api/v1/content-tasks/${task.id}/content-versions`),
    );
    if (products.items.length && profiles.items.length && channels.items.length && versions.items.length) return true;
  }
  return false;
}

test('准备共享视觉验收数据', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('账号').fill('admin');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/$/);
  const { csrf_token: csrf } = await body<{ csrf_token: string }>(
    await page.request.get('/api/v1/auth/csrf'),
  );
  if (await hasSharedData(page)) return;

  const suffix = randomUUID().slice(0, 8);
  const product = await post<{ id: string }>(page, '/api/v1/products', csrf, {
    part_number: `VISUAL-${suffix}`,
    brand: 'PartSignal',
    category: 'TEST',
  });
  await body(await page.request.put(`/api/v1/products/${product.id}/facts`, {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      expected_revision: 0,
      body_markdown: '# 共享视觉验收事实\n\n- 仅用于本地和 CI 浏览器验收。',
      classification: 'PUBLIC',
    },
  }));
  const factVersion = await post<{ id: string; revision: number }>(
    page,
    `/api/v1/products/${product.id}/fact-versions`,
    csrf,
    { change_summary: '创建共享视觉验收事实快照' },
  );
  const submittedFact = await post<{ revision: number }>(
    page,
    `/api/v1/fact-versions/${factVersion.id}/submit`,
    csrf,
    { expected_revision: factVersion.revision, comment: '提交共享视觉验收事实' },
  );
  await post(
    page,
    `/api/v1/fact-versions/${factVersion.id}/approve`,
    csrf,
    { expected_revision: submittedFact.revision, comment: '批准共享视觉验收事实' },
  );

  const platformType = await post<{ id: string }>(page, '/api/v1/platform-types', csrf, {
    name: `共享视觉平台类型 ${suffix}`,
    slug: `visual-type-${suffix}`,
  });
  const prompt = await post<{ id: string }>(page, '/api/v1/platform-prompts', csrf, {
    name: `共享视觉 Prompt ${suffix}`,
    template_markdown: '仅依据已批准事实生成测试内容。',
  });
  const profile = await post<{ id: string }>(page, '/api/v1/platform-profiles', csrf, {
    name: `共享视觉平台 ${suffix}`,
    slug: `visual-platform-${suffix}`,
    allowed_domains: ['visual.example.invalid'],
    platform_type_id: platformType.id,
    platform_prompt_id: prompt.id,
  });
  const task = await body<{ id: string }>(await page.request.post('/api/v1/content-tasks', {
    headers: {
      'X-CSRF-Token': csrf,
      'Idempotency-Key': `shared-visual-${suffix}`,
    },
    data: {
      product_id: product.id,
      fact_version_id: factVersion.id,
      platform_profile_id: profile.id,
    },
  }));
  await post(page, `/api/v1/content-tasks/${task.id}/manual-versions`, csrf, {
    title: `共享视觉内容 ${suffix}`,
    summary: '用于动态内容路由的浏览器验收。',
    body_markdown: '不得将共享视觉验收数据用于真实选型。',
    tags: ['e2e'],
    change_summary: '创建共享视觉验收内容',
  });
  await post(page, '/api/v1/ai-channels', csrf, {
    name: `共享视觉渠道 ${suffix}`,
    description: '用于 AI 渠道列表浏览器验收',
    protocol_type: 'openai-compatible-chat-completions',
    provider_brand: 'CUSTOM',
    base_url: 'http://127.0.0.1:9001/v1',
    api_key: `visual-${suffix}`,
    timeout_seconds: 30,
  });

  expect(await hasSharedData(page)).toBe(true);
});
