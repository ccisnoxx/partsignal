import {
  expect,
  publicationIds,
  publishedArticle,
  test,
} from './fixtures/publication.fixture';

const canonical = '/publishing/issues?status=OPEN&page=1&pageSize=20';
const workspacePath = `/publishing/issues/${publicationIds.issue}#issue`;

test('Issues 六列表与 Workspace 使用 canonical 单读边界', async ({ page, publicationApi }) => {
  publicationApi.seedIssue();
  await page.goto('/publishing/issues');

  await expect(page).toHaveURL(canonical);
  await expect(page.getByRole('heading', { level: 1, name: '发布内容问题' })).toBeVisible();
  await expect(page.locator('thead th')).toHaveCount(6);
  expect(publicationApi.issueListRequests).toHaveLength(1);

  await page.getByRole('link', { name: publishedArticle.actual_title }).click();
  await expect(page).toHaveURL(workspacePath);
  await expect(page.getByLabel('内容问题关联的发布来源 Markdown')).toContainText('公开发布快照正文');
  expect(publicationApi.issueWorkspaceRequests).toHaveLength(1);
  expect(publicationApi.issueRepairRequests).toHaveLength(0);
});

test('Article 登记后交接 Workspace，repair 与 resolve 保持独立', async ({
  page,
  publicationApi,
}) => {
  await page.goto(`/publishing/articles/${publicationIds.work}`);
  await page.getByRole('button', { name: '登记内容问题' }).click();
  await page.getByRole('textbox', { name: '问题描述' }).fill('公开页面正文发生变化。');
  await page.getByRole('button', { name: '确认登记' }).click();
  await expect(page).toHaveURL(workspacePath);
  expect(publicationApi.commandRequests.at(-1)).toMatchObject({
    path: `/api/v1/published-articles/${publicationIds.work}/issues`,
    body: { kind: 'PAGE_UNAVAILABLE', description: '公开页面正文发生变化。' },
    csrfToken: 'publication-e2e-csrf',
  });

  await page.getByRole('button', { name: '创建修复任务' }).click();
  await page.getByRole('combobox', { name: '修复依据' }).click();
  await page.getByRole('option', { name: 'FactVersion v2 · 批准修复依据' }).click();
  await page.getByRole('button', { name: '确认创建' }).click();
  await expect(page.getByRole('link', { name: publicationIds.repairTask })).toBeVisible();
  expect(publicationApi.issueRepairRequests.length).toBeGreaterThan(0);
  expect(publicationApi.commandRequests.at(-1)).toMatchObject({
    path: `/api/v1/published-content-issues/${publicationIds.issue}/repair-task`,
    body: { fact_version_id: publicationIds.factVersion, expected_issue_revision: 0 },
  });

  await page.getByRole('button', { name: '解决内容问题' }).click();
  await page.getByRole('textbox', { name: '解决说明' }).fill('公开页面已恢复。');
  await page.getByRole('button', { name: '确认解决' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('已恢复', { exact: true })).toBeVisible();
  await expect(page.getByText('公开页面已恢复。', { exact: true })).toBeVisible();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  expect(publicationApi.commandRequests.at(-1)).toMatchObject({
    path: `/api/v1/published-content-issues/${publicationIds.issue}/resolve`,
    body: { outcome: 'RESTORED', comment: '公开页面已恢复。', expected_revision: 0 },
  });
});

test('非法列表状态与未知 Workspace hash 被 canonicalize，页面无根横向溢出', async ({
  page,
  publicationApi,
}, testInfo) => {
  publicationApi.seedIssue();
  await page.goto('/publishing/issues?status=UNKNOWN&page=0&pageSize=99&extra=1');
  await expect(page).toHaveURL(canonical);

  await page.goto(`/publishing/issues/${publicationIds.issue}#unknown`);
  await expect(page).toHaveURL(workspacePath);
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1280, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
});
