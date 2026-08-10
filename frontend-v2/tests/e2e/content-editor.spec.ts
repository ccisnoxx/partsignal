import { editorTaskId, expect, test } from './fixtures/content.fixture';

const editorPath = `/content/tasks/${editorTaskId}/editor`;
const detailPath = `/content/tasks/${editorTaskId}`;

test('从 List/Detail primary 进入 canonical Editor，direct/refresh 只读取 Editor Context', async ({ page, contentApi }) => {
  await page.goto('/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=20');
  const row = page.getByRole('row').filter({ hasText: 'CT-00000002' });
  await row.getByRole('link', { name: '编辑并提交审核' }).click();
  await expect(page).toHaveURL(editorPath);
  await expect(page.getByRole('heading', { level: 1, name: 'CT-00000002' })).toBeVisible();
  expect(contentApi.editorContextRequests).toHaveLength(1);

  await page.reload();
  await expect(page.getByRole('textbox', { name: '标题' })).toHaveValue('当前人工草稿');
  expect(contentApi.editorContextRequests).toHaveLength(2);

  await page.goto(detailPath);
  await page.getByRole('link', { name: '编辑并提交审核' }).click();
  await expect(page).toHaveURL(editorPath);
  await expect(page.getByRole('textbox', { name: '内容 Markdown' })).toBeVisible();
  expect(contentApi.detailRequests).toHaveLength(1);
  expect(contentApi.editorContextRequests).toHaveLength(3);
});

test('no-draft 创建完整人工首稿，不创建 AI lineage，并携带 CSRF', async ({ page, contentApi }, testInfo) => {
  contentApi.setEditorMode('no-current');
  await page.goto(editorPath);
  await page.getByRole('tab', { name: 'Diff' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Diff' }).getByText('暂无可比较版本')).toBeVisible();
  await page.getByRole('tab', { name: '文档', exact: true }).click();

  await page.getByRole('textbox', { name: '标题' }).fill('人工首稿');
  await page.getByRole('textbox', { name: '摘要' }).fill('人工首稿摘要');
  await page.getByRole('textbox', { name: '标签' }).fill('工业,控制\n人工');
  await page.getByRole('textbox', { name: '变更说明' }).fill('创建人工首稿');
  await page.getByRole('textbox', { name: '内容 Markdown' }).fill('# 人工正文');
  await page.getByRole('button', { name: '创建人工首稿' }).click();

  await expect.poll(() => contentApi.editorRevisionRequests.length).toBe(1);
  expect(contentApi.editorRevisionRequests[0]).toEqual({
    body: {
      title: '人工首稿',
      summary: '人工首稿摘要',
      body_markdown: '# 人工正文',
      tags: ['工业,控制', '人工'],
      change_summary: '创建人工首稿',
    },
    csrfToken: 'content-e2e-csrf',
    contentVersionId: null,
    taskId: editorTaskId,
  });
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeVisible();
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '参考' }).click();
  }
  await expect(page.getByText('无生成作业')).toBeVisible();
});

test('HUMAN DRAFT DirtyGuard、Preview/Diff 与 Ctrl/Cmd+S 使用 canonical revision', async ({ page, contentApi }, testInfo) => {
  await page.goto(detailPath);
  await page.getByRole('link', { name: '编辑并提交审核' }).click();
  const title = page.getByRole('textbox', { name: '标题' });
  await title.fill('已人工更新标题');
  await expect(page.getByText('有未保存修改')).toBeVisible();
  await expect(page.getByRole('button', { name: '提交审核' })).toHaveAttribute('aria-disabled', 'true');

  await page.getByRole('link', { name: '返回任务详情' }).click();
  const guard = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: '继续编辑' }).click();
  await expect(title).toHaveValue('已人工更新标题');
  await expect(guard).toHaveCount(0);

  await page.getByRole('tab', { name: '预览' }).click();
  await expect(page.getByRole('heading', { name: '当前正文' })).toBeVisible();
  await page.getByRole('tab', { name: '编辑' }).click();
  await page.getByRole('tab', { name: 'Diff' }).click();
  const diff = page.getByRole('tabpanel', { name: 'Diff' });
  await expect(diff.getByText(/v1 → v2/)).toBeVisible();
  await expect(diff.getByText(/\+当前正文/)).toBeVisible();
  await page.getByRole('tab', { name: '文档', exact: true }).click();

  await title.press(testInfo.project.name === 'foundation-mobile' ? 'Control+s' : 'Meta+s');
  await expect(page.getByText('已保存 · Revision 3')).toBeVisible();
  expect(contentApi.editorSaveRequests).toEqual([{
    body: {
      expected_revision: 2,
      title: '已人工更新标题',
      summary: 'Content Editor fixture 摘要',
      body_markdown: '# 当前正文\n\n工作电压为 3.3 V。',
      tags: ['工业,控制', '选型'],
    },
    csrfToken: 'content-e2e-csrf',
    contentVersionId: '30000000-0000-4000-8000-000000000002',
  }]);
  await expect(page.getByText('有未保存修改')).toHaveCount(0);
  await page.getByRole('link', { name: '返回任务详情' }).click();
  await expect(page).toHaveURL(detailPath);
  await expect(guard).toHaveCount(0);
});

test('DirtyGuard 覆盖浏览器 Back/Forward，确认离开后丢弃本地草稿', async ({ page }) => {
  await page.goto(editorPath);
  await page.getByRole('link', { name: '返回任务详情' }).click();
  await expect(page).toHaveURL(detailPath);
  await page.goBack();
  await expect(page).toHaveURL(editorPath);
  await page.getByRole('textbox', { name: '标题' }).fill('浏览器历史未保存标题');

  const confirmedForward = page.goForward();
  const dialog = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '放弃修改并离开' }).click();
  await confirmedForward;
  await expect(page).toHaveURL(detailPath);
  await expect(dialog).toHaveCount(0);
});

test('AI DRAFT 保持源版本只读，显示 snapshot 摘要并创建 based_on 人工 revision', async ({ page, contentApi }, testInfo) => {
  contentApi.setEditorMode('ai-draft');
  await page.goto(editorPath);
  await expect(page.getByText('只读').first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: '标题' })).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: /批准|要求修改|自然化/ })).toHaveCount(0);
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '参考' }).click();
  }
  await expect(page.getByText('模型：Fixture Model')).toBeVisible();
  await expect(page.getByText('Prompt：Content Prompt')).toBeVisible();
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '内容文档' }).click();
  }

  await page.getByRole('button', { name: '创建人工修订' }).click();
  await expect(page.getByText('新人工修订')).toBeVisible();
  await page.getByRole('textbox', { name: '变更说明' }).fill('AI 草稿修订');
  await page.getByRole('button', { name: '创建人工修订' }).click();
  await expect.poll(() => contentApi.editorRevisionRequests.length).toBe(1);
  expect(contentApi.editorRevisionRequests[0]).toMatchObject({
    csrfToken: 'content-e2e-csrf',
    contentVersionId: '30000000-0000-4000-8000-000000000002',
    taskId: null,
    body: { title: 'AI 原始草稿', change_summary: 'AI 草稿修订' },
  });
});

test('CHANGES_REQUESTED 不原地编辑，创建 based_on 人工 revision', async ({ page, contentApi }) => {
  contentApi.setEditorMode('changes-requested');
  await page.goto(editorPath);
  await expect(page.getByText('新人工修订')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存草稿' })).toHaveCount(0);
  await page.getByRole('textbox', { name: '变更说明' }).fill('按审核意见修订');
  await page.getByRole('button', { name: '创建人工修订' }).click();
  await expect.poll(() => contentApi.editorRevisionRequests.length).toBe(1);
  expect(contentApi.editorRevisionRequests[0]).toMatchObject({
    csrfToken: 'content-e2e-csrf',
    contentVersionId: '30000000-0000-4000-8000-000000000002',
    taskId: null,
    body: { title: '待修订内容', change_summary: '按审核意见修订' },
  });
});

test('409 保留本地输入和请求 ID，只在显式 reload 后采用服务端版本', async ({ page, contentApi }) => {
  contentApi.setEditorMutationMode('revision-conflict');
  await page.goto(editorPath);
  const title = page.getByRole('textbox', { name: '标题' });
  await title.fill('本地未保存标题');
  await page.getByRole('button', { name: '保存草稿' }).click();

  await expect(page.getByRole('alert').filter({ hasText: '检测到 revision 冲突' })).toBeVisible();
  await expect(page.getByText('请求 ID：req-content-editor-conflict')).toBeVisible();
  await expect(title).toHaveValue('本地未保存标题');
  expect(contentApi.editorSaveRequests).toHaveLength(1);

  await page.getByRole('button', { name: '重新加载最新版本' }).click();
  await expect(title).toHaveValue('服务端最新标题');
  expect(contentApi.editorContextRequests).toHaveLength(2);
  expect(contentApi.editorSaveRequests).toHaveLength(1);
});

test('dirty 必须先保存再提交审核，提交后停留 Editor 且不暴露 Review actions', async ({ page, contentApi }) => {
  await page.goto(editorPath);
  const title = page.getByRole('textbox', { name: '标题' });
  await title.fill('待提交标题');
  await expect(page.getByRole('button', { name: '提交审核' })).toHaveAttribute('aria-disabled', 'true');
  expect(contentApi.editorCommandRequests).toHaveLength(0);

  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('已保存 · Revision 3')).toBeVisible();
  await page.getByRole('button', { name: '提交审核' }).click();
  const dialog = page.getByRole('dialog', { name: '提交内容审核' });
  await dialog.getByRole('textbox', { name: '备注（可选）' }).fill('请审核当前版本');
  await dialog.getByRole('button', { name: '确认提交审核' }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(editorPath);
  await expect(page.getByText('只读').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /批准|要求修改/ })).toHaveCount(0);
  expect(contentApi.editorCommandRequests).toEqual([{
    body: { expected_revision: 3, comment: '请审核当前版本' },
    csrfToken: 'content-e2e-csrf',
    command: 'submit-review',
    contentVersionId: '30000000-0000-4000-8000-000000000002',
  }]);
});

test('DELETE 只物理删除人工草稿，并采用服务端恢复的父版本主线', async ({ page, contentApi }) => {
  await page.goto(editorPath);
  await expect(page.getByRole('button', { name: '放弃当前版本' })).toHaveCount(0);
  await page.getByRole('button', { name: '删除草稿' }).click();
  const dialog = page.getByRole('dialog', { name: '删除当前人工草稿？' });
  await expect(dialog).toContainText('物理删除');
  await dialog.getByRole('button', { name: '确认删除草稿' }).click();

  await expect(page.getByRole('textbox', { name: '标题' })).toHaveValue('父级 AI 草稿');
  await expect(page.getByText('只读').first()).toBeVisible();
  expect(contentApi.editorDeleteRequests).toEqual([{
    csrfToken: 'content-e2e-csrf',
    contentVersionId: '30000000-0000-4000-8000-000000000002',
    expectedRevision: 2,
  }]);
  expect(contentApi.editorCommandRequests).toHaveLength(0);
  expect(contentApi.editorContextRequests).toHaveLength(2);
});

test('ABANDON 保留历史且只采用服务端返回的新主线', async ({ page, contentApi }) => {
  contentApi.setEditorMode('ai-draft');
  await page.goto(editorPath);
  await expect(page.getByRole('button', { name: '删除草稿' })).toHaveCount(0);
  await page.getByRole('button', { name: '放弃当前版本' }).click();
  const dialog = page.getByRole('dialog', { name: '放弃当前内容版本？' });
  await expect(dialog).toContainText('不会物理删除历史');
  await dialog.getByRole('button', { name: '确认放弃' }).click();

  await expect(page.getByRole('button', { name: '创建人工首稿' })).toBeVisible();
  expect(contentApi.editorCommandRequests).toEqual([{
    body: { expected_revision: 2, comment: '' },
    csrfToken: 'content-e2e-csrf',
    command: 'abandon',
    contentVersionId: '30000000-0000-4000-8000-000000000002',
  }]);
  expect(contentApi.editorDeleteRequests).toHaveLength(0);
  expect(contentApi.editorContextRequests).toHaveLength(2);
});

test('375/768/1024/1440 复用 Workspace 响应式、键盘焦点且 StickyActionBar 不遮挡正文', async ({ page }, testInfo) => {
  await page.goto(editorPath);
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根不应横向溢出`).toBe(true);
    if (width < 1280) {
      const mainTab = page.getByRole('tab', { name: '内容文档' });
      await mainTab.focus();
      await mainTab.press('ArrowRight');
      await expect(page.getByRole('tab', { name: '上下文' })).toBeFocused();
      await mainTab.click();
    } else {
      await expect(page.getByRole('region', { name: '上下文' })).toBeVisible();
      await expect(page.getByRole('region', { name: '参考' })).toBeVisible();
    }
  }

  const title = page.getByRole('textbox', { name: '标题' });
  await title.focus();
  await title.press('Tab');
  await expect(page.getByRole('textbox', { name: '标签' })).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const documentBox = await page.getByRole('region', { name: '内容文档' }).boundingBox();
  const actionBox = await page.locator('[data-safe-area="bottom"]').boundingBox();
  expect(documentBox && actionBox && documentBox.y + documentBox.height <= actionBox.y + 1).toBe(true);
});
