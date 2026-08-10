import type { Page } from '@playwright/test';

import {
  creationFactId,
  creationProductId,
  expect,
  inactiveProductId,
  noFactsProductId,
  platformId,
  secondCreationProductId,
  test,
} from './fixtures/content.fixture';

const listUrl = '/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=20';

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

async function fillCreationForm(page: Page) {
  await choose(page, '已批准事实版本', 'v3 · 公开');
  await choose(page, '目标平台', '工程师社区');
}

test('Content Task List Page Primary 进入可直达、刷新的三字段创建页', async ({ page }) => {
  await page.goto(listUrl);
  const primary = page.getByRole('link', { name: '创建内容任务', exact: true });
  await expect(primary).toHaveCount(1);
  await primary.click();
  await expect(page).toHaveURL('/content/tasks/new');
  await expect(page.getByRole('heading', { level: 1, name: '创建内容任务' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL('/content/tasks/new');
  await expect(page.locator('form label')).toHaveText([
    '产品*',
    '已批准事实版本*',
    '目标平台*',
  ]);
  await expect(page.getByRole('button', { name: '创建', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消' })).toBeVisible();
  await expect(page.locator('form')).not.toContainText('Topic');
  await expect(page.locator('form')).not.toContainText('Intent');
  await expect(page.locator('form')).not.toContainText('generation');
  await expect(page.locator('form')).not.toContainText('notes');
  await expect(page.locator('form')).not.toContainText('AI model');
});

test('Product Detail CREATE_CONTENT_TASK handoff 进入 URL 并经服务端资格确认后预选', async ({ page, contentApi }) => {
  await page.goto(`/products/${creationProductId}`);
  const action = page.getByRole('link', { name: '创建内容' });
  await expect(action).toHaveAttribute(
    'href',
    `/content/tasks/new?productId=${creationProductId}`,
  );
  await action.click();
  await expect(page).toHaveURL(`/content/tasks/new?productId=${creationProductId}`);
  await expect(page.getByRole('status')).toContainText('已根据链接预选产品');
  await expect(page.getByRole('combobox', { name: '产品' })).toContainText('PS-CREATE-001');
  expect(contentApi.creationOptionsRequests.at(-1)?.searchParams.get('requested_product_id'))
    .toBe(creationProductId);
});

test('productId direct/refresh/Back/Forward 恢复，非法、不存在、停用和无事实都不静默改选', async ({ page }) => {
  await page.goto(`/content/tasks/new?productId=${creationProductId}`);
  await expect(page.getByRole('combobox', { name: '产品' })).toContainText('PS-CREATE-001');
  await page.reload();
  await expect(page.getByRole('combobox', { name: '产品' })).toContainText('PS-CREATE-001');

  await choose(page, '产品', 'PartSignal · PS-CREATE-002');
  await expect(page).toHaveURL(`/content/tasks/new?productId=${secondCreationProductId}`);
  await expect(page.getByRole('combobox', { name: '产品' })).toContainText('PS-CREATE-002');
  await page.goBack();
  await expect(page).toHaveURL(`/content/tasks/new?productId=${creationProductId}`);
  await expect(page.getByRole('status')).toContainText('PS-CREATE-001');
  await expect(page.getByRole('combobox', { name: '产品' })).toContainText('PS-CREATE-001');
  await page.goForward();
  await expect(page.getByRole('combobox', { name: '产品' })).toContainText('PS-CREATE-002');

  for (const [value, message] of [
    ['', 'productId 为空'],
    ['not-a-uuid', '不是有效 UUID'],
    ['10000000-0000-4000-8000-000000000299', '产品不存在'],
    [inactiveProductId, '已停用'],
  ] as const) {
    await page.goto(`/content/tasks/new?productId=${value}`);
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('combobox', { name: '产品' })).toContainText('选择产品');
  }
  await page.goto(`/content/tasks/new?productId=${noFactsProductId}`);
  await expect(page.getByRole('alert')).toContainText('没有非空的已批准事实版本');
  await expect(page.getByRole('alert').getByRole('link', { name: '进入产品事实' }))
    .toHaveAttribute('href', `/products/${noFactsProductId}/facts`);
});

test('Product 只显示所属 approved facts，换 Product 清除旧事实，Platform 只显示活动具体平台', async ({ page }) => {
  await page.goto('/content/tasks/new');
  await choose(page, '产品', 'PartSignal · PS-CREATE-001');
  await page.getByRole('combobox', { name: '已批准事实版本' }).click();
  await expect(page.getByRole('option', { name: 'v3 · 公开' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'v2 · 内部' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'v1 · 受限' })).toHaveCount(0);
  await page.getByRole('option', { name: 'v3 · 公开' }).click();

  await choose(page, '产品', 'PartSignal · PS-CREATE-002');
  await expect(page.getByRole('combobox', { name: '已批准事实版本' })).toContainText('选择事实版本');
  await page.getByRole('combobox', { name: '已批准事实版本' }).click();
  await expect(page.getByRole('option', { name: 'v1 · 受限' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'v3 · 公开' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('combobox', { name: '目标平台' }).click();
  await expect(page.getByRole('option', { name: '工程师社区' })).toBeVisible();
  await expect(page.getByRole('option', { name: '开发者问答' })).toBeVisible();
});

test('POST 发送精确 ContentTaskCreate 与稳定 Idempotency-Key，pending 防重，成功回列表重新获取', async ({ page, contentApi }) => {
  await page.goto(listUrl);
  const listRequestsBefore = contentApi.listRequests.length;
  await page.getByRole('link', { name: '创建内容任务', exact: true }).click();
  await choose(page, '产品', 'PartSignal · PS-CREATE-001');
  await fillCreationForm(page);
  contentApi.setCreateMode('pending');
  await page.getByRole('button', { name: '创建', exact: true }).dblclick();

  await expect.poll(() => contentApi.createRequests.length).toBe(1);
  const request = contentApi.createRequests[0]!;
  expect(request.body).toEqual({
    product_id: creationProductId,
    fact_version_id: creationFactId,
    platform_profile_id: platformId,
  });
  expect(Object.keys(request.body)).toHaveLength(3);
  expect(request.csrfToken).toBe('content-e2e-csrf');
  expect(request.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  expect(request.idempotencyKey).not.toBe(creationProductId);
  await expect(page.getByRole('button', { name: '创建中…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '取消' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: '产品' })).toBeDisabled();

  contentApi.releaseCreate();
  await expect(page).toHaveURL(listUrl);
  await expect(page.getByRole('status')).toContainText('内容任务已创建');
  await expect(page.getByRole('link', { name: 'PS-CREATE-001' })).toBeVisible();
  await expect.poll(() => contentApi.listRequests.length).toBeGreaterThan(listRequestsBefore);
  await expect(page.getByRole('dialog', { name: '要离开当前页面吗？' })).toHaveCount(0);
});

test('失败保留选择与同键重试，字段错误、403/404/409 与 IDEMPOTENCY_CONFLICT 显示 request ID', async ({ page, contentApi }) => {
  await page.goto(`/content/tasks/new?productId=${creationProductId}`);
  await fillCreationForm(page);
  contentApi.setCreateMode('validation');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  let summary = page.getByRole('alert', { name: '请修正以下问题' });
  await expect(summary).toContainText('事实版本不属于所选产品');
  await expect(summary).toContainText('req-content-validation');
  await expect(page.getByRole('combobox', { name: '已批准事实版本' })).toHaveAttribute('aria-invalid', 'true');
  const retryKey = contentApi.createRequests.at(-1)?.idempotencyKey;

  for (const [mode, message, requestId] of [
    ['fact-not-approved', '内容任务只能绑定', 'req-content-fact'],
    ['platform-disabled', '所选平台已停用', 'req-content-platform'],
    ['not-found', '平台配置不存在', 'req-content-not-found'],
    ['forbidden', '没有创建内容任务的权限', 'req-content-forbidden'],
  ] as const) {
    contentApi.setCreateMode(mode);
    await page.getByRole('button', { name: '创建', exact: true }).click();
    summary = page.getByRole('alert', { name: '请修正以下问题' });
    await expect(summary).toContainText(message);
    await expect(summary).toContainText(requestId);
    expect(contentApi.createRequests.at(-1)?.idempotencyKey).toBe(retryKey);
    await expect(page.getByRole('combobox', { name: '产品' })).toContainText('PS-CREATE-001');
  }

  contentApi.setCreateMode('idempotency-conflict');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('alert', { name: '请修正以下问题' }))
    .toContainText('req-content-idempotency');
  contentApi.setCreateMode('success');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(listUrl);
  expect(contentApi.createRequests.at(-1)?.idempotencyKey).not.toBe(retryKey);
});

test('options loading/error/retry/empty 均有明确恢复路径', async ({ page, contentApi }) => {
  contentApi.setCreationOptionsMode('loading');
  const navigation = page.goto('/content/tasks/new');
  await expect(page.getByText('正在读取可选产品、事实版本和平台…')).toBeVisible();
  contentApi.releaseOptionsLoading();
  await navigation;
  await expect(page.getByRole('combobox', { name: '产品' })).toBeVisible();

  contentApi.setCreationOptionsMode('error');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('req-content-options');
  contentApi.setCreationOptionsMode('empty');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText(/产品活动且存在/)).toBeVisible();
  await expect(page.getByText(/没有活动的具体平台/)).toBeVisible();
});

test('DirtyGuard 覆盖 Cancel', async ({ page }) => {
  await page.goto(listUrl);
  await page.getByRole('link', { name: '创建内容任务', exact: true }).click();
  await choose(page, '目标平台', '工程师社区');
  const cancel = page.getByRole('button', { name: '取消' });
  await cancel.click();
  const dialog = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(page).toHaveURL('/content/tasks/new');
  await expect(dialog).toHaveCount(0);
  await expect(cancel).toBeFocused();
});

test('DirtyGuard 覆盖浏览器 Back', async ({ page }) => {
  await page.goto(listUrl);
  await page.getByRole('link', { name: '创建内容任务', exact: true }).click();
  await choose(page, '目标平台', '工程师社区');
  const confirmedBack = page.goBack();
  const dialog = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '放弃修改并离开' }).click();
  await confirmedBack;
  await expect(page).toHaveURL(listUrl);
});

test('创建页在 375/768/1024/1440 无页面横溢出，键盘可选择且焦点可见', async ({ page }, testInfo) => {
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  await page.goto(`/content/tasks/new?productId=${creationProductId}`);
  await expect(page.getByRole('combobox', { name: '产品' })).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }

  const product = page.getByRole('combobox', { name: '产品' });
  await product.focus();
  await expect(product).toBeFocused();
  await product.press('Enter');
  await expect(page.getByRole('option', { name: 'PartSignal · PS-CREATE-002' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(product).toBeFocused();
  expect(await product.evaluate((element) => (
    getComputedStyle(element).outlineStyle !== 'none'
    || getComputedStyle(element).boxShadow !== 'none'
  ))).toBe(true);

});
