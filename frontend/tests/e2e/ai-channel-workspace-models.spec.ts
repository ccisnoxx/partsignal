import { channelId, expect, test } from './fixtures/ai-channel-workspace.fixture';

test('Models 完成发现、创建、冲突 reload、测试、启停与删除闭环', async ({
  page,
  aiChannelsApi,
  aiChannelWorkspaceApi,
}) => {
  await page.goto(`/settings/ai/${channelId}?tab=models`);
  const originalRow = page.getByRole('row', { name: /Workspace Model/ });
  await expect(originalRow).toBeVisible();

  await page.getByRole('button', { name: '发现模型' }).click();
  const discovery = page.getByRole('dialog', { name: '发现远端模型' });
  await expect(discovery.getByText('remote-new-model')).toBeVisible();
  await discovery.getByRole('button', { name: '添加' }).click();
  const create = page.getByRole('dialog', { name: '新增模型' });
  await expect(create.getByRole('textbox', { name: 'Model ID' })).toHaveValue('remote-new-model');
  await create.getByRole('textbox', { name: '请求参数 JSON' }).fill('{"temperature":0.2}');
  await create.getByRole('button', { name: '保存模型' }).click();
  await expect(page.getByRole('row', { name: /remote-new-model/ })).toBeVisible();
  expect(aiChannelWorkspaceApi.mutationRequests.find((request) => request.path.endsWith('/models'))).toMatchObject({
    method: 'POST',
    body: { display_name: 'remote-new-model', model_id: 'remote-new-model', request_parameters: { temperature: 0.2 } },
  });

  await originalRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '编辑模型' }).click();
  const edit = page.getByRole('dialog', { name: '编辑模型' });
  await edit.getByRole('textbox', { name: '显示名称' }).fill('本地模型草稿');
  aiChannelWorkspaceApi.conflictNextModelMutation();
  aiChannelsApi.allowHttpError(409);
  await edit.getByRole('button', { name: '保存模型' }).click();
  await expect(edit.getByText(/AI 模型已被其他请求修改/)).toBeVisible();
  await expect(edit.getByRole('textbox', { name: '显示名称' })).toHaveValue('本地模型草稿');
  const conflictRequestCount = aiChannelWorkspaceApi.mutationRequests.filter((request) => request.path.includes('/ai-models/')).length;
  await page.waitForTimeout(150);
  expect(aiChannelWorkspaceApi.mutationRequests.filter((request) => request.path.includes('/ai-models/'))).toHaveLength(conflictRequestCount);
  await edit.getByRole('button', { name: '重新加载模型列表' }).click();
  await expect(page.getByRole('row', { name: /服务端最新模型/ })).toBeVisible();

  const currentRow = page.getByRole('row', { name: /服务端最新模型/ });
  await currentRow.getByRole('button', { name: '测试连接' }).click();
  const testDialog = page.getByRole('dialog', { name: /测试模型/ });
  await testDialog.getByRole('button', { name: '开始测试' }).click();
  await expect(page.getByText(/连接测试通过；模型仍保持停用/)).toBeVisible();
  await expect(currentRow).toContainText('已停用');

  await currentRow.getByRole('button', { name: '启用模型' }).click();
  await expect(page.getByText('模型已启用')).toBeVisible();
  await currentRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '停用模型' }).click();
  await page.getByRole('dialog', { name: /停用模型/ }).getByRole('button', { name: '停用模型' }).click();
  await expect(page.getByText('模型已停用')).toBeVisible();

  await currentRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '删除模型' }).click();
  await page.getByRole('dialog', { name: /删除模型/ }).getByRole('button', { name: '删除模型' }).click();
  await expect(currentRow).toHaveCount(0);

  const modelCommands = aiChannelWorkspaceApi.mutationRequests.filter((request) => request.path.includes('/ai-models/'));
  expect(modelCommands.map((request) => ({ method: request.method, revision: request.revision }))).toEqual([
    { method: 'PATCH', revision: 2 },
    { method: 'POST', revision: 3 },
    { method: 'POST', revision: 4 },
    { method: 'POST', revision: 5 },
    { method: 'DELETE', revision: 6 },
  ]);
});

test('dirty 配置进入 Models 需确认，确认后卸载表单且四档宽度无根溢出', async ({
  page,
}, testInfo) => {
  await page.goto(`/settings/ai/${channelId}?tab=basic`);
  await page.getByRole('textbox', { name: '渠道名称' }).fill('未保存模型切换');
  await page.getByRole('tab', { name: '模型管理' }).click();
  const guard = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: '放弃修改并离开' }).click();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=models`);
  await expect(page.getByRole('textbox', { name: '渠道名称' })).toHaveCount(0);

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
});
