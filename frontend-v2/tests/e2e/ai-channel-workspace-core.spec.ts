import { channelId, expect, test } from './fixtures/ai-channel-workspace.fixture';

test('List 创建后进入 canonical Workspace，并支持 direct/refresh/history', async ({
  page,
  aiChannelWorkspaceApi,
}) => {
  await page.goto('/settings/ai?page=1&pageSize=20');
  await page.getByRole('button', { name: '创建渠道' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 AI 渠道' });
  await dialog.getByRole('textbox', { name: '渠道名称' }).fill('Core 新渠道');
  await dialog.getByRole('textbox', { name: '描述' }).fill('Core 创建交接');
  await dialog.getByRole('textbox', { name: 'API 根地址' }).fill('https://core.example.invalid/v1');
  await dialog.getByLabel('API Key').fill('create-secret-sentinel');
  await dialog.getByRole('button', { name: '创建渠道' }).click();

  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=basic`);
  await expect(page.getByRole('heading', { level: 1, name: 'Core 新渠道' })).toBeVisible();
  expect(aiChannelWorkspaceApi.createRequests).toEqual([{
    name: 'Core 新渠道',
    description: 'Core 创建交接',
    protocol_type: 'openai-compatible-chat-completions',
    provider_brand: 'CUSTOM',
    base_url: 'https://core.example.invalid/v1',
    api_key: 'create-secret-sentinel',
    timeout_seconds: 30,
  }]);
  expect(aiChannelWorkspaceApi.responsePayloads.join('\n')).not.toContain('create-secret-sentinel');
  expect(await page.locator('body').innerText()).not.toContain('create-secret-sentinel');

  await page.getByRole('tab', { name: '请求配置' }).click();
  await page.reload();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=request`);
  await page.goBack();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=basic`);
  await page.goForward();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=request`);

  await page.goto(`/settings/ai/${channelId.toUpperCase()}`);
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=basic`);

  const detailCount = aiChannelWorkspaceApi.detailRequests.length;
  await page.goto(`/settings/ai/${channelId}?tab=models`);
  await expect(page.getByRole('heading', { name: '模型管理' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Workspace Model/ })).toBeVisible();
  expect(aiChannelWorkspaceApi.detailRequests).toHaveLength(detailCount + 1);
});

test('Basic/Request 共享草稿，dirty guard 与 409 显式 reload 成立', async ({
  page,
  aiChannelsApi,
  aiChannelWorkspaceApi,
}) => {
  await page.goto(`/settings/ai/${channelId}?tab=basic`);
  const name = page.getByRole('textbox', { name: '渠道名称' });
  await name.fill('本地未保存渠道');
  await page.getByRole('tab', { name: '请求配置' }).click();
  await page.getByRole('textbox', { name: 'API 根地址' }).fill('https://draft.example.invalid/v1');
  await page.getByRole('tab', { name: '基本信息' }).click();
  await expect(name).toHaveValue('本地未保存渠道');

  const returnLink = page.getByRole('link', { name: '返回 AI 渠道列表' });
  await returnLink.click();
  const guard = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: '继续编辑' }).click();
  await expect(returnLink).toBeFocused();

  aiChannelWorkspaceApi.conflictNextUpdate();
  aiChannelsApi.allowHttpError(409);
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText(/当前非敏感草稿已保留/)).toBeVisible();
  await expect(name).toHaveValue('本地未保存渠道');
  expect(aiChannelWorkspaceApi.mutationRequests.at(-1)).toMatchObject({
    method: 'PATCH',
    revision: 4,
    body: {
      expected_revision: 4,
      name: '本地未保存渠道',
      base_url: 'https://draft.example.invalid/v1',
    },
  });
  const requestCount = aiChannelWorkspaceApi.mutationRequests.length;
  await page.waitForTimeout(150);
  expect(aiChannelWorkspaceApi.mutationRequests).toHaveLength(requestCount);

  await page.getByRole('button', { name: '重新加载服务端版本' }).click();
  await expect(name).toHaveValue('服务端最新渠道');
});

test('API Key 与 Header 只写不回显，Header 删除提交渠道 revision 并恢复焦点', async ({
  page,
  aiChannelWorkspaceApi,
}) => {
  await page.goto(`/settings/ai/${channelId}?tab=request`);
  const replaceTrigger = page.getByRole('button', { name: '重新配置' });
  await replaceTrigger.click();
  let dialog = page.getByRole('dialog', { name: '重新配置 API Key' });
  await dialog.getByLabel('新的 API Key').fill('api-key-secret-sentinel');
  await dialog.getByRole('button', { name: '保存新密钥' }).click();
  await expect(replaceTrigger).toBeFocused();

  const createTrigger = page.getByRole('button', { name: '新增 Header' });
  await createTrigger.click();
  dialog = page.getByRole('dialog', { name: '新增 Header' });
  await dialog.getByRole('textbox', { name: 'Header 名' }).fill('X-Secret-Core');
  await dialog.getByLabel('替换值').fill('header-secret-sentinel');
  await dialog.getByRole('combobox', { name: '类型' }).click();
  await page.getByRole('option', { name: '敏感且永不回显' }).click();
  await dialog.getByRole('button', { name: '保存 Header' }).click();
  await expect(createTrigger).toBeFocused();
  await expect(page.getByRole('row', { name: /X-Secret-Core/ })).toContainText('已配置（不回显）');

  const existing = page.getByRole('row', { name: /X-Workspace/ });
  await existing.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '删除 Header' }).click();
  await page.getByRole('dialog', { name: /删除 Header/ }).getByRole('button', { name: '删除 Header' }).click();
  await expect(existing).toHaveCount(0);

  expect(aiChannelWorkspaceApi.mutationRequests).toMatchObject([
    { method: 'PUT', revision: 4, body: { expected_revision: 4, api_key: 'api-key-secret-sentinel' } },
    { method: 'POST', revision: 5, body: { expected_channel_revision: 5, name: 'X-Secret-Core', value: 'header-secret-sentinel', is_sensitive: true } },
    { method: 'DELETE', revision: 6 },
  ]);
  const safeOutput = `${aiChannelWorkspaceApi.responsePayloads.join('\n')}\n${await page.locator('body').innerText()}`;
  expect(safeOutput).not.toContain('api-key-secret-sentinel');
  expect(safeOutput).not.toContain('header-secret-sentinel');
});

test('Workspace 保持 ADMIN 边界、键盘可达且根节点无响应式溢出', async ({
  page,
  aiChannelsApi,
}, testInfo) => {
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  await page.goto(`/settings/ai/${channelId}?tab=request`);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
  const create = page.getByRole('button', { name: '新增 Header' });
  await create.focus();
  await create.press('Enter');
  await expect(page.getByRole('dialog', { name: '新增 Header' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(create).toBeFocused();

  aiChannelsApi.setAccountType('ENGINEER');
  await page.reload();
  await expect(page.getByRole('heading', { name: '无权访问系统管理' })).toBeVisible();
});
