/** 通过 V2 页面验证真实 Content 批准与退回修订完整闭环。 */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIResponse,
  type Page,
} from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';

type AuthSession = components['schemas']['AuthSession'];
type ContentReviewContext = components['schemas']['ContentReviewContext'];
type ContentTaskDetail = components['schemas']['ContentTaskDetail'];
type ContentVersionDetail = components['schemas']['ContentVersionDetail'];
type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformType = components['schemas']['PlatformType'];
type ImmutableContent = Pick<
  ContentReviewContext['content'],
  | 'based_on_id'
  | 'body_markdown'
  | 'content_hash'
  | 'fact_version_id'
  | 'id'
  | 'source_job_id'
  | 'source_type'
  | 'summary'
  | 'tags'
  | 'task_id'
  | 'title'
  | 'version'
>;

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

async function createActivePlatform(page: Page, csrfToken: string, suffix: string) {
  const headers = { 'X-CSRF-Token': csrfToken };
  const platformType = await responseBody<PlatformType>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-types`,
    { data: { name: `Content Review 平台-${suffix}`, slug: `content-review-${suffix}` }, headers },
  ));
  return responseBody<PlatformProfile>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-profiles`,
    {
      data: {
        name: `Content Review 平台-${suffix}`,
        slug: `content-review-${suffix}`,
        allowed_domains: [`${suffix}.example.invalid`],
        platform_type_id: platformType.id,
        platform_prompt_id: null,
      },
      headers,
    },
  ));
}

async function createApprovedProduct(page: Page, suffix: string) {
  const partNumber = `CR-${suffix}`;
  await page.goto('/products/new');
  await page.getByRole('textbox', { name: '产品型号' }).fill(partNumber);
  await page.getByRole('textbox', { name: '品牌' }).fill('PartSignal E2E');
  await page.getByRole('textbox', { name: '类别' }).fill('Content Review 真实闭环');
  await page.getByRole('button', { name: '创建产品' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+$/i);
  const productId = new URL(page.url()).pathname.split('/').at(-1);
  if (!productId) throw new Error('创建产品后 URL 缺少 productId');

  await page.getByRole('link', { name: '录入事实', exact: true }).click();
  await page.getByRole('textbox', { name: '事实 Markdown' }).fill(
    `# ${partNumber}\n\n- 工作电压：3.3 V\n- 数据性质：本地虚构验收`,
  );
  await page.getByRole('combobox', { name: '数据级别' }).click();
  await page.getByRole('option', { name: '公开' }).click();
  await page.getByRole('button', { name: '保存事实' }).click();
  await expect(page.getByText(/已保存 · Revision \d+/)).toBeVisible();
  await page.getByRole('button', { name: '提交事实审核' }).click();
  const submit = page.getByRole('dialog', { name: '提交事实审核' });
  await submit.getByRole('textbox', { name: '变更摘要' }).fill(`批准事实 ${suffix}`);
  await submit.getByRole('button', { name: '确认提交审核' }).click();

  await page.goto('/products');
  const search = page.getByRole('searchbox', { name: '搜索产品' });
  await search.fill(partNumber);
  await search.press('Enter');
  const row = page.getByRole('row').filter({
    has: page.getByRole('link', { name: partNumber, exact: true }),
  });
  await row.getByRole('link', { name: '审核', exact: true }).click();
  await page.getByRole('button', { name: '批准事实' }).click();
  await page.getByRole('dialog', { name: /批准事实版本 v\d+？/ })
    .getByRole('button', { name: '确认批准' })
    .click();
  await expect(page.getByText(/事实版本 v\d+ 已批准/).first()).toBeVisible();
  return { partNumber, productId };
}

async function createReviewReadyTask(
  page: Page,
  product: { partNumber: string; productId: string },
  platformName: string,
  suffix: string,
) {
  await page.goto(`/products/${product.productId}`);
  await page.getByRole('link', { name: '创建内容', exact: true }).click();
  await page.getByRole('combobox', { name: '已批准事实版本' }).click();
  await page.getByRole('option', { name: /v\d+ · 公开/ }).click();
  await page.getByRole('combobox', { name: '目标平台' }).click();
  await page.getByRole('option', { name: platformName, exact: true }).click();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(/\/content\/tasks\/[0-9a-f-]+$/i);
  const taskId = new URL(page.url()).pathname.split('/').at(-1);
  if (!taskId) throw new Error('创建内容任务后 URL 缺少 taskId');

  await page.getByRole('link', { name: '创建初稿' }).click();
  await page.getByRole('textbox', { name: '标题' }).fill(`${product.partNumber} 审核内容`);
  await page.getByRole('textbox', { name: '摘要' }).fill('Content Review 真实栈摘要');
  await page.getByRole('textbox', { name: '标签' }).fill('真实栈\n审核');
  await page.getByRole('textbox', { name: '变更说明' }).fill(`创建审核稿 ${suffix}`);
  await page.getByRole('textbox', { name: '内容 Markdown' }).fill(
    `# ${product.partNumber} 审核内容\n\n工作电压为 3.3 V。`,
  );
  await page.getByRole('button', { name: '创建人工首稿' }).click();
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeVisible();
  await page.getByRole('textbox', { name: '内容 Markdown' }).fill(
    `# ${product.partNumber} 审核内容\n\n工作电压为 3.3 V。\n\n人工编辑标记：${suffix}`,
  );
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(/已保存 · Revision \d+/)).toBeVisible();
  await page.getByRole('button', { name: '提交审核' }).click();
  const submit = page.getByRole('dialog', { name: '提交内容审核' });
  await submit.getByRole('textbox', { name: '备注（可选）' }).fill(`真实栈提交 ${suffix}`);
  await submit.getByRole('button', { name: '确认提交审核' }).click();
  await expect(submit).toBeHidden();

  await page.getByRole('link', { name: '返回任务详情', exact: true }).click();
  await expect(page).toHaveURL(`/content/tasks/${taskId}`);
  await page.getByRole('link', { name: '审核内容' }).click();
  await expect(page).toHaveURL(`/content/tasks/${taskId}/review`);
  await expect(page.locator('#content-review-title')).toHaveText(`${product.partNumber} 审核内容`);
  return taskId;
}

async function reviewContext(page: Page, taskId: string) {
  return responseBody<ContentReviewContext>(await page.request.get(
    `${apiBaseUrl}/api/v1/content-tasks/${taskId}/review-context`,
  ));
}

async function taskDetail(page: Page, taskId: string) {
  return responseBody<ContentTaskDetail>(await page.request.get(
    `${apiBaseUrl}/api/v1/content-tasks/${taskId}/detail`,
  ));
}

async function versionDetail(page: Page, versionId: string) {
  return responseBody<ContentVersionDetail>(await page.request.get(
    `${apiBaseUrl}/api/v1/content-versions/${versionId}/detail`,
  ));
}

function immutableContent(content: ImmutableContent) {
  return {
    based_on_id: content.based_on_id,
    body_markdown: content.body_markdown,
    content_hash: content.content_hash,
    fact_version_id: content.fact_version_id,
    id: content.id,
    source_job_id: content.source_job_id,
    source_type: content.source_type,
    summary: content.summary,
    tags: content.tags,
    task_id: content.task_id,
    title: content.title,
    version: content.version,
  };
}

test('Flow A：人工内容批准后进入只读版本并出现发布交接', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const platform = await createActivePlatform(page, session.csrf_token, suffix);
  const product = await createApprovedProduct(page, suffix);
  const taskId = await createReviewReadyTask(page, product, platform.name, suffix);
  const before = await reviewContext(page, taskId);

  await page.getByRole('button', { name: '批准内容' }).click();
  await page.getByRole('dialog', { name: /批准内容版本 v\d+？/ })
    .getByRole('button', { name: '确认批准' })
    .click();
  await expect(page.getByText(/内容版本 v\d+ 已批准/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /批准内容|退回修改/ })).toHaveCount(0);

  const after = await reviewContext(page, taskId);
  expect(after.content.status).toBe('APPROVED');
  expect(after.task.workflow_stage).toBe('APPROVED');
  expect(after.task.primary_task).toBe('START_PUBLICATION');
  expect(after.task.current_content_version_id).toBe(before.content.id);
  expect(after.available_actions).toEqual([]);
  expect(immutableContent(after.content)).toEqual(immutableContent(before.content));
  expect(after.review_history.map((record) => record.action)).toEqual([
    ...before.review_history.map((record) => record.action),
    'approve',
  ]);

  await page.getByRole('link', { name: '返回任务详情', exact: true }).click();
  await expect(page).toHaveURL(`/content/tasks/${taskId}`);
  await expect(page.getByText('START_PUBLICATION', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '开始发布' })).toHaveAttribute(
    'href',
    '/publishing/work',
  );
  const currentContent = page.getByRole('heading', { name: '当前内容' })
    .locator('xpath=ancestor::section[1]');
  const approvedVersionLink = currentContent.getByRole('link', {
    name: `v${before.content.version}`,
    exact: true,
  });
  await expect(currentContent).toContainText('已批准');
  await expect(approvedVersionLink).toHaveAttribute(
    'href',
    `/content/versions/${before.content.id}`,
  );

  const detail = await taskDetail(page, taskId);
  expect(detail.task.workflow_stage).toBe('APPROVED');
  expect(detail.task.primary_task).toBe('START_PUBLICATION');
  expect(detail.current_content).toMatchObject({
    id: before.content.id,
    status: 'APPROVED',
    version: before.content.version,
  });

  await approvedVersionLink.click();
  await expect(page).toHaveURL(`/content/versions/${before.content.id}`);
  await expect(page.locator('#content-version-title')).toHaveText(before.content.title);
  await expect(page.getByText('当前主线', { exact: true })).toBeVisible();
  await expect(page.getByText('只读 · 不可变快照')).toBeVisible();
  const reviewResult = page.getByRole('heading', { name: '审核结果' })
    .locator('xpath=ancestor::section[1]');
  await expect(reviewResult).toContainText('批准内容');
  await expect(reviewResult).toContainText(`v${before.content.version}`);

  const approved = await versionDetail(page, before.content.id);
  expect(approved.content).toMatchObject({
    id: before.content.id,
    is_current: true,
    status: 'APPROVED',
  });
  expect(approved.review_result).toMatchObject({
    action: 'approve',
    target_id: before.content.id,
    target_version: before.content.version,
  });
});

test('Flow B：退回后创建 HUMAN revision，重新送审批准且历史不串线', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const platform = await createActivePlatform(page, session.csrf_token, suffix);
  const product = await createApprovedProduct(page, suffix);
  const taskId = await createReviewReadyTask(page, product, platform.name, suffix);
  const before = await reviewContext(page, taskId);
  const comment = `请补充平台约束 ${suffix}`;

  await page.getByRole('button', { name: '退回修改' }).click();
  const dialog = page.getByRole('dialog', { name: /退回内容版本 v\d+/ });
  await dialog.getByRole('textbox', { name: '审核意见' }).fill(comment);
  await dialog.getByRole('button', { name: '确认退回' }).click();
  await expect(page.getByText(/内容版本 v\d+ 已退回修改/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /批准内容|退回修改/ })).toHaveCount(0);

  const after = await reviewContext(page, taskId);
  expect(after.content.status).toBe('CHANGES_REQUESTED');
  expect(after.task.workflow_stage).toBe('CHANGES_REQUESTED');
  expect(after.task.primary_task).toBe('REVISE_CONTENT');
  expect(after.task.current_content_version_id).toBe(before.content.id);
  expect(after.available_actions).toEqual([]);
  expect(immutableContent(after.content)).toEqual(immutableContent(before.content));
  expect(after.review_history.at(-1)).toMatchObject({ action: 'request-changes', comment });

  await page.getByRole('link', { name: '返回任务详情', exact: true }).click();
  await expect(page).toHaveURL(`/content/tasks/${taskId}`);
  const reviseLink = page.getByRole('link', { name: '修订内容' });
  await expect(reviseLink).toHaveAttribute('href', `/content/tasks/${taskId}/editor`);
  await reviseLink.click();
  await expect(page).toHaveURL(`/content/tasks/${taskId}/editor`);
  await expect(page.getByText('新人工修订')).toBeVisible();

  const revisedTitle = `${product.partNumber} 修订内容`;
  const revisedBody = `# ${revisedTitle}\n\n工作电压为 3.3 V。\n\n已根据审核意见修订：${suffix}`;
  await page.getByRole('textbox', { name: '标题' }).fill(revisedTitle);
  await page.getByRole('textbox', { name: '变更说明' }).fill(`退回后修订 ${suffix}`);
  await page.getByRole('textbox', { name: '内容 Markdown' }).fill(revisedBody);
  await page.getByRole('button', { name: '创建人工修订' }).click();
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeVisible();

  const savedRevisionBody = `${revisedBody}\n\n保存确认：${suffix}`;
  await page.getByRole('textbox', { name: '内容 Markdown' }).fill(savedRevisionBody);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(/已保存 · Revision \d+/)).toBeVisible();
  await page.getByRole('button', { name: '提交审核' }).click();
  const resubmit = page.getByRole('dialog', { name: '提交内容审核' });
  await resubmit.getByRole('textbox', { name: '备注（可选）' }).fill(`修订后重新送审 ${suffix}`);
  await resubmit.getByRole('button', { name: '确认提交审核' }).click();
  await expect(resubmit).toBeHidden();

  await page.getByRole('link', { name: '返回任务详情', exact: true }).click();
  await expect(page).toHaveURL(`/content/tasks/${taskId}`);
  await page.getByRole('link', { name: '审核内容' }).click();
  await expect(page).toHaveURL(`/content/tasks/${taskId}/review`);
  await expect(page.locator('#content-review-title')).toHaveText(revisedTitle);
  await page.getByRole('button', { name: '批准内容' }).click();
  await page.getByRole('dialog', { name: /批准内容版本 v\d+？/ })
    .getByRole('button', { name: '确认批准' })
    .click();
  await expect(page.getByText(/内容版本 v\d+ 已批准/).first()).toBeVisible();

  await page.getByRole('link', { name: '返回任务详情', exact: true }).click();
  await expect(page).toHaveURL(`/content/tasks/${taskId}`);
  await expect(page.getByRole('link', { name: '开始发布' })).toHaveAttribute(
    'href',
    '/publishing/work',
  );

  const finalContext = await reviewContext(page, taskId);
  const newVersionId = finalContext.content.id;
  expect(newVersionId).not.toBe(before.content.id);
  expect(finalContext.content).toMatchObject({
    based_on_id: before.content.id,
    body_markdown: savedRevisionBody,
    source_type: 'HUMAN',
    status: 'APPROVED',
    title: revisedTitle,
  });
  expect(finalContext.task).toMatchObject({
    current_content_version_id: newVersionId,
    primary_task: 'START_PUBLICATION',
    workflow_stage: 'APPROVED',
  });

  const finalTask = await taskDetail(page, taskId);
  expect(finalTask.current_content).toMatchObject({
    id: newVersionId,
    source_type: 'HUMAN',
    status: 'APPROVED',
  });
  const [oldVersion, newVersion] = await Promise.all([
    versionDetail(page, before.content.id),
    versionDetail(page, newVersionId),
  ]);
  expect(immutableContent(oldVersion.content)).toEqual(immutableContent(before.content));
  expect(oldVersion.content.change_summary).toBe(`创建审核稿 ${suffix}`);
  expect(oldVersion.content.creator.id).toBe(before.content.created_by);
  expect(oldVersion.content.created_at).toBe(before.content.created_at);
  expect(oldVersion.content.is_current).toBe(false);
  expect(oldVersion.review_result).toMatchObject({
    action: 'request-changes',
    target_id: before.content.id,
    target_version: before.content.version,
  });
  expect(newVersion.content).toMatchObject({
    based_on_id: before.content.id,
    body_markdown: savedRevisionBody,
    id: newVersionId,
    is_current: true,
    source_type: 'HUMAN',
    status: 'APPROVED',
  });

  const oldVersionRecords = newVersion.review_timeline.filter(
    (record) => record.target_id === before.content.id,
  );
  const newVersionRecords = newVersion.review_timeline.filter(
    (record) => record.target_id === newVersionId,
  );
  expect(oldVersionRecords.map((record) => record.action)).toEqual([
    'submit-review',
    'request-changes',
  ]);
  expect(oldVersionRecords.every(
    (record) => record.target_version === before.content.version,
  )).toBe(true);
  expect(newVersionRecords.map((record) => record.action)).toEqual([
    'submit-review',
    'approve',
  ]);
  expect(newVersionRecords.every(
    (record) => record.target_version === newVersion.content.version,
  )).toBe(true);
  expect(newVersion.review_timeline).toHaveLength(4);
});
