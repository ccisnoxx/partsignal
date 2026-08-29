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
type PublishedContentIssueWorkspaceContext = components['schemas']['PublishedContentIssueWorkspaceContext'];

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
  return { approvedContent, approvedFact, domain, firstAccount, secondAccount, task };
}

async function createPublicationWork(
  page: Page,
  csrfToken: string,
  contentVersionId: string,
  platformAccountId: string,
) {
  return responseBody<PublicationWork>(await page.request.post(
    `${apiBaseUrl}/api/v1/publication-works`,
    {
      data: { content_version_id: contentVersionId, platform_account_id: platformAccountId },
      headers: { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': randomUUID() },
    },
  ));
}

test('Flow A：V2 UI 从开始发布连续完成成果、修复任务与问题解决', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const setup = await createPrerequisites(page, session.csrf_token, suffix);

  await page.goto('/publishing/work?page=1&pageSize=20');
  const readyCard = page.locator('article').filter({ hasText: setup.approvedContent.title });
  await expect(readyCard.getByRole('button', { name: '开始发布' })).toBeVisible();
  await readyCard.getByRole('button', { name: '开始发布' }).click();
  let dialog = page.getByRole('dialog', { name: `开始发布“${setup.approvedContent.title}”` });
  await dialog.getByRole('combobox', { name: '发布账号' }).click();
  await page.getByRole('option', {
    name: `${setup.firstAccount.label} · ${setup.firstAccount.account_identifier}`,
  }).click();
  await dialog.getByRole('button', { name: '确认开始' }).click();
  await expect(dialog).toBeHidden();

  const activeRow = page.locator('tbody tr').filter({ hasText: setup.approvedContent.title });
  const continuePreparation = activeRow.getByRole('link', { name: '继续准备' });
  const workHref = await continuePreparation.getAttribute('href');
  const workId = workHref?.match(/^\/publishing\/work\/([^#]+)#preparation$/)?.[1];
  if (!workId) throw new Error('UI START 后未返回合法的继续准备链接');
  await expect(page.locator('[role="status"]').filter({
    hasText: `已创建发布工作：${workId}`,
  })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
  const publicationActionCard = page.locator('[data-workbench-count="publication_actions"]');
  await expect(publicationActionCard.locator('p').nth(1)).toHaveText(/^[1-9]\d*$/);
  await expect(publicationActionCard.getByRole('link', { name: '继续准备' })).toHaveAttribute(
    'href',
    '/publishing/work?status=PREPARING&page=1&pageSize=20',
  );
  const preparationAttention = page.locator('.workbench-attention-link').filter({
    hasText: setup.approvedContent.title,
  });
  await expect(preparationAttention).toHaveCount(1);
  await expect(preparationAttention).toHaveAttribute(
    'href',
    `/publishing/work/${workId}#preparation`,
  );
  await preparationAttention.click();
  await expect(page).toHaveURL(`/publishing/work/${workId}#preparation`);
  await expect(page.locator('#publication-workspace-title')).toHaveText(setup.approvedContent.title);

  await page.getByRole('button', { name: '更新准备信息' }).click();
  dialog = page.getByRole('dialog', { name: '更新准备信息' });
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

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
  const verificationCard = page.locator('[data-workbench-count="publication_verifications"]');
  await expect(verificationCard.locator('p').nth(1)).toHaveText(/^[1-9]\d*$/);
  await expect(verificationCard.getByRole('link', { name: '查看待核验发布' })).toHaveAttribute(
    'href',
    '/publishing/work?status=AWAITING_VERIFICATION&page=1&pageSize=20',
  );
  const verificationAttention = page.locator('.workbench-attention-link').filter({
    hasText: setup.approvedContent.title,
  });
  await expect(verificationAttention).toHaveCount(1);
  await expect(verificationAttention).toHaveAttribute(
    'href',
    `/publishing/work/${workId}#verification`,
  );
  await verificationAttention.click();
  await expect(page).toHaveURL(`/publishing/work/${workId}#verification`);
  await expect(page.locator('#publication-workspace-title')).toHaveText(setup.approvedContent.title);
  await page.getByRole('button', { name: '核验发布结果' }).click();
  dialog = page.getByRole('dialog', { name: '核验发布结果' });
  const verificationComment = `直接核验通过 ${suffix}`;
  await dialog.getByRole('radio', { name: '一致，通过本次核验' }).check();
  await dialog.getByRole('textbox', { name: '核验说明' }).fill(verificationComment);
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('核验通过，发布成果已冻结为只读。')).toBeVisible();
  await expect(page.getByRole('button', {
    name: /登记发布结果|核验发布结果|切换内容版本|关闭发布工作/,
  })).toHaveCount(0);

  const articleLink = page.getByRole('link', { name: '前往发布成果详情' });
  await expect(articleLink).toHaveAttribute('href', `/publishing/articles/${workId}`);
  await articleLink.click();
  await expect(page).toHaveURL(`/publishing/articles/${workId}`);
  await expect(page.getByRole('heading', { level: 1, name: actualTitle })).toBeVisible();
  await expect(page.getByText(setup.approvedContent.content_hash, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '登记内容问题' })).toBeVisible();

  await page.getByRole('button', { name: '登记内容问题' }).click();
  dialog = page.getByRole('dialog', { name: `登记“${actualTitle}”的内容问题` });
  await dialog.getByRole('combobox', { name: '问题类型' }).click();
  await page.getByRole('option', { name: '公开内容发生变化' }).click();
  const issueDescription = `公开页面正文发生变化 ${suffix}`;
  await dialog.getByRole('textbox', { name: '问题描述' }).fill(issueDescription);
  await dialog.getByRole('button', { name: '确认登记' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/publishing\/issues\/[0-9a-f-]+#issue$/);
  const issueId = page.url().match(/\/publishing\/issues\/([^#]+)#issue$/)?.[1];
  if (!issueId) throw new Error('UI 登记问题后未进入合法的 Issue Workspace');

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
  const contentIssueCard = page.locator('[data-workbench-count="content_issues"]');
  await expect(contentIssueCard.locator('p').nth(1)).toHaveText(/^[1-9]\d*$/);
  await expect(contentIssueCard.getByRole('link', { name: '查看内容问题' })).toHaveAttribute(
    'href',
    '/publishing/issues?status=OPEN&page=1&pageSize=20',
  );
  const issueAttention = page.locator('.workbench-attention-link').filter({
    hasText: setup.approvedContent.title,
  });
  await expect(issueAttention).toHaveCount(1);
  await expect(issueAttention).toHaveAttribute(
    'href',
    `/publishing/issues/${issueId}#repair`,
  );
  await issueAttention.click();
  await expect(page).toHaveURL(`/publishing/issues/${issueId}#repair`);
  await expect(page.getByRole('button', { name: '创建修复任务' })).toBeVisible();
  await expect(page.getByRole('button', { name: '解决内容问题' })).toBeVisible();
  await page.getByRole('button', { name: '创建修复任务' }).click();
  dialog = page.getByRole('dialog', { name: '创建修复任务' });
  await dialog.getByRole('combobox', { name: '修复依据' }).click();
  await page.getByRole('option', {
    name: `FactVersion v${setup.approvedFact.version} · ${setup.approvedFact.change_summary}`,
  }).click();
  await dialog.getByRole('button', { name: '确认创建' }).click();
  await expect(dialog).toBeHidden();
  const repairTaskLink = page.locator('#repair a[href^="/content/tasks/"]');
  await expect(repairTaskLink).toBeVisible();
  const repairTaskHref = await repairTaskLink.getAttribute('href');
  const repairTaskId = repairTaskHref?.match(/^\/content\/tasks\/([^/]+)$/)?.[1];
  if (!repairTaskId) throw new Error('UI 创建修复任务后未返回合法的 ContentTask 链接');

  await page.goto('/publishing/issues?status=OPEN&page=1&pageSize=20');
  const issueRow = page.locator('tbody tr').filter({ hasText: actualTitle });
  const continueRepair = issueRow.getByRole('link', { name: '继续修复' });
  await expect(continueRepair).toHaveAttribute('href', `/content/tasks/${repairTaskId}`);
  await continueRepair.click();
  await expect(page).toHaveURL(`/content/tasks/${repairTaskId}`);
  await expect(page.getByText('CREATE_FIRST_DRAFT', { exact: true })).toBeVisible();
  const currentContentSection = page.getByRole('heading', { level: 2, name: '当前内容' })
    .locator('..').locator('..').locator('..');
  await expect(currentContentSection.getByText('暂无', { exact: true })).toBeVisible();
  const sourceIssueLink = page.getByRole('link', { name: '内容发生变化 · OPEN' });
  await expect(sourceIssueLink).toHaveAttribute('href', `/publishing/issues/${issueId}`);
  await sourceIssueLink.click();
  await expect(page).toHaveURL(`/publishing/issues/${issueId}#issue`);

  await page.getByRole('button', { name: '解决内容问题' }).click();
  dialog = page.getByRole('dialog', { name: '解决内容问题' });
  const resolutionComment = `公开页面已恢复 ${suffix}`;
  await dialog.getByRole('textbox', { name: '解决说明' }).fill(resolutionComment);
  await dialog.getByRole('button', { name: '确认解决' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('已恢复', { exact: true })).toBeVisible();
  await expect(page.getByText(resolutionComment, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /创建修复任务|解决内容问题/ })).toHaveCount(0);

  const finalContext = await responseBody<PublicationWorkspaceContext>(await page.request.get(
    `${apiBaseUrl}/api/v1/publication-works/${workId}/workspace-context`,
  ));
  const article = await responseBody<PublishedArticle>(await page.request.get(
    `${apiBaseUrl}/api/v1/published-articles/${workId}`,
  ));
  const issueContext = await responseBody<PublishedContentIssueWorkspaceContext>(await page.request.get(
    `${apiBaseUrl}/api/v1/published-content-issues/${issueId}/workspace-context`,
  ));
  const repairTask = await responseBody<ContentTaskDetail>(await page.request.get(
    `${apiBaseUrl}/api/v1/content-tasks/${repairTaskId}/detail`,
  ));

  expect(finalContext.work).toMatchObject({
    id: workId,
    task_id: setup.task.id,
    content_version_id: setup.approvedContent.id,
    content_hash: setup.approvedContent.content_hash,
    platform_account_id: setup.secondAccount.id,
    platform_account_label: setup.secondAccount.label,
    account_identifier: setup.secondAccount.account_identifier,
    actual_title: actualTitle,
    final_url: finalUrl,
    status: 'COMPLETED',
    primary_task: 'VIEW_COMPLETION',
    available_actions: [],
  });
  expect(finalContext.work.attachments).toHaveLength(1);
  expect(finalContext.work.attachments[0]?.status).toBe('VERIFIED');
  expect(finalContext.work.verifications).toHaveLength(1);
  expect(finalContext.work.verifications[0]).toMatchObject({
    outcome: 'PASSED',
    content_version_id: setup.approvedContent.id,
    actual_title_snapshot: actualTitle,
    final_url_snapshot: finalUrl,
    published_at_snapshot: finalContext.work.published_at,
    comment: verificationComment,
  });
  expect(finalContext.work.events.map((event) => event.action)).toEqual([
    'CREATED',
    'PREPARATION_UPDATED',
    'PLATFORM_REVIEW_MARKED',
    'RESULT_REGISTERED',
    'COMPLETED',
  ]);

  expect(article).toMatchObject({
    id: workId,
    task_id: setup.task.id,
    content_version_id: setup.approvedContent.id,
    content_hash: setup.approvedContent.content_hash,
    platform_account_id: setup.secondAccount.id,
    platform_account_label: setup.secondAccount.label,
    account_identifier: setup.secondAccount.account_identifier,
    actual_title: actualTitle,
    final_url: finalUrl,
    published_at: finalContext.work.published_at,
    has_open_issue: false,
    open_issue_id: null,
    workflow_stage: 'HEALTHY',
  });
  expect(article.verification).toEqual(finalContext.work.verifications[0]);
  expect(article.events).toEqual(finalContext.work.events);
  expect(article.source_content.content).toMatchObject({
    id: setup.approvedContent.id,
    task_id: setup.task.id,
    fact_version_id: setup.approvedFact.id,
    version: setup.approvedContent.version,
    title: setup.approvedContent.title,
    summary: setup.approvedContent.summary,
    body_markdown: setup.approvedContent.body_markdown,
    tags: setup.approvedContent.tags,
    content_hash: setup.approvedContent.content_hash,
  });
  expect(article.source_content.fact_version).toMatchObject({
    id: setup.approvedFact.id,
    version: setup.approvedFact.version,
    status: 'APPROVED',
  });
  expect(article.issues).toEqual([expect.objectContaining({
    id: issueId,
    kind: 'CONTENT_CHANGED',
    description: issueDescription,
    status: 'RESOLVED',
    resolution_outcome: 'RESTORED',
    resolution_comment: resolutionComment,
  })]);

  expect(issueContext.issue).toMatchObject({
    id: issueId,
    kind: 'CONTENT_CHANGED',
    description: issueDescription,
    published_article_id: workId,
    repair_task_id: repairTaskId,
    status: 'RESOLVED',
    revision: 1,
    workflow_stage: 'RESOLVED',
    primary_task: 'VIEW_RESOLUTION',
    available_actions: [],
    opened_by: session.user.id,
    resolution_outcome: 'RESTORED',
    resolution_comment: resolutionComment,
    resolved_by: session.user.id,
  });
  expect(issueContext.article.verification).toEqual(article.verification);
  expect(issueContext.article.events).toEqual(article.events);
  expect(issueContext.article.source_content).toEqual(article.source_content);
  expect(issueContext.repair_task).toMatchObject({
    id: repairTaskId,
    product_id: setup.task.product_id,
    fact_version_id: setup.approvedFact.id,
    platform_profile_id: setup.task.platform_profile_id,
    source_published_content_issue_id: issueId,
    current_content_version_id: null,
    status: 'OPEN',
    workflow_stage: 'NO_DRAFT',
    primary_task: 'CREATE_FIRST_DRAFT',
  });
  expect(repairTask.task).toMatchObject({
    id: repairTaskId,
    status: 'OPEN',
    workflow_stage: 'NO_DRAFT',
    primary_task: 'CREATE_FIRST_DRAFT',
  });
  expect(repairTask.current_content).toBeNull();
  expect(repairTask.source?.published_content_issue).toMatchObject({
    id: issueId,
    kind: 'CONTENT_CHANGED',
    status: 'RESOLVED',
    published_article_id: workId,
  });
});

test('Flow B：失败核验经内容修订审批、换版和重登记后完成发布', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const setup = await createPrerequisites(page, session.csrf_token, suffix);
  const work = await createPublicationWork(
    page,
    session.csrf_token,
    setup.approvedContent.id,
    setup.firstAccount.id,
  );
  const firstTitle = `${setup.approvedContent.title} · 首次发布`;
  const firstUrl = `https://${setup.domain}/articles/${suffix}-first`;

  await page.goto(`/publishing/work/${work.id}#result`);
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
  await expect(page).toHaveURL(`/content/tasks/${work.task_id}`);
  const reviseLink = page.getByRole('link', { name: '修订内容' });
  await expect(reviseLink).toHaveAttribute(
    'href',
    `/content/tasks/${work.task_id}/editor`,
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
  await expect(page).toHaveURL(`/content/tasks/${work.task_id}`);
  await page.getByRole('link', { name: '审核内容' }).click();
  await expect(page).toHaveURL(`/content/tasks/${work.task_id}/review`);
  await expect(page.locator('#content-review-title')).toHaveText(revisedTitle);
  await page.getByRole('button', { name: '批准内容' }).click();
  await page.getByRole('dialog', { name: /批准内容版本 v\d+？/ })
    .getByRole('button', { name: '确认批准' })
    .click();
  await expect(page.getByText(/内容版本 v\d+ 已批准/).first()).toBeVisible();

  await page.getByRole('link', { name: '返回任务详情', exact: true }).click();
  await expect(page).toHaveURL(`/content/tasks/${work.task_id}`);
  const continueLink = page.getByRole('link', { name: '继续发布' });
  await expect(continueLink).toHaveAttribute('href', `/publishing/work/${work.id}`);
  await continueLink.click();

  await page.getByRole('button', { name: '切换内容版本' }).click();
  dialog = page.getByRole('dialog', { name: '切换内容版本' });
  await expect(dialog.getByText(revisedTitle, { exact: true })).toBeVisible();
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
    `${apiBaseUrl}/api/v1/publication-works/${work.id}/workspace-context`,
  ));
  const revisedContentId = finalContext.content.id;
  expect(finalContext.work.status).toBe('COMPLETED');
  expect(revisedContentId).not.toBe(setup.approvedContent.id);
  expect(finalContext.content.title).toBe(revisedTitle);
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
    `${apiBaseUrl}/api/v1/content-tasks/${work.task_id}/detail`,
  ));
  expect(task.task).toMatchObject({
    status: 'COMPLETED',
    workflow_stage: 'VERIFIED',
    primary_task: 'VIEW_FULL_LINEAGE',
  });
  const article = await responseBody<PublishedArticle>(await page.request.get(
    `${apiBaseUrl}/api/v1/published-articles/${work.id}`,
  ));
  expect(article.id).toBe(work.id);
  await expect(page.getByRole('button', {
    name: /登记发布结果|核验发布结果|切换内容版本|关闭发布工作/,
  })).toHaveCount(0);
});

test('Published Article：真实栈列表进入单请求只读详情', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const setup = await createPrerequisites(page, session.csrf_token, suffix);
  const work = await createPublicationWork(
    page,
    session.csrf_token,
    setup.approvedContent.id,
    setup.firstAccount.id,
  );
  const headers = { 'X-CSRF-Token': session.csrf_token };
  const actualTitle = `${setup.approvedContent.title} · 成果 ${suffix}`;
  const finalUrl = `https://${setup.domain}/articles/${suffix}`;
  const registered = await responseBody<PublicationWork>(await page.request.put(
    `${apiBaseUrl}/api/v1/publication-works/${work.id}/result`,
    {
      data: {
        actual_title: actualTitle,
        final_url: finalUrl,
        published_at: '2026-08-11T15:00:00Z',
        expected_revision: work.revision,
        comment: `成果验收 ${suffix}`,
        attachment_file_ids: [],
      },
      headers,
    },
  ));
  await responseBody<PublicationWork>(await page.request.post(
    `${apiBaseUrl}/api/v1/publication-works/${work.id}/verifications`,
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
  await expect(page).toHaveURL(`/publishing/articles/${work.id}`);
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
  await expect(page.getByRole('button', { name: '登记内容问题' })).toBeVisible();
  await expect(page.getByRole('button', { name: /编辑|删除|核验|重新登记/ })).toHaveCount(0);
  expect(articleRequests).toEqual([
    { method: 'GET', path: '/api/v1/published-articles' },
    { method: 'GET', path: `/api/v1/published-articles/${work.id}` },
  ]);
});
