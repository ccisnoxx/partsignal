import { expect, platformId, test } from './fixtures/content.fixture';

const canonical = '/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=20';

test('Content Tasks 由服务端 projection 驱动固定列、链接、搜索、筛选与分页', async ({ page, contentApi }) => {
  await page.goto('/content/tasks?archiveStatus=ACTIVE&page=3&pageSize=20');
  await expect(page.getByRole('heading', { level: 1, name: '内容任务' })).toBeVisible();
  await expect(page.locator('thead th')).toHaveCount(6);
  expect(contentApi.listRequests.at(-1)?.searchParams.get('page')).toBe('3');

  const search = page.getByRole('searchbox', { name: '搜索内容任务' });
  await search.fill('PS-0001');
  await search.press('Enter');
  await expect(page).toHaveURL(/q=PS-0001/);
  await expect(page.getByRole('link', { name: 'PS-0001' })).toHaveAttribute(
    'href',
    '/content/tasks/00000000-0000-4000-8000-000000000001',
  );
  await expect(page.getByText('生成失败')).toBeVisible();
  await expect(page.getByText('v1 · AI')).toHaveText('v1 · AI');
  await expect(page.getByRole('link', { name: '审核内容' })).toHaveAttribute(
    'href',
    '/content/tasks/00000000-0000-4000-8000-000000000001/review',
  );
  await expect(page.getByRole('link', { name: '创建内容任务' })).toHaveAttribute(
    'href',
    '/content/tasks/new',
  );
  expect(contentApi.listRequests.at(-1)?.searchParams.get('q')).toBe('PS-0001');

  await page.getByRole('combobox', { name: '当前阶段' }).click();
  await page.getByRole('option', { name: '生成失败' }).click();
  await expect(page).toHaveURL(/workflowStage=GENERATION_FAILED/);
  expect(contentApi.listRequests.at(-1)?.searchParams.get('workflow_stage')).toBe('GENERATION_FAILED');

  await page.getByRole('combobox', { name: '目标平台' }).click();
  await page.getByRole('option', { name: '工程师社区' }).click();
  await expect(page).toHaveURL(new RegExp(`platformId=${platformId}`));
  expect(contentApi.listRequests.at(-1)?.searchParams.get('platform_profile_id')).toBe(platformId);

  await page.getByRole('button', { name: '重置' }).click();
  await page.getByRole('combobox', { name: '每页条数' }).click();
  await page.getByRole('option', { name: '10 条/页' }).click();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(contentApi.listRequests.at(-1)?.searchParams.get('page_size')).toBe('10');
});

test('Content Tasks URL 支持 direct、refresh、Back/Forward，并规范化非法参数', async ({ page }) => {
  await page.goto('/content/tasks?q=PS-0003&archiveStatus=ACTIVE&page=1&pageSize=20');
  await expect(page.getByRole('searchbox', { name: '搜索内容任务' })).toHaveValue('PS-0003');
  await page.reload();
  await expect(page.getByRole('link', { name: 'PS-0003' })).toBeVisible();

  const search = page.getByRole('searchbox', { name: '搜索内容任务' });
  await search.fill('PS-0004');
  await search.press('Enter');
  await expect(page.getByRole('link', { name: 'PS-0004' })).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue('PS-0003');
  await page.goForward();
  await expect(search).toHaveValue('PS-0004');

  await page.goto('/content/tasks?q=%20&workflowStage=BAD&archiveStatus=BAD&platformId=BAD&page=0&pageSize=99&extra=1');
  await expect(page).toHaveURL(canonical);
});

test('Query Topic 两类 resolve URL 成对映射服务端筛选并可清除', async ({ page, contentApi }) => {
  const topicId = '40000000-0000-4000-8000-000000000001';
  await page.goto(`/content/tasks?queryTopicId=${topicId}&queryTopicReference=GEO_OPTIMIZATION_SOURCE&archiveStatus=ALL&page=1&pageSize=20`);
  await expect(page.getByText(new RegExp(`GEO Optimization 来源 · ${topicId}`))).toBeVisible();
  const params = contentApi.listRequests.at(-1)?.searchParams;
  expect(params?.get('query_topic_id')).toBe(topicId);
  expect(params?.get('query_topic_reference')).toBe('GEO_OPTIMIZATION_SOURCE');
  await page.getByRole('button', { name: '清除此引用筛选' }).click();
  await expect(page).toHaveURL('/content/tasks?archiveStatus=ALL&page=1&pageSize=20');
});

test('Content lifecycle 使用服务端 token、CSRF、comment 和 revision，409 不重放', async ({ page, contentApi }) => {
  await page.goto(canonical);
  const more = page.getByRole('button', { name: '更多操作：CT-00000001' });
  await more.click();
  await expect(page.getByRole('menuitem', { name: '使用 AI 创建初稿' })).toHaveAttribute(
    'href',
    '/content/tasks/00000000-0000-4000-8000-000000000001/editor',
  );
  await page.getByRole('menuitem', { name: '取消任务' }).click();
  const cancel = page.getByRole('dialog', { name: '取消任务“CT-00000001”' });
  await cancel.getByLabel('取消说明').fill('需求已撤销');
  await cancel.getByRole('button', { name: '确认取消' }).click();
  await expect(page.getByText('内容任务已取消。')).toBeVisible();
  expect(contentApi.lifecycleRequests[0]).toMatchObject({
    body: { expected_revision: 1, comment: '需求已撤销' },
    csrfToken: 'content-e2e-csrf',
    method: 'POST',
    pathname: '/api/v1/content-tasks/00000000-0000-4000-8000-000000000001/cancel',
  });
  await expect(more).toBeFocused();

  contentApi.setMutationMode('revision-conflict');
  await more.click();
  await page.getByRole('menuitem', { name: '删除任务' }).click();
  await page.getByRole('dialog', { name: '确认删除任务“CT-00000001”' })
    .getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('alert')).toContainText('req-content-conflict');
  expect(contentApi.lifecycleRequests.filter((request) => request.method === 'DELETE')).toHaveLength(1);
  expect(contentApi.lifecycleRequests.at(-1)).toMatchObject({
    csrfToken: 'content-e2e-csrf',
    expectedRevision: 1,
  });
});

test('已归档视图使用实时永久删除 preview 和精确确认文本', async ({ page, contentApi }) => {
  await page.goto('/content/tasks?archiveStatus=ARCHIVED&page=1&pageSize=20');
  await expect(page.getByText('已归档视图')).toBeVisible();
  await expect(page.getByRole('link', { name: 'PS-ARCHIVED' })).toBeVisible();

  const more = page.getByRole('button', { name: '更多操作：CT-ARCHIVED' });
  await more.press('Enter');
  await page.getByRole('menuitem', { name: '永久删除' }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除任务“CT-ARCHIVED”' });
  await expect(dialog).toContainText('https://example.com/published/1');
  await dialog.getByRole('textbox').fill('永久删除');
  await dialog.getByRole('button', { name: '永久删除' }).click();
  await expect(page.getByText('内容任务已永久删除。')).toBeVisible();
  expect(contentApi.lifecycleRequests.at(-1)).toMatchObject({
    body: { expected_revision: 100, confirmation_text: '永久删除' },
    csrfToken: 'content-e2e-csrf',
    method: 'POST',
    pathname: '/api/v1/content-tasks/00000000-0000-4000-8000-000000000999/permanent-delete',
  });
  await expect(more).toBeFocused();
});

test('Content Tasks 明确呈现 loading、empty、filtered empty、error 与 retry', async ({ page, contentApi }) => {
  contentApi.setListMode('loading');
  const navigation = page.goto(canonical);
  await expect(page.getByRole('rowgroup', { name: '正在加载表格' })).toBeVisible();
  contentApi.releaseLoading();
  await navigation;
  await expect(page.getByRole('link', { name: 'PS-0001' })).toBeVisible();

  contentApi.setListMode('empty');
  await page.goto(canonical);
  await expect(page.getByText('暂无内容任务')).toBeVisible();
  await page.goto('/content/tasks?q=missing&archiveStatus=ACTIVE&page=1&pageSize=20');
  await expect(page.getByText('未找到匹配任务')).toBeVisible();

  contentApi.setListMode('error');
  await page.goto('/content/tasks?q=error&archiveStatus=ACTIVE&page=1&pageSize=20');
  await expect(page.getByRole('alert')).toContainText('req-content-list');
  contentApi.setListMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('table')).toBeVisible();
});

test('Content Tasks 在目标宽度无页面级横向溢出，键盘与 Dialog 焦点可恢复', async ({ page }, testInfo) => {
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  await page.goto(canonical);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByText('生成失败')).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根不应横向溢出`).toBe(true);
  }

  const search = page.getByRole('searchbox', { name: '搜索内容任务' });
  await search.focus();
  await expect(search).toBeFocused();
  const more = page.getByRole('button', { name: '更多操作：CT-00000001' });
  await more.press('Enter');
  await expect(page.getByRole('menuitem', { name: '取消任务' })).toHaveAttribute('data-highlighted');
  await page.getByRole('menuitem', { name: '取消任务' }).click();
  await page.getByRole('dialog', { name: '取消任务“CT-00000001”' })
    .getByRole('button', { name: '返回' }).click();
  await expect(more).toBeFocused();
});
