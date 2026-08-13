import { expect, test } from './fixtures/platform-types.fixture';

const workspaceId = '00000000-0000-4000-8000-000000000001';

test('从 Platform Settings 与 Workspace 进入 subsettings，支持 direct/refresh/back/forward', async ({
  page,
}) => {
  await page.goto('/settings/platforms?page=1&pageSize=20');
  const entry = page.getByRole('link', { name: '管理平台类型' });
  await expect(entry).toHaveAttribute('href', '/settings/platforms/types');
  await entry.click();
  await expect(page).toHaveURL('/settings/platforms/types');
  await expect(page.getByRole('heading', { level: 1, name: '平台类型' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: '平台类型' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/settings/platforms?page=1&pageSize=20');
  await page.goForward();
  await expect(page).toHaveURL('/settings/platforms/types');

  await page.goto(`/settings/platforms/${workspaceId}?tab=overview`);
  await expect(page.getByRole('link', { name: '管理平台类型' })).toHaveAttribute(
    'href',
    '/settings/platforms/types',
  );
  await page.getByRole('link', { name: '管理平台类型' }).click();
  await expect(page).toHaveURL('/settings/platforms/types');
  await expect(page.getByRole('link', { name: '返回平台与账号' })).toHaveAttribute(
    'href',
    '/settings/platforms?page=1&pageSize=20',
  );
});

test('创建、编辑和删除只提交 Name、Slug、CSRF 与 canonical revision', async ({
  page,
  platformTypesApi,
}) => {
  await page.goto('/settings/platforms/types');
  const create = page.getByRole('button', { name: '新建平台类型' });
  await create.click();
  let dialog = page.getByRole('dialog', { name: '新建平台类型' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('  社交平台  ');
  await dialog.getByRole('textbox', { name: 'Slug' }).fill('social-platform');
  await dialog.getByRole('button', { name: '创建' }).click();
  await expect(create).toBeFocused();
  let row = page.locator('tr:visible, li:visible').filter({ hasText: '社交平台' }).first();
  await expect(row).toContainText('social-platform');

  let more = row.getByRole('button', { name: '更多操作：社交平台' });
  await more.click();
  await page.getByRole('menuitem', { name: '编辑' }).click();
  dialog = page.getByRole('dialog', { name: '编辑平台类型' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('社交媒体');
  await dialog.getByRole('button', { name: '保存' }).click();
  row = page.locator('tr:visible, li:visible').filter({ hasText: '社交媒体' }).first();
  await expect(row).toBeVisible();

  more = row.getByRole('button', { name: '更多操作：社交媒体' });
  await more.click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  dialog = page.getByRole('dialog', { name: '删除平台类型？' });
  await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(row).toHaveCount(0);

  expect(platformTypesApi.requests.filter((request) => request.method !== 'GET')).toMatchObject([
    {
      method: 'POST',
      body: { name: '社交平台', slug: 'social-platform' },
      csrfToken: 'platforms-e2e-csrf',
    },
    {
      method: 'PATCH',
      body: { name: '社交媒体', slug: 'social-platform', expected_revision: 0 },
      csrfToken: 'platforms-e2e-csrf',
      expectedRevision: 0,
    },
    {
      method: 'DELETE',
      csrfToken: 'platforms-e2e-csrf',
      expectedRevision: 1,
    },
  ]);
});

test('blocker、编辑冲突和删除冲突均保留服务端权威与显式 reload', async ({
  page,
  platformTypesApi,
}) => {
  await page.goto('/settings/platforms/types');
  const blocked = page.locator('tr:visible, li:visible').filter({ hasText: '技术社区' }).first();
  let more = blocked.getByRole('button', { name: '更多操作：技术社区' });
  await more.click();
  await page.getByRole('menuitem', { name: '查看删除条件' }).click();
  let dialog = page.getByRole('dialog', { name: '平台类型暂时不能删除' });
  await expect(dialog.getByRole('link', { name: '查看引用平台（2）' })).toHaveAttribute(
    'href',
    '/settings/platforms?platformTypeId=10000000-0000-4000-8000-000000000001&page=1&pageSize=20',
  );
  await dialog.getByRole('button', { name: '关闭' }).first().click();
  await expect(more).toBeFocused();

  const editable = page.locator('tr:visible, li:visible').filter({ hasText: '行业媒体' }).first();
  more = editable.getByRole('button', { name: '更多操作：行业媒体' });
  await more.click();
  await page.getByRole('menuitem', { name: '编辑' }).click();
  dialog = page.getByRole('dialog', { name: '编辑平台类型' });
  const name = dialog.getByRole('textbox', { name: 'Name' });
  await name.fill('本地未保存名称');
  platformTypesApi.conflictNextUpdate();
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: '当前输入已保留，不会自动重放' }))
    .toBeVisible();
  await expect(name).toHaveValue('本地未保存名称');
  expect(platformTypesApi.requests.filter((request) => request.method === 'PATCH')).toHaveLength(1);
  await dialog.getByRole('button', { name: '重新读取服务端版本' }).click();
  await expect(name).toHaveValue('服务端并发名称');
  await dialog.getByRole('button', { name: '取消' }).click();

  const concurrent = page.locator('tr:visible, li:visible').filter({ hasText: '服务端并发名称' }).first();
  more = concurrent.getByRole('button', { name: '更多操作：服务端并发名称' });
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  dialog = page.getByRole('dialog', { name: '删除平台类型？' });
  platformTypesApi.conflictNextDelete();
  await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(dialog.getByRole('alert')).toContainText('平台类型已被其他请求修改');
  expect(platformTypesApi.requests.filter((request) => request.method === 'DELETE')).toHaveLength(1);
  await dialog.getByRole('button', { name: '重新读取服务端版本' }).click();
  await expect(dialog.getByText(/已读取 revision/)).toBeVisible();
  platformTypesApi.blockNextDelete();
  await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(dialog.getByRole('link', { name: '查看引用平台（1）' })).toHaveAttribute(
    'href',
    '/settings/platforms?platformTypeId=10000000-0000-4000-8000-000000000002&page=1&pageSize=20',
  );
});

test('非管理员由 route 与 server 双重拒绝', async ({ page, platformTypesApi }) => {
  platformTypesApi.setEngineer();
  await page.goto('/settings/platforms/types');
  await expect(page.getByRole('heading', { name: '无权访问系统管理' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '平台类型' })).toHaveCount(0);
  await expect.poll(() => (
    platformTypesApi.requests.filter((request) => request.method === 'GET').length
  )).toBeGreaterThan(0);
});

test('error retry 与 375/768/1024/1440 production artifact 均保持四字段和动作可达', async ({
  page,
  platformTypesApi,
}, testInfo) => {
  platformTypesApi.failNextList();
  await page.goto('/settings/platforms/types');
  await expect(page.getByRole('alert').filter({ hasText: '平台类型服务暂不可用' }).first())
    .toBeVisible();
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.locator('tr:visible, li:visible').filter({ hasText: '行业媒体' }).first())
    .toBeVisible();

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
    const row = page.locator('tr:visible, li:visible').filter({ hasText: '行业媒体' }).first();
    await expect(row).toContainText('行业媒体');
    await expect(row).toContainText('industry-media');
    await expect(row).toContainText('0');
    await expect(row.getByRole('button', { name: '更多操作：行业媒体' })).toBeVisible();
  }
});
