/** 以虚构数据验证事实、生成、审核、发布、文件和 GEO 观测纵向闭环。 */
import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';

test.setTimeout(120_000);

async function body<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${response.request().method()} ${response.url()}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function login(page: Page, username: string): Promise<string> {
  await page.goto('/login');
  await page.getByLabel('账号').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/$/);
  const token = await body<{ csrf_token: string }>(await page.request.get('/api/v1/auth/csrf'));
  return token.csrf_token;
}

async function switchUser(page: Page, csrf: string, username: string): Promise<string> {
  const response = await page.request.post('/api/v1/auth/logout', {
    headers: { 'X-CSRF-Token': csrf },
  });
  expect(response.status()).toBe(204);
  return login(page, username);
}

async function command(page: Page, path: string, csrf: string, data: unknown) {
  return body<Record<string, unknown>>(await page.request.post(path, {
    headers: { 'X-CSRF-Token': csrf },
    data,
  }));
}

test('批准事实到人工发布和 GEO 观测保持完整追溯', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  let csrf = await login(page, 'product_editor');

  await page.getByRole('menuitem', { name: '产品事实' }).click();
  await page.getByRole('button', { name: '新增产品' }).click();
  await page.getByLabel('产品型号').fill(`DEMO-${suffix}`);
  await page.getByLabel('品牌').fill('DEMO');
  await page.getByLabel('类别').fill('TEST');
  await page.getByRole('button', { name: '创建事实工作区' }).click();
  await expect(page.getByText(`DEMO-${suffix}`)).toBeVisible();

  const products = await body<{ items: Array<{ id: string; part_number: string }> }>(
    await page.request.get(`/api/v1/products?page=1&page_size=100&search=DEMO-${suffix}`),
  );
  const product = products.items.find((item) => item.part_number === `DEMO-${suffix}`);
  expect(product).toBeTruthy();

  const facts = {
    expected_revision: 0,
    reference_parts: [{ client_key: 'ref', part_number: `REF-${suffix}`, manufacturer: 'DEMO-REF', category: 'TEST' }],
    parameters: [{ client_key: 'voltage', owner_key: 'product', key: 'voltage', name: '工作电压', value_type: 'NUMERIC', min_value: null, typical_value: 5, max_value: null, text_value: null, unit: 'V', test_conditions: '室温', is_critical: true, evidence_keys: ['datasheet'] }],
    replacement_relations: [{ client_key: 'replacement', reference_part_key: 'ref', replacement_level: 'FUNCTIONALLY_SIMILAR', conditions: '仅用于本地虚构验收', exclusions: '不得用于真实选型', evidence_keys: ['datasheet'] }],
    evidences: [{ client_key: 'datasheet', type: 'DATASHEET', title: '虚构开发数据手册', version: 'v1', source_url: 'https://example.invalid/datasheet.pdf', file_id: null, confidentiality: 'PUBLIC' }],
    claims: [{ client_key: 'disclosure', type: 'REQUIRED_DISCLOSURE', text: '不得将虚构验收数据用于真实选型。', evidence_keys: ['datasheet'] }],
  };
  await body(await page.request.put(`/api/v1/products/${product!.id}/facts`, { headers: { 'X-CSRF-Token': csrf }, data: facts }));
  const factVersion = await command(page, `/api/v1/products/${product!.id}/fact-versions`, csrf, { change_summary: 'E2E 虚构事实快照' });
  await command(page, `/api/v1/fact-versions/${factVersion.id as string}/submit`, csrf, { expected_revision: 0, comment: '提交审核' });

  csrf = await switchUser(page, csrf, 'product_reviewer');
  await page.goto(`/products/${product!.id}`);
  await page.getByRole('tab', { name: /事实版本/ }).click();
  await page.getByRole('button', { name: /批\s*准/ }).click();
  await expect(page.getByText('批准前必须核对下方不可变快照，而不是当前事实工作区。')).toBeVisible();
  await page.getByLabel('审核意见').fill('批准虚构事实');
  await page.getByRole('button', { name: /确\s*认/ }).click();
  await expect(page.getByText('已批准', { exact: true })).toBeVisible();

  csrf = await switchUser(page, csrf, 'admin');
  const profile = await command(page, '/api/v1/platform-profiles', csrf, { name: `E2E 论坛 ${suffix}`, slug: `e2e-forum-${suffix}`, allowed_domains: ['forum.example.invalid'], rules: { target_audience: '测试工程师', title_min: 1, title_max: 120, body_min: 1, body_max: 5000, tone: '技术说明', allow_external_links: true, allow_tables: true, allow_contact: false, prohibited_phrases: ['绝对领先'], sections: [{ name: '测试栏目', url: 'https://forum.example.invalid/board' }] } });
  await page.goto('/settings');
  await page.getByRole('tab', { name: '平台规则' }).click();
  await expect(page.getByText(`E2E 论坛 ${suffix}`)).toBeVisible();

  csrf = await switchUser(page, csrf, 'content_editor');
  const topic = await command(page, '/api/v1/query-topics', csrf, { canonical_question: `${product!.part_number} 如何替代？`, intent_type: 'REPLACEMENT', variants: [`${product!.part_number} 替代方案`] });
  const task = await command(page, '/api/v1/content-tasks', csrf, { query_topic_id: topic.id, product_id: product!.id, fact_version_id: factVersion.id, platform_profile_version_id: (profile.active_version as { id: string }).id, target_audience: '测试工程师', content_angle: '虚构参数与替代边界', conversion_goal: '查看虚构资料', desired_format: '工程说明', desired_length_min: 1, desired_length_max: 5000, canonical_url: `https://example.invalid/products/${product!.part_number}` });
  const job = await body<{ id: string }>(await page.request.post(`/api/v1/content-tasks/${task.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-${suffix}` } }));
  await expect.poll(async () => (await body<{ status: string; content_version_id: string | null }>(await page.request.get(`/api/v1/generation-jobs/${job.id}`))).status, { timeout: 30_000 }).toBe('SUCCEEDED');
  const completedJob = await body<{ content_version_id: string }>(await page.request.get(`/api/v1/generation-jobs/${job.id}`));
  const submittedId = completedJob.content_version_id;
  await page.goto(`/tasks/${task.id as string}`);
  await expect(page.getByText('成功').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'V1' })).toBeVisible();
  await page.goto(`/content/${submittedId}`);
  await page.getByRole('button', { name: '提交审核' }).click();
  await page.getByLabel('审核意见').fill('提交内容审核');
  await page.getByRole('button', { name: /确\s*认/ }).click();
  await expect(page.getByText('待审核')).toBeVisible();

  csrf = await switchUser(page, csrf, 'content_reviewer');
  await page.goto(`/content/${submittedId}`);
  await page.getByRole('button', { name: /批\s*准/ }).click();
  await page.getByLabel('审核意见').fill('批准虚构内容');
  await page.getByRole('button', { name: /确\s*认/ }).click();
  await expect(page.getByText('已批准', { exact: true })).toBeVisible();

  csrf = await switchUser(page, csrf, 'content_editor');
  const account = await command(page, '/api/v1/platform-accounts', csrf, { platform_profile_id: profile.id, label: `E2E 账号 ${suffix}`, account_identifier: `e2e-${suffix}` });
  const bytes = Buffer.from(`PartSignal E2E screenshot ${suffix}`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const upload = await command(page, '/api/v1/files/upload-intents', csrf, { category: 'OPERATION_SCREENSHOT', original_filename: 'e2e.txt.png', content_type: 'image/png', size: bytes.length, sha256: digest, access_level: 'INTERNAL' });
  const uploadInstruction = upload.upload as { url: string; headers: Record<string, string> };
  const uploadResponse = await page.request.put(uploadInstruction.url, {
    headers: uploadInstruction.headers,
    data: bytes,
  });
  expect(uploadResponse.status()).toBe(204);
  const file = await command(page, `/api/v1/files/${(upload.file as { id: string }).id}/complete`, csrf, undefined);
  const publication = await body<{ id: string }>(await page.request.post('/api/v1/publication-records/manual', { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-publication-${suffix}` }, data: { content_version_id: submittedId, platform_account_id: account.id, section_url: 'https://forum.example.invalid/board', attachment_file_ids: [file.id] } }));
  await command(page, `/api/v1/publication-records/${publication.id}/mark-platform-review`, csrf, { comment: '平台审核中' });
  await command(page, `/api/v1/publication-records/${publication.id}/mark-published`, csrf, { actual_title: `E2E ${suffix}`, final_url: `https://forum.example.invalid/posts/${suffix}`, published_at: new Date().toISOString(), content_matches: null, comment: '人工发布完成' });
  await command(page, `/api/v1/publication-records/${publication.id}/verify`, csrf, { actual_title: null, final_url: null, published_at: null, content_matches: true, comment: '人工核对一致' });
  await page.goto('/publications');
  await expect(page.locator(`a[href="https://forum.example.invalid/posts/${suffix}"]`)).toBeVisible();

  csrf = await switchUser(page, csrf, 'analyst');
  await command(page, '/api/v1/geo-observations', csrf, { query_topic_id: topic.id, product_id: product!.id, actual_prompt: `${product!.part_number} 如何替代？`, model_name: 'E2E-DETERMINISTIC', model_version: 'v1', tested_at: new Date().toISOString(), web_search_enabled: true, answer_summary: '虚构 E2E 回答摘要', mentioned: true, recommendation: 'RECOMMENDED', accuracy: 'ACCURATE', citations: [{ url: `https://forum.example.invalid/posts/${suffix}`, source_type: 'EXTERNAL_COMPANY', publication_record_id: publication.id }], publication_record_ids: [publication.id], attachment_file_ids: [file.id], notes: '仅用于自动化验收', supersedes_id: null });
  const metrics = await body<{ sample_count: number; mention_rate: number }>(await page.request.get(`/api/v1/geo-metrics?product_id=${product!.id}`));
  expect(metrics.sample_count).toBe(1);
  expect(metrics.mention_rate).toBe(1);
  await page.goto('/observations');
  await expect(page.getByText('E2E-DETERMINISTIC').first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天的内容链路' })).toBeVisible();
});
