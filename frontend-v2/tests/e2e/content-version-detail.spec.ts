import {
  contentVersionDetailId,
  contentVersionTaskId,
  expect,
  test,
} from './fixtures/content.fixture';

const taskPath = `/content/tasks/${contentVersionTaskId}`;
const detailPath = `/content/versions/${contentVersionDetailId}`;

test('从 Content Task 以键盘进入只读详情，refresh 与 Back/Forward 保持单一 detail 数据边界', async ({
  contentApi,
  page,
}, testInfo) => {
  await page.goto(taskPath);
  const versionLink = page.getByRole('link', { name: 'v1' });
  await versionLink.focus();
  await versionLink.press('Enter');

  await expect(page).toHaveURL(detailPath);
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByRole('heading', { level: 1, name: /长生命周期器件选型指南/ })).toBeVisible();
  await expect(page.getByText('只读 · 不可变快照')).toBeVisible();
  await expect(page.getByLabel('内容版本 v1 Markdown 快照')).toContainText('长正文与 Markdown 列表');
  await expect(page.getByLabel('内容版本 v1 Markdown 快照')).not.toContainText('不得执行');
  await expect(page.getByRole('link', { name: '返回所属 Content Task' })).toHaveAttribute(
    'href',
    taskPath,
  );
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('.cm-editor, [contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /保存|删除|批准|退回|放弃/ })).toHaveCount(0);
  expect(contentApi.versionDetailRequests).toHaveLength(1);
  expect(contentApi.reviewContextRequests).toHaveLength(0);
  expect(contentApi.editorContextRequests).toHaveLength(0);
  expect(contentApi.generationJobDetailRequests).toHaveLength(0);
  expect(contentApi.generationJobListRequests).toHaveLength(0);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /长生命周期器件选型指南/ })).toBeVisible();
  expect(contentApi.versionDetailRequests).toHaveLength(2);

  await page.goBack();
  await expect(page).toHaveURL(taskPath);
  await page.goForward();
  await expect(page).toHaveURL(detailPath);
  await expect(page.getByText('只读 · 不可变快照')).toBeVisible();

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }

  const modelSummary = page.getByText('Model snapshot', { exact: true });
  await modelSummary.focus();
  await expect(modelSummary).toBeFocused();
  await modelSummary.press('Enter');
  await expect(page.getByText(/fixture-model/)).toBeVisible();
});

test('HUMAN/AI 与六种 status、当前和历史版本都不生成业务动作', async ({
  contentApi,
  page,
}) => {
  const base = contentApi.getVersionDetail();
  const cases = [
    ['DRAFT', 'HUMAN', true, '草稿'],
    ['PENDING_REVIEW', 'AI', false, '待审核'],
    ['CHANGES_REQUESTED', 'HUMAN', true, '已退回修改'],
    ['APPROVED', 'AI', false, '已批准'],
    ['SUPERSEDED', 'HUMAN', false, '历史版本'],
    ['ABANDONED', 'AI', true, '已放弃'],
  ] as const;

  for (const [status, source, current, label] of cases) {
    contentApi.setVersionDetail({
      ...base,
      content: {
        ...base.content,
        status,
        source_type: source,
        is_current: current,
      },
    });
    await page.goto(detailPath);
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(source === 'AI' ? 'AI 生成' : '人工创作', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(current ? '当前主线' : '历史版本', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /保存|删除|批准|退回|放弃/ })).toHaveCount(0);
  }
});

test('缺失 Prompt/model/generation/review snapshot 与更新时间时显示诚实空态', async ({
  contentApi,
  page,
}) => {
  const base = contentApi.getVersionDetail();
  contentApi.setVersionDetail({
    ...base,
    content: {
      ...base.content,
      source_type: 'HUMAN',
      source_job_id: null,
      updated_at: null,
      tags: ['超长标签'.repeat(20), '人工'],
      change_summary: '长变更摘要'.repeat(60),
    },
    generation_lineage: null,
    review_result: null,
    review_timeline: [],
  });
  await page.goto(detailPath);

  await expect(page.getByText('该版本没有生成、Prompt 或模型快照。')).toBeVisible();
  await expect(page.getByText('该版本没有审核结果。')).toBeVisible();
  await expect(page.getByText('该版本时点没有审核记录。')).toBeVisible();
  await expect(page.getByText('历史记录未记录')).toBeVisible();
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
});

test('覆盖 loading、404、403、通用错误与 retry', async ({ contentApi, page }) => {
  contentApi.setVersionDetailMode('loading');
  await page.goto(detailPath);
  await expect(page.getByRole('heading', { name: '正在加载内容版本' })).toBeVisible();
  contentApi.releaseVersionDetailLoading();
  await expect(page.getByRole('heading', { level: 1, name: /长生命周期器件选型指南/ })).toBeVisible();

  contentApi.setVersionDetailMode('not-found');
  await page.reload();
  await expect(page.getByRole('heading', { name: '未找到内容版本' })).toBeVisible();
  await expect(page.getByText('请求 ID：req-content-version-detail-not-found')).toBeVisible();
  await expect(page.getByRole('button', { name: '重试' })).toHaveCount(0);

  contentApi.setVersionDetailMode('forbidden');
  await page.reload();
  await expect(page.getByRole('heading', { name: '无法访问内容版本' })).toBeVisible();
  await expect(page.getByText('请求 ID：req-content-version-detail-forbidden')).toBeVisible();
  await expect(page.getByRole('button', { name: '重试' })).toHaveCount(0);

  contentApi.setVersionDetailMode('error');
  await page.reload();
  await expect(page.getByRole('heading', { name: '内容版本加载失败' })).toBeVisible();
  await expect(page.getByText('请求 ID：req-content-version-detail', { exact: true })).toBeVisible();

  contentApi.setVersionDetailMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /长生命周期器件选型指南/ })).toBeVisible();
});
