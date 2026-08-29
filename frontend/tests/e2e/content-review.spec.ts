import { reviewTaskId, expect, test } from './fixtures/content.fixture';

const reviewPath = `/content/tasks/${reviewTaskId}/review`;
const detailPath = `/content/tasks/${reviewTaskId}`;

test('direct URL、refresh、Back 与 Forward 始终读取 task-scoped Review Context', async ({
  contentApi,
  page,
}) => {
  contentApi.setReviewMode('review-pending');
  await page.goto(reviewPath);
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0002 平台适配指南' })).toBeVisible();
  expect(contentApi.reviewContextRequests).toHaveLength(1);

  await page.reload();
  await expect(page.getByLabel('内容版本 v2 canonical Markdown')).toContainText('工作电压');
  expect(contentApi.reviewContextRequests).toHaveLength(2);

  if (page.viewportSize()?.width === 375) {
    await page.getByRole('tab', { name: '审核上下文' }).click();
  }
  await page.getByRole('link', { name: '返回任务详情' }).click();
  await expect(page).toHaveURL(detailPath);
  await page.getByRole('link', { name: '审核内容' }).click();
  await expect(page).toHaveURL(reviewPath);
  await page.goBack();
  await expect(page).toHaveURL(detailPath);
  await page.goForward();
  await expect(page).toHaveURL(reviewPath);
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0002 平台适配指南' })).toBeVisible();
});

test('一次快照展示 canonical、blocking/warnings、fact、platform、diff 与 timeline', async ({
  contentApi,
  page,
}, testInfo) => {
  contentApi.setReviewMode('blocking');
  await page.goto(reviewPath);
  await expect(page.getByLabel('内容版本 v2 canonical Markdown')).toContainText('Canonical 内容');
  await openReviewPanel(page, testInfo.project.name);
  await expect(page.getByText('缺少来源说明')).toBeVisible();
  await expect(page.getByText('标题可能过长')).toBeVisible();
  await expect(page.getByLabel('事实版本 v3 Markdown 核对依据')).toContainText('温度范围');
  await expect(page.getByText('content-markdown-v3')).toBeVisible();
  await expect(page.getByRole('region', { name: '内容版本 canonical Markdown 差异' })).toContainText('旧正文');
  await expect(page.getByText('提交审核')).toBeVisible();
  await expect(page.getByRole('button', { name: '批准内容' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退回修改' })).toBeVisible();
  expect(contentApi.reviewContextRequests).toHaveLength(1);
});

for (const mode of ['approved', 'changes-requested', 'readonly'] as const) {
  test(`${mode} 状态只读且不从 status 推导审核动作`, async ({ contentApi, page }) => {
    contentApi.setReviewMode(mode);
    await page.goto(reviewPath);
    await expect(page.getByText('当前为只读状态，没有可执行的审核动作')).toBeVisible();
    await expect(page.getByRole('button', { name: '批准内容' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '退回修改' })).toHaveCount(0);
  });
}

test('APPROVE 携带 CSRF/expected_revision，成功后重新读取 canonical state', async ({
  contentApi,
  page,
}) => {
  await page.goto(reviewPath);
  await page.getByRole('button', { name: '批准内容' }).click();
  const dialog = page.getByRole('dialog', { name: '批准内容版本 v2？' });
  await dialog.getByRole('button', { name: '确认批准' }).click();

  await expect(page.getByText('内容版本 v2 已批准').first()).toBeVisible();
  expect(contentApi.reviewCommandRequests).toEqual([{
    body: { expected_revision: 2, comment: '' },
    command: 'approve',
    contentVersionId: '30000000-0000-4000-8000-000000000002',
    csrfToken: 'content-e2e-csrf',
  }]);
  expect(contentApi.reviewContextRequests).toHaveLength(2);
  await expect(page.getByRole('button', { name: '批准内容' })).toHaveCount(0);
});

test('REQUEST_CHANGES 校验并修剪意见，Esc 后焦点返回真实触发器', async ({
  contentApi,
  page,
}) => {
  await page.goto(reviewPath);
  const trigger = page.getByRole('button', { name: '退回修改' });
  await trigger.click();
  let dialog = page.getByRole('dialog', { name: '退回内容版本 v2' });
  const comment = dialog.getByRole('textbox', { name: '审核意见' });
  await expect(comment).toBeFocused();
  await dialog.getByRole('button', { name: '确认退回' }).click();
  await expect(dialog.getByText('退回意见不能为空').first()).toBeVisible();
  expect(contentApi.reviewCommandRequests).toHaveLength(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  dialog = page.getByRole('dialog', { name: '退回内容版本 v2' });
  await dialog.getByRole('textbox', { name: '审核意见' }).fill('  请补充平台限制  ');
  await dialog.getByRole('button', { name: '确认退回' }).click();
  await expect(page.getByText('内容版本 v2 已退回修改').first()).toBeVisible();
  expect(contentApi.reviewCommandRequests).toEqual([{
    body: { expected_revision: 2, comment: '请补充平台限制' },
    command: 'request-changes',
    contentVersionId: '30000000-0000-4000-8000-000000000002',
    csrfToken: 'content-e2e-csrf',
  }]);
  expect(contentApi.reviewContextRequests).toHaveLength(2);
});

test('409 保留用户输入和 request ID，刷新 canonical context 且不自动重放', async ({
  contentApi,
  page,
}) => {
  contentApi.setReviewMutationMode('revision-conflict');
  await page.goto(reviewPath);
  await page.getByRole('button', { name: '退回修改' }).click();
  const dialog = page.getByRole('dialog', { name: '退回内容版本 v2' });
  const comment = dialog.getByRole('textbox', { name: '审核意见' });
  await comment.fill('保留这条审核意见');
  await dialog.getByRole('button', { name: '确认退回' }).click();

  await expect(dialog.getByText('请求 ID：req-content-review-conflict')).toBeVisible();
  await expect(comment).toHaveValue('保留这条审核意见');
  expect(contentApi.reviewCommandRequests).toHaveLength(1);
  expect(contentApi.reviewContextRequests).toHaveLength(2);
});

test('结构化 422 回到意见字段并保留输入', async ({ contentApi, page }) => {
  contentApi.setReviewMutationMode('validation');
  await page.goto(reviewPath);
  await page.getByRole('button', { name: '退回修改' }).click();
  const dialog = page.getByRole('dialog', { name: '退回内容版本 v2' });
  const comment = dialog.getByRole('textbox', { name: '审核意见' });
  await comment.fill('补充');
  await dialog.getByRole('button', { name: '确认退回' }).click();

  await expect(dialog.getByText('审核意见至少需要 5 个字符').first()).toBeVisible();
  await expect(dialog.getByText('请求 ID：req-content-review-validation')).toBeVisible();
  await expect(comment).toHaveValue('补充');
});

test('loading 完成后展示 canonical 页面', async ({ contentApi, page }) => {
  contentApi.setReviewMode('loading');
  await page.goto(reviewPath);
  await expect(page.getByRole('heading', { name: '正在加载内容审核上下文' })).toBeVisible();
  contentApi.releaseReviewLoading();
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0002 平台适配指南' })).toBeVisible();
});

test('error 展示 request ID，显式 retry 后恢复', async ({ contentApi, page }) => {
  contentApi.setReviewMode('error');
  await page.goto(reviewPath);
  await expect(page.getByRole('heading', { name: '内容审核工作台加载失败' })).toBeVisible();
  await expect(page.getByText('请求 ID：req-content-review-load', { exact: true })).toBeVisible();
  contentApi.setReviewMode('review-pending');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0002 平台适配指南' })).toBeVisible();
});

test('375/1440 使用既有 WorkspaceShell 响应式形态', async ({ page }, testInfo) => {
  await page.goto(reviewPath);
  if (testInfo.project.name === 'foundation-mobile') {
    expect(page.viewportSize()?.width).toBe(375);
    await expect(page.getByRole('tab', { name: 'Canonical Markdown' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Review Panel' })).toBeVisible();
  } else {
    expect(page.viewportSize()?.width).toBe(1440);
    await expect(page.getByRole('region', { name: '审核上下文' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Canonical Markdown', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Review Panel' })).toBeVisible();
  }
});

test('768/1024 保持 tabbed workspace 且内容无水平溢出', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'foundation-desktop', '中间视口只需在 desktop project 覆盖一次');
  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(reviewPath);
    await expect(page.getByRole('tab', { name: 'Canonical Markdown' })).toBeVisible();
    await page.getByRole('tab', { name: 'Review Panel' }).click();
    await expect(page.getByRole('heading', { name: 'Blocking issues' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  }
});

async function openReviewPanel(page: import('@playwright/test').Page, projectName: string) {
  if (projectName === 'foundation-mobile') {
    await page.getByRole('tab', { name: 'Review Panel' }).click();
  }
}
