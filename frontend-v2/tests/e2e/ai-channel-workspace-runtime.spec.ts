import { channelId, expect, test } from './fixtures/ai-channel-workspace.fixture';

test('Usage canonical URL、服务端 period 与 history 恢复一致', async ({
  page,
  aiChannelWorkspaceApi,
}) => {
  await page.goto(`/settings/ai/${channelId}?tab=usage&page=9`);
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=usage&period=30d`);
  await expect(page.getByRole('heading', { name: '使用统计' })).toBeVisible();
  await expect(page.getByText('业务作业').locator('..')).toContainText('0');
  await expect(page.getByText('成功率').locator('..')).toContainText('暂无数据');
  expect(aiChannelWorkspaceApi.runtimeRequests.at(-1)).toEqual({
    method: 'GET',
    path: `/api/v1/ai-channels/${channelId}/usage-summary`,
    query: { period: '30d' },
  });

  await page.getByRole('combobox', { name: '统计时间范围' }).click();
  await page.getByRole('option', { name: '最近 7 天' }).click();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=usage&period=7d`);
  await expect(page.getByText('业务作业').locator('..')).toContainText('7');
  expect(aiChannelWorkspaceApi.runtimeRequests.at(-1)?.query).toEqual({ period: '7d' });

  await page.getByRole('tab', { name: '操作日志' }).click();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=logs&page=1&pageSize=20`);
  await page.goBack();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=usage&period=7d`);
  await page.goForward();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=logs&page=1&pageSize=20`);
  await page.reload();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=logs&page=1&pageSize=20`);
});

test('Channel 与 Model Runtime 主任务进入真实 Usage', async ({
  page,
  aiChannelWorkspaceApi,
}) => {
  aiChannelWorkspaceApi.setRuntimePrimaryTasks();
  await page.goto(`/settings/ai/${channelId}?tab=basic`);
  await page.getByRole('button', { name: '查看运行' }).click();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=usage&period=30d`);

  await page.getByRole('tab', { name: '模型管理' }).click();
  const model = page.getByRole('row', { name: /Workspace Model/ });
  await expect(model).toBeVisible();
  await model.getByRole('button', { name: '查看运行' }).click();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=usage&period=30d`);
});

test('Logs 保持服务端分页和 actor，详情按需读取且未知 shape 显式失败', async ({
  page,
  aiChannelWorkspaceApi,
}) => {
  await page.goto(`/settings/ai/${channelId}?tab=logs&page=2&pageSize=10`);
  const firstRow = page.getByRole('row', { name: /更新渠道/ }).first();
  await expect(firstRow).toContainText('系统管理员');
  await expect(firstRow).toContainText('修订号');
  expect(aiChannelWorkspaceApi.runtimeRequests).toEqual([{
    method: 'GET',
    path: `/api/v1/ai-channels/${channelId}/audit-logs`,
    query: { page: '2', page_size: '10' },
  }]);

  const trigger = firstRow.getByRole('button', { name: '查看详情' });
  await trigger.click();
  const sheet = page.getByRole('dialog', { name: '渠道操作日志详情' });
  await expect(sheet.getByText('配置变更已记录')).toBeVisible();
  await expect(sheet.getByRole('link', { name: '查看关联对象' })).toBeVisible();
  expect(aiChannelWorkspaceApi.runtimeRequests.at(-1)?.path).toMatch(/^\/api\/v1\/audit-logs\//);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();

  aiChannelWorkspaceApi.setUnsafeAuditDetail(true);
  const secondTrigger = page.getByRole('button', { name: '查看详情' }).nth(1);
  await secondTrigger.click();
  await expect(page.getByRole('dialog', { name: '渠道操作日志详情' }).getByText(/安全投影失败/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: '渠道操作日志详情' })).not.toContainText('nested');
  await page.keyboard.press('Escape');

  await page.getByRole('combobox', { name: '每页条数' }).click();
  await page.getByRole('option', { name: '50 条/页' }).click();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=logs&page=1&pageSize=50`);
  await expect.poll(() => aiChannelWorkspaceApi.runtimeRequests
    .filter((request) => request.path.endsWith('/audit-logs'))
    .at(-1)?.query).toEqual({ page: '1', page_size: '50' });
  expect(aiChannelWorkspaceApi.runtimeRequests.some((request) => request.path === '/api/v1/users')).toBe(false);
  const safeOutput = `${aiChannelWorkspaceApi.responsePayloads.join('\n')}\n${await page.locator('body').innerText()}`;
  expect(safeOutput).not.toContain('api-key-secret-sentinel');
  expect(safeOutput).not.toContain('header-secret-sentinel');
});

test('Runtime 局部错误、越界恢复与四档根溢出边界成立', async ({
  page,
  aiChannelsApi,
  aiChannelWorkspaceApi,
}, testInfo) => {
  aiChannelWorkspaceApi.failNextRuntimeRequest('usage');
  aiChannelsApi.allowHttpError(500);
  await page.goto(`/settings/ai/${channelId}?tab=usage&period=30d`);
  await expect(page.getByRole('heading', { level: 1, name: 'Workspace OpenAI' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('使用统计暂时不可用');

  await page.goto(`/settings/ai/${channelId}?tab=logs&page=99&pageSize=10`);
  const recover = page.getByRole('button', { name: '返回最后有效页' });
  await expect(recover).toBeVisible();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=logs&page=99&pageSize=10`);
  await recover.click();
  await expect(page).toHaveURL(`/settings/ai/${channelId}?tab=logs&page=3&pageSize=10`);

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
});
