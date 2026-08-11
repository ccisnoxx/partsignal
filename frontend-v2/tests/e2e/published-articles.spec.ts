import {
  expect,
  publicationIds,
  publishedArticle,
  test,
} from './fixtures/publication.fixture';

const canonical = '/publishing/articles?page=1&pageSize=20';
const detailPath = `/publishing/articles/${publicationIds.work}`;

test('从五列成果表以键盘进入单请求只读详情', async ({ page, publicationApi }) => {
  await page.goto(canonical);
  await expect(page.getByRole('heading', { level: 1, name: '发布成果' })).toBeVisible();
  await expect(page.locator('thead th')).toHaveCount(5);
  await expect(page.getByRole('columnheader', { name: '操作' })).toHaveCount(0);
  await expect(page.getByText('Passed').first()).toHaveCount(1);
  const detailLink = page.getByRole('link', { name: publishedArticle.actual_title });
  await detailLink.focus();
  await detailLink.press('Enter');

  await expect(page).toHaveURL(detailPath);
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByRole('heading', { level: 1, name: publishedArticle.actual_title })).toBeVisible();
  await expect(page.getByText('只读 · 不可变快照')).toBeVisible();
  await expect(page.getByLabel('发布成果来源内容 v3 Markdown 快照')).toContainText('公开发布快照正文');
  await expect(page.getByLabel('发布成果来源内容 v3 Markdown 快照')).not.toContainText('不得执行');
  await expect(page.getByRole('heading', { name: '首次成功核验快照' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '发布事件时间线' })).toBeVisible();
  await expect(page.getByRole('link', { name: '打开公开页面' })).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('.cm-editor, [contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /编辑|删除|核验|登记|问题/ })).toHaveCount(0);
  expect(publicationApi.articleListRequests).toHaveLength(1);
  expect(publicationApi.articleRequests).toHaveLength(1);
  expect(publicationApi.commandRequests).toHaveLength(0);
});

test('canonical URL 支持 search/sort/pagination、refresh 与 Back/Forward', async ({
  page,
  publicationApi,
}) => {
  await page.goto(canonical);
  await page.getByLabel('搜索发布成果').fill('  发布成果 24  ');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page).toHaveURL(/\/publishing\/articles\?page=1&pageSize=20&q=/);
  expect(publicationApi.articleListRequests.at(-1)?.searchParams.get('search')).toBe('发布成果 24');

  await page.getByRole('combobox', { name: '排序' }).click();
  await page.getByRole('option', { name: '标题：A 到 Z' }).click();
  await expect(page).toHaveURL(/sort=TITLE_ASC/);
  expect(publicationApi.articleListRequests.at(-1)?.searchParams.get('sort')).toBe('TITLE_ASC');

  await page.goto('/publishing/articles?page=2&pageSize=10&sort=TITLE_ASC');
  await expect(page.getByText('第 2 / 3 页')).toBeVisible();
  expect(publicationApi.articleListRequests.at(-1)?.searchParams.get('page')).toBe('2');
  await page.reload();
  await expect(page).toHaveURL('/publishing/articles?page=2&pageSize=10&sort=TITLE_ASC');
  await page.goBack();
  await expect(page).toHaveURL(/sort=TITLE_ASC/);
  await page.goForward();
  await expect(page).toHaveURL('/publishing/articles?page=2&pageSize=10&sort=TITLE_ASC');

  await page.goto('/publishing/articles?page=0&pageSize=99&sort=UNKNOWN&q=%20%20&extra=1');
  await expect(page).toHaveURL(canonical);
});

test('列表与详情诚实处理 empty/error，四档宽度保持 readonly', async ({
  page,
  publicationApi,
}, testInfo) => {
  publicationApi.setArticleListMode('empty');
  await page.goto(canonical);
  await expect(page.getByText('暂无发布成果')).toBeVisible();

  publicationApi.setArticleListMode('success');
  await page.goto('/publishing/articles?page=1&pageSize=20&q=不存在');
  await expect(page.getByText('未找到匹配成果')).toBeVisible();

  publicationApi.setArticleListMode('error');
  await page.goto(canonical);
  await expect(page.getByText('发布成果列表加载失败')).toBeVisible();
  await expect(page.getByText(/req-articles/)).toBeVisible();

  for (const [status, title] of [
    [404, '未找到发布成果'],
    [403, '无法访问发布成果'],
    [409, '发布成果加载失败'],
  ] as const) {
    publicationApi.setArticleDetailError(status);
    await page.goto(detailPath);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(`请求 ID：req-article-${status}`, { exact: true })).toBeVisible();
  }

  publicationApi.setArticleDetailError();
  await page.goto(detailPath);
  await expect(page.getByText('只读 · 不可变快照')).toBeVisible();
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
});
