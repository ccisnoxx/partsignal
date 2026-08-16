import { expect, test } from './fixtures/users.fixture';

test.use({ trace: 'off' });

test('Users 由 canonical URL 与单次 UserList projection 驱动筛选、分页和历史', async ({ page, usersApi }, testInfo) => {
  await page.goto('/system/users');
  await expect(page).toHaveURL('/system/users?status=ENABLED&page=1&pageSize=20');
  await expect(page.getByRole('heading', { level: 1, name: '用户管理' })).toBeVisible();
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('button', { name: '打开主导航' }).click();
  }
  await expect(page.getByRole('link', { name: '用户管理' })).toHaveAttribute('aria-current', 'page');
  if (testInfo.project.name === 'foundation-mobile') await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: '面包屑' })).toContainText('用户管理');
  await expect(page.locator('thead th')).toHaveCount(7);
  await expect(page.getByRole('region', { name: '用户统计' })).toContainText('用户总数25');
  await expect(page.getByRole('region', { name: '用户统计' })).toContainText('不受当前筛选影响');
  expect(usersApi.listRequests).toHaveLength(1);
  expect(usersApi.listRequests[0]?.searchParams.get('status')).toBe('ENABLED');

  const search = page.getByRole('searchbox', { name: '搜索用户' });
  await search.fill('operator-05');
  await search.press('Enter');
  await expect(page.getByText('@operator-05', { exact: true })).toBeVisible();
  expect(usersApi.listRequests.at(-1)?.searchParams.get('q')).toBe('operator-05');

  await page.reload();
  await expect(page.getByRole('searchbox', { name: '搜索用户' })).toHaveValue('operator-05');
  await search.fill('operator-06');
  await search.press('Enter');
  await expect(page.getByText('@operator-06', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('@operator-05', { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByText('@operator-06', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '重置' }).click();
  await page.getByRole('combobox', { name: '每页条数' }).click();
  await page.getByRole('option', { name: '10 条/页' }).click();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(usersApi.listRequests.at(-1)?.searchParams.get('page_size')).toBe('10');
});

test('Users 创建、编辑、reset 冲突与 blocker 均遵守 revision 和敏感字段边界', async ({ page, usersApi }) => {
  await page.goto('/system/users?status=ENABLED&page=1&pageSize=20');

  await page.getByRole('button', { name: '新增用户' }).click();
  const create = page.getByRole('dialog', { name: '新增用户' });
  await create.getByRole('textbox', { name: '用户名' }).fill('new-e2e-user');
  await create.getByRole('textbox', { name: '显示名称' }).fill('新增 E2E 用户');
  await create.getByLabel(/临时密码/).fill('create-users-secret');
  await create.getByRole('button', { name: '创建用户' }).click();
  await expect(create).not.toBeVisible();
  expect(usersApi.requestRecords.at(-1)).toEqual({
    operation: 'create', csrfToken: 'users-e2e-csrf', passwordLength: 19,
  });

  const firstRow = page.getByRole('row', { name: /operator-long-account-name/ });
  await firstRow.getByRole('button', { name: '管理用户' }).click();
  const edit = page.getByRole('dialog', { name: /编辑用户 operator-long-account-name/ });
  await edit.getByRole('textbox', { name: '显示名称' }).fill('已编辑运营人员');
  await edit.getByRole('button', { name: '保存修改' }).click();
  await expect(edit).not.toBeVisible();
  expect(usersApi.requestRecords.at(-1)).toMatchObject({ operation: 'update', expectedRevision: 1 });

  const resetRow = page.getByRole('row', { name: /operator-02/ });
  usersApi.conflictNext('reset');
  usersApi.allowHttpError(409);
  await resetRow.getByRole('button', { name: '重置临时密码' }).click();
  const reset = page.getByRole('dialog', { name: /重置 operator-02 的临时密码/ });
  const password = reset.getByLabel(/临时密码/);
  await password.fill('reset-users-secret');
  await reset.getByRole('button', { name: '重置临时密码' }).click();
  await expect(reset.getByRole('alert')).toContainText('请求 ID：req-users-conflict');
  await expect(password).toHaveValue('reset-users-secret');
  const resetCount = usersApi.requestRecords.filter((record) => record.operation === 'reset').length;
  await page.waitForTimeout(150);
  expect(usersApi.requestRecords.filter((record) => record.operation === 'reset')).toHaveLength(resetCount);
  await reset.getByRole('button', { name: '重新加载列表' }).click();
  await expect(reset).not.toBeVisible();
  expect(usersApi.requestRecords.at(-1)).toMatchObject({
    operation: 'reset', csrfToken: 'users-e2e-csrf', expectedRevision: 2, passwordLength: 18,
  });

  await firstRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '查看删除条件' }).click();
  const blocker = page.getByRole('dialog', { name: /暂不可删除/ });
  await expect(blocker).toContainText('USER_BUSINESS_HISTORY：2');
  await expect(blocker.getByRole('link')).toHaveCount(0);
  await blocker.getByRole('button', { name: '关闭' }).first().click();
  await expect(firstRow.getByRole('button', { name: /更多操作/ })).toBeFocused();

  expect(usersApi.responsePayloads.join('\n')).not.toContain('create-users-secret');
  expect(usersApi.responsePayloads.join('\n')).not.toContain('reset-users-secret');
  expect(JSON.stringify(usersApi.requestRecords)).not.toContain('users-secret');
});

test('Users loading、空态、失败重试与越界页均由 UserList 合同驱动', async ({ page, usersApi }) => {
  usersApi.delayNextList(300);
  await page.goto('/system/users?status=ENABLED&page=1&pageSize=20');
  await expect(page.locator('tbody[aria-label="正在加载表格"]')).toBeVisible();
  await expect(page.getByText('@operator-long-account-name', { exact: true })).toBeVisible();

  usersApi.allowHttpError(503);
  usersApi.failNextList(503);
  await page.goto('/system/users?status=ENABLED&page=1&pageSize=10');
  await expect(page.getByText('用户列表加载失败', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('@operator-long-account-name', { exact: true })).toBeVisible();

  await page.goto('/system/users?q=not-found&status=ENABLED&page=1&pageSize=20');
  await expect(page.getByText('未找到匹配用户', { exact: true })).toBeVisible();
  await page.goto('/system/users?status=ENABLED&page=99&pageSize=20');
  await expect(page.getByText('当前页已超出范围', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回最后一页' }).click();
  await expect(page).toHaveURL(/page=2/);

  usersApi.clearUsers();
  await page.reload();
  await expect(page.getByText('暂无用户', { exact: true })).toBeVisible();
});

test('Users export、启用、停用和删除传递 CSRF 与当前 revision', async ({ page, usersApi }) => {
  await page.goto('/system/users?status=DISABLED&page=1&pageSize=20');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  expect((await download).suggestedFilename()).toBe('users-e2e.csv');
  expect(usersApi.requestRecords.at(-1)).toEqual({ operation: 'export', csrfToken: null });

  const enableRow = page.getByRole('row', { name: /operator-09/ });
  await enableRow.getByRole('button', { name: '启用用户' }).click();
  await page.getByRole('dialog', { name: /启用用户“operator-09”/ }).getByRole('button', { name: '启用用户' }).click();
  expect(usersApi.requestRecords.at(-1)).toMatchObject({
    operation: 'update', csrfToken: 'users-e2e-csrf', expectedRevision: 9, status: 'ENABLED',
  });

  await page.goto('/system/users?status=ENABLED&q=operator-10&page=1&pageSize=20');
  const disableRow = page.getByRole('row', { name: /operator-10/ });
  await disableRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '停用用户' }).click();
  await page.getByRole('dialog', { name: /停用用户“operator-10”/ }).getByRole('button', { name: '停用用户' }).click();
  expect(usersApi.requestRecords.at(-1)).toMatchObject({
    operation: 'update', csrfToken: 'users-e2e-csrf', expectedRevision: 10, status: 'DISABLED',
  });

  await page.goto('/system/users?status=DISABLED&q=operator-18&page=1&pageSize=20');
  const deleteRow = page.getByRole('row', { name: /operator-18/ });
  await deleteRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '删除用户' }).click();
  await page.getByRole('dialog', { name: /删除用户“operator-18”/ }).getByRole('button', { name: '删除用户' }).click();
  expect(usersApi.requestRecords.at(-1)).toMatchObject({
    operation: 'delete', csrfToken: 'users-e2e-csrf', expectedRevision: 18,
  });
});

test('Users bulk 使用选择时 revision、custom 停用确认和 200 partial 反馈', async ({ page, usersApi }) => {
  await page.goto('/system/users?status=ENABLED&page=1&pageSize=20');
  await page.getByRole('checkbox', { name: '选择用户 operator-long-account-name' }).check();
  await page.getByRole('checkbox', { name: '选择用户 operator-02' }).check();
  await expect(page.getByRole('toolbar', { name: '批量操作' })).toContainText('已选择 2 项');

  await page.getByRole('button', { name: '批量停用' }).click();
  const confirm = page.getByRole('dialog', { name: '批量停用 2 个用户？' });
  await confirm.getByRole('button', { name: '批量停用' }).click();
  await expect(page.getByRole('toolbar', { name: '批量操作' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('成功 1，失败 1');
  await expect(page.getByRole('status')).toContainText('operator-02：用户修订冲突（REVISION_CONFLICT）');
  expect(usersApi.requestRecords.at(-1)).toEqual({
    operation: 'bulk',
    csrfToken: 'users-e2e-csrf',
    status: 'DISABLED',
    itemRevisions: [
      { userId: '00000000-0000-4000-8000-000000000001', expectedRevision: 1 },
      { userId: '00000000-0000-4000-8000-000000000002', expectedRevision: 2 },
    ],
  });

  await page.getByRole('checkbox', { name: '选择用户 operator-03' }).check();
  await page.getByRole('combobox', { name: '账号类型' }).click();
  await page.getByRole('option', { name: 'ADMIN' }).click();
  await expect(page.getByRole('toolbar', { name: '批量操作' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('查询范围已变化');
});

test('Users 管理员边界、四档响应式、键盘动作与无敏感响应成立', async ({ page, usersApi }, testInfo) => {
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  await page.goto('/system/users?status=ENABLED&page=1&pageSize=20');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
  await page.setViewportSize({ width: widths[0], height: 900 });
  const firstRow = page.getByRole('row', { name: /operator-long-account-name/ });
  if (widths[0] <= 768) {
    const compactFacts = firstRow.locator('.user-list-mobile-summary');
    await expect(compactFacts.getByText('ENGINEER', { exact: true })).toBeVisible();
    await expect(compactFacts.getByText('Enabled', { exact: true })).toBeVisible();
  } else {
    await expect(firstRow.getByRole('cell', { name: '已完成初始改密' })).toBeVisible();
  }
  const more = firstRow.getByRole('button', { name: /更多操作/ });
  await more.focus();
  await more.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  expect(usersApi.responsePayloads.join('\n')).not.toContain('temporary_password');
  expect(usersApi.responsePayloads.join('\n')).not.toContain('password_hash');

  usersApi.setAccountType('ENGINEER');
  usersApi.allowHttpError(403);
  await page.reload();
  await expect(page.getByRole('heading', { name: '无权访问系统管理' })).toBeVisible();
  await expect(page).toHaveURL('/system/users?status=ENABLED&page=1&pageSize=20');
});
