import { actorId, channelId, expect, secretSentinel, test, unknownAction } from './fixtures/system-audit.fixture';

test.use({ trace: 'off' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-16T00:00:00.000Z'));
});

test('canonical URL、七列、导航与全部 server 参数映射成立', async ({ page, systemAuditApi }, testInfo) => {
  await page.goto('/system/audit');
  await expect(page).toHaveURL('/system/audit?page=1&pageSize=20&createdFrom=2026-08-13T00%3A00%3A00.000Z&createdTo=2026-08-16T00%3A00%3A00.000Z');
  await expect(page.getByRole('heading', { level: 1, name: '系统审计' })).toBeVisible();
  if (testInfo.project.name === 'foundation-mobile') await page.getByRole('button', { name: '打开主导航' }).click();
  await expect(page.getByRole('link', { name: '系统审计' })).toHaveAttribute('aria-current', 'page');
  if (testInfo.project.name === 'foundation-mobile') await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: '面包屑' })).toContainText('系统审计');
  await expect(page.locator('thead th')).toHaveCount(7);
  await expect(page.getByRole('columnheader', { name: '操作', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看详情' })).toHaveCount(0);
  expect(systemAuditApi.requests.filter((request) => request.path === '/api/v1/audit-logs')).toHaveLength(1);
  expect(systemAuditApi.requests.filter((request) => /^\/api\/v1\/audit-logs\/[0-9a-f-]{36}$/.test(request.path))).toHaveLength(0);

  const url = new URL('/system/audit', 'http://audit.local');
  Object.entries({
    page: '1', pageSize: '10', createdFrom: '2026-08-13T00:00:00.000Z', createdTo: '2026-08-16T00:00:00.000Z',
    actorId, module: 'CONFIGURATION', action: 'ai_channel.updated', targetType: 'AIChannel', targetId: channelId,
    outcome: 'SUCCESS', requestId: 'req-system-audit-1', keyword: 'ai_channel.updated',
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  await page.goto(`${url.pathname}${url.search}`);
  await expect(page.getByRole('row', { name: /更新 AI 渠道/ })).toHaveCount(1);
  expect(systemAuditApi.requests.filter((request) => request.path === '/api/v1/audit-logs').at(-1)?.query).toMatchObject({
    page: '1', page_size: '10', created_from: '2026-08-13T00:00:00.000Z', created_to: '2026-08-16T00:00:00.000Z',
    actor_id: actorId, business_module: 'CONFIGURATION', action: 'ai_channel.updated', target_type: 'AIChannel',
    target_id: channelId, outcome: 'SUCCESS', request_id: 'req-system-audit-1', keyword: 'ai_channel.updated',
  });
});

test('详情严格 lazy，并由 row click/Enter/Space 驱动自适应容器与焦点恢复', async ({ page, systemAuditApi }, testInfo) => {
  await page.goto('/system/audit');
  const first = page.getByRole('row', { name: /更新 AI 渠道/ }).first();
  await expect(first).toBeVisible();
  expect(systemAuditApi.requests.filter((request) => /^\/api\/v1\/audit-logs\/[0-9a-f-]{36}$/.test(request.path))).toHaveLength(0);

  await first.focus();
  await first.press('Enter');
  const detail = testInfo.project.name === 'foundation-desktop'
    ? page.getByRole('complementary', { name: '审计详情' })
    : page.getByRole('dialog', { name: '审计详情' });
  await expect(detail.getByText('审计操作已完成')).toBeVisible();
  await expect(detail.getByText('空 → 5')).toBeVisible();
  await expect(detail.getByText('平台甲、平台乙')).toBeVisible();
  await expect(detail.getByRole('link', { name: '查看 AI 渠道' })).toHaveAttribute('href', `/settings/ai/${channelId}?tab=basic`);
  expect(systemAuditApi.requests.filter((request) => /^\/api\/v1\/audit-logs\/[0-9a-f-]{36}$/.test(request.path))).toHaveLength(1);

  if (testInfo.project.name === 'foundation-desktop') await detail.getByRole('button', { name: '关闭审计详情' }).click();
  else await page.keyboard.press('Escape');
  await expect(first).toBeFocused();

  await first.press(' ');
  await expect(detail).toBeVisible();
  await page.goBack();
  await expect(first).toBeFocused();
  await page.goForward();
  await expect(detail).toBeVisible();
});

test('deleted actor、三态结果、相关对象三态与安全投影错误均不泄漏', async ({ page, systemAuditApi }) => {
  await page.goto('/system/audit');
  const unknownRow = page.getByRole('row', { name: '审计记录动作无法安全投影' });
  await expect(unknownRow).toBeVisible();
  await expect(unknownRow).toContainText('无法安全投影');
  await expect(unknownRow).not.toContainText(unknownAction);
  await expect(unknownRow).not.toHaveAttribute('tabindex');
  await unknownRow.press('Enter');
  await unknownRow.press('Space');
  expect(systemAuditApi.requests.filter((request) => /^\/api\/v1\/audit-logs\/[0-9a-f-]{36}$/.test(request.path))).toHaveLength(0);
  await expect(page.getByRole('row', { name: /更新用户/ }).first()).toContainText('用户已删除/未记录');
  await expect(page.getByRole('row', { name: /更新 AI 渠道/ }).first()).toContainText('成功');
  await expect(page.getByRole('row', { name: /更新用户/ }).first()).toContainText('失败');
  await expect(page.getByRole('row', { name: /完成发布工作/ }).first()).toContainText('已拒绝');

  const missing = page.getByRole('row', { name: /更新用户/ }).first();
  await missing.click();
  const container = page.viewportSize()!.width >= 1280
    ? page.getByRole('complementary', { name: '审计详情' })
    : page.getByRole('dialog', { name: '审计详情' });
  await expect(container.getByText('关联对象已不存在，历史审计记录保持不变。')).toBeVisible();
  await page.keyboard.press('Escape');

  if (page.viewportSize()!.width >= 1280) {
    await page.getByRole('row', { name: /更新 AI 渠道/ }).first().click();
    await expect(container.getByText('审计操作已完成')).toBeVisible();
    await page.getByRole('button', { name: '刷新当前页' }).click();
    await expect(page.locator('tbody tr').filter({ hasText: '无法安全投影' })).toHaveCount(1);
    await expect(container.getByText('审计操作已完成')).toBeVisible();
    systemAuditApi.failNextList();
    systemAuditApi.allowHttpError(503);
    await page.getByRole('button', { name: '刷新当前页' }).click();
    await expect(page.getByText('刷新失败，已保留当前列表')).toHaveCount(1);
    await expect(container.getByText('审计操作已完成')).toBeVisible();
  }

  systemAuditApi.setProjectionFailure(true);
  systemAuditApi.allowHttpError(409);
  await page.getByRole('row', { name: /完成发布工作/ }).first().click();
  await expect(container.getByRole('alert')).toContainText('该审计详情当前无法安全展示');
  const safeOutput = `${await page.locator('body').innerText()}\n${page.url()}\n${JSON.stringify(systemAuditApi.requests)}`;
  expect(safeOutput).not.toContain(secretSentinel);
  expect(safeOutput).not.toContain(unknownAction);
  expect(safeOutput).not.toContain('change_summary');
});

test('未知动作筛选项与当前 URL 筛选保持局部且可明确清除', async ({ page, systemAuditApi }) => {
  await page.goto(`/system/audit?action=${encodeURIComponent(unknownAction)}&createdFrom=2026-08-13T00%3A00%3A00.000Z&createdTo=2026-08-16T00%3A00%3A00.000Z&page=1&pageSize=20`);
  const currentActionAlert = page.getByText('当前动作无法安全投影，请清除或改选。');
  await expect(page.getByText('部分动作筛选项无法安全投影，已从可选项中隐藏。')).toBeVisible();
  await expect(currentActionAlert).toBeVisible();
  await expect(currentActionAlert).not.toContainText(unknownAction);
  await expect(page).toHaveURL(new RegExp(`action=${encodeURIComponent(unknownAction)}`));
  expect(systemAuditApi.requests.filter((request) => request.path === '/api/v1/audit-logs').at(-1)?.query.action).toBe(unknownAction);

  await page.getByText('更多筛选').click();
  const actionSelect = page.getByRole('combobox', { name: '动作' });
  await expect(actionSelect).toContainText('当前动作无法安全投影');
  await actionSelect.click();
  await expect(page.getByRole('option', { name: unknownAction })).toHaveCount(0);
  await page.getByRole('option', { name: '全部动作' }).click();
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page).not.toHaveURL(new RegExp(`action=${encodeURIComponent(unknownAction)}`));
  expect(systemAuditApi.requests.filter((request) => request.path === '/api/v1/audit-logs').at(-1)?.query.action).toBeUndefined();
});

test('列表失败可重试、越界自动规范、四档无页面根溢出且 ENGINEER 被拒绝', async ({ page, systemAuditApi }, testInfo) => {
  systemAuditApi.failNextList();
  systemAuditApi.allowHttpError(503);
  await page.goto('/system/audit');
  await expect(page.getByText('审计日志加载失败')).toBeVisible();
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('row', { name: /更新 AI 渠道/ }).first()).toBeVisible();

  await page.goto('/system/audit?page=99&pageSize=10&createdFrom=2026-08-13T00%3A00%3A00.000Z&createdTo=2026-08-16T00%3A00%3A00.000Z');
  await expect(page).toHaveURL(/page=3/);
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根不应横向溢出`).toBe(true);
  }

  systemAuditApi.setAccountType('ENGINEER');
  systemAuditApi.allowHttpError(403);
  systemAuditApi.allowHttpError(403);
  await page.reload();
  await expect(page.getByRole('heading', { name: '无权访问系统管理' })).toBeVisible();
});
