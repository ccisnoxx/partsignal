import { expect, publicationIds, test } from './fixtures/publication.fixture';

const canonical = '/publishing/work?page=1&pageSize=20';

test('Publishing Work 以三个窄 endpoint 绘制四指标、Ready Queue 与固定六列', async ({ page, publicationApi }) => {
  await page.goto(canonical);
  await expect(page.getByRole('heading', { level: 1, name: '发布工作' })).toBeVisible();
  const summary = page.getByRole('region', { name: '运营摘要' });
  await expect(summary.getByText('待开始')).toBeVisible();
  await expect(summary.getByText('进行中')).toBeVisible();
  await expect(summary.getByText('待核验')).toBeVisible();
  await expect(summary.getByText('需处理')).toBeVisible();
  await expect(summary.getByText('99')).toHaveCount(0);
  await expect(page.getByText('当前平台暂无可用账号。')).toBeVisible();
  await expect(page.getByRole('button', { name: '开始发布' })).toHaveCount(1);
  await expect(page.locator('thead th')).toHaveCount(6);
  await expect(page.getByText('准备中').first()).toBeVisible();
  await expect(page.getByText('已开始发布')).toHaveCount(20);
  await expect(page.getByRole('link', { name: '继续准备' }).first()).toHaveAttribute(
    'href',
    /\/publishing\/work\/.+#preparation$/,
  );
  expect(publicationApi.summaryRequests).toHaveLength(1);
  expect(publicationApi.readyRequests).toHaveLength(1);
  expect(publicationApi.listRequests).toHaveLength(1);
});

test('URL 支持 direct、refresh、status、pagination 与 Back/Forward，并归一非法分页和额外参数', async ({ page, publicationApi }) => {
  await page.goto('/publishing/work?page=2&pageSize=10');
  await expect(page.getByRole('heading', { level: 1, name: '发布工作' })).toBeVisible();
  expect(publicationApi.listRequests.at(-1)?.searchParams.get('page')).toBe('2');
  await page.reload();
  await expect(page).toHaveURL('/publishing/work?page=2&pageSize=10');

  await page.getByRole('combobox', { name: '当前阶段' }).click();
  await page.getByRole('option', { name: '准备中' }).click();
  await expect(page).toHaveURL('/publishing/work?page=1&pageSize=10&status=PREPARING');
  expect(publicationApi.listRequests.at(-1)?.searchParams.get('status')).toBe('PREPARING');
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).toHaveURL('/publishing/work?page=2&pageSize=10&status=PREPARING');
  await page.goBack();
  await expect(page).toHaveURL('/publishing/work?page=1&pageSize=10&status=PREPARING');
  await page.goForward();
  await expect(page).toHaveURL('/publishing/work?page=2&pageSize=10&status=PREPARING');

  await page.goto('/publishing/work?page=0&pageSize=99&status=CLOSED&extra=1');
  await expect(page).toHaveURL('/publishing/work?status=CLOSED&page=1&pageSize=20');
});

test('START 明确选账号、携带 CSRF/稳定 key；409 不重放，人工重试采用 canonical ID', async ({ page, publicationApi }) => {
  publicationApi.setCreateMode('conflict');
  await page.goto(canonical);
  const trigger = page.getByRole('button', { name: '开始发布' });
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: /开始发布/ });
  await dialog.getByRole('combobox', { name: '发布账号' }).click();
  await page.getByRole('option', { name: /工程师社区主账号/ }).click();
  await dialog.getByRole('button', { name: '确认开始' }).click();
  await expect(dialog.getByText('请求 ID：req-publication-conflict')).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: '发布账号' })).toContainText('工程师社区主账号');
  expect(publicationApi.createRequests).toHaveLength(1);

  publicationApi.setCreateMode('success');
  await dialog.getByRole('button', { name: '确认开始' }).click();
  await expect(page.getByText(publicationIds.work)).toBeVisible();
  expect(publicationApi.createRequests).toHaveLength(2);
  expect(publicationApi.createRequests[0]).toEqual({
    body: {
      content_version_id: publicationIds.contentVersion,
      platform_account_id: publicationIds.account,
    },
    csrfToken: 'publication-e2e-csrf',
    idempotencyKey: publicationApi.createRequests[0]?.idempotencyKey,
  });
  expect(publicationApi.createRequests[0]?.idempotencyKey).toBeTruthy();
  expect(publicationApi.createRequests[1]?.idempotencyKey)
    .toBe(publicationApi.createRequests[0]?.idempotencyKey);
  await expect(page).toHaveURL(canonical);
});

test('三个 surface 状态独立，目标宽度只允许 TableRegion 局部滚动，Dialog 焦点返回', async ({ page, publicationApi }, testInfo) => {
  publicationApi.setSummaryMode('loading');
  publicationApi.setReadyMode('loading');
  publicationApi.setWorkMode('loading');
  const navigation = page.goto(canonical);
  await expect(page.getByLabel('正在读取发布运营摘要')).toBeVisible();
  await expect(page.getByLabel('正在读取待开始内容')).toBeVisible();
  await expect(page.getByRole('rowgroup', { name: '正在加载表格' })).toBeVisible();
  publicationApi.releaseLoading();
  await navigation;
  await expect(page.getByRole('button', { name: '开始发布' })).toBeVisible();

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根不应横向溢出`).toBe(true);
  }
  const trigger = page.getByRole('button', { name: '开始发布' });
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: /开始发布/ });
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(trigger).toBeFocused();

  publicationApi.setReadyMode('empty');
  publicationApi.setWorkMode('empty');
  await page.reload();
  await expect(page.getByText('暂无待开始内容')).toBeVisible();
  await expect(page.getByText('暂无活动发布工作')).toBeVisible();
  await page.goto('/publishing/work?page=1&pageSize=20&status=ACTION_REQUIRED');
  await expect(page.getByText('未找到匹配工作')).toBeVisible();

  publicationApi.setSummaryMode('error');
  publicationApi.setReadyMode('error');
  publicationApi.setWorkMode('error');
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(3);
  await expect(page.getByText('req-summary')).toBeVisible();
  await expect(page.getByText('req-ready')).toBeVisible();
  await expect(page.getByText('req-works')).toBeVisible();
});
