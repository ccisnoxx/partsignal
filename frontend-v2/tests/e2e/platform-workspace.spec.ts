import { expect, test } from './fixtures/platform-workspace.fixture';

const platformId = '00000000-0000-4000-8000-000000000001';

test('Platform List 进入 canonical Workspace，Tab URL 支持 refresh/back/forward', async ({
  page,
  platformWorkspaceApi,
}) => {
  await page.goto('/settings/platforms?page=1&pageSize=20');
  const handoff = page.getByRole('link', { name: /工程师社区 001/ });
  await expect(handoff).toHaveAttribute('href', `/settings/platforms/${platformId}?tab=overview`);
  await handoff.click();
  await expect(page).toHaveURL(`/settings/platforms/${platformId}?tab=overview`);
  await expect(page.getByRole('heading', { level: 1, name: /工程师社区 001/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '面包屑' })).toContainText('平台工作区');

  const more = page.getByRole('button', { name: /更多操作/ });
  await more.click();
  await page.getByRole('menuitem', { name: '查看删除条件' }).click();
  const blockers = page.getByRole('dialog', { name: '平台暂时不能删除' });
  await expect(blockers).toContainText('开放内容任务：2');
  await blockers.getByRole('button', { name: '关闭' }).first().click();
  await expect(more).toBeFocused();

  await page.getByRole('tab', { name: '发布账号' }).click();
  await expect(page).toHaveURL(`/settings/platforms/${platformId}?tab=accounts`);
  await expect(page.getByText('Workspace 运营账号')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: '发布账号' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: '生成配置' }).click();
  await expect(page).toHaveURL(`/settings/platforms/${platformId}?tab=generation`);
  await page.goBack();
  await expect(page).toHaveURL(`/settings/platforms/${platformId}?tab=accounts`);
  await page.goForward();
  await expect(page).toHaveURL(`/settings/platforms/${platformId}?tab=generation`);
  expect(platformWorkspaceApi.detailRequests.length).toBeGreaterThanOrEqual(2);

  await page.goto(`/settings/platforms/${platformId.toUpperCase()}?tab=overview`);
  await expect(page).toHaveURL(`/settings/platforms/${platformId}?tab=overview`);
});

test('Overview 取消与保存只发送单个 revision PATCH，官网候选确认后才绑定', async ({
  page,
  platformWorkspaceApi,
}) => {
  await page.goto(`/settings/platforms/${platformId}?tab=overview`);
  const name = page.getByRole('textbox', { name: '平台名称' });
  await expect(name).toBeVisible();
  const originalName = await name.inputValue();
  await name.fill('未保存的平台名称');
  await page.getByRole('button', { name: '取消' }).click();
  await expect(name).toHaveValue(originalName);

  await name.fill('Workspace 已保存名称');
  await page.getByRole('button', { name: '保存概览' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workspace 已保存名称' })).toBeVisible();
  expect(platformWorkspaceApi.updateRequests[0]).toMatchObject({
    csrfToken: 'platforms-e2e-csrf',
    platformId,
    body: {
      expected_revision: 1,
      name: 'Workspace 已保存名称',
      platform_prompt_id: '20000000-0000-4000-8000-000000000001',
    },
  });
  expect('logo' in platformWorkspaceApi.updateRequests[0]!.body).toBe(false);

  await page.getByRole('button', { name: '从官网导入候选' }).click();
  await expect(page.getByAltText('官网 Logo 候选')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存概览' })).toBeDisabled();
  await page.getByRole('button', { name: '使用此候选' }).click();
  await page.getByRole('button', { name: '保存概览' }).click();
  await expect.poll(() => platformWorkspaceApi.updateRequests.length).toBe(2);
  expect(platformWorkspaceApi.candidateRequests).toEqual(['https://community-1.example.invalid/']);
  expect(platformWorkspaceApi.updateRequests[1]!.body.logo).toEqual({
    source: 'UPLOAD',
    file_id: '40000000-0000-4000-8000-000000000001',
  });
});

test('Logo 手工上传只接受图片并通过 PLATFORM_LOGO 生命周期，移除由下一次 PATCH 完成', async ({
  page,
  platformWorkspaceApi,
}) => {
  await page.goto(`/settings/platforms/${platformId}?tab=overview`);
  await page.getByLabel('上传平台 Logo').setInputFiles({
    name: 'workspace-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  });
  await expect.poll(() => platformWorkspaceApi.uploadRequests.length).toBe(1);
  expect(platformWorkspaceApi.uploadRequests[0]).toMatchObject({
    access_level: 'PUBLIC',
    category: 'PLATFORM_LOGO',
    content_type: 'image/png',
    original_filename: 'workspace-logo.png',
  });
  await page.getByRole('button', { name: '保存概览' }).click();
  await expect.poll(() => platformWorkspaceApi.updateRequests.length).toBe(1);
  expect(platformWorkspaceApi.updateRequests[0]!.body.logo).toEqual({
    source: 'UPLOAD',
    file_id: '40000000-0000-4000-8000-000000000002',
  });

  await page.getByRole('button', { name: '移除 Logo' }).click();
  await page.getByRole('button', { name: '保存概览' }).click();
  await expect.poll(() => platformWorkspaceApi.updateRequests.length).toBe(2);
  expect(platformWorkspaceApi.updateRequests[1]!.body.logo).toBeNull();
});

test('Accounts 保持移动端可达，Generation 绑定/解绑并在 409 保留选择', async ({
  page,
  platformWorkspaceApi,
}) => {
  await page.goto(`/settings/platforms/${platformId}?tab=accounts`);
  await expect(page.getByText('Workspace 运营账号')).toBeVisible();
  await expect(page.getByText('workspace-main')).toBeVisible();
  await expect(page.getByText('Workspace 停用账号')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '平台' })).toHaveCount(0);

  await page.getByRole('tab', { name: '生成配置' }).click();
  const prompt = page.getByRole('combobox', { name: '绑定 Prompt' });
  await prompt.click();
  await page.getByRole('option', { name: /Workspace 备选 Prompt/ }).click();
  await page.getByRole('button', { name: '保存生成配置' }).click();
  await expect.poll(() => platformWorkspaceApi.updateRequests.length).toBe(1);
  expect(platformWorkspaceApi.updateRequests[0]!.body.platform_prompt_id)
    .toBe('20000000-0000-4000-8000-000000000099');

  platformWorkspaceApi.conflictNextUpdate();
  await prompt.click();
  await page.getByRole('option', { name: '不绑定 Prompt' }).click();
  await page.getByRole('button', { name: '保存生成配置' }).click();
  await expect(page.getByRole('alert')).toContainText('平台已被其他请求修改');
  await expect(prompt).toContainText('不绑定 Prompt');
  await expect(page.getByRole('button', { name: '重新加载服务端版本' })).toBeVisible();
});

test('DirtyGuard 覆盖 Tab 离开；404/403/error retry 分别呈现', async ({
  page,
  platformWorkspaceApi,
}) => {
  await page.goto(`/settings/platforms/${platformId}?tab=overview`);
  await page.getByRole('textbox', { name: '平台名称' }).fill('未保存草稿');
  const accountsTab = page.getByRole('tab', { name: '发布账号' });
  await accountsTab.click();
  const guard = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: '继续编辑' }).click();
  await expect(accountsTab).toBeFocused();
  await expect(page).toHaveURL(`/settings/platforms/${platformId}?tab=overview`);
  await page.getByRole('tab', { name: '发布账号' }).click();
  await guard.getByRole('button', { name: '放弃修改并离开' }).click();
  await expect(page).toHaveURL(`/settings/platforms/${platformId}?tab=accounts`);

  platformWorkspaceApi.failNextDetail(403);
  await page.goto('/settings/platforms/99999999-9999-4999-8999-999999999999?tab=overview');
  await expect(page.getByRole('heading', { name: '无法访问 Platform Workspace' })).toBeVisible();

  platformWorkspaceApi.failNextDetail(404);
  await page.goto('/settings/platforms/99999999-9999-4999-8999-999999999999?tab=overview');
  await expect(page.getByRole('heading', { name: '未找到平台' })).toBeVisible();

  platformWorkspaceApi.failNextDetail(500);
  await page.goto(`/settings/platforms/00000000-0000-4000-8000-000000000002?tab=overview`);
  await expect(page.getByRole('heading', { name: 'Platform Workspace 加载失败' })).toBeVisible();
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '工程师社区 002' })).toBeVisible();
});

test('375/768/1024/1440 无页面横向溢出，read-only projection 不加载 Prompt options', async ({
  page,
  platformWorkspaceApi,
}, testInfo) => {
  platformWorkspaceApi.setReadOnly(true);
  await page.goto(`/settings/platforms/${platformId}?tab=generation`);
  await expect(page.getByText('只读访问')).toBeVisible();
  await expect(page.getByText(/没有修改生成配置的服务端动作/)).toBeVisible();
  await expect(page.getByRole('combobox', { name: '绑定 Prompt' })).toHaveCount(0);

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }

  await page.getByRole('tab', { name: '发布账号' }).click();
  await expect(page.getByText('Workspace 运营账号')).toBeVisible();
  await expect(page.getByText('workspace-main')).toBeVisible();
});
