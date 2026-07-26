/** 以虚构数据验证事实、生成、审核、发布、文件和 GEO 观测纵向闭环。 */
import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';

test.setTimeout(180_000);

async function body<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${response.status()} ${response.url()}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function login(page: Page, username: string, loginPassword = password): Promise<string> {
  await page.goto('/login');
  await page.getByLabel('账号').fill(username);
  await page.getByLabel('密码').fill(loginPassword);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/$/);
  const token = await body<{ csrf_token: string }>(await page.request.get('/api/v1/auth/csrf'));
  return token.csrf_token;
}

async function openPasswordPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打开用户操作菜单' }).click();
  await page.getByRole('menuitem', { name: /修改密码/ }).dispatchEvent('click');
}

async function selectOption(page: Page, label: string, optionName: string): Promise<void> {
  await page.getByLabel(label).fill(optionName);
  await page.locator('.ant-select-dropdown:visible').getByTitle(optionName, { exact: true }).click();
}

async function clickVisibleOption(page: Page, optionName: string): Promise<void> {
  await page.locator('.ant-select-dropdown:visible').getByTitle(optionName, { exact: true }).click({ force: true });
}

test('账号类型、最后管理员、临时密码和停用会话由服务端强制执行', async ({ page, browser }) => {
  const suffix = randomUUID().slice(0, 8);
  const csrf = await login(page, 'admin');
  await expect(page.getByRole('button', { name: '打开用户操作菜单' })).toBeVisible();
  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible();
  const users = await body<{ items: Array<{ id: string; username: string; display_name: string; account_type: 'ADMIN' | 'ENGINEER'; is_active: boolean; revision: number }> }>(await page.request.get('/api/v1/users?q=admin&page=1&page_size=100'));
  // 只清理本测试历史运行生成的管理员，避免影响测试环境中的其他 admin-* 账号。
  for (const staleAdmin of users.items.filter((item) => (
    /^admin-[0-9a-f]{8}$/.test(item.username)
    && item.display_name === `管理员 ${item.username.slice(6)}`
    && item.is_active
  ))) {
    expect((await page.request.patch(`/api/v1/users/${staleAdmin.id}`, {
      headers: { 'X-CSRF-Token': csrf },
      data: { expected_revision: staleAdmin.revision, display_name: staleAdmin.display_name, account_type: 'ADMIN', is_active: false },
    })).ok()).toBeTruthy();
  }
  const admin = users.items.find((item) => item.username === 'admin');
  expect(admin).toBeTruthy();
  expect((await page.request.post('/api/v1/auth/change-password', {
    headers: { 'X-CSRF-Token': csrf },
    data: { old_password: 'wrong-password', new_password: 'unused-new-password' },
  })).status()).toBe(401);

  const lastAdmin = await page.request.patch(`/api/v1/users/${admin!.id}`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { expected_revision: admin!.revision, display_name: admin!.display_name, account_type: 'ENGINEER', is_active: true },
  });
  expect(lastAdmin.status()).toBe(409);

  const username = `engineer-${suffix}`;
  const created = await body<{ id: string }>(await page.request.post('/api/v1/users', {
    headers: { 'X-CSRF-Token': csrf },
    data: { username, display_name: `工程师 ${suffix}`, temporary_password: 'initial-password-only', account_type: 'ENGINEER' },
  }));
  const temporaryPassword = 'temporary-password-only';
  const reset = await page.request.post(`/api/v1/users/${created.id}/reset-password`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { temporary_password: temporaryPassword },
  });
  expect(reset.status()).toBe(204);

  const engineerContext = await browser.newContext({
    baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
  });
  const engineerPage = await engineerContext.newPage();
  await engineerPage.goto('/login');
  await engineerPage.getByLabel('账号').fill(username);
  await engineerPage.getByLabel('密码').fill(temporaryPassword);
  await engineerPage.getByRole('button', { name: /登\s*录/ }).click();
  await expect(engineerPage).toHaveURL(/\/change-password$/);
  const forcedGate = await engineerPage.request.get('/api/v1/platform-types');
  expect(forcedGate.status()).toBe(403);
  await engineerPage.getByLabel('当前密码').fill(temporaryPassword);
  await engineerPage.getByLabel('新密码').fill('engineer-new-password');
  await engineerPage.getByRole('button', { name: '更新密码' }).click();
  await expect(engineerPage).toHaveURL(/\/$/);
  await expect(engineerPage.getByRole('menuitem', { name: '配置中心' })).toHaveCount(0);
  await expect(engineerPage.getByRole('menuitem', { name: /审计日志/ })).toHaveCount(0);
  await engineerPage.goto('/audit');
  expect((await engineerPage.request.get('/api/v1/audit-logs')).status()).toBe(403);
  await expect(engineerPage.getByRole('button', { name: '打开用户操作菜单' })).toBeVisible();
  expect((await engineerPage.request.get('/api/v1/users')).status()).toBe(403);
  const engineerCsrf = await body<{ csrf_token: string }>(await engineerPage.request.get('/api/v1/auth/csrf'));
  const nonexistentId = randomUUID();
  for (const path of [
    `/api/v1/products/${nonexistentId}`,
    `/api/v1/platform-types/${nonexistentId}`,
    `/api/v1/platform-profiles/${nonexistentId}`,
    `/api/v1/platform-profiles/${nonexistentId}/prompt?expected_revision=0`,
    `/api/v1/platform-accounts/${nonexistentId}`,
    `/api/v1/fact-versions/${nonexistentId}`,
  ]) {
    expect((await engineerPage.request.delete(path, { headers: { 'X-CSRF-Token': engineerCsrf.csrf_token } })).status()).toBe(403);
  }
  expect((await engineerPage.request.post('/api/v1/platform-types', {
    headers: { 'X-CSRF-Token': engineerCsrf.csrf_token },
    data: { name: '越权类型', slug: `forbidden-${suffix}` },
  })).status()).toBe(403);
  await engineerPage.getByRole('menuitem', { name: '产品事实' }).click();
  await expect(engineerPage.getByRole('button', { name: '删除' })).toHaveCount(0);
  await openPasswordPage(engineerPage);
  await expect(engineerPage).toHaveURL(/\/change-password$/);

  const adminUsername = `admin-${suffix}`;
  const adminInitialPassword = 'temporary-admin-initial';
  const adminReadyPassword = 'temporary-admin-ready';
  const adminNewPassword = 'temporary-admin-updated';
  const createdAdmin = await body<{ id: string }>(await page.request.post('/api/v1/users', {
    headers: { 'X-CSRF-Token': csrf },
    data: { username: adminUsername, display_name: `管理员 ${suffix}`, temporary_password: adminInitialPassword, account_type: 'ADMIN' },
  }));
  const adminContext = await browser.newContext({
    baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
  });
  const otherAdminContext = await browser.newContext({
    baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
  });
  const adminPage = await adminContext.newPage();
  const otherAdminPage = await otherAdminContext.newPage();
  await adminPage.goto('/login');
  await adminPage.getByLabel('账号').fill(adminUsername);
  await adminPage.getByLabel('密码').fill(adminInitialPassword);
  await adminPage.getByRole('button', { name: /登\s*录/ }).click();
  await expect(adminPage).toHaveURL(/\/change-password$/);
  await adminPage.getByLabel('当前密码').fill(adminInitialPassword);
  await adminPage.getByLabel('新密码').fill(adminReadyPassword);
  await adminPage.getByRole('button', { name: '更新密码' }).click();
  await expect(adminPage).toHaveURL(/\/$/);
  const adminCsrf = await body<{ csrf_token: string }>(await adminPage.request.get('/api/v1/auth/csrf'));
  await login(otherAdminPage, adminUsername, adminReadyPassword);
  expect((await adminPage.request.post(`/api/v1/users/${createdAdmin.id}/reset-password`, {
    headers: { 'X-CSRF-Token': adminCsrf.csrf_token },
    data: { temporary_password: 'self-reset-must-fail' },
  })).status()).toBe(422);
  await openPasswordPage(adminPage);
  await adminPage.getByLabel('当前密码').fill(adminReadyPassword);
  await adminPage.getByLabel('新密码').fill(adminNewPassword);
  await adminPage.getByRole('button', { name: '更新密码' }).click();
  await expect(adminPage).toHaveURL(/\/$/);
  expect((await adminPage.request.get('/api/v1/auth/me')).status()).toBe(200);
  expect((await otherAdminPage.request.get('/api/v1/auth/me')).status()).toBe(401);

  const refreshedUsers = await body<{ items: Array<{ id: string; username: string; display_name: string; account_type: 'ADMIN' | 'ENGINEER'; is_active: boolean; revision: number }> }>(await page.request.get(`/api/v1/users?q=${suffix}&page=1&page_size=100`));
  const engineer = refreshedUsers.items.find((item) => item.id === created.id);
  const temporaryAdmin = refreshedUsers.items.find((item) => item.id === createdAdmin.id);
  expect(engineer).toBeTruthy();
  expect(temporaryAdmin).toBeTruthy();
  const disabled = await page.request.patch(`/api/v1/users/${engineer!.id}`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { expected_revision: engineer!.revision, display_name: engineer!.display_name, account_type: 'ENGINEER', is_active: false },
  });
  expect(disabled.ok()).toBeTruthy();
  const disabledAdmin = await page.request.patch(`/api/v1/users/${temporaryAdmin!.id}`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { expected_revision: temporaryAdmin!.revision, display_name: temporaryAdmin!.display_name, account_type: 'ADMIN', is_active: false },
  });
  expect(disabledAdmin.ok()).toBeTruthy();
  expect((await engineerPage.request.get('/api/v1/auth/me')).status()).toBe(401);
  const auditText = await (await page.request.get('/api/v1/audit-logs?page=1&page_size=100')).text();
  for (const secret of ['initial-password-only', temporaryPassword, 'engineer-new-password', adminInitialPassword, adminReadyPassword, adminNewPassword, 'self-reset-must-fail']) {
    expect(auditText).not.toContain(secret);
  }
  await adminContext.close();
  await otherAdminContext.close();
  await engineerContext.close();
});

async function command(page: Page, path: string, csrf: string, data: unknown) {
  return body<Record<string, unknown>>(await page.request.post(path, {
    headers: { 'X-CSRF-Token': csrf },
    data,
  }));
}

async function uploadOperationScreenshot(page: Page, csrf: string, filename: string, text: string) {
  const bytes = Buffer.from(text);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const upload = await command(page, '/api/v1/files/upload-intents', csrf, { category: 'OPERATION_SCREENSHOT', original_filename: filename, content_type: 'image/png', size: bytes.length, sha256: digest, access_level: 'INTERNAL' });
  const instruction = upload.upload as { url: string; headers: Record<string, string> };
  const response = await page.request.put(instruction.url, { headers: instruction.headers, data: bytes });
  expect(response.status()).toBe(204);
  return command(page, `/api/v1/files/${(upload.file as { id: string }).id}/complete`, csrf, undefined);
}

async function expectTextInPaginatedTable(page: Page, text: string) {
  const target = page.getByText(text, { exact: true });
  await expect(page.locator('.ant-table-wrapper').last()).toBeVisible();
  await expect(page.locator('.ant-table-wrapper .ant-spin-spinning')).toHaveCount(0);
  for (let pageNumber = 1; pageNumber <= 10; pageNumber += 1) {
    if (await target.isVisible()) return;
    const next = page.getByRole('button', { name: 'right' });
    if (!(await next.isEnabled())) break;
    await next.click();
  }
  await expect(target).toBeVisible();
}

test('批准事实到人工发布和 GEO 观测保持完整追溯', async ({ page }, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const timeoutProviderModelId = `e2e-timeout-model-${suffix}`;
  const csrf = await login(page, 'admin');
  const initialHumanizationPrompt = await page.request.get('/api/v1/content-humanization-prompt');
  expect([200, 204]).toContain(initialHumanizationPrompt.status());
  const humanizationPromptWasConfigured = initialHumanizationPrompt.status() === 200;
  const nonexistentId = randomUUID();
  for (const path of [
    `/api/v1/products/${nonexistentId}`,
    `/api/v1/platform-types/${nonexistentId}`,
    `/api/v1/platform-profiles/${nonexistentId}`,
    `/api/v1/platform-profiles/${nonexistentId}/prompt?expected_revision=0`,
    `/api/v1/platform-accounts/${nonexistentId}`,
    `/api/v1/fact-versions/${nonexistentId}`,
  ]) {
    const response = await page.request.delete(path, { headers: { 'X-CSRF-Token': csrf } });
    expect(response.status()).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
  }

  await page.getByRole('menuitem', { name: '产品事实' }).click();
  await page.getByRole('button', { name: '新增产品' }).click();
  await page.getByLabel('产品型号').fill(`DEMO-${suffix}`);
  await page.getByLabel('品牌').fill('DEMO');
  await page.getByLabel('类别').fill('TEST');
  await page.getByRole('button', { name: '创建事实工作区' }).click();
  await expect(page.getByRole('dialog', { name: '新增产品' })).toBeHidden();
  await page.getByRole('searchbox', { name: '搜索产品' }).fill(`DEMO-${suffix}`);
  const filteredProductsLoaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok()
      && url.pathname === '/api/v1/products'
      && url.searchParams.get('search') === `DEMO-${suffix}`;
  });
  await Promise.all([
    filteredProductsLoaded,
    page.getByRole('searchbox', { name: '搜索产品' }).press('Enter'),
  ]);
  await expect(page).toHaveURL(new RegExp(`q=DEMO-${suffix}`));
  await expectTextInPaginatedTable(page, `DEMO-${suffix}`);

  const products = await body<{ items: Array<{ id: string; part_number: string }> }>(
    await page.request.get(`/api/v1/products?page=1&page_size=100&search=DEMO-${suffix}`),
  );
  const product = products.items.find((item) => item.part_number === `DEMO-${suffix}`);
  expect(product).toBeTruthy();

  const invalidDraft = await page.request.put(`/api/v1/products/${product!.id}/facts`, {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      expected_revision: 0,
      body_markdown: '   ',
      classification: 'PUBLIC',
    },
  });
  expect(invalidDraft.status()).toBe(422);
  const factsBodyMarkdown = `# ${product!.part_number} 产品事实\n\n- 工作电压：5 V\n- 替代条件：仅用于本地虚构验收\n- 排除条件：不得用于真实选型`;
  const facts = {
    expected_revision: 0,
    body_markdown: factsBodyMarkdown,
    classification: 'PUBLIC',
  };
  await body(await page.request.put(`/api/v1/products/${product!.id}/facts`, { headers: { 'X-CSRF-Token': csrf }, data: facts }));
  const factVersion = await command(page, `/api/v1/products/${product!.id}/fact-versions`, csrf, { change_summary: 'E2E 虚构事实快照' });
  await command(page, `/api/v1/fact-versions/${factVersion.id as string}/submit`, csrf, { expected_revision: 0, comment: '提交审核' });

  await page.goto(`/products/${product!.id}`);
  await expect(page.getByRole('textbox', { name: '事实 Markdown' })).toHaveValue(factsBodyMarkdown);
  await page.getByRole('tab', { name: /事实版本/ }).click();
  await expect(page.getByRole('button', { name: '更多操作：事实版本 V1' })).toBeVisible();
  await page.getByRole('button', { name: '审核与历史' }).click();
  await page.getByRole('button', { name: /批\s*准/, exact: true }).click();
  await expect(page.getByText('请显式确认：批准依据是下方不可变 Markdown 与分级，而不是当前工作区。')).toBeVisible();
  await page.getByLabel('审核意见').fill('批准虚构事实');
  await page.getByRole('button', { name: '确认批准' }).click();
  await expect(page.getByText('已批准', { exact: true }).first()).toBeVisible();

  const disposableFact = await command(page, `/api/v1/products/${product!.id}/fact-versions`, csrf, { change_summary: 'E2E 待物理删除事实快照' });
  expect((await page.request.delete(`/api/v1/fact-versions/${disposableFact.id as string}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.get(`/api/v1/fact-versions/${disposableFact.id as string}`)).status()).toBe(404);

  const platformType = await command(page, '/api/v1/platform-types', csrf, { name: `E2E 论坛类型 ${suffix}`, slug: `e2e-type-${suffix}` });
  const profile = await command(page, '/api/v1/platform-profiles', csrf, { name: `E2E 论坛 ${suffix}`, slug: `e2e-forum-${suffix}`, allowed_domains: ['forum.example.invalid'], platform_type_id: platformType.id });
  const taskPayload = { product_id: product!.id, fact_version_id: factVersion.id, platform_profile_id: profile.id };
  const platformPromptMarkdown = '使用技术说明语气，只依据输入事实；受众、角度、长度、安全和 JSON 输出均按本 Prompt 执行。';
  const platformPrompt = await body<{ revision: number }>(await page.request.put(`/api/v1/platform-profiles/${profile.id as string}/prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { template_markdown: platformPromptMarkdown, expected_revision: null } }));
  expect((await page.request.put(`/api/v1/platform-profiles/${profile.id as string}/prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { template_markdown: '禁止创建第二份 Prompt', expected_revision: null } })).status()).toBe(409);
  const typeConflict = await page.request.delete(`/api/v1/platform-types/${platformType.id as string}`, { headers: { 'X-CSRF-Token': csrf } });
  expect(typeConflict.status()).toBe(409);
  expect((await typeConflict.json()).error.details.references).toEqual([{ type: 'PLATFORM_PROFILE', count: 1 }]);
  const channel = await command(page, '/api/v1/ai-channels', csrf, { name: `E2E 渠道 ${suffix}`, description: 'E2E 测试渠道', protocol_type: 'openai-compatible-chat-completions', provider_brand: 'CUSTOM', base_url: 'http://127.0.0.1:9001/v1', api_key: 'e2e-only-key', timeout_seconds: 30 });
  const secondChannel = await command(page, '/api/v1/ai-channels', csrf, { name: `E2E 备用渠道 ${suffix}`, description: 'E2E 备用测试渠道', protocol_type: 'openai-compatible-chat-completions', provider_brand: 'CUSTOM', base_url: 'http://127.0.0.1:9001/v1', api_key: 'e2e-second-key', timeout_seconds: 10 });
  const model = await command(page, `/api/v1/ai-channels/${channel.id as string}/models`, csrf, { display_name: 'E2E 模型', model_id: 'e2e-model', request_parameters: { temperature: 0 } });
  await command(page, `/api/v1/ai-channels/${channel.id as string}/models`, csrf, { display_name: 'E2E 手工模型', model_id: 'e2e-manual-model', request_parameters: { temperature: 0.2 } });
  const plainHeaderChannel = await command(page, `/api/v1/ai-channels/${channel.id as string}/headers`, csrf, { expected_channel_revision: channel.revision, name: 'X-E2E-Region', value: 'test', is_sensitive: false });
  const sensitiveHeaderChannel = await command(page, `/api/v1/ai-channels/${channel.id as string}/headers`, csrf, { expected_channel_revision: plainHeaderChannel.revision, name: 'X-E2E-Secret', value: 'header-secret', is_sensitive: true });
  const projectedHeaders = sensitiveHeaderChannel.headers as Array<{ id: string; name: string; value: string | null; is_sensitive: boolean }>;
  expect(projectedHeaders.find((item) => item.name === 'X-E2E-Secret')?.value).toBeNull();
  expect(projectedHeaders.find((item) => item.name === 'X-E2E-Region')?.value).toBe('test');
  expect((await page.request.post(`/api/v1/ai-channels/${channel.id as string}/headers`, { headers: { 'X-CSRF-Token': csrf }, data: { expected_channel_revision: sensitiveHeaderChannel.revision, name: 'x-e2e-region', value: 'duplicate', is_sensitive: false } })).status()).toBe(409);
  const discovered = await body<{ items: Array<{ model_id: string }> }>(await page.request.post(`/api/v1/ai-channels/${channel.id as string}/discover-models`, { headers: { 'X-CSRF-Token': csrf } }));
  expect(discovered.items).toContainEqual({ model_id: 'e2e-model' });
  const testedModel = await command(page, `/api/v1/ai-models/${model.id as string}/test`, csrf, undefined);
  const connectionRequest = await body<{ messages: Array<{ role: string; content: string }> }>(await page.request.get('http://127.0.0.1:9001/e2e/payloads/e2e-model'));
  expect(connectionRequest.messages).toEqual([{ role: 'user', content: 'hi' }]);
  await command(page, `/api/v1/ai-models/${model.id as string}/enable`, csrf, { expected_revision: testedModel.revision });
  const enabledChannel = await command(page, `/api/v1/ai-channels/${channel.id as string}/enable`, csrf, { expected_revision: sensitiveHeaderChannel.revision });
  const plainHeader = projectedHeaders.find((item) => item.name === 'X-E2E-Region');
  expect(plainHeader).toBeTruthy();
  const updatedHeaderChannel = await body<{ revision: number }>(await page.request.patch(`/api/v1/ai-channel-headers/${plainHeader!.id}`, { headers: { 'X-CSRF-Token': csrf }, data: { expected_channel_revision: enabledChannel.revision, name: 'X-E2E-Region', value: 'test-updated', is_sensitive: false } }));
  const invalidatedModels = await body<{ items: Array<{ id: string; revision: number; test_status: string; is_enabled: boolean }> }>(await page.request.get(`/api/v1/ai-channels/${channel.id as string}/models`));
  expect(invalidatedModels.items[0]).toMatchObject({ test_status: 'UNTESTED', is_enabled: false });
  const retestedModel = await command(page, `/api/v1/ai-models/${model.id as string}/test`, csrf, undefined);
  await command(page, `/api/v1/ai-models/${model.id as string}/enable`, csrf, { expected_revision: retestedModel.revision });
  await command(page, `/api/v1/ai-channels/${channel.id as string}/enable`, csrf, { expected_revision: updatedHeaderChannel.revision });
  const secondPlainHeader = await command(page, `/api/v1/ai-channels/${secondChannel.id as string}/headers`, csrf, { expected_channel_revision: secondChannel.revision, name: 'X-E2E-Region', value: 'timeout-test', is_sensitive: false });
  const secondSensitiveHeader = await command(page, `/api/v1/ai-channels/${secondChannel.id as string}/headers`, csrf, { expected_channel_revision: secondPlainHeader.revision, name: 'X-E2E-Secret', value: 'timeout-secret', is_sensitive: true });
  const timeoutModel = await command(page, `/api/v1/ai-channels/${secondChannel.id as string}/models`, csrf, { display_name: 'E2E 超时模型', model_id: timeoutProviderModelId, request_parameters: {} });
  const testedTimeoutModel = await command(page, `/api/v1/ai-models/${timeoutModel.id as string}/test`, csrf, undefined);
  await command(page, `/api/v1/ai-models/${timeoutModel.id as string}/enable`, csrf, { expected_revision: testedTimeoutModel.revision });
  const enabledSecondChannel = await command(page, `/api/v1/ai-channels/${secondChannel.id as string}/enable`, csrf, { expected_revision: secondSensitiveHeader.revision });
  await page.goto('/configuration');
  await expect(page).toHaveURL(/\/configuration\/ai(?:\/channels\/[^/]+)?$/);
  const channelRow = page.getByRole('region', { name: 'AI 渠道列表' }).getByRole('row').filter({ hasText: `E2E 渠道 ${suffix}` });
  const headerBox = await page.getByRole('row', { name: /渠道名称 状态 API 根地址/ }).boundingBox();
  const rowBox = await channelRow.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(rowBox!.y + 1);
  await expect(page.getByRole('columnheader', { name: 'API Key' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Header' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '模型' })).toBeVisible();
  await expect(channelRow.getByRole('cell', { name: '2', exact: true })).toHaveCount(1);
  const channelMore = channelRow.getByRole('button', { name: `更多操作：E2E 渠道 ${suffix}` });
  await expect(channelMore).toBeVisible();
  await channelMore.focus();
  await expect(channelMore).toBeFocused();
  await channelMore.press('Enter');
  await expect(page.getByRole('menuitem', { name: '停用' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(channelMore).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await channelRow.getByRole('button', { name: `配置：E2E 渠道 ${suffix}` }).click();
  await expect(page).toHaveURL(new RegExp(`/configuration/ai/channels/${channel.id as string}$`));
  await expect(page.getByRole('complementary', { name: '渠道详情面板' }).getByText('E2E 测试渠道', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '请求配置' }).click();
  await expect(page.getByRole('region', { name: '请求 Header 列表' })).toBeVisible();
  await expect(page.getByText('••••••', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: '模型管理' }).click();
  await expect(page.getByText('E2E 模型', { exact: true })).toBeVisible();
  await page.goto('/configuration/platforms');
  await expectTextInPaginatedTable(page, `E2E 论坛 ${suffix}`);

  const task = await command(page, '/api/v1/content-tasks', csrf, taskPayload);
  const taskOption = `DEMO ${product!.part_number}`;
  const modelOption = `E2E 渠道 ${suffix} / E2E 模型 (e2e-model)`;
  await page.goto(`/tasks/${task.id as string}`);
  if (!humanizationPromptWasConfigured) {
    await expect(page.getByText('全局自然化 Prompt 未配置；原始生成不受影响。')).toBeVisible();
  }
  await selectOption(page, '生成模型', modelOption);
  await page.getByRole('button', { name: /生成 AI 草稿/ }).click();
  let generatedJobId: string | undefined;
  await expect.poll(async () => {
    const aiJobs = await body<{ items: Array<{ id: string; job_type: string; status: string }> }>(await page.request.get(`/api/v1/content-tasks/${task.id as string}/generation-jobs`));
    const originalJob = aiJobs.items.find((item) => item.job_type === 'GENERATE');
    generatedJobId = originalJob?.id;
    return originalJob?.status;
  }, { timeout: 30_000 }).toBe('SUCCEEDED');
  expect(generatedJobId).toBeTruthy();
  const job = { id: generatedJobId! };
  const completedJob = await body<{ content_version_id: string; provider_request_id: string | null; response_duration_ms: number | null; prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null; input_snapshot: { contract_version: string; system_message: string; user_message: string } }>(await page.request.get(`/api/v1/generation-jobs/${job.id}`));
  const generatedContentId = completedJob.content_version_id;
  const generatedContentBeforeHumanization = await body<{ id: string; title: string; summary: string; body_markdown: string; tags: string[]; content_hash: string; source_type: string; status: string }>(await page.request.get(`/api/v1/content-versions/${generatedContentId}`));
  expect(generatedContentBeforeHumanization).toMatchObject({ source_type: 'AI', status: 'DRAFT' });
  const inUseFactDelete = await page.request.delete(`/api/v1/fact-versions/${factVersion.id as string}`, { headers: { 'X-CSRF-Token': csrf } });
  expect(inUseFactDelete.status()).toBe(409);
  expect(await inUseFactDelete.json()).toMatchObject({
    error: {
      code: 'FACT_VERSION_IN_USE',
      details: {
        references: expect.arrayContaining([
          expect.objectContaining({ type: 'CONTENT_TASK' }),
          expect.objectContaining({ type: 'CONTENT_VERSION' }),
        ]),
      },
    },
  });
  expect(completedJob).toMatchObject({ provider_request_id: 'e2e-provider-request', prompt_tokens: 1, completion_tokens: 1, total_tokens: null });
  expect(completedJob.response_duration_ms).not.toBeNull();
  expect(completedJob.input_snapshot).toMatchObject({
    contract_version: 'content-markdown-v2',
    system_message: platformPromptMarkdown,
    user_message: factsBodyMarkdown,
  });
  const providerRequest = await body<Record<string, unknown>>(await page.request.get('http://127.0.0.1:9001/e2e/payloads/e2e-model'));
  expect(providerRequest).toMatchObject({
    model: 'e2e-model',
    temperature: 0,
    stream: false,
    messages: [
      { role: 'system', content: platformPromptMarkdown },
      { role: 'user', content: factsBodyMarkdown },
    ],
  });
  const providerPayload = JSON.stringify(providerRequest);
  expect(providerPayload).toContain(product!.part_number);
  for (const forbidden of ['datasheet.pdf', 'e2e-only-key', 'header-secret', 'evidence_keys', 'source_url', 'file_id', 'query_topic', '目标问题']) {
    expect(providerPayload).not.toContain(forbidden);
  }
  const sourceVersionRow = page.getByRole('region', { name: '内容版本列表' }).getByRole('row').filter({ has: page.getByRole('link', { name: 'V1', exact: true }) });
  if (!humanizationPromptWasConfigured) {
    await expect(sourceVersionRow.getByRole('button', { name: '自然化' })).toBeDisabled();
    const missingPromptHumanization = await page.request.post(`/api/v1/content-versions/${generatedContentId}/humanization-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-humanization-no-prompt-${suffix}` }, data: { ai_model_id: model.id } });
    expect(missingPromptHumanization.status()).toBe(409);
    expect(await missingPromptHumanization.json()).toMatchObject({ error: { code: 'HUMANIZATION_PROMPT_MISSING' } });
  }
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto(`/configuration/prompts?tab=platform&platform_profile_id=${profile.id as string}&page=1&page_size=10`);
  await expect(page.getByRole('heading', { name: 'Prompt 管理' })).toBeVisible();
  await expect(page.getByText(`当前平台：E2E 论坛 ${suffix}`, { exact: true })).toBeVisible();
  await selectOption(page, '预览内容任务', taskOption);
  await selectOption(page, '预览模型', modelOption);
  await page.getByRole('button', { name: '生成平台预览' }).click();
  await expect(page.getByRole('heading', { name: '连接测试' })).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole('tab', { name: '全局自然化 Prompt' }).click();
  const e2eHumanizationPrompt = `保留批准事实与必要披露，减少机械衔接，使用自然、克制的中文表达。${suffix}`;
  await page.getByLabel('自然化 Prompt Markdown').fill(e2eHumanizationPrompt);
  const humanizationSaveResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/content-humanization-prompt') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: humanizationPromptWasConfigured ? '保存 Prompt' : '首次保存' }).click();
  expect((await humanizationSaveResponse).ok()).toBeTruthy();
  await expect(page.getByText('Prompt 已保存')).toBeVisible();
  await selectOption(page, '预览内容任务', taskOption);
  await selectOption(page, '自然化源草稿', `V1 · ${generatedContentBeforeHumanization.title}`);
  await selectOption(page, '预览模型', modelOption);
  await page.getByRole('button', { name: '生成自然化预览' }).click();
  await expect(page.getByRole('heading', { name: '连接测试' })).toBeVisible({ timeout: 30_000 });

  await page.goto(`/tasks/${task.id as string}`);
  const refreshedSourceRow = page.getByRole('region', { name: '内容版本列表' }).getByRole('row').filter({ has: page.getByRole('link', { name: 'V1', exact: true }) });
  await expect(refreshedSourceRow.getByRole('button', { name: '自然化' })).toBeEnabled();
  const modelCallsBeforeHumanization = await body<{ count: number }>(await page.request.get('http://127.0.0.1:9001/e2e/calls/e2e-model'));
  await refreshedSourceRow.getByRole('button', { name: '自然化' }).click();
  const humanizationDialog = page.getByRole('dialog', { name: '自然化 V1' });
  await expect(humanizationDialog).toBeVisible();
  await selectOption(page, '自然化模型', modelOption);
  const humanizationCreated = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1/content-versions/${generatedContentId}/humanization-jobs`
  ));
  await humanizationDialog.getByRole('button', { name: '创建自然化作业' }).click();
  const { id: humanizationJobId } = await body<{ id: string }>(await humanizationCreated);
  let humanizedContentId: string | null | undefined;
  await expect.poll(async () => {
    const humanizationJob = await body<{ status: string; content_version_id: string | null }>(
      await page.request.get(`/api/v1/generation-jobs/${humanizationJobId}`),
    );
    humanizedContentId = humanizationJob.content_version_id;
    return humanizationJob.status;
  }, { timeout: 30_000 }).toBe('SUCCEEDED');
  expect(humanizedContentId).toBeTruthy();
  expect(await body<{ count: number }>(await page.request.get('http://127.0.0.1:9001/e2e/calls/e2e-model'))).toEqual({ count: modelCallsBeforeHumanization.count + 1 });
  const humanizationDetail = await body<{ job_type: string; source_content_version_id: string; input_snapshot: { humanization_prompt: { template_markdown: string }; model: { id: string }; source_content: { id: string; content_hash: string } } }>(await page.request.get(`/api/v1/generation-jobs/${humanizationJobId}`));
  expect(humanizationDetail).toMatchObject({ job_type: 'HUMANIZE', source_content_version_id: generatedContentId, input_snapshot: { humanization_prompt: { template_markdown: e2eHumanizationPrompt }, model: { id: model.id }, source_content: { id: generatedContentId, content_hash: generatedContentBeforeHumanization.content_hash } } });
  const generatedContentAfterHumanization = await body<typeof generatedContentBeforeHumanization>(await page.request.get(`/api/v1/content-versions/${generatedContentId}`));
  expect(generatedContentAfterHumanization).toEqual(generatedContentBeforeHumanization);
  expect(await body<{ source_type: string; status: string; source_job_id: string; based_on_id: string }>(await page.request.get(`/api/v1/content-versions/${humanizedContentId!}`))).toMatchObject({ source_type: 'AI', status: 'DRAFT', source_job_id: humanizationJobId, based_on_id: generatedContentId });
  await page.goto(`/content/${humanizedContentId!}`);
  await page.getByRole('tab', { name: '版本差异' }).click();
  await expect(page.locator('#review-diff')).toBeVisible();
  await page.getByRole('tab', { name: '产品事实' }).click();
  await expect(page.locator('#review-trace').getByText('自然化 1', { exact: true })).toBeVisible();
  const updatedPlatformPrompt = await body<{ revision: number }>(await page.request.put(`/api/v1/platform-profiles/${profile.id as string}/prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { template_markdown: '使用更新后的技术说明语气，只依据输入事实。', expected_revision: platformPrompt.revision } }));
  const secondJob = await body<{ id: string }>(await page.request.post(`/api/v1/content-tasks/${task.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-second-${suffix}` }, data: { ai_model_id: model.id } }));
  await expect.poll(async () => (await body<{ status: string }>(await page.request.get(`/api/v1/generation-jobs/${secondJob.id}`))).status, { timeout: 30_000 }).toBe('SUCCEEDED');
  const secondJobDetail = await body<{ input_snapshot: { system_message: string; user_message: string } }>(await page.request.get(`/api/v1/generation-jobs/${secondJob.id}`));
  expect(completedJob.input_snapshot.system_message).toBe(platformPromptMarkdown);
  expect(completedJob.input_snapshot.user_message).toBe(factsBodyMarkdown);
  expect(secondJobDetail.input_snapshot.system_message).toContain('更新后的技术说明语气');
  expect(secondJobDetail.input_snapshot.user_message).toBe(factsBodyMarkdown);
  const manualTask = await command(page, '/api/v1/content-tasks', csrf, taskPayload);
  const manualFirstDraft = await body<{ source_type: string; status: string; source_job_id: string | null; based_on_id: string | null }>(
    await page.request.post(`/api/v1/content-tasks/${manualTask.id as string}/manual-versions`, {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        title: `外部模型人工录入 ${product!.part_number}`,
        summary: '从网页版模型复制并人工确认。',
        body_markdown: factsBodyMarkdown,
        tags: ['manual'],
        change_summary: '人工录入首稿',
      },
    }),
  );
  expect(manualFirstDraft).toMatchObject({
    source_type: 'HUMAN',
    status: 'DRAFT',
    source_job_id: null,
    based_on_id: null,
  });
  const timeoutJob = await body<{ id: string }>(await page.request.post(`/api/v1/content-tasks/${task.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-timeout-${suffix}` }, data: { ai_model_id: timeoutModel.id } }));
  await expect.poll(async () => (await body<{ status: string }>(await page.request.get(`/api/v1/generation-jobs/${timeoutJob.id}`))).status, { timeout: 30_000 }).toBe('FAILED');
  const failedTimeoutJob = await body<{ attempt_count: number; error_code: string; input_snapshot: unknown }>(await page.request.get(`/api/v1/generation-jobs/${timeoutJob.id}`));
  expect(failedTimeoutJob).toMatchObject({ attempt_count: 1, error_code: 'AI_PROVIDER_TIMEOUT' });
  expect(await body<{ count: number }>(await page.request.get(`http://127.0.0.1:9001/e2e/calls/${timeoutProviderModelId}`))).toEqual({ count: 2 });
  const replacedSecondKey = await body<{ revision: number }>(await page.request.put(`/api/v1/ai-channels/${secondChannel.id as string}/api-key`, { headers: { 'X-CSRF-Token': csrf }, data: { expected_revision: enabledSecondChannel.revision, api_key: 'e2e-second-key-updated' } }));
  const secondHeaders = secondSensitiveHeader.headers as Array<{ id: string; name: string }>;
  const secondSensitiveHeaderId = secondHeaders.find((item) => item.name === 'X-E2E-Secret')?.id;
  expect(secondSensitiveHeaderId).toBeTruthy();
  const updatedSecondHeader = await body<{ revision: number }>(await page.request.patch(`/api/v1/ai-channel-headers/${secondSensitiveHeaderId!}`, { headers: { 'X-CSRF-Token': csrf }, data: { expected_channel_revision: replacedSecondKey.revision, name: 'X-E2E-Secret', value: 'timeout-secret-updated', is_sensitive: true } }));
  const retestedTimeoutModel = await command(page, `/api/v1/ai-models/${timeoutModel.id as string}/test`, csrf, undefined);
  await command(page, `/api/v1/ai-models/${timeoutModel.id as string}/enable`, csrf, { expected_revision: retestedTimeoutModel.revision });
  await command(page, `/api/v1/ai-channels/${secondChannel.id as string}/enable`, csrf, { expected_revision: updatedSecondHeader.revision });
  const retriedTimeoutJob = await body<{ id: string }>(await page.request.post(`/api/v1/generation-jobs/${timeoutJob.id}/retry`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-timeout-retry-${suffix}` } }));
  await expect.poll(async () => (await body<{ status: string }>(await page.request.get(`/api/v1/generation-jobs/${retriedTimeoutJob.id}`))).status, { timeout: 30_000 }).toBe('SUCCEEDED');
  const retriedTimeoutDetail = await body<{ retry_of_id: string; input_snapshot: unknown }>(await page.request.get(`/api/v1/generation-jobs/${retriedTimeoutJob.id}`));
  expect(retriedTimeoutDetail.retry_of_id).toBe(timeoutJob.id);
  expect(retriedTimeoutDetail.input_snapshot).toEqual(failedTimeoutJob.input_snapshot);
  expect(await body<{ count: number }>(await page.request.get(`http://127.0.0.1:9001/e2e/calls/${timeoutProviderModelId}`))).toEqual({ count: 4 });
  expect((await page.request.delete(`/api/v1/platform-profiles/${profile.id as string}/prompt?expected_revision=${updatedPlatformPrompt.revision}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.post(`/api/v1/content-tasks/${task.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-no-prompt-${suffix}` }, data: { ai_model_id: model.id } })).status()).toBe(409);
  await body(await page.request.put(`/api/v1/platform-profiles/${profile.id as string}/prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { template_markdown: '恢复后的技术说明 Prompt。', expected_revision: null } }));
  const manualRevision = await body<{ id: string }>(await page.request.post(`/api/v1/content-versions/${generatedContentId}/revisions`, { headers: { 'X-CSRF-Token': csrf }, data: { title: `人工核对 ${product!.part_number}`, summary: '工程师已核对生成草稿。', body_markdown: '不得将虚构验收数据用于真实选型。', tags: ['reviewed'], change_summary: '人工核对并创建新版本' } }));
  const submittedId = manualRevision.id;
  await page.goto(`/tasks/${task.id as string}`);
  const taskNavigation = page.getByRole('navigation', { name: '内容任务章节' });
  await expect(taskNavigation.getByRole('link', { name: '任务上下文' })).toHaveAttribute('aria-current', 'location');
  await expect(taskNavigation.getByRole('link', { name: '任务上下文' })).toHaveAttribute('href', '#task-context');
  await expect(taskNavigation.getByRole('link', { name: '首稿入口' })).toHaveAttribute('href', '#task-entry');
  await expect(taskNavigation.getByRole('link', { name: '内容版本' })).toHaveAttribute('href', '#task-versions');
  await expect(page.locator('#task-context')).toBeVisible();
  await expect(page.locator('#task-entry')).toBeVisible();
  await expect(page.locator('#task-versions')).toBeVisible();
  await expect(page.getByText('成功').first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '耗时 / Token' })).toBeVisible();
  await expect(page.getByText(/ms \/ —/).first()).toBeVisible();
  await expect(page.getByText(`E2E 论坛 ${suffix}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'V1' })).toBeVisible();
  await page.goto(`/content/${submittedId}`);
  await page.getByRole('tab', { name: '预览', exact: true }).click();
  await expect(page.getByRole('tab', { name: '预览', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Markdown 源文' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '版本差异' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '编辑', exact: true })).toBeVisible();
  await expect(page.locator('#review-content')).toBeVisible();
  await page.getByRole('tab', { name: '审核记录' }).click();
  await expect(page.locator('#review-history')).toBeVisible();
  await expect(page.getByRole('button', { name: '提交审核' })).toHaveCount(1);
  await page.getByRole('button', { name: '提交审核' }).click();
  await page.getByLabel('审核意见').fill('提交内容审核');
  await page.getByRole('button', { name: /确\s*认/ }).click();
  await expect(page.getByText('待审核', { exact: true })).toBeVisible();

  await page.goto(`/content/${submittedId}`);
  await page.getByRole('button', { name: /批\s*准/ }).click();
  await page.getByLabel('审核意见').fill('批准虚构内容');
  await page.getByRole('button', { name: /确\s*认/ }).click();
  await expect(page.getByText('已批准', { exact: true })).toBeVisible();

  const account = await command(page, '/api/v1/platform-accounts', csrf, { platform_profile_id: profile.id, label: `E2E 账号 ${suffix}`, account_identifier: `e2e-${suffix}` });
  const file = await uploadOperationScreenshot(page, csrf, 'e2e-prepared.png', `PartSignal E2E prepared screenshot ${suffix}`);
  const resultFile = await uploadOperationScreenshot(page, csrf, 'e2e-result.png', `PartSignal E2E result screenshot ${suffix}`);

  const candidatesPattern = '**/api/v1/publication-candidates';
  await page.route(candidatesPattern, async (route) => {
    const response = await route.fetch();
    const candidates = await response.json() as {
      items: Array<{ content_version: { id: string }; matching_accounts: unknown[] }>;
    };
    const target = candidates.items.find((item) => item.content_version.id === submittedId);
    if (target) target.matching_accounts = [];
    await route.fulfill({ response, json: candidates });
  });
  await page.goto('/publications');
  const candidateWithoutAccount = page.getByRole('row').filter({ hasText: `人工核对 ${product!.part_number}` });
  await expect(candidateWithoutAccount.getByText('无匹配账号')).toBeVisible();
  await expect(candidateWithoutAccount.getByRole('link', { name: '前往业务设置' })).toHaveAttribute(
    'href',
    `/settings?tab=accounts&platform_profile_id=${profile.id as string}`,
  );
  await expect(candidateWithoutAccount.getByRole('button', { name: '准备人工发布' })).toBeDisabled();
  await page.unroute(candidatesPattern);

  const packagePattern = `**/api/v1/content-versions/${submittedId}/publication-package`;
  await page.route(packagePattern, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      json: {
        error: {
          code: 'PUBLICATION_PACKAGE_FAILED',
          message: '发布包加载失败',
          request_id: `e2e-package-${suffix}`,
        },
      },
    });
  });
  await page.reload();
  const candidateWithPackageFailure = page.getByRole('row').filter({ hasText: `人工核对 ${product!.part_number}` });
  await candidateWithPackageFailure.getByRole('button', { name: '准备人工发布' }).click();
  const failedPackageDrawer = page.getByRole('dialog', { name: '准备人工发布' });
  await expect(failedPackageDrawer.getByText('发布包加载失败')).toBeVisible();
  await expect(failedPackageDrawer.getByRole('button', { name: '登记待人工发布' })).toBeDisabled();
  await expect(failedPackageDrawer.locator('input[type="file"]')).toBeDisabled();
  await failedPackageDrawer.getByRole('button', { name: '关闭' }).click();
  await page.unroute(packagePattern);

  const publication = await body<{ id: string }>(await page.request.post('/api/v1/publication-records/manual', { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-publication-${suffix}` }, data: { content_version_id: submittedId, platform_account_id: account.id, section_url: 'https://forum.example.invalid/board', attachment_file_ids: [file.id] } }));
  await command(page, `/api/v1/publication-records/${publication.id}/mark-platform-review`, csrf, { comment: '平台审核中' });
  await command(page, `/api/v1/publication-records/${publication.id}/mark-published`, csrf, { actual_title: `E2E ${suffix}`, final_url: `https://forum.example.invalid/posts/${suffix}`, published_at: new Date().toISOString(), content_matches: null, comment: '人工发布完成', attachment_file_ids: [resultFile.id] });
  await command(page, `/api/v1/publication-records/${publication.id}/verify`, csrf, { actual_title: null, final_url: null, published_at: null, content_matches: true, comment: '人工核对一致' });
  const completedTask = await body<{ status: string }>(await page.request.get(`/api/v1/content-tasks/${task.id as string}`));
  expect(completedTask.status).toBe('COMPLETED');
  await page.goto('/publications');
  for (const viewport of [{ width: 1536, height: 1024 }, { width: 1024, height: 768 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('heading', { name: '发布管理' })).toBeVisible();
    await expect.poll(
      () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      { message: `${viewport.width}×${viewport.height} 不应产生页面级横向滚动` },
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 1536, height: 1024 });
  for (const mode of ['light', 'dark', 'system'] as const) {
    await page.evaluate((value) => localStorage.setItem('partsignal.theme-mode', value), mode);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', mode);
    await expect(page.getByRole('heading', { name: '发布管理' })).toBeVisible();
  }
  await expect(page.getByRole('radio', { name: '近 7 天' })).toBeChecked();
  await page.getByText('近 30 天').click();
  await expect(page).toHaveURL(/window_days=30/);
  await page.getByRole('tab', { name: /发布记录/ }).click();
  await expect(page).toHaveURL(/tab=records/);
  const publicationRow = page.getByRole('row').filter({
    has: page.locator(`a[href="https://forum.example.invalid/posts/${suffix}"]`),
  });
  await expect(publicationRow).toBeVisible();
  await expect(publicationRow.getByText(`E2E ${suffix}`, { exact: true })).toBeVisible();
  await publicationRow.getByRole('button', { name: '标记已移除' }).click();
  const publicationDrawer = page.getByRole('dialog', { name: '发布结果登记' });
  await expect(publicationDrawer).toBeVisible();
  await expect(publicationDrawer.getByText(new RegExp(`人工核对 ${product!.part_number} · V\\d+`))).toBeVisible();
  await expect(publicationDrawer.getByText(`E2E 论坛 ${suffix}`, { exact: true })).toBeVisible();
  await expect(publicationDrawer.getByText(`E2E 账号 ${suffix} / e2e-${suffix}`, { exact: true })).toBeVisible();
  await expect(publicationDrawer.getByText(/内容哈希/)).toBeVisible();
  await expect(publicationDrawer.getByText('e2e-prepared.png')).toBeVisible();
  await expect(publicationDrawer.getByText('e2e-result.png')).toBeVisible();
  await publicationDrawer.getByRole('button', { name: '关闭' }).click();

  await page.goto(`/publications/${publication.id}`);
  await expect(page.getByRole('button', { name: '在工作台处理' })).toBeVisible();
  await expect(page.getByRole('button', { name: '标记已移除' })).toHaveCount(0);
  await page.getByRole('button', { name: '在工作台处理' }).click();
  await expect(page).toHaveURL(new RegExp(`/publications\\?record=${publication.id}`));
  await expect(page.getByRole('dialog', { name: '发布结果登记' })).toBeVisible();
  await page.getByRole('dialog', { name: '发布结果登记' }).getByRole('button', { name: '关闭' }).click();

  const geoTopic = await body<{ canonical_question: string }>(await page.request.post('/api/v1/query-topics', {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      canonical_question: `${product!.part_number} 如何应用？`,
      intent_type: 'APPLICATION',
      variants: [`${product!.part_number} 应用场景`],
    },
  }));
  const geoConsoleErrors: string[] = [];
  const geoPageErrors: string[] = [];
  const geoFailedRequests: string[] = [];
  const geoFailedResponses: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') geoConsoleErrors.push(message.text()); });
  page.on('pageerror', (error) => geoPageErrors.push(error.message));
  page.on('requestfailed', (request) => geoFailedRequests.push(`${request.method()} ${request.url()}`));
  page.on('response', (response) => { if (response.status() >= 400) geoFailedResponses.push(`${response.status()} ${response.url()}`); });

  await page.setViewportSize({ width: 1582, height: 995 });
  await page.goto('/observations');
  await expect(page.getByRole('heading', { name: 'GEO 观测' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '观测记录' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '分析洞察' })).toBeVisible();
  await expect(page.getByRole('link', { name: '分析洞察' }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: /导出/ })).toHaveCount(0);

  await page.getByRole('button', { name: /新建观测/ }).click();
  const geoForm = page.getByRole('dialog', { name: '登记人工观测' });
  const geoProductLoaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok() && url.pathname === '/api/v1/products' && url.searchParams.get('search') === product!.part_number;
  });
  await geoForm.getByRole('combobox', { name: '产品' }).fill(product!.part_number);
  await geoProductLoaded;
  await page.getByText(`DEMO ${product!.part_number}`, { exact: true }).last().click();
  await geoForm.getByRole('combobox', { name: /问题主题/ }).fill(geoTopic.canonical_question);
  await page.locator('.ant-select-dropdown:visible').getByTitle(geoTopic.canonical_question, { exact: true }).click();
  await geoForm.getByLabel('人工搜索平台').fill('DeepSeek E2E');
  const geoSearchQuery = `${product!.part_number} 如何替代？`;
  await geoForm.getByLabel('实际搜索词').fill(geoSearchQuery);
  await expect(geoForm.getByText(`E2E ${suffix}`, { exact: true })).toBeVisible();
  const discoveredSelect = geoForm.getByRole('combobox', { name: `是否发现：E2E ${suffix}` });
  await discoveredSelect.click();
  await clickVisibleOption(page, '已发现');
  const mentioned = geoForm.getByRole('combobox', { name: `是否提及：E2E ${suffix}` });
  await mentioned.click();
  await clickVisibleOption(page, '已提及');
  const articleResult = geoForm.getByRole('combobox', { name: `文章推荐结果：E2E ${suffix}` });
  await articleResult.click();
  await clickVisibleOption(page, '已推荐');
  const cited = geoForm.getByRole('combobox', { name: `是否引用：E2E ${suffix}` });
  await cited.click();
  await clickVisibleOption(page, '有引用');
  const accuracy = geoForm.getByRole('combobox', { name: `准确性：E2E ${suffix}` });
  await accuracy.click();
  await clickVisibleOption(page, '准确');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await geoForm.getByLabel('选择文件').setInputFiles({ name: `geo-${suffix}.png`, mimeType: 'image/png', buffer: png });
  await expect(geoForm.getByText(`geo-${suffix}.png`)).toBeVisible();
  await geoForm.getByLabel('人工备注').fill('仅用于自动化验收');
  const createdGeoRecord = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/geo-observations')
      && response.request().method() === 'POST'
      && response.status() === 201,
  );
  const refreshedGeoRecords = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/geo-observations'
      && response.request().method() === 'GET'
      && response.ok(),
  );
  await geoForm.getByRole('button', { name: /追加观测记录/ }).click();
  await Promise.all([createdGeoRecord, refreshedGeoRecords]);
  await expect(page.getByRole('button', { name: geoSearchQuery })).toBeVisible();
  const createdGeoDetail = page.getByRole('dialog', { name: '观测详情' });
  await createdGeoDetail.locator('.ant-drawer-close').click();
  await expect(createdGeoDetail).not.toBeVisible();

  const metrics = await body<{ manual_observation_count: number; article_recommendation_rate: number | null }>(await page.request.get(`/api/v1/geo-metrics?product_id=${product!.id}`));
  expect(metrics.manual_observation_count).toBe(1);
  expect(metrics.article_recommendation_rate).toBe(1);

  const filteredRecords = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok() && url.pathname === '/api/v1/geo-observations' && url.searchParams.get('search') === product!.part_number;
  });
  await page.getByLabel('搜索词 / 问题').fill(product!.part_number);
  await filteredRecords;
  await expect(page).toHaveURL(new RegExp(`search=${product!.part_number}`));

  const sortedRecords = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok() && url.pathname === '/api/v1/geo-observations' && url.searchParams.get('sort_order') === 'ASC';
  });
  await page.getByRole('button', { name: /观测时间/ }).click();
  await sortedRecords;
  await expect(page).toHaveURL(/sort_order=ASC/);

  const pageSizeSelect = page.locator('.geo-record-card .ant-pagination-options .ant-select').getByRole('combobox');
  await pageSizeSelect.click();
  const pageSizeOption = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '100 条/页' });
  await expect(pageSizeOption).toBeVisible();
  const resizedRecords = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok() && url.pathname === '/api/v1/geo-observations' && url.searchParams.get('page_size') === '100';
  });
  await pageSizeOption.click();
  await resizedRecords;
  await expect(page).toHaveURL(/page_size=100/);
  await page.screenshot({ path: testInfo.outputPath('geo-observations-list-1582x995.png') });

  await page.getByRole('row').filter({ hasText: geoSearchQuery }).getByRole('cell').first().click();
  const geoDetail = page.getByRole('dialog', { name: '观测详情' });
  await expect(geoDetail.getByText('发现：已发现')).toBeVisible();
  await expect(geoDetail.getByText('提及：已提及')).toBeVisible();
  await expect(geoDetail.getByText('引用：有引用')).toBeVisible();
  await expect(geoDetail.getByText('历史回答摘要')).toHaveCount(0);
  await expect(geoDetail.getByRole('img', { name: `geo-${suffix}.png` })).toBeVisible();
  await expect.poll(async () => (await geoDetail.boundingBox())?.x ?? 1582).toBeLessThanOrEqual(1210);
  await expect(page.locator('.ant-drawer-mask')).toHaveCount(0);
  await geoDetail.evaluate(async (element) => {
    await Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  await page.screenshot({ path: testInfo.outputPath('geo-observations-detail-1582x995.png') });

  await geoDetail.getByRole('button', { name: '更正' }).click();
  const correctionForm = page.getByRole('dialog', { name: '更正人工观测' });
  await expect(correctionForm.getByLabel('实际搜索词')).toBeDisabled();
  await expect(correctionForm.getByRole('combobox', { name: '问题主题' })).toBeDisabled();
  const correctedDiscovered = correctionForm.getByRole('combobox', { name: `是否发现：E2E ${suffix}` });
  await correctedDiscovered.click();
  await clickVisibleOption(page, '已发现');
  const correctedMentioned = correctionForm.getByRole('combobox', { name: `是否提及：E2E ${suffix}` });
  await correctedMentioned.click();
  await clickVisibleOption(page, '已提及');
  const correctedArticleResult = correctionForm.getByRole('combobox', { name: `文章推荐结果：E2E ${suffix}` });
  await correctedArticleResult.click();
  await clickVisibleOption(page, '未推荐');
  const correctedCited = correctionForm.getByRole('combobox', { name: `是否引用：E2E ${suffix}` });
  await correctedCited.click();
  await clickVisibleOption(page, '无引用');
  const correctedAccuracy = correctionForm.getByRole('combobox', { name: `准确性：E2E ${suffix}` });
  await correctedAccuracy.click();
  await clickVisibleOption(page, '部分准确');
  await correctionForm.getByLabel('选择文件').setInputFiles({ name: `geo-correction-${suffix}.png`, mimeType: 'image/png', buffer: png });
  await expect(correctionForm.getByText(`geo-correction-${suffix}.png`)).toBeVisible();
  await correctionForm.getByLabel('人工备注').fill('E2E 追加更正');
  await correctionForm.getByRole('button', { name: /追加更正记录/ }).click();
  await expect(page.getByRole('dialog', { name: '观测详情' }).getByText('E2E 追加更正')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '观测详情' }).getByText('未推荐')).toBeVisible();
  await page.getByRole('dialog', { name: '观测详情' }).locator('.ant-drawer-close').click();
  await expect(page.getByRole('dialog', { name: '观测详情' })).not.toBeVisible();
  await page.getByRole('switch', { name: '包含历史更正记录' }).click();
  await expect(page.getByRole('button', { name: geoSearchQuery })).toHaveCount(2);

  const insightsLoaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok() && url.pathname === '/api/v1/geo-insights';
  });
  await page.getByRole('link', { name: '分析洞察' }).last().click();
  await insightsLoaded;
  await expect(page.getByText('平台表现对比', { exact: true })).toBeVisible();
  await expect(page.getByText('GEO 转化链路', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收起筛选' }).click();
  await expect(page.getByText('筛选区已折叠')).toBeVisible();
  await page.getByRole('button', { name: '展开筛选' }).click();
  const mentionTrend = page.locator('.geo-insight-trend-card').filter({ hasText: '提及率' }).first();
  await mentionTrend.locator('circle:not(.is-empty)').last().hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  const reportPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: '导出洞察报告' }).click();
  const report = await reportPromise;
  await report.waitForLoadState('networkidle');
  await expect(report.getByRole('button', { name: '打印 / 另存为 PDF' })).toBeVisible();
  await expect(report.getByText('平台表现对比', { exact: true })).toBeVisible();
  await report.close();
  await page.screenshot({ path: testInfo.outputPath('geo-insights-1582x995.png') });

  expect(geoConsoleErrors).toEqual([]);
  expect(geoPageErrors).toEqual([]);
  expect(geoFailedRequests).toEqual([]);
  expect(geoFailedResponses).toEqual([]);

  await page.goto(`/publications?tab=records&record=${publication.id}`);
  const removalDrawer = page.getByRole('dialog', { name: '发布结果登记' });
  await removalDrawer.getByRole('button', { name: '标记已移除' }).click();
  await removalDrawer.getByRole('textbox', { name: '操作说明' }).fill('E2E 页面已下线');
  await removalDrawer.getByRole('button', { name: '确认提交' }).click();
  await expect(removalDrawer.getByText('已下线').first()).toBeVisible();
  expect((await body<{ status: string }>(await page.request.get(`/api/v1/content-tasks/${task.id as string}`))).status).toBe('COMPLETED');
  const attentionList = await body<{ items: Array<{ id: string; publication_record_id: string; status: string; repair_task_id: string | null }> }>(await page.request.get('/api/v1/publication-attentions?status=OPEN'));
  const attention = attentionList.items.find((item) => item.publication_record_id === publication.id);
  expect(attention).toBeTruthy();
  await page.goto(`/publication-attentions/${attention!.id}`);
  await page.getByRole('button', { name: /创\s*建\s*修\s*复\s*任\s*务/ }).click();
  await page.getByRole('combobox', { name: '当前已批准事实版本' }).click();
  await page.getByText(/^V1 ·/).last().click();
  await page.getByRole('button', { name: /创\s*建\s*修\s*复\s*任\s*务/ }).click();
  await expect(page.getByRole('heading', { name: `DEMO ${product!.part_number}` })).toBeVisible();
  const attentionWithRepair = await body<{ status: string; repair_task_id: string | null }>(await page.request.get(`/api/v1/publication-attentions/${attention!.id}`));
  expect(attentionWithRepair.status).toBe('OPEN');
  expect(attentionWithRepair.repair_task_id).not.toBeNull();
  await page.goto(`/publication-attentions/${attention!.id}`);
  await page.getByRole('button', { name: /显\s*式\s*解\s*决/ }).click();
  await page.getByLabel('处置说明').fill('E2E 已创建并确认修复任务');
  await page.getByRole('button', { name: /确\s*认\s*解\s*决/ }).click();
  await expect(page.getByText('已解决').first()).toBeVisible();
  expect((await page.request.delete(`/api/v1/ai-channels/${channel.id as string}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.delete(`/api/v1/ai-channels/${secondChannel.id as string}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.post(`/api/v1/generation-jobs/${timeoutJob.id}/retry`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-timeout-deleted-${suffix}` } })).status()).toBe(409);
  const historicalJob = await body<{ input_snapshot: { model: { model_id: string }; system_message: string } }>(await page.request.get(`/api/v1/generation-jobs/${job.id}`));
  expect(historicalJob.input_snapshot.model.model_id).toBe('e2e-model');
  expect(historicalJob.input_snapshot.system_message).toBe(platformPromptMarkdown);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '总览' })).toBeVisible();
});
