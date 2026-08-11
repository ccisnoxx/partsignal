/** 真实 PostgreSQL 与对象存储下验证 Publication Workspace Flow A/B。 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';

type AuthSession = components['schemas']['AuthSession'];
type Product = components['schemas']['Product'];
type ProductFactsDraft = components['schemas']['ProductFactsDraft'];
type FactVersion = components['schemas']['FactVersion'];
type PlatformType = components['schemas']['PlatformType'];
type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformAccount = components['schemas']['PlatformAccount'];
type ContentTask = components['schemas']['ContentTask'];
type ContentTaskDetail = components['schemas']['ContentTaskDetail'];
type ContentVersion = components['schemas']['ContentVersion'];
type PublicationWork = components['schemas']['PublicationWork'];
type PublicationWorkspaceContext = components['schemas']['PublicationWorkspaceContext'];
type PublishedArticle = components['schemas']['PublishedArticle'];

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

async function login(page: Page) {
  return responseBody<AuthSession>(await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { username: 'admin', password },
  }));
}

async function createPrerequisites(page: Page, csrfToken: string, suffix: string) {
  const headers = { 'X-CSRF-Token': csrfToken };
  const platformType = await responseBody<PlatformType>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-types`,
    { data: { name: `Publication Core-${suffix}`, slug: `publication-core-${suffix}` }, headers },
  ));
  const domain = `${suffix}.example.invalid`;
  const platform = await responseBody<PlatformProfile>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-profiles`,
    {
      data: {
        name: `Publication Core-${suffix}`,
        slug: `publication-core-${suffix}`,
        allowed_domains: [domain],
        platform_type_id: platformType.id,
        platform_prompt_id: null,
        website_url: `https://${domain}`,
      },
      headers,
    },
  ));
  const firstAccount = await responseBody<PlatformAccount>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-accounts`,
    { data: { platform_profile_id: platform.id, label: '首发账号', account_identifier: `first-${suffix}` }, headers },
  ));
  const secondAccount = await responseBody<PlatformAccount>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-accounts`,
    { data: { platform_profile_id: platform.id, label: '复核账号', account_identifier: `second-${suffix}` }, headers },
  ));
  const product = await responseBody<Product>(await page.request.post(`${apiBaseUrl}/api/v1/products`, {
    data: { part_number: `PUB-${suffix}`, brand: 'PartSignal E2E', category: 'Publication Core' },
    headers,
  }));
  const draft = await responseBody<ProductFactsDraft>(await page.request.get(
    `${apiBaseUrl}/api/v1/products/${product.id}/facts`,
  ));
  const savedDraft = await responseBody<ProductFactsDraft>(await page.request.put(
    `${apiBaseUrl}/api/v1/products/${product.id}/facts`,
    {
      data: {
        expected_revision: draft.revision,
        body_markdown: `# ${product.part_number}\n\n- 工作电压：3.3 V\n- 数据性质：本地虚构验收`,
        classification: 'PUBLIC',
      },
      headers,
    },
  ));
  const pendingFact = await responseBody<FactVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/products/${product.id}/fact-review-submissions`,
    { data: { expected_revision: savedDraft.revision, change_summary: `批准事实 ${suffix}` }, headers },
  ));
  const approvedFact = await responseBody<FactVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/fact-versions/${pendingFact.id}/approve`,
    { data: { expected_revision: pendingFact.revision, comment: `真实栈批准 ${suffix}` }, headers },
  ));
  const task = await responseBody<ContentTask>(await page.request.post(`${apiBaseUrl}/api/v1/content-tasks`, {
    data: { product_id: product.id, fact_version_id: approvedFact.id, platform_profile_id: platform.id },
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
  }));
  const draftContent = await responseBody<ContentVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/content-tasks/${task.id}/manual-versions`,
    {
      data: {
        title: `${product.part_number} 发布内容`,
        summary: 'Publication Workspace Core 真实栈摘要',
        body_markdown: `# ${product.part_number} 发布内容\n\n工作电压为 3.3 V。`,
        tags: ['真实栈', 'Publication Core'],
        change_summary: `创建发布稿 ${suffix}`,
      },
      headers,
    },
  ));
  const pendingContent = await responseBody<ContentVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/content-versions/${draftContent.id}/submit-review`,
    { data: { expected_revision: draftContent.revision, comment: `提交发布稿 ${suffix}` }, headers },
  ));
  const approvedContent = await responseBody<ContentVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/content-versions/${pendingContent.id}/approve`,
    { data: { expected_revision: pendingContent.revision, comment: `批准发布稿 ${suffix}` }, headers },
  ));
  const work = await responseBody<PublicationWork>(await page.request.post(
    `${apiBaseUrl}/api/v1/publication-works`,
    {
      data: { content_version_id: approvedContent.id, platform_account_id: firstAccount.id },
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
    },
  ));
  return { approvedContent, domain, secondAccount, work };
}

test('Flow A：V2 UI 完成准备、平台审核、截图上传与结果登记', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const setup = await createPrerequisites(page, session.csrf_token, suffix);

  await page.goto(`/publishing/work/${setup.work.id}#preparation`);
  await expect(page.locator('#publication-workspace-title')).toHaveText(setup.approvedContent.title);

  await page.getByRole('button', { name: '更新准备信息' }).click();
  let dialog = page.getByRole('dialog', { name: '更新准备信息' });
  await dialog.getByRole('combobox', { name: '发布账号' }).click();
  await page.getByRole('option', { name: new RegExp(setup.secondAccount.label) }).click();
  await dialog.getByRole('textbox', { name: '备注' }).fill(`切换到复核账号 ${suffix}`);
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '标记平台处理中' }).click();
  dialog = page.getByRole('dialog', { name: '标记平台处理中' });
  await dialog.getByRole('textbox', { name: '备注' }).fill(`平台审核 ${suffix}`);
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '登记发布结果' }).click();
  dialog = page.getByRole('dialog', { name: '登记发布结果' });
  const actualTitle = `${setup.approvedContent.title} · 已发布`;
  const finalUrl = `https://${setup.domain}/articles/${suffix}`;
  await dialog.getByRole('textbox', { name: '实际发布标题' }).fill(actualTitle);
  await dialog.getByRole('textbox', { name: '最终 URL' }).fill(finalUrl);
  await dialog.getByLabel('发布时间').fill('2026-08-11T12:00');
  await dialog.getByRole('textbox', { name: '备注' }).fill(`结果登记 ${suffix}`);
  await dialog.getByLabel('上传发布证据截图').setInputFiles({
    name: `publication-${suffix}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(dialog.getByText(new RegExp(`已校验：publication-${suffix}\\.png`))).toBeVisible();
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('发布结果已登记，可以开始人工核验。')).toBeVisible();

  const context = await responseBody<PublicationWorkspaceContext>(await page.request.get(
    `${apiBaseUrl}/api/v1/publication-works/${setup.work.id}/workspace-context`,
  ));
  expect(context.work.status).toBe('AWAITING_VERIFICATION');
  expect(context.work.actual_title).toBe(actualTitle);
  expect(context.work.final_url).toBe(finalUrl);
  expect(context.work.content_hash).toBe(setup.approvedContent.content_hash);
  expect(context.work.attachments).toHaveLength(1);
  expect(context.work.attachments[0]?.status).toBe('VERIFIED');
  expect(context.work.events.map((event) => event.action)).toEqual([
    'CREATED', 'PREPARATION_UPDATED', 'PLATFORM_REVIEW_MARKED', 'RESULT_REGISTERED',
  ]);
});

test('Flow B：失败核验经内容修订审批、换版和重登记后完成发布', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const setup = await createPrerequisites(page, session.csrf_token, suffix);
  const firstTitle = `${setup.approvedContent.title} · 首次发布`;
  const firstUrl = `https://${setup.domain}/articles/${suffix}-first`;

  await page.goto(`/publishing/work/${setup.work.id}#result`);
  await expect(page.locator('#publication-workspace-title')).toHaveText(setup.approvedContent.title);
  await page.getByRole('button', { name: '登记发布结果' }).click();
  let dialog = page.getByRole('dialog', { name: '登记发布结果' });
  await dialog.getByRole('textbox', { name: '实际发布标题' }).fill(firstTitle);
  await dialog.getByRole('textbox', { name: '最终 URL' }).fill(firstUrl);
  await dialog.getByLabel('发布时间').fill('2026-08-11T13:00');
  await dialog.getByRole('textbox', { name: '备注' }).fill(`首次结果 ${suffix}`);
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '核验发布结果' }).click();
  dialog = page.getByRole('dialog', { name: '核验发布结果' });
  await dialog.getByRole('radio', { name: '不一致，记录失败并进入内容修正' }).check();
  const failureComment = `公开正文未同步修订 ${suffix}`;
  await dialog.getByRole('textbox', { name: '核验说明' }).fill(failureComment);
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(failureComment).first()).toBeVisible();

  await page.getByRole('link', { name: '打开 Content Task 修正批准内容' }).click();
  await expect(page).toHaveURL(`/content/tasks/${setup.work.task_id}`);
  const reviseLink = page.getByRole('link', { name: '修订内容' });
  await expect(reviseLink).toHaveAttribute(
    'href',
    `/content/tasks/${setup.work.task_id}/editor`,
  );
  await reviseLink.click();
  await expect(page.getByText('新人工修订')).toBeVisible();

  const revisedTitle = `${setup.approvedContent.title} · 修订版`;
  const revisedBody = `# ${revisedTitle}\n\n工作电压为 3.3 V。\n\n失败核验修订：${suffix}`;
  await page.getByRole('textbox', { name: '标题' }).fill(revisedTitle);
  await page.getByRole('textbox', { name: '内容 Markdown' }).fill(revisedBody);
  await page.getByRole('textbox', { name: '变更说明' }).fill(`失败核验修订 ${suffix}`);
  await page.getByRole('button', { name: '创建人工修订' }).click();
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeVisible();

  const savedBody = `${revisedBody}\n\n保存确认：${suffix}`;
  await page.getByRole('textbox', { name: '内容 Markdown' }).fill(savedBody);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(/已保存 · Revision \d+/)).toBeVisible();
  await page.getByRole('button', { name: '提交审核' }).click();
  dialog = page.getByRole('dialog', { name: '提交内容审核' });
  await dialog.getByRole('textbox', { name: '备注（可选）' }).fill(`提交修订审核 ${suffix}`);
  await dialog.getByRole('button', { name: '确认提交审核' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('link', { name: '返回任务详情', exact: true }).click();
  await expect(page).toHaveURL(`/content/tasks/${setup.work.task_id}`);
  await page.getByRole('link', { name: '审核内容' }).click();
  await expect(page).toHaveURL(`/content/tasks/${setup.work.task_id}/review`);
  await expect(page.locator('#content-review-title')).toHaveText(revisedTitle);
  await page.getByRole('button', { name: '批准内容' }).click();
  await page.getByRole('dialog', { name: /批准内容版本 v\d+？/ })
    .getByRole('button', { name: '确认批准' })
    .click();
  await expect(page.getByText(/内容版本 v\d+ 已批准/).first()).toBeVisible();

  await page.getByRole('link', { name: '返回任务详情', exact: true }).click();
  await expect(page).toHaveURL(`/content/tasks/${setup.work.task_id}`);
  const continueLink = page.getByRole('link', { name: '继续发布' });
  await expect(continueLink).toHaveAttribute('href', `/publishing/work/${setup.work.id}`);
  await continueLink.click();

  const candidateContext = await responseBody<PublicationWorkspaceContext>(await page.request.get(
    `${apiBaseUrl}/api/v1/publication-works/${setup.work.id}/workspace-context`,
  ));
  expect(candidateContext.work.status).toBe('ACTION_REQUIRED');
  expect(candidateContext.work.content_version_id).toBe(setup.approvedContent.id);
  expect(candidateContext.switch_candidate).toMatchObject({ title: revisedTitle });
  const revisedContentId = candidateContext.switch_candidate?.id;
  if (!revisedContentId) throw new Error('内容批准后未返回合法换版候选');

  await page.getByRole('button', { name: '切换内容版本' }).click();
  dialog = page.getByRole('dialog', { name: '切换内容版本' });
  await dialog.getByRole('textbox', { name: '换版说明' }).fill(`采用批准修订 ${suffix}`);
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('内容版本已切换，请重新登记真实发布结果后再核验。')).toBeVisible();

  const finalTitle = `${revisedTitle} · 已发布`;
  const finalUrl = `https://${setup.domain}/articles/${suffix}-revised`;
  await page.getByRole('button', { name: '登记发布结果' }).click();
  dialog = page.getByRole('dialog', { name: '登记发布结果' });
  await dialog.getByRole('textbox', { name: '实际发布标题' }).fill(finalTitle);
  await dialog.getByRole('textbox', { name: '最终 URL' }).fill(finalUrl);
  await dialog.getByLabel('发布时间').fill('2026-08-11T14:00');
  await dialog.getByRole('textbox', { name: '备注' }).fill(`修订结果 ${suffix}`);
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('发布结果已登记，可以开始人工核验。')).toBeVisible();

  await page.getByRole('button', { name: '核验发布结果' }).click();
  dialog = page.getByRole('dialog', { name: '核验发布结果' });
  await dialog.getByRole('radio', { name: '一致，通过本次核验' }).check();
  await dialog.getByRole('textbox', { name: '核验说明' }).fill(`修订页面核验通过 ${suffix}`);
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('核验通过，发布成果已冻结为只读。')).toBeVisible();

  const finalContext = await responseBody<PublicationWorkspaceContext>(await page.request.get(
    `${apiBaseUrl}/api/v1/publication-works/${setup.work.id}/workspace-context`,
  ));
  expect(finalContext.work.status).toBe('COMPLETED');
  expect(finalContext.content.id).toBe(revisedContentId);
  expect(finalContext.work.verifications.map((item) => [item.outcome, item.content_version_id]))
    .toEqual([
      ['FAILED', setup.approvedContent.id],
      ['PASSED', revisedContentId],
    ]);
  expect(finalContext.work.events.map((event) => event.action)).toEqual([
    'CREATED',
    'RESULT_REGISTERED',
    'VERIFICATION_FAILED',
    'CONTENT_VERSION_CHANGED',
    'RESULT_REGISTERED',
    'COMPLETED',
  ]);
  const task = await responseBody<ContentTaskDetail>(await page.request.get(
    `${apiBaseUrl}/api/v1/content-tasks/${setup.work.task_id}/detail`,
  ));
  expect(task.task).toMatchObject({
    status: 'COMPLETED',
    workflow_stage: 'VERIFIED',
    primary_task: 'VIEW_FULL_LINEAGE',
  });
  const article = await responseBody<PublishedArticle>(await page.request.get(
    `${apiBaseUrl}/api/v1/published-articles/${setup.work.id}`,
  ));
  expect(article.id).toBe(setup.work.id);
  await expect(page.getByRole('button', {
    name: /登记发布结果|核验发布结果|切换内容版本|关闭发布工作/,
  })).toHaveCount(0);
});

test('Published Article：真实栈列表进入单请求只读详情', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const setup = await createPrerequisites(page, session.csrf_token, suffix);
  const headers = { 'X-CSRF-Token': session.csrf_token };
  const actualTitle = `${setup.approvedContent.title} · 成果 ${suffix}`;
  const finalUrl = `https://${setup.domain}/articles/${suffix}`;
  const registered = await responseBody<PublicationWork>(await page.request.put(
    `${apiBaseUrl}/api/v1/publication-works/${setup.work.id}/result`,
    {
      data: {
        actual_title: actualTitle,
        final_url: finalUrl,
        published_at: '2026-08-11T15:00:00Z',
        expected_revision: setup.work.revision,
        comment: `成果验收 ${suffix}`,
        attachment_file_ids: [],
      },
      headers,
    },
  ));
  await responseBody<PublicationWork>(await page.request.post(
    `${apiBaseUrl}/api/v1/publication-works/${setup.work.id}/verifications`,
    {
      data: {
        outcome: 'PASSED',
        content_matches: true,
        expected_revision: registered.revision,
        comment: `真实栈核验通过 ${suffix}`,
      },
      headers,
    },
  ));

  const articleRequests: Array<{ method: string; path: string }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/published-articles')) {
      articleRequests.push({ method: request.method(), path: url.pathname });
    }
  });

  await page.goto(`/publishing/articles?page=1&pageSize=20&q=${encodeURIComponent(suffix)}`);
  const articleLink = page.getByRole('link', { name: actualTitle });
  await expect(articleLink).toBeVisible();
  await articleLink.click();
  await expect(page).toHaveURL(`/publishing/articles/${setup.work.id}`);
  await expect(page.getByRole('heading', { level: 1, name: actualTitle })).toBeVisible();
  await expect(page.getByText('只读 · 不可变快照')).toBeVisible();
  await expect(page.getByRole('link', {
    name: `v${setup.approvedContent.version}`,
    exact: true,
  }))
    .toHaveAttribute('href', `/content/versions/${setup.approvedContent.id}`);
  await expect(page.getByText(setup.approvedContent.content_hash, { exact: true })).toBeVisible();
  await expect(page.getByLabel(`发布成果来源内容 v${setup.approvedContent.version} Markdown 快照`))
    .toContainText('工作电压为 3.3 V');
  await expect(page.getByText(`真实栈核验通过 ${suffix}`).first()).toBeVisible();
  await expect(page.getByText('首次核验通过').first()).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /编辑|删除|核验|登记|问题/ })).toHaveCount(0);
  expect(articleRequests).toEqual([
    { method: 'GET', path: '/api/v1/published-articles' },
    { method: 'GET', path: `/api/v1/published-articles/${setup.work.id}` },
  ]);
});
