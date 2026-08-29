import { expect, test } from './fixtures/ai-channels.fixture';

test('AI Channel List 由安全 GET projection 驱动 canonical URL、筛选与分页', async ({ page, aiChannelsApi }) => {
  await page.goto('/settings/ai');
  await expect(page).toHaveURL('/settings/ai?page=1&pageSize=20');
  await expect(page.getByRole('heading', { level: 1, name: 'AI 渠道' })).toBeVisible();
  await expect(page.locator('thead th')).toHaveCount(7);

  const search = page.getByRole('searchbox', { name: '搜索 AI 渠道' });
  await search.fill('AI 渠道 004');
  await search.press('Enter');
  await expect(page.getByRole('link', { name: 'AI 渠道 004' })).toBeVisible();
  expect(aiChannelsApi.listRequests.at(-1)?.searchParams.get('q')).toBe('AI 渠道 004');

  await page.getByRole('button', { name: '重置' }).click();
  await page.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'OpenAI', exact: true }).click();
  await expect(page).toHaveURL(/provider=OPENAI/);
  expect(aiChannelsApi.listRequests.at(-1)?.searchParams.get('provider_brand')).toBe('OPENAI');

  await page.getByRole('combobox', { name: '启用状态' }).click();
  await page.getByRole('option', { name: 'Enabled' }).click();
  expect(aiChannelsApi.listRequests.at(-1)?.searchParams.get('status')).toBe('ENABLED');

  await page.getByRole('button', { name: '重置' }).click();
  await page.getByRole('combobox', { name: '排序' }).click();
  await page.getByRole('option', { name: '名称升序' }).click();
  expect(aiChannelsApi.listRequests.at(-1)?.searchParams.get('sort')).toBe('NAME_ASC');
  await page.getByRole('combobox', { name: '每页条数' }).click();
  await page.getByRole('option', { name: '10 条/页' }).click();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(aiChannelsApi.listRequests.at(-1)?.searchParams.get('page_size')).toBe('10');
});

test('AI Channel List 恢复历史并生成未来 Workspace href', async ({ page }) => {
  await page.goto('/settings/ai?q=AI%20%E6%B8%A0%E9%81%93%20004&page=1&pageSize=20');
  await expect(page.getByRole('link', { name: 'AI 渠道 004' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('searchbox', { name: '搜索 AI 渠道' })).toHaveValue('AI 渠道 004');

  const search = page.getByRole('searchbox', { name: '搜索 AI 渠道' });
  await search.fill('AI 渠道 005');
  await search.press('Enter');
  await expect(page.getByRole('link', { name: 'AI 渠道 005' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('link', { name: 'AI 渠道 004' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('link', { name: 'AI 渠道 005' })).toHaveAttribute(
    'href',
    '/settings/ai/00000000-0000-4000-8000-000000000005?tab=basic',
  );
});

test('AI Channel List 发送三类 revision command，冲突不自动重放', async ({ page, aiChannelsApi }) => {
  await page.goto('/settings/ai?sort=NAME_ASC&page=1&pageSize=20');
  const disabled = page.getByRole('row', { name: /AI 渠道 003/ });
  await disabled.getByRole('button', { name: '启用渠道' }).click();
  await page.getByRole('dialog', { name: '启用渠道“AI 渠道 003”？' })
    .getByRole('button', { name: '启用渠道' }).click();
  await expect.poll(() => aiChannelsApi.commandRequests.length).toBe(1);
  expect(aiChannelsApi.commandRequests[0]).toEqual({
    command: 'enable',
    channelId: '00000000-0000-4000-8000-000000000003',
    csrfToken: 'ai-channels-e2e-csrf',
    expectedRevision: 3,
  });

  const running = page.getByRole('row', { name: /生产 OpenAI/ });
  await running.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '停用渠道' }).click();
  await page.getByRole('dialog', { name: /停用渠道/ }).getByRole('button', { name: '停用渠道' }).click();
  await expect.poll(() => aiChannelsApi.commandRequests.length).toBe(2);
  expect(aiChannelsApi.commandRequests[1]).toMatchObject({ command: 'disable', expectedRevision: 1 });

  const deletable = page.getByRole('row', { name: /AI 渠道 002/ });
  await deletable.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '删除渠道' }).click();
  await page.getByRole('dialog', { name: /删除渠道/ }).getByRole('button', { name: '删除渠道' }).click();
  await expect.poll(() => aiChannelsApi.commandRequests.length).toBe(3);
  expect(aiChannelsApi.commandRequests[2]).toMatchObject({ command: 'delete', expectedRevision: 2 });

  aiChannelsApi.conflictNext('delete');
  aiChannelsApi.allowHttpError(409);
  const conflictRow = page.getByRole('row', { name: /AI 渠道 004/ });
  await conflictRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '删除渠道' }).click();
  await page.getByRole('dialog', { name: /删除渠道/ }).getByRole('button', { name: '删除渠道' }).click();
  await expect(page.getByRole('alert')).toContainText('请求 ID：req-ai-conflict');
  const commandCount = aiChannelsApi.commandRequests.length;
  await page.waitForTimeout(200);
  expect(aiChannelsApi.commandRequests).toHaveLength(commandCount);
  await page.getByRole('button', { name: '重新加载列表' }).click();
  expect(aiChannelsApi.commandRequests).toHaveLength(commandCount);
});

test('AI Channel List 管理员边界、移动响应式和敏感字段边界成立', async ({ page, aiChannelsApi }, testInfo) => {
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  await page.goto('/settings/ai?page=1&pageSize=20');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
  await page.setViewportSize({ width: widths[0], height: 900 });
  const firstRow = page.getByRole('row', { name: /生产 OpenAI/ });
  if (widths[0] <= 768) {
    await expect(firstRow.getByText('模型 2/3')).toBeVisible();
    await expect(firstRow.getByText('连接 Passed')).toBeVisible();
  } else {
    await expect(firstRow.getByText('2 / 3')).toBeVisible();
    await expect(firstRow.getByText('Passed', { exact: true })).toBeVisible();
  }
  const more = firstRow.getByRole('button', { name: /更多操作/ });
  await more.focus();
  await more.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();

  const responseText = aiChannelsApi.responsePayloads.join('\n');
  expect(responseText).not.toContain('base_url');
  expect(responseText).not.toContain('"api_key":');
  expect(responseText).not.toContain('header-value-sentinel');
  expect(await page.locator('body').innerText()).not.toContain('provider.example.invalid');

  aiChannelsApi.setAccountType('ENGINEER');
  aiChannelsApi.allowHttpError(403);
  await page.reload();
  await expect(page.getByRole('heading', { name: '无权访问系统管理' })).toBeVisible();
  await expect(page).toHaveURL('/settings/ai?page=1&pageSize=20');
  expect(aiChannelsApi.listRequests.length).toBeGreaterThan(0);
});
