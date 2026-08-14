import {
  createdPromptId,
  expect,
  firstPromptId,
  platformId,
  previewJobId,
  previewModelId,
  previewTaskId,
  previewVersionId,
  secondPromptId,
  test,
} from './fixtures/prompt-workspace.fixture';

test('管理员从导航进入 Prompt Workspace，并完成 create/update/delete revision 闭环', async ({
  page,
  promptWorkspaceApi,
}, testInfo) => {
  await page.goto('/');
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('button', { name: '打开主导航' }).click();
  }
  await page.getByRole('link', { name: 'Prompt 管理' }).click();
  await expect(page).toHaveURL('/settings/prompts');
  await expect(page.getByRole('heading', { level: 1, name: 'Prompt 管理' })).toBeVisible();
  await expect(page.getByText(/从 Prompt Library 选择/)).toBeVisible();

  await page.getByRole('button', { name: '新建 Prompt' }).click();
  await expect(page).toHaveURL('/settings/prompts?new=1');
  await page.getByRole('textbox', { name: 'Prompt 名称' }).fill('新建 E2E Prompt');
  await page.getByRole('textbox', { name: 'Prompt Markdown' }).fill('# E2E 正文');
  await page.getByRole('button', { name: '创建 Prompt' }).click();
  await expect(page).toHaveURL(`/settings/prompts?promptId=${createdPromptId}`);
  expect(promptWorkspaceApi.requests[0]).toMatchObject({
    body: { name: '新建 E2E Prompt', template_markdown: '# E2E 正文' },
    csrfToken: 'platforms-e2e-csrf',
    method: 'POST',
  });

  await page.goto(`/settings/prompts?promptId=${firstPromptId}`);
  const markdown = page.getByRole('textbox', { name: 'Prompt Markdown' });
  await expect(markdown).toHaveText('# 写作约束');
  await markdown.click();
  await markdown.press('End');
  await markdown.press('Enter');
  await markdown.pressSequentially('已更新约束');
  await expect(markdown).toHaveText('# 写作约束已更新约束');
  await expect(page.getByRole('button', { name: '保存 Prompt' })).toBeEnabled();
  await markdown.press('Control+s');
  const impact = page.getByRole('dialog', { name: '保存将影响绑定平台' });
  await expect(impact.getByRole('link', { name: '工程师社区 001' })).toHaveAttribute(
    'href',
    `/settings/platforms/${platformId}?tab=generation`,
  );
  await impact.getByRole('button', { name: '确认保存' }).click();
  await expect.poll(() => promptWorkspaceApi.requests.length).toBe(2);
  expect(promptWorkspaceApi.requests[1]).toMatchObject({
    body: { expected_revision: 4, template_markdown: '# 写作约束\n已更新约束' },
    csrfToken: 'platforms-e2e-csrf',
    method: 'PUT',
    promptId: firstPromptId,
  });

  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '绑定平台' }).click();
  }
  await page.getByRole('button', { name: '删除 Prompt' }).click();
  const remove = page.getByRole('dialog', { name: '删除 Prompt“技术文章 Prompt”？' });
  await remove.getByRole('button', { name: '确认删除' }).click();
  await expect(page).toHaveURL('/settings/prompts');
  expect(promptWorkspaceApi.requests[2]).toMatchObject({
    csrfToken: 'platforms-e2e-csrf',
    expectedRevision: 5,
    method: 'DELETE',
    promptId: firstPromptId,
  });
});

test('Preview 显式选择并确认真实首稿，按返回 Job 轮询到不可变版本', async ({
  page,
  promptWorkspaceApi,
}, testInfo) => {
  await page.goto(`/settings/prompts?promptId=${firstPromptId}`);
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '绑定平台' }).click();
  }
  const run = page.getByRole('button', { name: '运行真实 Preview' });
  await expect(run).toBeDisabled();
  await page.getByRole('combobox', { name: 'Test Context' }).click();
  await page.getByRole('option', { name: /CT-30000000/ }).click();
  await expect(run).toBeDisabled();
  await page.getByRole('combobox', { name: '模型' }).click();
  await page.getByRole('option', { name: /Fixture Preview 模型/ }).click();
  await expect(run).toBeEnabled();
  await run.click();
  const confirmation = page.getByRole('dialog', { name: '确认创建真实首稿？' });
  await expect(confirmation.getByText(/这不是沙箱/)).toBeVisible();
  await confirmation.getByRole('button', { name: '确认创建真实首稿' }).click();

  await expect.poll(() => promptWorkspaceApi.generationRequests.length).toBe(1);
  expect(promptWorkspaceApi.generationRequests[0]).toMatchObject({
    body: {
      ai_model_id: previewModelId,
      platform_prompt_id: firstPromptId,
      platform_prompt_revision: 4,
    },
    csrfToken: 'platforms-e2e-csrf',
    taskId: previewTaskId,
  });
  expect(promptWorkspaceApi.generationRequests[0]?.idempotencyKey).toBeTruthy();
  await expect(page.getByText('Fixture Preview 标题')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(`Job ${previewJobId}`)).toBeVisible();
  await expect(page.getByText(`Version ${previewVersionId}`)).toBeVisible();
  await expect(page.getByRole('link', { name: '查看任务 CT-30000000' })).toHaveAttribute(
    'href',
    `/content/tasks/${previewTaskId}`,
  );
  await page.getByRole('button', { name: '全屏查看结果' }).click();
  await expect(page.getByRole('dialog', { name: 'Fixture Preview 标题' })).toContainText(
    '这是不可变 AI DRAFT。',
  );
});

test('Preview 明确处理 empty、options error 和公开失败，且不提供自动重试', async ({
  page,
  platformsApi,
  promptWorkspaceApi,
}, testInfo) => {
  promptWorkspaceApi.setPreviewMode('empty');
  await page.goto(`/settings/prompts?promptId=${secondPromptId}`);
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '绑定平台' }).click();
  }
  await expect(page.getByText(/当前没有合格上下文/)).toBeVisible();
  await expect(page.getByText(/当前没有已启用且测试通过的模型/)).toBeVisible();

  promptWorkspaceApi.setPreviewMode('error');
  platformsApi.allowHttpError(503);
  await page.goto(`/settings/prompts?promptId=${firstPromptId}`);
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '绑定平台' }).click();
  }
  await expect(page.getByText(/Preview 选项暂时不可用/)).toBeVisible();
  promptWorkspaceApi.setPreviewMode('normal');
  await page.getByRole('button', { name: '重试加载 Preview 选项' }).click();
  await expect(page.getByRole('combobox', { name: 'Test Context' })).toBeEnabled();

  promptWorkspaceApi.setJobOutcome('FAILED');
  await page.getByRole('combobox', { name: 'Test Context' }).click();
  await page.getByRole('option', { name: /CT-30000000/ }).click();
  await page.getByRole('combobox', { name: '模型' }).click();
  await page.getByRole('option', { name: /Fixture Preview 模型/ }).click();
  await page.getByRole('button', { name: '运行真实 Preview' }).click();
  await page.getByRole('dialog', { name: '确认创建真实首稿？' })
    .getByRole('button', { name: '确认创建真实首稿' }).click();
  await expect(page.getByText(/PROVIDER_ERROR：Fixture 供应商拒绝请求/)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: /重试/ })).toHaveCount(0);
});

test('q-only 导航保留草稿，切换 Prompt 被阻断，四档宽度无页面横向溢出', async ({
  page,
}, testInfo) => {
  await page.goto(`/settings/prompts?promptId=${firstPromptId}`);
  const name = page.getByRole('textbox', { name: 'Prompt 名称' });
  await expect(name).toHaveValue('技术文章 Prompt');
  await name.fill('未保存 E2E 草稿');
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: 'Prompt Library' }).click();
  }
  await page.getByRole('searchbox', { name: '搜索 Prompt 名称' }).fill('技术');
  await expect(page).toHaveURL(`/settings/prompts?q=%E6%8A%80%E6%9C%AF&promptId=${firstPromptId}`);
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: 'Prompt Editor' }).click();
  }
  await expect(name).toHaveValue('未保存 E2E 草稿');

  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: 'Prompt Library' }).click();
  }
  await page.getByRole('searchbox', { name: '搜索 Prompt 名称' }).fill('');
  await page.getByRole('button', { name: /产品简报 Prompt/ }).click();
  const guard = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await guard.getByRole('button', { name: '继续编辑' }).click();
  await expect(page).toHaveURL(`/settings/prompts?promptId=${firstPromptId}`);

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
});
