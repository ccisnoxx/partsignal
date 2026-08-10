import { expect, test } from './fixtures/content.fixture';

const taskId = '00000000-0000-4000-8000-000000000001';
const archivedTaskId = '00000000-0000-4000-8000-000000000999';
const detailUrl = `/content/tasks/${taskId}`;

test('从 Content Task List 进入，页面只以单一 Detail endpoint 绘制完整摘要', async ({ page, contentApi }) => {
  await page.goto('/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=20');
  await page.getByRole('link', { name: 'PS-0001' }).click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'CT-00000001' })).toBeVisible();
  await expect(page.getByText('PartSignal Fixture · PS-0001 · 工程师社区')).toBeVisible();
  await expect(page.getByRole('link', { name: 'v3 · 已批准' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'v1' })).toBeVisible();
  await expect(page.getByText('模型响应超时')).toBeVisible();
  await expect(page.getByText('要求修订')).toBeVisible();
  await expect(page.getByText('需要处理')).toBeVisible();
  await expect(page.getByText('如何选择 PS-0001？')).toBeVisible();
  await expect(page.getByText('任务进入当前阶段')).toBeVisible();
  expect(contentApi.detailRequests).toHaveLength(1);
  expect(contentApi.detailRequests[0]?.pathname)
    .toBe(`/api/v1/content-tasks/${taskId}/detail`);
});

test('direct navigation、refresh、Back/Forward 保持 canonical Detail route', async ({ page, contentApi }) => {
  await page.goto(detailUrl);
  await expect(page.getByRole('heading', { name: 'CT-00000001' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'CT-00000001' })).toBeVisible();
  await page.goto('/content/tasks/new');
  await page.goBack();
  await expect(page).toHaveURL(detailUrl);
  await page.goForward();
  await expect(page).toHaveURL('/content/tasks/new');
  expect(contentApi.detailRequests.length).toBeGreaterThanOrEqual(2);
});

test('compact section 没有数据时显式显示“暂无”，不触发 join API', async ({ page, contentApi }) => {
  contentApi.setDetailMode('empty');
  await page.goto(detailUrl);
  await expect(page.getByRole('heading', { name: 'CT-00000001' })).toBeVisible();
  expect(await page.getByText('暂无').count()).toBeGreaterThanOrEqual(6);
  expect(contentApi.detailRequests).toHaveLength(1);
});

test('服务端 primary_task 与 lifecycle overflow 生效，409 不重放并 canonical refetch', async ({ page, contentApi }) => {
  await page.goto(detailUrl);
  await expect(page.getByRole('link', { name: '审核内容' }))
    .toHaveAttribute('href', `/content/tasks/${taskId}/review`);
  const detailReads = contentApi.detailRequests.length;
  contentApi.setMutationMode('revision-conflict');
  const trigger = page.getByRole('button', { name: '更多操作：CT-00000001' });
  await trigger.click();
  await page.getByRole('menuitem', { name: '删除任务' }).click();
  await page.getByRole('dialog', { name: '确认删除任务“CT-00000001”' })
    .getByRole('button', { name: '确认删除' })
    .click();
  await expect(page.getByRole('alert')).toContainText('req-content-conflict');
  expect(contentApi.lifecycleRequests).toHaveLength(1);
  await expect.poll(() => contentApi.detailRequests.length).toBeGreaterThan(detailReads);
});

test('loading、404、403 与 generic retry 都有明确状态', async ({ page, contentApi }) => {
  contentApi.setDetailMode('loading');
  const navigation = page.goto(detailUrl);
  await expect(page.getByRole('heading', { name: '正在加载内容任务' })).toBeVisible();
  contentApi.releaseDetailLoading();
  await navigation;
  await expect(page.getByRole('heading', { name: 'CT-00000001' })).toBeVisible();

  for (const [mode, heading] of [
    ['not-found', '未找到内容任务'],
    ['forbidden', '无法访问内容任务详情'],
  ] as const) {
    contentApi.setDetailMode(mode);
    await page.reload();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.getByRole('button', { name: '重试' })).toHaveCount(0);
  }

  contentApi.setDetailMode('error');
  await page.reload();
  await expect(page.getByRole('heading', { name: '内容任务详情加载失败' })).toBeVisible();
  contentApi.setDetailMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { name: 'CT-00000001' })).toBeVisible();
});

test('archived verified 与 cancelled Detail 明确只读，保留服务端 primary', async ({ page, contentApi }) => {
  await page.goto(`/content/tasks/${archivedTaskId}`);
  await expect(page.getByText('只读')).toBeVisible();
  await expect(page.getByRole('link', { name: '查看完整链路' })).toHaveAttribute('href', '#activity');
  await page.getByRole('button', { name: '更多操作：CT-ARCHIVED' }).click();
  await expect(page.getByRole('menuitem', { name: '恢复任务' })).toBeVisible();

  contentApi.setDetailMode('cancelled');
  await page.goto(detailUrl);
  await expect(page.getByText('只读')).toBeVisible();
  await expect(page.getByRole('link', { name: '查看取消记录' })).toHaveAttribute('href', '#summary');
  await expect(page.getByText('VIEW_CANCELLATION', { exact: true })).toBeVisible();
});

test('375/768/1024/1440 无根横溢出，overflow 可键盘操作并返回焦点', async ({ page }, testInfo) => {
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  await page.goto(detailUrl);
  await expect(page.getByRole('heading', { name: 'CT-00000001' })).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )), `${width}px 页面根不应横向溢出`).toBe(true);
  }

  const trigger = page.getByRole('button', { name: '更多操作：CT-00000001' });
  await trigger.focus();
  await trigger.press('Enter');
  await page.getByRole('menuitem', { name: '取消任务' }).press('Enter');
  const dialog = page.getByRole('dialog', { name: '取消任务“CT-00000001”' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '返回' }).click();
  await expect(trigger).toBeFocused();
});
