/** 通过真实本地协议替身验收 AI 渠道三栏页面与安全状态机。 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';
const createdChannelIds = new Set<string>();

test.setTimeout(120_000);

test.afterEach(async ({ page }) => {
  const csrfResponse = await page.request.get('/api/v1/auth/csrf').catch(() => null);
  if (csrfResponse === null) return;
  if (!csrfResponse.ok()) return;
  const { csrf_token: csrf } = await body<{ csrf_token: string }>(csrfResponse);
  for (const channelId of createdChannelIds) {
    const response = await page.request.delete(`/api/v1/ai-channels/${channelId}`, {
      headers: { 'X-CSRF-Token': csrf },
    });
    expect([204, 404]).toContain(response.status());
  }
  createdChannelIds.clear();
});

async function body<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${response.status()} ${response.url()}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function login(page: Page): Promise<string> {
  await page.goto('/login');
  await page.getByLabel('账号').fill('admin');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/$/);
  return (await body<{ csrf_token: string }>(
    await page.request.get('/api/v1/auth/csrf'),
  )).csrf_token;
}

async function selectDetailTab(page: Page, name: string, key: string | null) {
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL((url) => url.searchParams.get('tab') === key);
}

async function selectVisibleOption(page: Page, name: string) {
  await page.locator('.ant-select-dropdown:visible').getByTitle(name, { exact: true }).click();
}

async function expectSelectedChannelParams(
  page: Page,
  channelId: string,
  expected: Record<string, string>,
) {
  await expect(page).toHaveURL((url) => (
    url.pathname === `/configuration/ai/channels/${channelId}`
    && Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === value)
  ));
}

async function createVisualChannel(
  page: Page,
  csrf: string,
  fixture: {
    name: string;
    description: string;
    providerBrand: 'ANTHROPIC' | 'GOOGLE' | 'AZURE_OPENAI' | 'ZHIPU' | 'QWEN';
    enabled: boolean;
  },
) {
  const channel = await body<{ id: string; revision: number }>(await page.request.post('/api/v1/ai-channels', {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      name: fixture.name,
      description: fixture.description,
      protocol_type: 'openai-compatible-chat-completions',
      provider_brand: fixture.providerBrand,
      base_url: 'http://127.0.0.1:9001/v1',
      api_key: `visual-key-${randomUUID()}`,
      timeout_seconds: 60,
    },
  }));
  createdChannelIds.add(channel.id);
  if (!fixture.enabled) return channel.id;

  let channelRevision = channel.revision;
  for (const header of [
    { name: 'X-E2E-Region', value: 'visual-test', is_sensitive: false },
    { name: 'X-E2E-Secret', value: `visual-secret-${randomUUID()}`, is_sensitive: true },
  ]) {
    const updatedChannel = await body<{ revision: number }>(await page.request.post(
      `/api/v1/ai-channels/${channel.id}/headers`,
      {
        headers: { 'X-CSRF-Token': csrf },
        data: { expected_channel_revision: channelRevision, ...header },
      },
    ));
    channelRevision = updatedChannel.revision;
  }

  const model = await body<{ id: string; revision: number }>(await page.request.post(
    `/api/v1/ai-channels/${channel.id}/models`,
    {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        display_name: 'e2e-model',
        model_id: 'e2e-model',
        request_parameters: {},
      },
    },
  ));
  const testedModel = await body<{ revision: number }>(await page.request.post(
    `/api/v1/ai-models/${model.id}/test`,
    { headers: { 'X-CSRF-Token': csrf } },
  ));
  await body(await page.request.post(`/api/v1/ai-models/${model.id}/enable`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { expected_revision: testedModel.revision },
  }));
  await body(await page.request.post(`/api/v1/ai-channels/${channel.id}/enable`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { expected_revision: channelRevision },
  }));
  return channel.id;
}

test('管理员通过三栏页面完成渠道、凭据、Header、模型、测试与删除闭环', async ({
  page,
  context,
}, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const visualQuery = `视觉${suffix}`;
  const channelName = 'OpenAI';
  const initialDescription = `用于真实 UI 验收 · ${visualQuery}`;
  const editedDescription = `OpenAI 官方 API 渠道 · ${visualQuery}`;
  const apiKey = `ui-api-key-${suffix}`;
  const replacementKey = `ui-replacement-key-${suffix}`;
  const sensitiveHeader = `ui-header-secret-${suffix}`;
  const csrf = await login(page);
  const fixtureChannelIds: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.setDefaultTimeout(10_000);
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? 'unknown';
    if (errorText !== 'net::ERR_ABORTED') {
      failedRequests.push(`${request.method()} ${request.url()} (${errorText})`);
    }
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1570, height: 1001 });

  const visualFixtures = [
    { name: '通义千问', description: `阿里云 · ${visualQuery}`, providerBrand: 'QWEN', enabled: false },
    { name: '智谱 AI', description: `智谱开放平台 · ${visualQuery}`, providerBrand: 'ZHIPU', enabled: false },
    { name: 'Azure OpenAI', description: `Azure 托管 · ${visualQuery}`, providerBrand: 'AZURE_OPENAI', enabled: true },
    { name: 'Google Gemini', description: `Gemini API · ${visualQuery}`, providerBrand: 'GOOGLE', enabled: true },
    { name: 'Anthropic', description: `Claude 系列 · ${visualQuery}`, providerBrand: 'ANTHROPIC', enabled: true },
  ] as const;
  for (const fixture of visualFixtures) {
    const fixtureChannelId = await createVisualChannel(page, csrf, fixture);
    fixtureChannelIds.push(fixtureChannelId);
  }

  await page.goto('/configuration/ai');
  await expect(page.getByRole('heading', { name: 'AI 渠道与模型' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '渠道状态分类' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'AI 渠道管理工作区' })).toBeVisible();
  // 等待初始集合与可能的首条详情导航稳定，避免打开 Modal 后被路由切换卸载。
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: '新增渠道' }).click();
  const createDialog = page.getByRole('dialog', { name: '新增渠道' });
  await createDialog.getByRole('textbox', { name: '渠道名称' }).fill(channelName);
  await createDialog.getByRole('textbox', { name: '描述' }).fill(initialDescription);
  await createDialog.getByRole('combobox', { name: '供应商品牌' }).click();
  await selectVisibleOption(page, 'OpenAI');
  await createDialog.getByRole('textbox', { name: 'API 根地址' }).fill('http://127.0.0.1:9001/v1');
  await createDialog.getByLabel('API Key').fill(apiKey);
  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/ai-channels')
      && response.request().method() === 'POST'
      && response.status() === 201,
  );
  await createDialog.getByRole('button', { name: '创建渠道' }).click();
  const channel = await body<{ id: string }>(await createResponse);
  createdChannelIds.add(channel.id);
  await expect(page).toHaveURL(new RegExp(`/configuration/ai/channels/${channel.id}$`));
  await expect(page.getByRole('complementary', { name: '渠道详情面板' })
    .getByText(initialDescription, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '编辑' }).click();
  const editDialog = page.getByRole('dialog', { name: '编辑渠道' });
  await editDialog.getByRole('textbox', { name: '描述' }).fill(editedDescription);
  await editDialog.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('complementary', { name: '渠道详情面板' })
    .getByText(editedDescription, { exact: true })).toBeVisible();
  await expect(editDialog).not.toBeVisible();

  await selectDetailTab(page, '请求配置', 'request');
  await page.getByRole('button', { name: '重新配置' }).click();
  const keyDialog = page.getByRole('dialog', { name: '重新配置 API Key' });
  await expect(keyDialog.getByText('原密钥不会回显。', { exact: false })).toBeVisible();
  await keyDialog.getByLabel('新的 API Key').fill(replacementKey);
  await keyDialog.getByRole('button', { name: '保存并重置连接状态' }).click();
  await expect(page.getByText('API Key 已重新配置，渠道与模型测试状态已重置')).toBeVisible();
  await expect(keyDialog).not.toBeVisible();

  await selectDetailTab(page, '请求配置', 'request');
  const detailPanel = page.getByRole('complementary', { name: '渠道详情面板' });
  await detailPanel.getByRole('button', { name: /新增/ }).click();
  let headerDialog = page.getByRole('dialog', { name: '新增 Header' });
  await headerDialog.getByRole('textbox', { name: 'Header 名' }).fill('X-E2E-Region');
  await headerDialog.getByLabel('值').fill('ui-test');
  await headerDialog.getByRole('button', { name: /保\s*存/ }).click();
  await expect(headerDialog).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'X-E2E-Region', exact: true })).toBeVisible();

  await detailPanel.getByRole('button', { name: /新增/ }).click();
  headerDialog = page.getByRole('dialog', { name: '新增 Header' });
  await headerDialog.getByRole('textbox', { name: 'Header 名' }).fill('X-E2E-Secret');
  await headerDialog.getByLabel('值').fill(sensitiveHeader);
  await headerDialog.getByRole('combobox', { name: '类型' }).click();
  await selectVisibleOption(page, '敏感且永不回显');
  await headerDialog.getByRole('button', { name: /保\s*存/ }).click();
  await expect(headerDialog).not.toBeVisible();
  const sensitiveRow = page.getByRole('row').filter({ hasText: 'X-E2E-Secret' });
  await expect(sensitiveRow.getByText('••••••', { exact: true })).toBeVisible();
  await expect(page.getByText(sensitiveHeader, { exact: true })).toHaveCount(0);

  await selectDetailTab(page, '模型管理', 'models');
  await page.getByRole('button', { name: '获取模型' }).click();
  const discoveryDialog = page.getByRole('dialog', { name: '获取模型' });
  const discoveredRow = discoveryDialog.getByRole('row').filter({ hasText: 'e2e-model' });
  await expect(discoveredRow).toBeVisible();
  await discoveredRow.getByRole('button', { name: '添加' }).click();
  await expect(discoveredRow.getByRole('button', { name: '已添加' })).toBeDisabled();
  await discoveryDialog.locator('.ant-modal-close').click();
  await expect(discoveryDialog).not.toBeVisible();

  await page.getByRole('button', { name: '测试连接' }).first().click();
  const testDialog = page.getByRole('dialog', { name: /测试连接.*OpenAI/ });
  await expect(testDialog.getByRole('button', { name: '开始测试' })).toBeDisabled();
  await testDialog.getByRole('combobox', { name: '选择测试模型' }).click();
  await selectVisibleOption(page, 'e2e-model · e2e-model');
  await testDialog.getByRole('button', { name: '开始测试' }).click();
  await expect(page.getByText('连接测试成功，模型当前保持停用')).toBeVisible();

  const modelRow = page.getByRole('row').filter({ hasText: 'e2e-model' });
  await modelRow.getByRole('button', { name: '更多模型操作：e2e-model' }).click();
  await page.getByRole('menuitem', { name: '启用' }).click();
  await expect(modelRow.getByRole('cell', { name: '已启用' })).toBeVisible();
  await selectDetailTab(page, '基本信息', null);
  await page.getByRole('button', { name: '启用渠道' }).click();
  await expect(page.locator('.ant-message').getByText('渠道已启用', { exact: true })).toBeVisible();

  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok()
      && url.pathname === '/api/v1/ai-channels'
      && url.searchParams.get('q') === visualQuery;
  });
  await page.getByRole('searchbox', { name: '搜索渠道名称、描述或地址' }).fill(visualQuery);
  await page.getByRole('searchbox', { name: '搜索渠道名称、描述或地址' }).press('Enter');
  await searchResponse;
  await expectSelectedChannelParams(page, channel.id, { q: visualQuery });
  const enabledChannelsLoaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok()
      && url.pathname === '/api/v1/ai-channels'
      && url.searchParams.get('q') === visualQuery
      && url.searchParams.get('status') === 'ENABLED';
  });
  await Promise.all([
    enabledChannelsLoaded,
    page.getByRole('button', { name: /^已启用\s+4$/ }).click(),
  ]);
  await expectSelectedChannelParams(page, channel.id, { q: visualQuery, status: 'enabled' });
  await page.getByRole('combobox', { name: '筛选供应商品牌' }).click();
  await selectVisibleOption(page, 'OpenAI');
  await expectSelectedChannelParams(page, channel.id, {
    q: visualQuery,
    status: 'enabled',
    provider_brand: 'OPENAI',
  });
  await expect(page.locator('.ai-channel-table tbody tr').filter({ has: page.locator('.ai-channel-name-cell') })).toHaveCount(1);
  await page.getByRole('combobox', { name: '渠道排序' }).click();
  await selectVisibleOption(page, '名称升序');
  await expectSelectedChannelParams(page, channel.id, {
    q: visualQuery,
    status: 'enabled',
    provider_brand: 'OPENAI',
    sort: 'NAME_ASC',
  });

  for (let index = 0; index < 5; index += 1) {
    const response = await page.request.post('/api/v1/ai-channels', {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        name: `分页渠道 ${suffix}-${index}`,
        description: '分页验收数据',
        protocol_type: 'openai-compatible-chat-completions',
        provider_brand: 'CUSTOM',
        base_url: 'http://127.0.0.1:9001/v1',
        api_key: `pagination-key-${suffix}-${index}`,
        timeout_seconds: 30,
      },
    });
    const fixtureChannelId = (await body<{ id: string }>(response)).id;
    fixtureChannelIds.push(fixtureChannelId);
    createdChannelIds.add(fixtureChannelId);
  }
  await page.goto('/configuration/ai?page_size=10');
  const secondPage = page.locator('.ai-list-pagination .ant-pagination-item-2');
  await expect(secondPage).toBeVisible();
  await secondPage.click();
  await expect(page).toHaveURL(/page=2/);
  await page.goto(`/configuration/ai/channels/${channel.id}`);

  await selectDetailTab(page, '使用统计', 'usage');
  await expect(page.getByText('业务作业')).toBeVisible();
  await expect(page.getByText('暂无数据').first()).toBeVisible();
  await selectDetailTab(page, '操作日志', 'logs');
  await expect(page.getByText('ai_channel.created', { exact: true })).toBeVisible();
  await expect(page.getByText('ai_model.tested', { exact: true })).toBeVisible();
  await selectDetailTab(page, '基本信息', null);

  await page.getByRole('button', { name: '复制配置' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('X-E2E-Secret');
  expect(copied).toContain('"is_configured": true');
  expect(copied).not.toContain(apiKey);
  expect(copied).not.toContain(replacementKey);
  expect(copied).not.toContain(sensitiveHeader);

  const browserStorage = await page.evaluate(() => JSON.stringify({
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage },
  }));
  for (const secret of [apiKey, replacementKey, sensitiveHeader]) {
    expect(browserStorage).not.toContain(secret);
    await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  }
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  await page.goto(`/configuration/ai/channels/${channel.id}?q=${encodeURIComponent(visualQuery)}`);
  const selectedChannelRow = page
    .getByRole('region', { name: 'AI 渠道列表' })
    .getByRole('row')
    .filter({ has: page.getByText(channelName, { exact: true }) });
  await expect(selectedChannelRow).toHaveClass(/ai-channel-row-selected/);
  await expect(page.locator('.ai-channel-table tbody tr').filter({ has: page.locator('.ai-channel-name-cell') })).toHaveCount(6);
  await expect(page.getByRole('button', { name: /^已启用\s+4$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^已停用\s+2$/ })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '渠道详情面板' })
    .getByText(editedDescription, { exact: true })).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
  await expect.poll(() => page.locator('.ai-config-page').evaluate((element) => element.getAnimations().length)).toBe(0);
  const desktopMetrics = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`缺少视觉量测节点：${selector}`);
      const box = element.getBoundingClientRect();
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };
    const tableHeader = document.querySelector('.ai-channel-table thead th');
    const tableRow = Array.from(document.querySelectorAll('.ai-channel-table tbody tr'))
      .find((element) => element.getBoundingClientRect().height > 0);
    if (!(tableHeader instanceof HTMLElement) || !(tableRow instanceof HTMLElement)) {
      throw new Error('缺少表格视觉量测节点');
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      sider: rect('.app-sider'),
      header: rect('.app-header'),
      page: rect('.ai-config-page'),
      statusRail: rect('.ai-status-rail'),
      detail: rect('.ai-detail-pane'),
      tableHeaderHeight: Math.round(tableHeader.getBoundingClientRect().height),
      tableRowHeight: Math.round(tableRow.getBoundingClientRect().height),
      tableHeaderFontSize: getComputedStyle(tableHeader).fontSize,
    };
  });
  expect(desktopMetrics.viewport).toEqual({ width: 1570, height: 1001 });
  expect(desktopMetrics.sider).toEqual({ x: 0, y: 0, width: 208, height: 1001 });
  expect(desktopMetrics.header).toEqual({ x: 208, y: 0, width: 1362, height: 64 });
  expect(desktopMetrics.page).toMatchObject({ x: 228, y: 84, width: 1322 });
  expect(desktopMetrics.statusRail.x).toBe(desktopMetrics.page.x + 1);
  expect(desktopMetrics.statusRail.y).toBe(desktopMetrics.detail.y);
  expect(desktopMetrics.statusRail.y).toBeGreaterThan(desktopMetrics.page.y);
  expect(desktopMetrics.statusRail.width).toBe(188);
  expect(desktopMetrics.detail.x + desktopMetrics.detail.width).toBe(desktopMetrics.page.x + desktopMetrics.page.width - 1);
  expect(desktopMetrics.detail.width).toBe(340);
  expect(desktopMetrics.statusRail.height).toBe(desktopMetrics.detail.height);
  expect(desktopMetrics.tableHeaderHeight).toBe(52);
  expect(desktopMetrics.tableRowHeight).toBe(92);
  expect(desktopMetrics.tableHeaderFontSize).toBe('11px');
  await page.screenshot({ path: testInfo.outputPath('ai-channels-1570x1001.png') });

  await page.setViewportSize({ width: 1440, height: 1000 });
  const tableGeometry = await selectedChannelRow.evaluate((row) => {
    const status = row.querySelector<HTMLElement>('.ai-test-status');
    const actions = row.querySelector<HTMLElement>('.ant-table-cell-fix-end .ant-space');
    const content = row.closest('.ant-table-content');
    if (!status || !actions || !(content instanceof HTMLElement)) {
      throw new Error('缺少 AI 表格列几何量测节点');
    }
    const statusRect = status.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      statusRight: statusRect.right,
      actionsLeft: actionsRect.left,
      clientWidth: content.clientWidth,
      scrollWidth: content.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(tableGeometry.statusRight).toBeLessThanOrEqual(tableGeometry.actionsLeft);
  expect(tableGeometry.scrollWidth).toBeLessThanOrEqual(tableGeometry.clientWidth);
  expect(tableGeometry.documentWidth).toBeLessThanOrEqual(1440);
  await page.screenshot({ path: testInfo.outputPath('ai-channels-light-1440x1000.png') });

  await page.setViewportSize({ width: 375, height: 844 });
  await expect(page.getByRole('button', { name: '切换导航' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI 渠道与模型' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const narrowTable = page.locator('.ai-channel-table .ant-table-content');
  const narrowScroll = await narrowTable.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(narrowScroll.scrollWidth).toBeGreaterThan(narrowScroll.clientWidth);
  await expect(page.getByRole('region', { name: 'AI 渠道列表' })
    .getByRole('button', { name: /更多操作：/ }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('ai-channels-mobile-375x844.png'), fullPage: true });
  await page.setViewportSize({ width: 1570, height: 1001 });
  await expect(page.locator('.app-sider')).toBeVisible();

  await page.getByRole('button', { name: '编辑' }).click();
  const failureEditDialog = page.getByRole('dialog', { name: '编辑渠道' });
  await failureEditDialog
    .getByRole('textbox', { name: 'API 根地址' })
    .fill('http://127.0.0.1:9001/missing');
  await failureEditDialog.getByRole('button', { name: '保存修改' }).click();
  await expect(failureEditDialog).not.toBeVisible();
  await page.getByRole('button', { name: '测试连接' }).first().click();
  const failureDialog = page.getByRole('dialog', { name: /测试连接.*OpenAI/ });
  await failureDialog.getByRole('combobox', { name: '选择测试模型' }).click();
  await selectVisibleOption(page, 'e2e-model · e2e-model');
  await failureDialog.getByRole('button', { name: '开始测试' }).click();
  await expect(page.getByText(/AI 渠道返回 HTTP 404/)).toBeVisible();
  await selectDetailTab(page, '模型管理', 'models');
  await expect(page.getByRole('region', { name: '模型列表' }).getByText('失败', { exact: true })).toBeVisible();
  await selectDetailTab(page, '基本信息', null);

  await page.getByRole('button', { name: '删除渠道' }).click();
  const deleteConfirmation = page.getByText('删除此 AI 渠道？').locator('..');
  await expect(deleteConfirmation.getByText(/历史快照保留/)).toBeVisible();
  await page.getByRole('button', { name: '删除渠道' }).last().click();
  await expect(page).not.toHaveURL(new RegExp(`/configuration/ai/channels/${channel.id}`));
  await expect(page.getByText(channelName, { exact: true })).toHaveCount(0);
  createdChannelIds.delete(channel.id);

  for (const fixtureChannelId of fixtureChannelIds) {
    const response = await page.request.delete(`/api/v1/ai-channels/${fixtureChannelId}`, {
      headers: { 'X-CSRF-Token': csrf },
    });
    expect(response.status()).toBe(204);
    createdChannelIds.delete(fixtureChannelId);
  }
  expect(consoleErrors).not.toEqual([]);
  expect(consoleErrors.filter((entry) => !entry.includes('404 (Not Found)'))).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('普通工程师无法通过直接路由或 API 访问 AI 渠道配置', async ({ page, browser }) => {
  const suffix = randomUUID().slice(0, 8);
  const username = `ai-engineer-${suffix}`;
  const initialPassword = `initial-${suffix}-password`;
  const temporaryPassword = `temporary-${suffix}-password`;
  const updatedPassword = `updated-${suffix}-password`;
  const csrf = await login(page);
  const created = await body<{ id: string }>(await page.request.post('/api/v1/users', {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      username,
      display_name: `AI 权限工程师 ${suffix}`,
      temporary_password: initialPassword,
      account_type: 'ENGINEER',
    },
  }));
  expect((await page.request.post(`/api/v1/users/${created.id}/reset-password`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { temporary_password: temporaryPassword },
  })).status()).toBe(204);

  const engineerContext = await browser.newContext({
    baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
  });
  const engineerPage = await engineerContext.newPage();
  try {
    await engineerPage.goto('/login');
    await engineerPage.getByLabel('账号').fill(username);
    await engineerPage.getByLabel('密码').fill(temporaryPassword);
    await engineerPage.getByRole('button', { name: /登\s*录/ }).click();
    await expect(engineerPage).toHaveURL(/\/change-password$/);
    await engineerPage.getByLabel('当前密码').fill(temporaryPassword);
    await engineerPage.getByLabel('新密码').fill(updatedPassword);
    const changePasswordResponse = engineerPage.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/v1/auth/change-password'
      && response.request().method() === 'POST'
    ));
    await engineerPage.getByRole('button', { name: '更新密码' }).click();
    expect((await changePasswordResponse).status()).toBe(204);
    await expect(engineerPage).toHaveURL(/\/$/, { timeout: 10_000 });
    await expect(engineerPage.getByRole('menuitem', { name: '配置中心' })).toHaveCount(0);

    await engineerPage.goto('/configuration/ai');
    await expect(engineerPage).toHaveURL(/\/$/);
    expect((await engineerPage.request.get('/api/v1/ai-channels?page=1&page_size=20')).status()).toBe(403);
    const engineerCsrf = await body<{ csrf_token: string }>(
      await engineerPage.request.get('/api/v1/auth/csrf'),
    );
    const forbiddenSecret = `forbidden-key-${suffix}`;
    const forbiddenCreate = await engineerPage.request.post('/api/v1/ai-channels', {
      headers: { 'X-CSRF-Token': engineerCsrf.csrf_token },
      data: {
        name: `越权渠道 ${suffix}`,
        description: '不得创建',
        protocol_type: 'openai-compatible-chat-completions',
        provider_brand: 'CUSTOM',
        base_url: 'https://provider.example.invalid/v1',
        api_key: forbiddenSecret,
        timeout_seconds: 30,
      },
    });
    expect(forbiddenCreate.status()).toBe(403);
    expect(await forbiddenCreate.text()).not.toContain(forbiddenSecret);
    expect((await engineerPage.request.post(`/api/v1/ai-models/${randomUUID()}/test`, {
      headers: { 'X-CSRF-Token': engineerCsrf.csrf_token },
    })).status()).toBe(403);
  } finally {
    await engineerContext.close();
    const users = await body<{ items: Array<{ id: string; display_name: string; account_type: 'ADMIN' | 'ENGINEER'; is_active: boolean; revision: number }> }>(
      await page.request.get('/api/v1/users'),
    );
    const engineer = users.items.find((item) => item.id === created.id);
    if (engineer?.is_active) {
      await page.request.patch(`/api/v1/users/${engineer.id}`, {
        headers: { 'X-CSRF-Token': csrf },
        data: {
          expected_revision: engineer.revision,
          display_name: engineer.display_name,
          account_type: engineer.account_type,
          is_active: false,
        },
      });
    }
  }
});
