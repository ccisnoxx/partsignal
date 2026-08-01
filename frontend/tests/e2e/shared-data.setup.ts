/** 为依赖动态路由的浏览器验收准备一套真实、可复用的最小业务数据。 */
import { createHash, randomUUID } from 'node:crypto';
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

type SharedTask = {
  id: string;
  product: { id: string; brand: string; part_number: string };
  platform: { id: string };
};

async function hasSharedData(page: Page): Promise<boolean> {
  const tasks = await body<{ items: SharedTask[] }>(await page.request.get('/api/v1/content-tasks'));
  for (const task of tasks.items.filter((item) => item.product.part_number.startsWith('VISUAL-'))) {
    const suffix = task.product.part_number.slice('VISUAL-'.length);
    const [versions, jobs, candidates, observations, channels] = await Promise.all([
      body<{ items: unknown[] }>(await page.request.get(`/api/v1/content-tasks/${task.id}/content-versions`)),
      body<{ items: unknown[] }>(await page.request.get(`/api/v1/content-tasks/${task.id}/generation-jobs`)),
      body<{ items: Array<{ publication_record_id: string }> }>(await page.request.get(`/api/v1/geo-observation-publications?product_id=${task.product.id}`)),
      body<{ items: unknown[] }>(await page.request.get(`/api/v1/geo-observations?product_id=${task.product.id}&page_size=100`)),
      body<{ items: Array<{ id: string; name: string }> }>(await page.request.get(`/api/v1/ai-channels?q=${encodeURIComponent(`共享视觉渠道 ${suffix}`)}&page=1&page_size=50`)),
    ]);
    const channel = channels.items.find((item) => item.name === `共享视觉渠道 ${suffix}`);
    const candidate = candidates.items[0];
    if (!versions.items.length || !jobs.items.length || !candidate || !observations.items.length || !channel) continue;

    const [detail, models, logs, insights] = await Promise.all([
      body<{ headers: unknown[] }>(await page.request.get(`/api/v1/ai-channels/${channel.id}`)),
      body<{ items: unknown[] }>(await page.request.get(`/api/v1/ai-channels/${channel.id}/models`)),
      body<{ items: unknown[] }>(await page.request.get(`/api/v1/ai-channels/${channel.id}/audit-logs?page=1&page_size=20`)),
      body<{
        platform_performance: unknown[];
        content_rankings: { best: unknown[] };
        question_coverage: { matrix: unknown[] };
      }>(await page.request.get(`/api/v1/geo-insights?publication_record_id=${candidate.publication_record_id}`)),
    ]);
    if (detail.headers.length >= 2
      && models.items.length
      && logs.items.length
      && insights.platform_performance.length
      && insights.content_rankings.best.length
      && insights.question_coverage.matrix.length) return true;
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
  const prompt = await post<{ id: string; revision: number }>(page, '/api/v1/platform-prompts', csrf, {
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
  const content = await post<{ id: string; revision: number }>(page, `/api/v1/content-tasks/${task.id}/manual-versions`, csrf, {
    title: `共享视觉内容 ${suffix}`,
    summary: '用于动态内容路由的浏览器验收。',
    body_markdown: '不得将共享视觉验收数据用于真实选型。',
    tags: ['e2e'],
    change_summary: '创建共享视觉验收内容',
  });
  const channel = await post<{ id: string; revision: number }>(page, '/api/v1/ai-channels', csrf, {
    name: `共享视觉渠道 ${suffix}`,
    description: '用于 AI 渠道列表浏览器验收',
    protocol_type: 'openai-compatible-chat-completions',
    provider_brand: 'CUSTOM',
    base_url: 'http://127.0.0.1:9001/v1',
    api_key: `visual-${suffix}`,
    timeout_seconds: 30,
  });
  const firstHeader = await post<{ revision: number }>(page, `/api/v1/ai-channels/${channel.id}/headers`, csrf, {
    expected_channel_revision: channel.revision,
    name: 'X-E2E-Region',
    value: 'visual-test',
    is_sensitive: false,
  });
  const secondHeader = await post<{ revision: number }>(page, `/api/v1/ai-channels/${channel.id}/headers`, csrf, {
    expected_channel_revision: firstHeader.revision,
    name: 'X-E2E-Secret',
    value: 'visual-secret',
    is_sensitive: true,
  });
  const model = await post<{ id: string; revision: number }>(page, `/api/v1/ai-channels/${channel.id}/models`, csrf, {
    display_name: `共享视觉模型 ${suffix}`,
    model_id: 'e2e-model',
    request_parameters: { temperature: 0 },
  });
  const testedModel = await post<{ revision: number }>(page, `/api/v1/ai-models/${model.id}/test`, csrf, undefined);
  await post(page, `/api/v1/ai-models/${model.id}/enable`, csrf, { expected_revision: testedModel.revision });
  await post(page, `/api/v1/ai-channels/${channel.id}/enable`, csrf, { expected_revision: secondHeader.revision });

  const job = await body<{ id: string }>(await page.request.post(`/api/v1/content-tasks/${task.id}/generation-jobs`, {
    headers: {
      'X-CSRF-Token': csrf,
      'Idempotency-Key': `shared-visual-generation-${suffix}`,
    },
    data: {
      ai_model_id: model.id,
      platform_prompt_id: prompt.id,
      platform_prompt_revision: prompt.revision,
    },
  }));
  await expect.poll(async () => (
    await body<{ status: string }>(await page.request.get(`/api/v1/generation-jobs/${job.id}`))
  ).status, { timeout: 30_000 }).toBe('SUCCEEDED');

  const submittedContent = await post<{ revision: number }>(page, `/api/v1/content-versions/${content.id}/submit-review`, csrf, {
    expected_revision: content.revision,
    comment: '提交共享视觉验收内容',
  });
  await post(page, `/api/v1/content-versions/${content.id}/approve`, csrf, {
    expected_revision: submittedContent.revision,
    comment: '批准共享视觉验收内容',
  });

  const account = await post<{ id: string }>(page, '/api/v1/platform-accounts', csrf, {
    platform_profile_id: profile.id,
    label: `共享视觉账号 ${suffix}`,
    account_identifier: `visual-${suffix}`,
  });
  const evidenceBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const upload = await post<{
    file: { id: string };
    upload: { url: string; headers: Record<string, string> };
  }>(page, '/api/v1/files/upload-intents', csrf, {
    category: 'OPERATION_SCREENSHOT',
    original_filename: `shared-visual-${suffix}.png`,
    content_type: 'image/png',
    size: evidenceBytes.length,
    sha256: createHash('sha256').update(evidenceBytes).digest('hex'),
    access_level: 'INTERNAL',
  });
  expect((await page.request.put(upload.upload.url, { headers: upload.upload.headers, data: evidenceBytes })).status()).toBe(204);
  await post(page, `/api/v1/files/${upload.file.id}/complete`, csrf, undefined);

  const publication = await body<{ id: string }>(await page.request.post('/api/v1/publication-records/manual', {
    headers: {
      'X-CSRF-Token': csrf,
      'Idempotency-Key': `shared-visual-publication-${suffix}`,
    },
    data: {
      content_version_id: content.id,
      platform_account_id: account.id,
      section_url: 'https://visual.example.invalid/board',
      attachment_file_ids: [],
    },
  }));
  await post(page, `/api/v1/publication-records/${publication.id}/mark-platform-review`, csrf, {
    comment: '共享视觉验收平台审核',
  });
  await post(page, `/api/v1/publication-records/${publication.id}/mark-published`, csrf, {
    actual_title: `共享视觉发布 ${suffix}`,
    final_url: `https://visual.example.invalid/posts/${suffix}`,
    published_at: new Date().toISOString(),
    content_matches: null,
    comment: '共享视觉验收发布完成',
    attachment_file_ids: [upload.file.id],
  });
  await post(page, `/api/v1/publication-records/${publication.id}/verify`, csrf, {
    actual_title: null,
    final_url: null,
    published_at: null,
    content_matches: true,
    comment: '共享视觉验收核对一致',
    attachment_file_ids: [],
  });

  const topic = await post<{ id: string }>(page, '/api/v1/query-topics', csrf, {
    canonical_question: `${product.id} 的共享视觉验收问题`,
    intent_type: 'APPLICATION',
    variants: [`${product.id} 视觉验收`],
  });
  const candidates = await body<{ items: Array<{ publication_record_id: string }> }>(
    await page.request.get(`/api/v1/geo-observation-publications?product_id=${product.id}`),
  );
  // 内容排行要求同一发布记录至少有 3 个独立观测样本。
  for (let sample = 1; sample <= 3; sample += 1) {
    await post(page, '/api/v1/geo-observations', csrf, {
      product_id: product.id,
      query_topic_id: topic.id,
      search_platform: '共享视觉搜索平台',
      search_query: `${product.id} 共享视觉验收 ${sample}`,
      tested_at: new Date().toISOString(),
      article_results: candidates.items.map((item) => ({
        publication_record_id: item.publication_record_id,
        discovered: true,
        mentioned: true,
        accuracy: 'ACCURATE',
      })),
      attachment_file_ids: [upload.file.id],
      notes: '仅用于本地和 CI 的 24 表门禁验收。',
    });
  }

  expect(await hasSharedData(page)).toBe(true);
});
