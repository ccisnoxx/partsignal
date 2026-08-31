import { expect, test } from './fixtures/platforms.fixture';

test('Platform List 由 GET projection 驱动搜索、筛选、分页与 canonical URL', async ({ page, platformsApi }) => {
  await page.goto('/settings/platforms?page=1&pageSize=20');
  await expect(page.getByRole('heading', { level: 1, name: '平台与账号' })).toBeVisible();
  await expect(page.locator('thead th')).toHaveCount(7);
  await expect(page.getByRole('region', { name: '全部平台摘要' })).toContainText('平台总数45');

  const search = page.getByRole('searchbox', { name: '搜索平台' });
  await search.fill('工程师社区 004');
  await search.press('Enter');
  await expect(page).toHaveURL(/q=%E5%B7%A5%E7%A8%8B%E5%B8%88%E7%A4%BE%E5%8C%BA(?:\+|%20)004/);
  await expect(page.getByRole('link', { name: '工程师社区 004' })).toBeVisible();
  expect(platformsApi.listRequests.at(-1)?.searchParams.get('q')).toBe('工程师社区 004');

  await page.getByRole('button', { name: '重置' }).click();
  await page.getByRole('combobox', { name: '平台类型' }).click();
  await page.getByRole('option', { name: '行业媒体' }).click();
  expect(platformsApi.listRequests.at(-1)?.searchParams.get('platform_type_id'))
    .toBe('10000000-0000-4000-8000-000000000002');

  await page.getByRole('combobox', { name: '启用状态' }).click();
  await page.getByRole('option', { name: 'Enabled' }).click();
  expect(platformsApi.listRequests.at(-1)?.searchParams.get('status')).toBe('ENABLED');

  await page.getByRole('combobox', { name: '配置状态' }).click();
  await page.getByRole('option', { name: '缺 Prompt' }).click();
  await expect(page).toHaveURL(/configurationStatus=MISSING_PROMPT/);
  expect(platformsApi.listRequests.at(-1)?.searchParams.get('readiness_status')).toBe('MISSING_PROMPT');

  await page.getByRole('button', { name: '重置' }).click();
  await page.getByRole('combobox', { name: '每页条数' }).click();
  await page.getByRole('option', { name: '10 条/页' }).click();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(platformsApi.listRequests.at(-1)?.searchParams.get('page_size')).toBe('10');
  expect(platformsApi.listRequests.at(-1)?.searchParams.get('page')).toBe('2');
});

test('Platform List 刷新与历史恢复搜索状态，名称点击交接 canonical Workspace', async ({ page }) => {
  await page.goto('/settings/platforms?q=%E5%B7%A5%E7%A8%8B%E5%B8%88%E7%A4%BE%E5%8C%BA%20004&page=1&pageSize=20');
  await expect(page.getByRole('searchbox', { name: '搜索平台' })).toHaveValue('工程师社区 004');
  await page.reload();
  await expect(page.getByRole('link', { name: '工程师社区 004' })).toBeVisible();

  const search = page.getByRole('searchbox', { name: '搜索平台' });
  await search.fill('工程师社区 005');
  await search.press('Enter');
  await expect(page.getByRole('link', { name: '工程师社区 005' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('link', { name: '工程师社区 004' })).toBeVisible();
  await page.goForward();
  const handoff = page.getByRole('link', { name: '工程师社区 005' });
  await expect(handoff).toHaveAttribute('href', '/settings/platforms/00000000-0000-4000-8000-000000000005?tab=overview');
  await handoff.click();
  await expect(page).toHaveURL('/settings/platforms/00000000-0000-4000-8000-000000000005?tab=overview');
});

test('Platform List 呈现服务端 Primary、overflow、删除条件与 revision command', async ({ page, platformsApi }) => {
  await page.goto('/settings/platforms?page=1&pageSize=20');
  const firstRow = page.getByRole('row', { name: /工程师社区 001/ });
  await expect(firstRow.getByRole('link', { name: '查看运营' })).toHaveAttribute(
    'href',
    '/settings/platforms/00000000-0000-4000-8000-000000000001?tab=overview',
  );

  await firstRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '查看删除条件' }).click();
  await expect(page.getByRole('dialog', { name: /当前不能删除/ })).toContainText('开放内容任务');
  await page.getByRole('dialog', { name: /当前不能删除/ }).getByRole('button', { name: '关闭' }).first().click();

  const disabledRow = page.getByRole('row', { name: /工程师社区 003/ });
  await disabledRow.getByRole('button', { name: '重新启用' }).click();
  const confirm = page.getByRole('dialog', { name: '启用平台“工程师社区 003”？' });
  await confirm.getByRole('button', { name: '启用平台' }).click();
  await expect.poll(() => platformsApi.commandRequests.length).toBe(1);
  expect(platformsApi.commandRequests[0]).toEqual({
    command: 'enable',
    csrfToken: 'platforms-e2e-csrf',
    expectedRevision: 3,
    platformId: '00000000-0000-4000-8000-000000000003',
  });
});

test('Platform Profile 删除 Dialog 在 focus projection 更新后禁止陈旧提交并使用最新 revision', async ({ page, platformsApi }) => {
  const platformId = '00000000-0000-4000-8000-000000000003';
  await page.goto('/settings/platforms?page=1&pageSize=20');
  const row = page.getByRole('row', { name: /工程师社区 003/ });
  await row.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '删除平台' }).click();

  platformsApi.setProjection(platformId, {
    name: '工程师社区 003（已阻断）',
    available_actions: ['UPDATE', 'ENABLE'],
    deletion: { blockers: [{ type: 'CONTENT_TASK', count: 1 }] },
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('dialog', { name: '“工程师社区 003（已阻断）”当前不能删除' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认删除' })).toHaveCount(0);

  platformsApi.setProjection(platformId, {
    name: '工程师社区 003（最新）',
    available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
    deletion: { blockers: [] },
    revision: 33,
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  const latest = page.getByRole('dialog', { name: '确认删除平台“工程师社区 003（最新）”' });
  await expect(latest).toBeVisible();
  await latest.getByRole('button', { name: '确认删除' }).click();
  await expect.poll(() => platformsApi.commandRequests.at(-1)?.expectedRevision).toBe(33);
});

test('Platform List 在 375/768/1024/1440 无页面级横向溢出且移动端动作可达', async ({ page }, testInfo) => {
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  await page.goto('/settings/platforms?page=1&pageSize=20');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }

  await page.setViewportSize({ width: widths[0], height: 900 });
  const firstRow = page.getByRole('row', { name: /工程师社区 001/ });
  await expect(firstRow.getByRole('link', { name: /工程师社区 001/ })).toBeVisible();
  await expect(firstRow.getByText('完整')).toBeVisible();
  await expect(firstRow.getByText('Enabled')).toBeVisible();
  const more = firstRow.getByRole('button', { name: /更多操作/ });
  await more.focus();
  await more.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
});
