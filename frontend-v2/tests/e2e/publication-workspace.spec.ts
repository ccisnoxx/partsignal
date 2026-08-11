import { expect, publicationIds, test } from './fixtures/publication.fixture';

const workspace = `/publishing/work/${publicationIds.work}`;

test('Workspace direct/refresh/Back/Forward 只使用六个 canonical hash', async ({ page, publicationApi }) => {
  await page.goto(workspace);
  await expect(page).toHaveURL(`${workspace}#summary`);
  await expect(page.getByRole('heading', { level: 1, name: '如何选择低噪声放大器' })).toBeVisible();
  expect(publicationApi.workspaceRequests).toHaveLength(1);

  for (const hash of ['preparation', 'result', 'verification', 'content-version', 'close', 'summary']) {
    await page.goto(`${workspace}#${hash}`);
    await expect(page).toHaveURL(`${workspace}#${hash}`);
  }
  await page.goto(`${workspace}#unknown`);
  await expect(page).toHaveURL(`${workspace}#summary`);
  await page.reload();
  await expect(page).toHaveURL(`${workspace}#summary`);
  await page.goto(`${workspace}#result`);
  await page.goBack();
  await expect(page).toHaveURL(`${workspace}#summary`);
  await page.goForward();
  await expect(page).toHaveURL(`${workspace}#result`);
});

test('Package 按点击读取，Core UI 完成 preparation/review/upload/result 并明确交接', async ({ context, page, publicationApi }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${workspace}#preparation`);
  expect(publicationApi.packageRequests).toHaveLength(0);
  await page.getByRole('button', { name: '复制发布包' }).click();
  await expect(page.getByText('发布包已复制。')).toBeVisible();
  expect(publicationApi.packageRequests).toHaveLength(1);

  const preparationTrigger = page.getByRole('button', { name: '更新准备信息' });
  await preparationTrigger.press('Enter');
  let dialog = page.getByRole('dialog', { name: '更新准备信息' });
  await dialog.getByRole('textbox', { name: '备注' }).fill('准备信息已确认');
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();
  await expect(preparationTrigger).toBeFocused();

  await page.getByRole('button', { name: '标记平台处理中' }).click();
  dialog = page.getByRole('dialog', { name: '标记平台处理中' });
  await dialog.getByRole('textbox', { name: '备注' }).fill('平台审核开始');
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '登记发布结果' }).click();
  dialog = page.getByRole('dialog', { name: '登记发布结果' });
  await dialog.getByRole('textbox', { name: '实际发布标题' }).fill('真实发布标题');
  await dialog.getByRole('textbox', { name: '最终 URL' }).fill('https://community.example.com/articles/lna');
  await dialog.getByLabel('发布时间').fill('2026-08-11T11:00');
  await dialog.getByRole('textbox', { name: '备注' }).fill('结果登记完成');
  await dialog.getByLabel('上传发布证据截图').setInputFiles({
    name: 'publication-proof.png',
    mimeType: 'image/png',
    buffer: Buffer.from('evidence'),
  });
  await expect(dialog.getByText('已校验：publication-proof.png')).toBeVisible();
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText('当前工作已等待核验；核验能力由下一子任务交付。')).toBeVisible();
  expect(publicationApi.commandRequests.map((request) => request.path)).toEqual([
    `/api/v1/publication-works/${publicationIds.work}/preparation`,
    `/api/v1/publication-works/${publicationIds.work}/platform-review`,
    `/api/v1/publication-works/${publicationIds.work}/result`,
  ]);
  expect(publicationApi.uploadRequests.map((request) => request.method)).toEqual(['POST', 'PUT', 'POST']);
});

test('409 保留输入且不重放；pending 禁止双提交', async ({ page, publicationApi }) => {
  publicationApi.setCommandMode('conflict');
  await page.goto(`${workspace}#preparation`);
  await page.getByRole('button', { name: '标记平台处理中' }).click();
  let dialog = page.getByRole('dialog', { name: '标记平台处理中' });
  const comment = dialog.getByRole('textbox', { name: '备注' });
  await comment.fill('必须保留的输入');
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog.getByText('请求 ID：req-workspace-conflict')).toBeVisible();
  await expect(comment).toHaveValue('必须保留的输入');
  expect(publicationApi.commandRequests).toHaveLength(1);
  await dialog.getByRole('button', { name: '显式重载最新工作' }).click();
  expect(publicationApi.commandRequests).toHaveLength(1);
  await dialog.getByRole('button', { name: '取消' }).click();

  publicationApi.setCommandMode('pending');
  await page.getByRole('button', { name: '标记平台处理中' }).click();
  dialog = page.getByRole('dialog', { name: '标记平台处理中' });
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog.getByRole('button', { name: '正在提交…' })).toBeDisabled();
  expect(publicationApi.commandRequests).toHaveLength(2);
  publicationApi.releaseCommand();
  await expect(dialog).toBeHidden();
});

test('typed 初始错误与目标宽度不产生页面横向溢出', async ({ page, publicationApi }) => {
  await page.goto(`${workspace}#summary`);
  for (const status of [401, 403, 404, 409, 422] as const) {
    publicationApi.setWorkspaceError(status);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText(`req-workspace-${status}`);
  }
  publicationApi.setWorkspaceError(undefined);
  await page.reload();
  for (const width of [375, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根不应横向溢出`).toBe(true);
  }
});
