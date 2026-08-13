import {
  createdPromptId,
  expect,
  firstPromptId,
  platformId,
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
