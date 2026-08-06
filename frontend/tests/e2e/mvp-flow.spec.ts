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
  await page.setViewportSize({ width: 375, height: 812 });
  const auditDetailTrigger = page.getByRole('button', { name: /查看日志详情：/ }).first();
  await expect(auditDetailTrigger).toBeVisible();
  await auditDetailTrigger.focus();
  await auditDetailTrigger.click();
  await expect(page.getByRole('heading', { name: '日志详情' })).toBeVisible();
  await page.getByRole('button', { name: '关闭日志详情' }).click();
  await expect(auditDetailTrigger).toBeFocused();
  await page.setViewportSize({ width: 1536, height: 1024 });
  type TestUser = { id: string; username: string; display_name: string; account_type: 'ADMIN' | 'ENGINEER'; is_active: boolean; revision: number };
  for (const rule of [
    { prefix: 'admin-', pattern: /^admin-([0-9a-f]{8})$/, displayPrefix: '管理员 ', accountType: 'ADMIN' },
    { prefix: 'engineer-', pattern: /^engineer-([0-9a-f]{8})$/, displayPrefix: '工程师 ', accountType: 'ENGINEER' },
  ] as const) {
    const staleUsers = await body<{ items: TestUser[] }>(await page.request.get(`/api/v1/users?q=${rule.prefix}&page=1&page_size=100`));
    for (const staleUser of staleUsers.items.filter((item) => {
      const match = rule.pattern.exec(item.username);
      return match !== null
        && item.display_name === `${rule.displayPrefix}${match[1]}`
        && item.account_type === rule.accountType;
    })) {
      if (staleUser.is_active) {
        expect((await page.request.patch(`/api/v1/users/${staleUser.id}`, {
          headers: { 'X-CSRF-Token': csrf },
          data: {
            expected_revision: staleUser.revision,
            display_name: staleUser.display_name,
            account_type: staleUser.account_type,
            is_active: false,
          },
        })).ok()).toBeTruthy();
      }
      expect((await page.request.delete(`/api/v1/users/${staleUser.id}`, {
        headers: { 'X-CSRF-Token': csrf },
      })).status()).toBe(204);
    }
  }
  const users = await body<{ items: TestUser[] }>(await page.request.get('/api/v1/users?q=admin&page=1&page_size=100'));
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
  expect((await page.request.post(`/api/v1/users/${created.id}/reset-password`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { temporary_password: '1234567' },
  })).status()).toBe(422);
  const temporaryPassword = 'Temp1234';
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
    `/api/v1/platform-prompts/${nonexistentId}?expected_revision=0`,
    `/api/v1/platform-accounts/${nonexistentId}`,
    `/api/v1/fact-versions/${nonexistentId}`,
    `/api/v1/users/${nonexistentId}`,
  ]) {
    expect((await engineerPage.request.delete(path, { headers: { 'X-CSRF-Token': engineerCsrf.csrf_token } })).status()).toBe(403);
  }
  expect((await engineerPage.request.get(
    `/api/v1/published-articles/${nonexistentId}/permanent-deletion-preview`,
  )).status()).toBe(403);
  expect((await engineerPage.request.post(
    `/api/v1/published-articles/${nonexistentId}/permanent-delete`,
    {
      headers: { 'X-CSRF-Token': engineerCsrf.csrf_token },
      data: { expected_revision: 0, confirmation_text: '永久删除' },
    },
  )).status()).toBe(403);
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
  expect((await page.request.delete(`/api/v1/users/${engineer!.id}`, {
    headers: { 'X-CSRF-Token': csrf },
  })).status()).toBe(204);
  expect((await page.request.delete(`/api/v1/users/${temporaryAdmin!.id}`, {
    headers: { 'X-CSRF-Token': csrf },
  })).status()).toBe(204);
  const residualUsers = await body<{ items: TestUser[] }>(await page.request.get(`/api/v1/users?q=${suffix}&page=1&page_size=100`));
  expect(residualUsers.items.filter((item) => item.username === username || item.username === adminUsername)).toEqual([]);
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

async function createContentTask(
  page: Page,
  csrf: string,
  data: unknown,
  idempotencyKey: string,
) {
  return body<Record<string, unknown>>(await page.request.post('/api/v1/content-tasks', {
    headers: {
      'X-CSRF-Token': csrf,
      'Idempotency-Key': idempotencyKey,
    },
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

async function expectTextInPaginatedTable(page: Page, tableLabel: string, text: string) {
  const table = page.getByRole('region', { name: tableLabel }).locator('.ant-table-wrapper');
  const targetRow = table.locator('tbody tr:visible').filter({ hasText: text }).first();
  await expect(table).toBeVisible();
  await expect(table.locator('.ant-spin-spinning')).toHaveCount(0);
  for (let pageNumber = 1; pageNumber <= 10; pageNumber += 1) {
    if (await targetRow.isVisible()) return;
    const next = table.getByRole('button', { name: 'right' });
    if (!(await next.isEnabled())) break;
    await next.click();
  }
  await expect(targetRow).toBeVisible();
}

test('批准事实到人工发布、GEO 观测及删除与归档生命周期保持完整追溯', async ({ page, browser }, testInfo) => {
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
    `/api/v1/platform-prompts/${nonexistentId}?expected_revision=0`,
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
  await expectTextInPaginatedTable(page, '产品事实列表', `DEMO-${suffix}`);

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
  const savedFacts = await body<{ revision: number }>(await page.request.put(`/api/v1/products/${product!.id}/facts`, { headers: { 'X-CSRF-Token': csrf }, data: facts }));
  const factVersion = await command(page, `/api/v1/products/${product!.id}/fact-review-submissions`, csrf, {
    expected_revision: savedFacts.revision,
    change_summary: 'E2E 虚构事实快照',
  });

  await page.goto(`/products/${product!.id}`);
  await expect(page.getByRole('textbox', { name: '事实 Markdown' })).toHaveValue(factsBodyMarkdown);
  await page.getByRole('tab', { name: /事实版本/ }).click();
  await expect(page.getByRole('button', { name: '更多操作：事实版本 V1' })).toBeVisible();
  await page.getByRole('button', { name: '审核处理' }).click();
  await page.getByRole('button', { name: /批\s*准/, exact: true }).click();
  await expect(page.getByText('请显式确认：批准依据是下方不可变 Markdown 与分级，而不是当前工作区。')).toBeVisible();
  await page.getByLabel('审核意见').fill('批准虚构事实');
  await page.getByRole('button', { name: '确认批准' }).click();
  await expect(page.getByText('已批准', { exact: true }).first()).toBeVisible();

  const disposableFact = await command(page, `/api/v1/products/${product!.id}/fact-review-submissions`, csrf, {
    expected_revision: savedFacts.revision,
    change_summary: 'E2E 待物理删除事实快照',
  });
  expect((await page.request.delete(`/api/v1/fact-versions/${disposableFact.id as string}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.get(`/api/v1/fact-versions/${disposableFact.id as string}`)).status()).toBe(404);

  const platformType = await command(page, '/api/v1/platform-types', csrf, { name: `E2E 论坛类型 ${suffix}`, slug: `e2e-type-${suffix}` });
  const platformPromptName = `E2E 论坛 Prompt ${suffix}`;
  const platformPromptMarkdown = '使用技术说明语气，只依据输入事实；受众、角度、长度、安全和 JSON 输出均按本 Prompt 执行。';
  const platformPrompt = await body<{ id: string; name: string; revision: number }>(await page.request.post('/api/v1/platform-prompts', { headers: { 'X-CSRF-Token': csrf }, data: { name: platformPromptName, template_markdown: platformPromptMarkdown } }));
  const profile = await command(page, '/api/v1/platform-profiles', csrf, { name: `E2E 论坛 ${suffix}`, slug: `e2e-forum-${suffix}`, allowed_domains: ['forum.example.invalid'], platform_type_id: platformType.id, platform_prompt_id: platformPrompt.id }) as {
    id: string;
    name: string;
    allowed_domains: string[];
    revision: number;
    website_url: string | null;
  };
  const taskPayload = { product_id: product!.id, fact_version_id: factVersion.id, platform_profile_id: profile.id };
  expect((await page.request.post('/api/v1/platform-prompts', { headers: { 'X-CSRF-Token': csrf }, data: { name: platformPromptName, template_markdown: '禁止创建同名 Prompt' } })).status()).toBe(409);
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
  expect(discovered.items).toContainEqual(expect.objectContaining({ model_id: 'e2e-model' }));
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
  await channelRow.getByRole('button', { name: '查看运行情况' }).click();
  await expect(page).toHaveURL(new RegExp(`/configuration/ai/channels/${channel.id as string}\\?tab=usage$`));
  await expect(page.getByRole('tab', { name: '使用统计' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '请求配置' }).click();
  await expect(page.getByRole('region', { name: '请求 Header 列表' })).toBeVisible();
  await expect(page.getByText('••••••', { exact: true }).first()).toBeVisible();
  const headerMore = page.getByRole('button', { name: '更多操作：Header X-E2E-Region' });
  await headerMore.focus();
  await headerMore.click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  const headerDeleteDialog = page.getByRole('dialog', { name: '删除 Header“X-E2E-Region”？' });
  await expect(headerDeleteDialog).toBeVisible();
  await headerDeleteDialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect(headerMore).toBeFocused();
  await page.getByRole('tab', { name: '模型管理' }).click();
  await expect(page.getByText('E2E 模型', { exact: true })).toBeVisible();
  await page.goto('/configuration/platforms');
  await expectTextInPaginatedTable(page, '平台列表', `E2E 论坛 ${suffix}`);

  const task = await createContentTask(page, csrf, taskPayload, `e2e-task-${suffix}`);
  const platformPreviewTask = await createContentTask(page, csrf, taskPayload, `e2e-platform-preview-task-${suffix}`);
  const platformPreviewTaskOption = `DEMO ${product!.part_number} · E2E 论坛 ${suffix} · ${(platformPreviewTask.id as string).slice(0, 8)}`;
  const modelOption = `E2E 渠道 ${suffix} / E2E 模型 (e2e-model)`;
  await page.goto(`/tasks/${task.id as string}`);
  await page.getByRole('button', { name: /生成 AI 草稿/ }).click();
  await expect(page.getByRole('dialog', { name: '生成 AI 草稿' })).toBeVisible();
  if (!humanizationPromptWasConfigured) {
    await expect(page.getByText('全局自然化 Prompt 未配置；不影响本次原始生成。')).toBeVisible();
  }
  await selectOption(page, '生成模型', modelOption);
  await page.getByRole('button', { name: '生成文稿' }).click();
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
    contract_version: 'content-markdown-v3',
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
    await expect(sourceVersionRow.getByRole('button', { name: '自然化' })).toHaveCount(0);
    const missingPromptHumanization = await page.request.post(`/api/v1/content-versions/${generatedContentId}/humanization-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-humanization-no-prompt-${suffix}` }, data: { ai_model_id: model.id } });
    expect(missingPromptHumanization.status()).toBe(409);
    expect(await missingPromptHumanization.json()).toMatchObject({ error: { code: 'HUMANIZATION_PROMPT_MISSING' } });
  }
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto(`/configuration/prompts?tab=platform&platform_prompt_id=${platformPrompt.id}&page=1&page_size=10`);
  await expect(page.getByRole('heading', { name: 'Prompt 管理' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt 名称', exact: true })).toHaveValue(platformPromptName);
  const promptBindings = page.getByRole('region', { name: 'Prompt 使用平台' });
  await expect(promptBindings.getByText('1 个', { exact: true })).toBeVisible();
  await expect(promptBindings.getByText(`E2E 论坛 ${suffix}`, { exact: true })).toBeVisible();
  await selectOption(page, '预览内容任务', platformPreviewTaskOption);
  await selectOption(page, '预览模型', modelOption);
  const platformPreviewCreated = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1/content-tasks/${platformPreviewTask.id as string}/generation-jobs`
  ));
  await page.getByRole('button', { name: '生成平台预览' }).click();
  const { id: platformPreviewJobId } = await body<{ id: string }>(await platformPreviewCreated);
  let platformPreviewContentId: string | null | undefined;
  await expect.poll(async () => {
    const platformPreviewJob = await body<{ status: string; content_version_id: string | null }>(
      await page.request.get(`/api/v1/generation-jobs/${platformPreviewJobId}`),
    );
    platformPreviewContentId = platformPreviewJob.content_version_id;
    return platformPreviewJob.status;
  }, { timeout: 30_000 }).toBe('SUCCEEDED');
  expect(platformPreviewContentId).toBeTruthy();
  await expect(page.getByRole('heading', { name: '连接测试' })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole('tab', { name: '全局自然化 Prompt' }).click();
  const e2eHumanizationPrompt = `保留批准事实与必要披露，减少机械衔接，使用自然、克制的中文表达。${suffix}`;
  await page.getByLabel('自然化 Prompt Markdown').fill(e2eHumanizationPrompt);
  const humanizationSaveResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/content-humanization-prompt') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: humanizationPromptWasConfigured ? '保存 Prompt' : '首次保存' }).click();
  expect((await humanizationSaveResponse).ok()).toBeTruthy();
  await expect(page.getByText('Prompt 已保存')).toBeVisible();
  await selectOption(page, '预览内容任务', platformPreviewTaskOption);
  await selectOption(page, '自然化源草稿', `V1 · ${generatedContentBeforeHumanization.title}`);
  await selectOption(page, '预览模型', modelOption);
  const humanizationPreviewCreated = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1/content-versions/${platformPreviewContentId!}/humanization-jobs`
  ));
  await page.getByRole('button', { name: '生成自然化预览' }).click();
  const { id: humanizationPreviewJobId } = await body<{ id: string }>(await humanizationPreviewCreated);
  await expect.poll(async () => (
    await body<{ status: string }>(await page.request.get(`/api/v1/generation-jobs/${humanizationPreviewJobId}`))
  ).status, { timeout: 30_000 }).toBe('SUCCEEDED');
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
  expect(generatedContentAfterHumanization).toMatchObject({
    ...generatedContentBeforeHumanization,
    workflow_stage: 'HISTORICAL',
    primary_task: 'VIEW_VERSION_HISTORY',
    available_actions: [],
  });
  expect(await body<{ source_type: string; status: string; source_job_id: string; based_on_id: string }>(await page.request.get(`/api/v1/content-versions/${humanizedContentId!}`))).toMatchObject({ source_type: 'AI', status: 'DRAFT', source_job_id: humanizationJobId, based_on_id: generatedContentId });
  await page.goto(`/content/${humanizedContentId!}`);
  await page.getByRole('tab', { name: '版本差异' }).click();
  await expect(page.locator('#review-diff')).toBeVisible();
  await page.getByRole('tab', { name: '产品事实' }).click();
  await expect(page.locator('#review-trace').getByText('自然化 1', { exact: true })).toBeVisible();
  const updatedPlatformPrompt = await body<{ revision: number }>(await page.request.put(`/api/v1/platform-prompts/${platformPrompt.id}`, { headers: { 'X-CSRF-Token': csrf }, data: { name: platformPrompt.name, template_markdown: '使用更新后的技术说明语气，只依据输入事实。', expected_revision: platformPrompt.revision } }));
  const updatedPromptTask = await createContentTask(page, csrf, taskPayload, `e2e-updated-prompt-task-${suffix}`);
  const secondJob = await body<{ id: string }>(await page.request.post(`/api/v1/content-tasks/${updatedPromptTask.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-second-${suffix}` }, data: { ai_model_id: model.id, platform_prompt_id: platformPrompt.id, platform_prompt_revision: updatedPlatformPrompt.revision } }));
  await expect.poll(async () => (await body<{ status: string }>(await page.request.get(`/api/v1/generation-jobs/${secondJob.id}`))).status, { timeout: 30_000 }).toBe('SUCCEEDED');
  const secondJobDetail = await body<{ input_snapshot: { system_message: string; user_message: string } }>(await page.request.get(`/api/v1/generation-jobs/${secondJob.id}`));
  expect(completedJob.input_snapshot.system_message).toBe(platformPromptMarkdown);
  expect(completedJob.input_snapshot.user_message).toBe(factsBodyMarkdown);
  expect(secondJobDetail.input_snapshot.system_message).toContain('更新后的技术说明语气');
  expect(secondJobDetail.input_snapshot.user_message).toBe(factsBodyMarkdown);
  const manualTask = await createContentTask(
    page,
    csrf,
    taskPayload,
    `e2e-manual-task-${suffix}`,
  );
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
  const timeoutTask = await createContentTask(page, csrf, taskPayload, `e2e-timeout-task-${suffix}`);
  const timeoutJob = await body<{ id: string }>(await page.request.post(`/api/v1/content-tasks/${timeoutTask.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-timeout-${suffix}` }, data: { ai_model_id: timeoutModel.id, platform_prompt_id: platformPrompt.id, platform_prompt_revision: updatedPlatformPrompt.revision } }));
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
  expect((await page.request.delete(`/api/v1/platform-prompts/${platformPrompt.id}?expected_revision=${updatedPlatformPrompt.revision}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  const unboundProfileDetail = await body<{ profile: { revision: number; platform_prompt: null } }>(await page.request.get(`/api/v1/platform-profiles/${profile.id}`));
  const unboundProfile = unboundProfileDetail.profile;
  expect(unboundProfile.platform_prompt).toBeNull();
  const noPromptTask = await createContentTask(page, csrf, taskPayload, `e2e-no-prompt-task-${suffix}`);
  expect((await page.request.post(`/api/v1/content-tasks/${noPromptTask.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-no-prompt-${suffix}` }, data: { ai_model_id: model.id, platform_prompt_id: platformPrompt.id, platform_prompt_revision: updatedPlatformPrompt.revision } })).status()).toBe(409);
  const replacementPrompt = await body<{ id: string; revision: number }>(await page.request.post('/api/v1/platform-prompts', {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      name: `E2E 恢复 Prompt ${suffix}`,
      template_markdown: '恢复后的技术说明 Prompt。',
    },
  }));
  await body(await page.request.patch(`/api/v1/platform-profiles/${profile.id}`, {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      expected_revision: unboundProfile.revision,
      name: profile.name,
      allowed_domains: profile.allowed_domains,
      platform_type_id: platformType.id,
      platform_prompt_id: replacementPrompt.id,
      website_url: profile.website_url,
    },
  }));
  const manualRevision = await body<{ id: string; version: number }>(await page.request.post(`/api/v1/content-versions/${humanizedContentId!}/revisions`, { headers: { 'X-CSRF-Token': csrf }, data: { title: `人工核对 ${product!.part_number}`, summary: '工程师已核对生成草稿。', body_markdown: '不得将虚构验收数据用于真实选型。', tags: ['reviewed'], change_summary: '人工核对并创建新版本' } }));
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

  const pendingContent = await body<{ revision: number }>(await page.request.get(`/api/v1/content-versions/${submittedId}`));
  const returnedContent = await command(page, `/api/v1/content-versions/${submittedId}/request-changes`, csrf, {
    expected_revision: pendingContent.revision,
    comment: '补充退回后的新修订验证',
  });
  expect(returnedContent.status).toBe('CHANGES_REQUESTED');
  const reviewedRevision = await body<{ id: string; version: number }>(await page.request.post(`/api/v1/content-versions/${submittedId}/revisions`, {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      title: `退回修订 ${product!.part_number}`,
      summary: '按审核意见创建新版本，不重提被退回版本。',
      body_markdown: '不得将虚构验收数据用于真实选型；本版补充退回修订说明。',
      tags: ['reviewed'],
      change_summary: '根据退回意见创建新修订',
    },
  }));
  expect(reviewedRevision.id).not.toBe(submittedId);

  await page.goto(`/content/${reviewedRevision.id}`);
  await page.getByRole('button', { name: '提交审核' }).click();
  await page.getByLabel('审核意见').fill('提交退回后的新修订');
  await page.getByRole('button', { name: /确\s*认/ }).click();
  await expect(page.getByText('待审核', { exact: true })).toBeVisible();
  await page.goto(`/content/${reviewedRevision.id}`);
  await page.getByRole('button', { name: /批\s*准/ }).click();
  await page.getByLabel('审核意见').fill('批准虚构内容');
  await page.getByRole('button', { name: /确\s*认/ }).click();
  await expect(page.getByText('已批准', { exact: true })).toBeVisible();

  const account = await command(page, '/api/v1/platform-accounts', csrf, { platform_profile_id: profile.id, label: `E2E 账号 ${suffix}`, account_identifier: `e2e-${suffix}` });
  const resultFile = await uploadOperationScreenshot(page, csrf, 'e2e-result.png', `PartSignal E2E result screenshot ${suffix}`);

  const publication = await body<{ id: string; revision: number }>(await page.request.post('/api/v1/publication-works', {
    headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-publication-${suffix}` },
    data: { content_version_id: reviewedRevision.id, platform_account_id: account.id },
  }));
  const reviewWork = await command(page, `/api/v1/publication-works/${publication.id}/platform-review`, csrf, { expected_revision: publication.revision, comment: '平台处理中' });
  const resultWork = await body<{ revision: number }>(await page.request.put(`/api/v1/publication-works/${publication.id}/result`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { actual_title: `E2E ${suffix}`, final_url: `https://forum.example.invalid/posts/${suffix}`, published_at: new Date().toISOString(), expected_revision: reviewWork.revision, comment: '人工发布完成', attachment_file_ids: [resultFile.id] },
  }));
  const failedWork = await command(page, `/api/v1/publication-works/${publication.id}/verifications`, csrf, { outcome: 'FAILED', content_matches: false, expected_revision: resultWork.revision, comment: '首次核验发现正文不一致' });
  expect(failedWork.status).toBe('ACTION_REQUIRED');
  const publicationRevision = await body<{ id: string; version: number; revision: number }>(await page.request.post(`/api/v1/content-versions/${reviewedRevision.id}/revisions`, {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      title: `发布改稿 ${product!.part_number}`,
      summary: '保留原发布工作并切换到新批准版本。',
      body_markdown: '不得将虚构验收数据用于真实选型；本版用于发布改稿切换。',
      tags: ['reviewed', 'publication-fix'],
      change_summary: '核验失败后的发布改稿',
    },
  }));
  const publicationRevisionPending = await command(page, `/api/v1/content-versions/${publicationRevision.id}/submit-review`, csrf, {
    expected_revision: publicationRevision.revision,
    comment: '提交发布改稿审核',
  });
  await command(page, `/api/v1/content-versions/${publicationRevision.id}/approve`, csrf, {
    expected_revision: publicationRevisionPending.revision,
    comment: '批准发布改稿',
  });
  const switchedWork = await command(page, `/api/v1/publication-works/${publication.id}/content-version`, csrf, {
    content_version_id: publicationRevision.id,
    expected_revision: failedWork.revision,
    comment: '切换到核验失败后的批准改稿',
  });
  expect(switchedWork.content_version_id).toBe(publicationRevision.id);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/publications?tab=works&status=ACTION_REQUIRED');
  const mobileWorkList = page.getByRole('list', { name: '发布工作移动列表' });
  await expect(mobileWorkList).toBeVisible();
  await expect(page.locator('.publication-panel table')).toHaveCount(0);
  const mobileWorkTitle = mobileWorkList.getByRole('button', { name: `发布改稿 ${product!.part_number} · V${publicationRevision.version}` });
  const mobileVerify = mobileWorkList.getByRole('button', { name: '修复并重新核验' });
  await expect(mobileWorkTitle).toBeVisible();
  await expect(mobileVerify).toBeVisible();
  for (const target of [mobileWorkTitle, mobileVerify]) {
    const box = await target.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await mobileWorkTitle.click();
  await expect(page).toHaveURL(new RegExp(`kind=work.*selected=${publication.id}|selected=${publication.id}.*kind=work`));
  const pendingDrawer = page.getByRole('dialog', { name: '发布工作详情' });
  await expect(pendingDrawer.getByText('首次核验发现正文不一致', { exact: true })).toBeVisible();
  await pendingDrawer.getByRole('button', { name: '关闭' }).click();
  await expect(mobileWorkTitle).toBeFocused();
  await mobileVerify.click();
  const verifyModal = page.getByRole('dialog', { name: '核验发布结果' });
  await expect(verifyModal).toBeVisible();
  await verifyModal.getByRole('button', { name: /取\s*消/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/publications?tab=works&status=ACTION_REQUIRED');
  const workRegion = page.getByRole('region', { name: '发布管理列表' });
  await expect(workRegion).toBeVisible();
  const workRegionBox = await workRegion.boundingBox();
  expect(workRegionBox?.y).toBeLessThan(1000);
  const desktopWorkRow = workRegion.locator('tbody tr').filter({ hasText: `发布改稿 ${product!.part_number}` });
  const desktopTitleBox = await desktopWorkRow.locator('.publication-table-title').boundingBox();
  const desktopActionBox = await desktopWorkRow.locator('td.ant-table-cell-fix-end').boundingBox();
  expect(desktopTitleBox!.x + desktopTitleBox!.width).toBeLessThanOrEqual(desktopActionBox!.x + 1);

  await command(page, `/api/v1/publication-works/${publication.id}/verifications`, csrf, { outcome: 'PASSED', content_matches: true, expected_revision: switchedWork.revision as number, comment: '复核后人工核对一致' });
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
  await page.getByRole('tab', { name: '发布成果' }).click();
  await expect(page).toHaveURL(/tab=articles/);
  await page.getByRole('button', { name: `E2E ${suffix}`, exact: true }).click();
  const publicationDrawer = page.getByRole('dialog', { name: '发布成果详情' });
  await expect(publicationDrawer.getByText('成果正文与核验历史不可原地修改；管理员可在无 GEO 下游引用时永久删除整个发布聚合。')).toBeVisible();
  await expect(publicationDrawer.getByRole('link', { name: `https://forum.example.invalid/posts/${suffix}` })).toBeVisible();
  await expect(publicationDrawer.getByRole('button', { name: '开始产品观测' })).toBeVisible();
  await publicationDrawer.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '永久删除' }).click();
  const articleDeleteDialog = page.getByRole('dialog', { name: '永久删除发布成果' });
  await expect(articleDeleteDialog.getByText('该操作不可恢复，且不会删除外部公开页面。')).toBeVisible();
  await expect(articleDeleteDialog.getByRole('button', { name: '永久删除' })).toBeDisabled();
  await articleDeleteDialog.getByRole('button', { name: /取\s*消/ }).click();
  await publicationDrawer.getByRole('button', { name: '关闭' }).click();
  await expect(publicationDrawer).not.toBeVisible();

  const geoTopic = await body<{ id: string; canonical_question: string }>(await page.request.post('/api/v1/query-topics', {
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
  await geoForm.getByRole('checkbox', { name: `是否发现：E2E ${suffix}` }).check();
  await geoForm.getByRole('checkbox', { name: `是否提及：E2E ${suffix}` }).check();
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

  const metrics = await body<{
    manual_observation_count: number;
    article_discovery_rate: number | null;
    article_mention_rate: number | null;
    article_accuracy_rate: number | null;
  }>(await page.request.get(`/api/v1/geo-metrics?product_id=${product!.id}`));
  expect(metrics.manual_observation_count).toBe(1);
  expect(metrics.article_discovery_rate).toBe(1);
  expect(metrics.article_mention_rate).toBe(1);
  expect(metrics.article_accuracy_rate).toBe(1);

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

  const geoRecordRow = page.getByRole('region', { name: '观测记录列表' }).locator('tbody tr:visible').filter({ hasText: geoSearchQuery }).first();
  await expect(geoRecordRow.getByRole('button', { name: '查看分析结果' })).toBeVisible();
  await geoRecordRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '查看观测详情' }).click();
  const geoDetail = page.getByRole('dialog', { name: '观测详情' });
  await expect(geoDetail.getByText('发现：已发现')).toBeVisible();
  await expect(geoDetail.getByText('提及：已提及')).toBeVisible();
  await expect(geoDetail.getByText('准确', { exact: true })).toBeVisible();
  await expect(geoDetail.getByText('历史回答摘要')).toHaveCount(0);
  await expect(geoDetail.getByRole('img', { name: `geo-${suffix}.png` })).toBeVisible();
  await expect.poll(async () => (await geoDetail.boundingBox())?.x ?? 1582).toBeLessThanOrEqual(1210);
  await expect(page.locator('.ant-drawer-mask')).toBeVisible();
  await geoDetail.evaluate(async (element) => {
    await Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  await page.screenshot({ path: testInfo.outputPath('geo-observations-detail-1582x995.png') });

  await geoDetail.getByRole('button', { name: '更正' }).click();
  const correctionForm = page.getByRole('dialog', { name: '更正人工观测' });
  await expect(correctionForm.getByLabel('实际搜索词')).toBeDisabled();
  await expect(correctionForm.getByRole('combobox', { name: '问题主题' })).toBeDisabled();
  await expect(correctionForm.getByText('已有证据截图（1）')).toBeVisible();
  await correctionForm.getByRole('checkbox', { name: `是否发现：E2E ${suffix}` }).check();
  await correctionForm.getByRole('checkbox', { name: `是否提及：E2E ${suffix}` }).check();
  const correctedAccuracy = correctionForm.getByRole('combobox', { name: `准确性：E2E ${suffix}` });
  await correctedAccuracy.click();
  await clickVisibleOption(page, '部分准确');
  await correctionForm.getByLabel('人工备注').fill('E2E 追加更正');
  await correctionForm.getByRole('button', { name: /追加更正记录/ }).click();
  await expect(page.getByRole('dialog', { name: '观测详情' }).getByText('E2E 追加更正')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '观测详情' }).getByText('部分准确', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '观测详情' }).getByRole('img', { name: `geo-${suffix}.png` })).toBeVisible();
  await page.getByRole('dialog', { name: '观测详情' }).locator('.ant-drawer-close').click();
  await expect(page.getByRole('dialog', { name: '观测详情' })).not.toBeVisible();
  await page.getByRole('switch', { name: '包含历史更正记录' }).click();
  await expect(page.getByRole('button', { name: geoSearchQuery })).toHaveCount(2);

  for (let index = 0; index < 3; index += 1) {
    const response = await page.request.post('/api/v1/geo-observations', {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        product_id: product!.id,
        query_topic_id: geoTopic.id,
        search_platform: 'DeepSeek E2E',
        search_query: `${geoSearchQuery} · 未命中 ${index + 1}`,
        tested_at: new Date(Date.now() - index * 60_000).toISOString(),
        article_results: [{ published_article_id: publication.id, discovered: false, mentioned: false, accuracy: null }],
        notes: 'E2E 构造明确覆盖缺口',
      },
    });
    expect(response.status()).toBe(201);
  }
  const analysisDateTo = new Date();
  const analysisDateFrom = new Date(analysisDateTo);
  analysisDateFrom.setUTCDate(analysisDateFrom.getUTCDate() - 29);
  const dateFrom = analysisDateFrom.toISOString().slice(0, 10);
  const dateTo = analysisDateTo.toISOString().slice(0, 10);
  const geoInsights = await body<{
    question_coverage: { matrix: Array<{ query_topic_id: string; geo_platform: string; status: string; primary_task: string }> };
  }>(await page.request.get(`/api/v1/geo-insights?date_from=${dateFrom}&date_to=${dateTo}&product_id=${product!.id}&geo_platform=${encodeURIComponent('DeepSeek E2E')}`));
  const coverageGap = geoInsights.question_coverage.matrix.find((item) => (
    item.query_topic_id === geoTopic.id && item.geo_platform === 'DeepSeek E2E'
  ));
  expect(coverageGap).toMatchObject({ status: 'UNCOVERED', primary_task: 'CREATE_OPTIMIZATION_TASK' });
  const optimizationTask = await body<{ id: string; product_id: string; fact_version_id: string; platform_profile_id: string }>(await page.request.post('/api/v1/geo-insights/optimization-content-tasks', {
    headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-geo-optimization-${suffix}` },
    data: {
      rule_code: 'QUESTION_COVERAGE_GAP',
      date_from: dateFrom,
      date_to: dateTo,
      query_topic_id: coverageGap!.query_topic_id,
      geo_platform: coverageGap!.geo_platform,
      product_id: product!.id,
      platform_profile_id: profile.id,
      fact_version_id: factVersion.id,
    },
  }));
  expect(optimizationTask).toMatchObject({ product_id: product!.id, fact_version_id: factVersion.id, platform_profile_id: profile.id });

  const insightsLoaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok() && url.pathname === '/api/v1/geo-insights';
  });
  await page.getByRole('link', { name: '分析洞察' }).last().click();
  await insightsLoaded;
  await expect(page.getByText('平台表现对比', { exact: true })).toBeVisible();
  await expect(page.getByText('发现率', { exact: true }).first()).toBeVisible();
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

  const issue = await body<{ id: string; revision: number; status: string }>(await page.request.post(`/api/v1/published-articles/${publication.id}/issues`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { kind: 'PAGE_UNAVAILABLE', description: 'E2E 页面已下线' },
  }));
  expect(issue.status).toBe('OPEN');
  expect((await body<{ status: string }>(await page.request.get(`/api/v1/content-tasks/${task.id as string}`))).status).toBe('COMPLETED');
  const eligibleAfterIssue = await body<{ items: Array<{ published_article_id: string }> }>(await page.request.get(`/api/v1/geo-observation-publications?product_id=${product!.id}`));
  expect(eligibleAfterIssue.items.some((item) => item.published_article_id === publication.id)).toBe(false);

  await page.goto(`/publications?tab=works&kind=issue&selected=${issue.id}`);
  const issueDrawer = page.getByRole('dialog', { name: '内容问题详情' });
  await issueDrawer.getByRole('button', { name: '处理内容问题' }).click();
  const repairModal = page.getByRole('dialog', { name: '创建修复任务' });
  await repairModal.getByRole('combobox', { name: '修复所用事实版本' }).click();
  await page.getByText(/^V1 ·/).last().click();
  const repairTaskCreated = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1/published-content-issues/${issue.id}/repair-task`
    && response.status() === 201
  ));
  await repairModal.getByRole('button', { name: '确认提交' }).click();
  const createdRepairTask = await body<{ id: string }>(await repairTaskCreated);
  const issueWithRepair = await body<{ status: string; repair_task_id: string | null }>(await page.request.get(`/api/v1/published-content-issues/${issue.id}`));
  expect(issueWithRepair.status).toBe('OPEN');
  expect(issueWithRepair.repair_task_id).toBe(createdRepairTask.id);

  await issueDrawer.getByRole('button', { name: /更多操作：内容问题/ }).click();
  await page.getByRole('menuitem', { name: '解决内容问题' }).click();
  const resolveModal = page.getByRole('dialog', { name: '解决内容问题' });
  await resolveModal.getByRole('combobox', { name: '处理结果' }).click();
  await page.getByText('已恢复，可继续观测', { exact: true }).last().click();
  await resolveModal.getByRole('textbox', { name: '操作说明' }).fill('E2E 已创建并确认修复任务');
  const issueResolved = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1/published-content-issues/${issue.id}/resolve`
    && response.status() === 200
  ));
  await resolveModal.getByRole('button', { name: '确认提交' }).click();
  await issueResolved;
  expect((await body<{ status: string }>(await page.request.get(`/api/v1/published-content-issues/${issue.id}`))).status).toBe('RESOLVED');
  expect((await page.request.delete(`/api/v1/ai-channels/${channel.id as string}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.delete(`/api/v1/ai-channels/${secondChannel.id as string}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.post(`/api/v1/generation-jobs/${timeoutJob.id}/retry`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-timeout-deleted-${suffix}` } })).status()).toBe(409);
  const historicalJob = await body<{ input_snapshot: { model: { model_id: string }; system_message: string } }>(await page.request.get(`/api/v1/generation-jobs/${job.id}`));
  expect(historicalJob.input_snapshot.model.model_id).toBe('e2e-model');
  expect(historicalJob.input_snapshot.system_message).toBe(platformPromptMarkdown);

  await page.goto(`/tasks/${noPromptTask.id as string}`);
  await page.getByRole('button', { name: '删除任务' }).click();
  const ordinaryDeleteDialog = page.getByRole('dialog', { name: '删除内容任务？' });
  await ordinaryDeleteDialog.getByRole('button', { name: '确认删除' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  expect((await page.request.get(`/api/v1/content-tasks/${noPromptTask.id as string}`)).status()).toBe(404);

  const latestProfile = (await body<{ profile: { revision: number } }>(await page.request.get(`/api/v1/platform-profiles/${profile.id}`))).profile;
  await command(page, `/api/v1/platform-profiles/${profile.id}/disable`, csrf, { expected_revision: latestProfile.revision });
  const activeTaskBlockedDeletion = await page.request.delete(`/api/v1/platform-profiles/${profile.id}`, { headers: { 'X-CSRF-Token': csrf } });
  expect(activeTaskBlockedDeletion.status()).toBe(409);
  expect(await activeTaskBlockedDeletion.json()).toMatchObject({
    error: { details: { references: expect.arrayContaining([expect.objectContaining({ type: 'CONTENT_TASK' })]) } },
  });

  const platformTasks = await body<{ items: Array<{ id: string; status: string }> }>(
    await page.request.get(`/api/v1/content-tasks?page=1&page_size=100&archive_status=ACTIVE&platform_profile_id=${profile.id}`),
  );
  for (const openTask of platformTasks.items.filter((item) => item.status === 'OPEN')) {
    expect((await page.request.delete(`/api/v1/content-tasks/${openTask.id}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  }
  expect((await page.request.delete(`/api/v1/platform-profiles/${profile.id}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.get(`/api/v1/platform-profiles/${profile.id}`)).status()).toBe(404);
  expect(await body<{ platform_profile_id: string | null }>(await page.request.get(`/api/v1/content-tasks/${task.id as string}`))).toMatchObject({ platform_profile_id: null });

  await page.goto(`/tasks/${task.id as string}`);
  await expect(page.getByText(`E2E 论坛 ${suffix}`, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '归档任务' }).click();
  await page.getByRole('dialog', { name: '归档内容任务？' }).getByRole('button', { name: '确认归档' }).click();
  await expect(page.getByRole('button', { name: '恢复任务' })).toBeVisible();

  const archivedTask = await body<{ revision: number }>(await page.request.get(`/api/v1/content-tasks/${task.id as string}`));
  const lifecycleEngineerName = `lifecycle-engineer-${suffix}`;
  const lifecycleEngineerPassword = `Lifecycle-${suffix}-ready`;
  const lifecycleEngineer = await body<{ id: string }>(await page.request.post('/api/v1/users', {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      username: lifecycleEngineerName,
      display_name: `删除验证工程师 ${suffix}`,
      temporary_password: `Lifecycle-${suffix}-temp`,
      account_type: 'ENGINEER',
    },
  }));
  const lifecycleEngineerContext = await browser.newContext({
    baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
  });
  const lifecycleEngineerPage = await lifecycleEngineerContext.newPage();
  await lifecycleEngineerPage.goto('/login');
  await lifecycleEngineerPage.getByLabel('账号').fill(lifecycleEngineerName);
  await lifecycleEngineerPage.getByLabel('密码').fill(`Lifecycle-${suffix}-temp`);
  await lifecycleEngineerPage.getByRole('button', { name: /登\s*录/ }).click();
  await expect(lifecycleEngineerPage).toHaveURL(/\/change-password$/);
  await lifecycleEngineerPage.getByLabel('当前密码').fill(`Lifecycle-${suffix}-temp`);
  await lifecycleEngineerPage.getByLabel('新密码').fill(lifecycleEngineerPassword);
  await lifecycleEngineerPage.getByRole('button', { name: '更新密码' }).click();
  await expect(lifecycleEngineerPage).toHaveURL(/\/$/);
  const lifecycleEngineerCsrf = await body<{ csrf_token: string }>(await lifecycleEngineerPage.request.get('/api/v1/auth/csrf'));
  expect((await lifecycleEngineerPage.request.post(`/api/v1/content-tasks/${task.id as string}/permanent-delete`, {
    headers: { 'X-CSRF-Token': lifecycleEngineerCsrf.csrf_token },
    data: { expected_revision: archivedTask.revision, confirmation_text: '永久删除' },
  })).status()).toBe(403);
  expect((await lifecycleEngineerPage.request.get(
    `/api/v1/published-articles/${publication.id}/permanent-deletion-preview`,
  )).status()).toBe(403);
  expect((await lifecycleEngineerPage.request.post(
    `/api/v1/published-articles/${publication.id}/permanent-delete`,
    {
      headers: { 'X-CSRF-Token': lifecycleEngineerCsrf.csrf_token },
      data: { expected_revision: 0, confirmation_text: '永久删除' },
    },
  )).status()).toBe(403);
  await lifecycleEngineerContext.close();

  await page.getByRole('button', { name: '恢复任务' }).click();
  await page.getByRole('dialog', { name: '恢复内容任务？' }).getByRole('button', { name: '确认恢复' }).click();
  await expect(page.getByRole('button', { name: '归档任务' })).toBeVisible();
  await page.getByRole('button', { name: '归档任务' }).click();
  await page.getByRole('dialog', { name: '归档内容任务？' }).getByRole('button', { name: '确认归档' }).click();
  await expect(page.getByRole('button', { name: '永久删除' })).toBeVisible();
  await page.getByRole('button', { name: '永久删除' }).click();
  const permanentDeleteDialog = page.getByRole('dialog', { name: '永久删除内容任务' });
  await expect(permanentDeleteDialog.getByText('此操作不可恢复')).toBeVisible();
  await expect(permanentDeleteDialog.getByRole('link', { name: `https://forum.example.invalid/posts/${suffix}` })).toBeVisible();
  const permanentDeleteButton = permanentDeleteDialog.getByRole('button', { name: '永久删除' });
  await expect(permanentDeleteButton).toBeDisabled();
  await permanentDeleteDialog.getByRole('textbox', { name: '永久删除确认文本' }).fill('永久删除');
  await permanentDeleteButton.click();
  await expect(page).toHaveURL(/\/tasks\?archive_status=ARCHIVED$/);
  expect((await page.request.get(`/api/v1/content-tasks/${task.id as string}`)).status()).toBe(404);

  const lifecycleEngineerUsers = await body<{ items: Array<{ id: string; display_name: string; account_type: 'ENGINEER'; is_active: boolean; revision: number }> }>(
    await page.request.get(`/api/v1/users?q=${lifecycleEngineerName}&page=1&page_size=100`),
  );
  const lifecycleEngineerUser = lifecycleEngineerUsers.items.find((item) => item.id === lifecycleEngineer.id);
  expect(lifecycleEngineerUser).toBeTruthy();
  const disabledLifecycleEngineer = await body<{ revision: number }>(await page.request.patch(`/api/v1/users/${lifecycleEngineer.id}`, {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      expected_revision: lifecycleEngineerUser!.revision,
      display_name: lifecycleEngineerUser!.display_name,
      account_type: lifecycleEngineerUser!.account_type,
      is_active: false,
    },
  }));
  expect(disabledLifecycleEngineer.revision).toBeGreaterThan(lifecycleEngineerUser!.revision);
  expect((await page.request.delete(`/api/v1/users/${lifecycleEngineer.id}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.delete(`/api/v1/platform-prompts/${replacementPrompt.id}?expected_revision=${replacementPrompt.revision}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.delete(`/api/v1/platform-types/${platformType.id as string}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '总览' })).toBeVisible();
});
