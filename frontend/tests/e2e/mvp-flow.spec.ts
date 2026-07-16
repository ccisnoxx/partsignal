/** 以虚构数据验证事实、生成、审核、发布、文件和 GEO 观测纵向闭环。 */
import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';

test.setTimeout(120_000);

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
  await page.getByRole('menuitem', { name: /修改密码/ }).click();
}

test('账号类型、最后管理员、临时密码和停用会话由服务端强制执行', async ({ page, browser }) => {
  const suffix = randomUUID().slice(0, 8);
  const csrf = await login(page, 'admin');
  await expect(page.getByRole('button', { name: '打开用户操作菜单' })).toBeVisible();
  const users = await body<{ items: Array<{ id: string; username: string; display_name: string; account_type: 'ADMIN' | 'ENGINEER'; is_active: boolean; revision: number }> }>(await page.request.get('/api/v1/users'));
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
    data: { username, display_name: `工程师 ${suffix}`, password: 'initial-password-only', account_type: 'ENGINEER' },
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
  await engineerPage.goto('/configuration/audit');
  await expect(engineerPage).toHaveURL(/\/$/);
  await expect(engineerPage.getByRole('button', { name: '打开用户操作菜单' })).toBeVisible();
  expect((await engineerPage.request.get('/api/v1/users')).status()).toBe(403);
  const engineerCsrf = await body<{ csrf_token: string }>(await engineerPage.request.get('/api/v1/auth/csrf'));
  const nonexistentId = randomUUID();
  for (const path of [
    `/api/v1/products/${nonexistentId}`,
    `/api/v1/platform-types/${nonexistentId}`,
    `/api/v1/platform-profiles/${nonexistentId}`,
    `/api/v1/platform-profiles/${nonexistentId}/prompt`,
    `/api/v1/platform-profile-versions/${nonexistentId}`,
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
  const adminNewPassword = 'temporary-admin-updated';
  const createdAdmin = await body<{ id: string }>(await page.request.post('/api/v1/users', {
    headers: { 'X-CSRF-Token': csrf },
    data: { username: adminUsername, display_name: `管理员 ${suffix}`, password: adminInitialPassword, account_type: 'ADMIN' },
  }));
  const adminContext = await browser.newContext({
    baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
  });
  const otherAdminContext = await browser.newContext({
    baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
  });
  const adminPage = await adminContext.newPage();
  const otherAdminPage = await otherAdminContext.newPage();
  const adminCsrf = await login(adminPage, adminUsername, adminInitialPassword);
  await login(otherAdminPage, adminUsername, adminInitialPassword);
  expect((await adminPage.request.post(`/api/v1/users/${createdAdmin.id}/reset-password`, {
    headers: { 'X-CSRF-Token': adminCsrf },
    data: { temporary_password: 'self-reset-must-fail' },
  })).status()).toBe(422);
  await openPasswordPage(adminPage);
  await adminPage.getByLabel('当前密码').fill(adminInitialPassword);
  await adminPage.getByLabel('新密码').fill(adminNewPassword);
  await adminPage.getByRole('button', { name: '更新密码' }).click();
  await expect(adminPage).toHaveURL(/\/$/);
  expect((await adminPage.request.get('/api/v1/auth/me')).status()).toBe(200);
  expect((await otherAdminPage.request.get('/api/v1/auth/me')).status()).toBe(401);

  const refreshedUsers = await body<{ items: Array<{ id: string; username: string; display_name: string; account_type: 'ADMIN' | 'ENGINEER'; is_active: boolean; revision: number }> }>(await page.request.get('/api/v1/users'));
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
  for (const secret of ['initial-password-only', temporaryPassword, 'engineer-new-password', adminInitialPassword, adminNewPassword, 'self-reset-must-fail']) {
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

test('批准事实到人工发布和 GEO 观测保持完整追溯', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const csrf = await login(page, 'admin');
  const nonexistentId = randomUUID();
  for (const path of [
    `/api/v1/products/${nonexistentId}`,
    `/api/v1/platform-types/${nonexistentId}`,
    `/api/v1/platform-profiles/${nonexistentId}`,
    `/api/v1/platform-profiles/${nonexistentId}/prompt`,
    `/api/v1/platform-profile-versions/${nonexistentId}`,
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
  await expectTextInPaginatedTable(page, `DEMO-${suffix}`);

  const products = await body<{ items: Array<{ id: string; part_number: string }> }>(
    await page.request.get(`/api/v1/products?page=1&page_size=100&search=DEMO-${suffix}`),
  );
  const product = products.items.find((item) => item.part_number === `DEMO-${suffix}`);
  expect(product).toBeTruthy();

  const invalidDraft = await body<{ revision: number }>(await page.request.put(`/api/v1/products/${product!.id}/facts`, {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      expected_revision: 0,
      reference_parts: [],
      parameters: [{ client_key: 'unsupported-voltage', owner_key: 'product', key: 'voltage', name: '无证据工作电压', value_type: 'NUMERIC', min_value: null, typical_value: 5, max_value: null, text_value: null, unit: 'V', test_conditions: '室温', is_critical: true, evidence_keys: [] }],
      replacement_relations: [], evidences: [], claims: [],
    },
  }));
  expect((await page.request.post(`/api/v1/products/${product!.id}/fact-versions`, { headers: { 'X-CSRF-Token': csrf }, data: { change_summary: '缺少证据的非法快照' } })).status()).toBe(422);
  const facts = {
    expected_revision: invalidDraft.revision,
    reference_parts: [{ client_key: 'ref', part_number: `REF-${suffix}`, manufacturer: 'DEMO-REF', category: 'TEST' }],
    parameters: [{ client_key: 'voltage', owner_key: 'product', key: 'voltage', name: '工作电压', value_type: 'NUMERIC', min_value: null, typical_value: 5, max_value: null, text_value: null, unit: 'V', test_conditions: '室温', is_critical: true, evidence_keys: ['datasheet'] }],
    replacement_relations: [{ client_key: 'replacement', reference_part_key: 'ref', replacement_level: 'FUNCTIONALLY_SIMILAR', conditions: '仅用于本地虚构验收', exclusions: '不得用于真实选型', evidence_keys: ['datasheet'] }],
    evidences: [{ client_key: 'datasheet', type: 'DATASHEET', title: '虚构开发数据手册', version: 'v1', source_url: 'https://example.invalid/datasheet.pdf', file_id: null, confidentiality: 'PUBLIC' }],
    claims: [{ client_key: 'disclosure', type: 'REQUIRED_DISCLOSURE', text: '不得将虚构验收数据用于真实选型。', evidence_keys: ['datasheet'] }],
  };
  await body(await page.request.put(`/api/v1/products/${product!.id}/facts`, { headers: { 'X-CSRF-Token': csrf }, data: facts }));
  const factVersion = await command(page, `/api/v1/products/${product!.id}/fact-versions`, csrf, { change_summary: 'E2E 虚构事实快照' });
  await command(page, `/api/v1/fact-versions/${factVersion.id as string}/submit`, csrf, { expected_revision: 0, comment: '提交审核' });

  await page.goto(`/products/${product!.id}`);
  await page.getByRole('tab', { name: /事实版本/ }).click();
  await page.getByRole('button', { name: '审核证据与历史' }).click();
  await page.getByRole('button', { name: /批\s*准/, exact: true }).click();
  await expect(page.getByText('请显式确认：批准依据是下方不可变快照，而不是当前事实工作区。')).toBeVisible();
  await page.getByLabel('审核意见').fill('批准虚构事实');
  await page.getByRole('button', { name: '确认批准' }).click();
  await expect(page.getByText('已批准', { exact: true }).first()).toBeVisible();

  const disposableFact = await command(page, `/api/v1/products/${product!.id}/fact-versions`, csrf, { change_summary: 'E2E 待物理删除事实快照' });
  expect((await page.request.delete(`/api/v1/fact-versions/${disposableFact.id as string}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.get(`/api/v1/fact-versions/${disposableFact.id as string}`)).status()).toBe(404);

  const platformType = await command(page, '/api/v1/platform-types', csrf, { name: `E2E 论坛类型 ${suffix}`, slug: `e2e-type-${suffix}` });
  const profile = await command(page, '/api/v1/platform-profiles', csrf, { name: `E2E 论坛 ${suffix}`, slug: `e2e-forum-${suffix}`, allowed_domains: ['forum.example.invalid'], platform_type_id: platformType.id });
  expect(profile.active_version).toBeNull();
  const rules = { target_audience: '测试工程师', title_min: 1, title_max: 120, body_min: 1, body_max: 5000, tone: '技术说明', allow_external_links: true, allow_tables: true, allow_contact: false, prohibited_phrases: ['绝对领先'], sections: [{ name: '测试栏目', url: 'https://forum.example.invalid/board' }] };
  const draftRule = await command(page, `/api/v1/platform-profiles/${profile.id as string}/versions`, csrf, { rules });
  const editedDraftRule = await body<{ id: string; revision: number }>(await page.request.patch(`/api/v1/platform-profile-versions/${draftRule.id as string}`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { expected_revision: draftRule.revision, rules: { ...rules, body_max: 5500 } },
  }));
  expect(editedDraftRule.revision).toBe(1);
  await page.goto('/configuration/platform-rules');
  await expectTextInPaginatedTable(page, `E2E 论坛 ${suffix}`);
  await page.goto('/configuration/platforms');
  await expectTextInPaginatedTable(page, `E2E 论坛 ${suffix}`);
  await page.getByRole('combobox', { name: `选择 E2E 论坛 ${suffix} 当前规则` }).click();
  await page.getByText('V1 · DRAFT', { exact: true }).last().click();
  let activeRuleId: string | null = null;
  await expect.poll(async () => {
    const profiles = await body<{ items: Array<{ id: string; active_version: { id: string } | null }> }>(await page.request.get('/api/v1/platform-profiles'));
    activeRuleId = profiles.items.find((item) => item.id === profile.id)?.active_version?.id ?? null;
    return activeRuleId;
  }).toBe(editedDraftRule.id);
  const topic = await command(page, '/api/v1/query-topics', csrf, { canonical_question: `${product!.part_number} 如何替代？`, intent_type: 'REPLACEMENT', variants: [`${product!.part_number} 替代方案`] });
  const taskPayload = { query_topic_id: topic.id, product_id: product!.id, fact_version_id: factVersion.id, platform_profile_version_id: activeRuleId, target_audience: '测试工程师', content_angle: '虚构参数与替代边界', conversion_goal: '查看虚构资料', desired_format: '工程说明', desired_length_min: 1, desired_length_max: 5000, canonical_url: `https://example.invalid/products/${product!.part_number}` };
  const missingPromptTask = await page.request.post('/api/v1/content-tasks', { headers: { 'X-CSRF-Token': csrf }, data: taskPayload });
  expect(missingPromptTask.status()).toBe(409);
  expect(await missingPromptTask.json()).toMatchObject({ error: { code: 'PLATFORM_PROMPT_MISSING' } });
  const platformPrompt = await body<{ revision: number }>(await page.request.put(`/api/v1/platform-profiles/${profile.id as string}/prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { template_markdown: '使用技术说明语气，只依据输入事实。', expected_revision: null } }));
  expect((await page.request.put(`/api/v1/platform-profiles/${profile.id as string}/prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { template_markdown: '禁止创建第二份 Prompt', expected_revision: null } })).status()).toBe(409);
  const typeConflict = await page.request.delete(`/api/v1/platform-types/${platformType.id as string}`, { headers: { 'X-CSRF-Token': csrf } });
  expect(typeConflict.status()).toBe(409);
  expect((await typeConflict.json()).error.details.references).toEqual([{ type: 'PLATFORM_PROFILE', count: 1 }]);
  const channel = await command(page, '/api/v1/ai-channels', csrf, { name: `E2E 渠道 ${suffix}`, base_url: 'http://127.0.0.1:9001/v1', api_key: 'e2e-only-key', timeout_seconds: 30 });
  const secondChannel = await command(page, '/api/v1/ai-channels', csrf, { name: `E2E 备用渠道 ${suffix}`, base_url: 'http://127.0.0.1:9001/v1', api_key: 'e2e-second-key', timeout_seconds: 10 });
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
  const timeoutModel = await command(page, `/api/v1/ai-channels/${secondChannel.id as string}/models`, csrf, { display_name: 'E2E 超时模型', model_id: 'e2e-timeout-model', request_parameters: {} });
  const testedTimeoutModel = await command(page, `/api/v1/ai-models/${timeoutModel.id as string}/test`, csrf, undefined);
  await command(page, `/api/v1/ai-models/${timeoutModel.id as string}/enable`, csrf, { expected_revision: testedTimeoutModel.revision });
  const enabledSecondChannel = await command(page, `/api/v1/ai-channels/${secondChannel.id as string}/enable`, csrf, { expected_revision: secondSensitiveHeader.revision });
  await page.goto('/configuration');
  await expect(page).toHaveURL(/\/configuration\/ai$/);
  const channelCard = page.getByRole('link', { name: `查看 E2E 渠道 ${suffix} 配置` });
  const enabledModelSummary = channelCard.getByRole('region', { name: '已启用模型' });
  await expect(enabledModelSummary.getByText('e2e-model', { exact: true })).toBeVisible();
  await expect(enabledModelSummary.getByText('e2e-manual-model', { exact: true })).toHaveCount(0);
  await channelCard.click();
  await expect(page).toHaveURL(new RegExp(`/configuration/ai/channels/${channel.id as string}$`));
  await expect(page.getByRole('region', { name: '请求 Header 列表' })).toBeVisible();
  await expect(page.getByText('E2E 模型', { exact: true })).toBeVisible();
  await page.goto('/configuration/platforms');
  await expectTextInPaginatedTable(page, `E2E 论坛 ${suffix}`);

  const task = await command(page, '/api/v1/content-tasks', csrf, taskPayload);
  const internalTask = await body<{ revision: number }>(await page.request.patch(`/api/v1/content-tasks/${task.id as string}/user-prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { expected_revision: task.revision, user_prompt_markdown: `请说明 ${product!.part_number} 的 5 V 参数和替代边界。`, generation_data_classification: 'INTERNAL' } }));
  const forbiddenGeneration = await page.request.post(`/api/v1/content-tasks/${task.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-classification-forbidden-${suffix}` }, data: { ai_model_id: model.id } });
  expect(forbiddenGeneration.status()).toBe(409);
  expect(await forbiddenGeneration.json()).toMatchObject({ error: { code: 'AI_DATA_CLASSIFICATION_FORBIDDEN' } });
  const promptedTask = await body<{ revision: number }>(await page.request.patch(`/api/v1/content-tasks/${task.id as string}/user-prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { expected_revision: internalTask.revision, user_prompt_markdown: `请说明 ${product!.part_number} 的 5 V 参数和替代边界。`, generation_data_classification: 'PUBLIC' } }));
  const job = await body<{ id: string }>(await page.request.post(`/api/v1/content-tasks/${task.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-${suffix}` }, data: { ai_model_id: model.id } }));
  await expect.poll(async () => (await body<{ status: string; content_version_id: string | null }>(await page.request.get(`/api/v1/generation-jobs/${job.id}`))).status, { timeout: 30_000 }).toBe('SUCCEEDED');
  const completedJob = await body<{ content_version_id: string; provider_request_id: string | null; response_duration_ms: number | null; prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null; input_snapshot: { system_message: string; user_prompt_markdown: string } }>(await page.request.get(`/api/v1/generation-jobs/${job.id}`));
  const generatedContentId = completedJob.content_version_id;
  expect(await body<{ source_type: string; status: string }>(await page.request.get(`/api/v1/content-versions/${generatedContentId}`))).toMatchObject({ source_type: 'AI', status: 'DRAFT' });
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
  const providerRequest = await body<Record<string, unknown>>(await page.request.get('http://127.0.0.1:9001/e2e/payloads/e2e-model'));
  expect(providerRequest).toMatchObject({ model: 'e2e-model', temperature: 0, stream: false });
  const providerPayload = JSON.stringify(providerRequest);
  expect(providerPayload).toContain(product!.part_number);
  for (const forbidden of ['datasheet.pdf', 'e2e-only-key', 'header-secret', 'evidence_keys', 'source_url', 'file_id']) {
    expect(providerPayload).not.toContain(forbidden);
  }
  await body(await page.request.put(`/api/v1/platform-profiles/${profile.id as string}/prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { template_markdown: '使用更新后的技术说明语气，只依据输入事实。', expected_revision: platformPrompt.revision } }));
  await body(await page.request.patch(`/api/v1/content-tasks/${task.id as string}/user-prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { expected_revision: promptedTask.revision, user_prompt_markdown: `第二次生成仍只说明 ${product!.part_number} 的 5 V 已批准事实。`, generation_data_classification: 'PUBLIC' } }));
  const secondJob = await body<{ id: string }>(await page.request.post(`/api/v1/content-tasks/${task.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-second-${suffix}` }, data: { ai_model_id: model.id } }));
  await expect.poll(async () => (await body<{ status: string }>(await page.request.get(`/api/v1/generation-jobs/${secondJob.id}`))).status, { timeout: 30_000 }).toBe('SUCCEEDED');
  const secondJobDetail = await body<{ input_snapshot: { system_message: string; user_prompt_markdown: string } }>(await page.request.get(`/api/v1/generation-jobs/${secondJob.id}`));
  expect(completedJob.input_snapshot.system_message).toContain('使用技术说明语气');
  expect(completedJob.input_snapshot.user_prompt_markdown).toContain('请说明');
  expect(secondJobDetail.input_snapshot.system_message).toContain('更新后的技术说明语气');
  expect(secondJobDetail.input_snapshot.user_prompt_markdown).toContain('第二次生成');
  const timeoutJob = await body<{ id: string }>(await page.request.post(`/api/v1/content-tasks/${task.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-timeout-${suffix}` }, data: { ai_model_id: timeoutModel.id } }));
  await expect.poll(async () => (await body<{ status: string }>(await page.request.get(`/api/v1/generation-jobs/${timeoutJob.id}`))).status, { timeout: 30_000 }).toBe('FAILED');
  const failedTimeoutJob = await body<{ attempt_count: number; error_code: string; input_snapshot: unknown }>(await page.request.get(`/api/v1/generation-jobs/${timeoutJob.id}`));
  expect(failedTimeoutJob).toMatchObject({ attempt_count: 1, error_code: 'AI_PROVIDER_TIMEOUT' });
  expect(await body<{ count: number }>(await page.request.get('http://127.0.0.1:9001/e2e/calls/e2e-timeout-model'))).toEqual({ count: 2 });
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
  expect(await body<{ count: number }>(await page.request.get('http://127.0.0.1:9001/e2e/calls/e2e-timeout-model'))).toEqual({ count: 4 });
  expect((await page.request.delete(`/api/v1/platform-profiles/${profile.id as string}/prompt`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  expect((await page.request.post(`/api/v1/content-tasks/${task.id as string}/generation-jobs`, { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-generation-no-prompt-${suffix}` }, data: { ai_model_id: model.id } })).status()).toBe(409);
  await body(await page.request.put(`/api/v1/platform-profiles/${profile.id as string}/prompt`, { headers: { 'X-CSRF-Token': csrf }, data: { template_markdown: '恢复后的技术说明 Prompt。', expected_revision: null } }));
  const blockingRevision = await body<{ id: string; revision: number; quality_issues: Array<{ code: string; severity: string }> }>(await page.request.post(`/api/v1/content-versions/${generatedContentId}/revisions`, { headers: { 'X-CSRF-Token': csrf }, data: { title: '包含未知参数的草稿', summary: '用于验证质量门禁。', body_markdown: '未知参数为 99 V。不得将虚构验收数据用于真实选型。', tags: ['blocking'], change_summary: '构造阻断质量问题' } }));
  expect(blockingRevision.quality_issues).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_NUMERIC_FACT', severity: 'BLOCKING' }));
  expect((await page.request.post(`/api/v1/content-versions/${blockingRevision.id}/submit-review`, { headers: { 'X-CSRF-Token': csrf }, data: { expected_revision: blockingRevision.revision, comment: '不应提交' } })).status()).toBe(409);
  const manualRevision = await body<{ id: string }>(await page.request.post(`/api/v1/content-versions/${generatedContentId}/revisions`, { headers: { 'X-CSRF-Token': csrf }, data: { title: `人工核对 ${product!.part_number}`, summary: '工程师已核对生成草稿。', body_markdown: '不得将虚构验收数据用于真实选型。', tags: ['reviewed'], change_summary: '人工核对并创建新版本' } }));
  const submittedId = manualRevision.id;
  await page.goto(`/tasks/${task.id as string}`);
  await expect(page.getByText('成功').first()).toBeVisible();
  await expect(page.getByText('Token 数：不可用')).toBeVisible();
  await expect(page.getByText(`E2E 论坛 ${suffix}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'V1' })).toBeVisible();
  await page.goto(`/content/${submittedId}`);
  await page.getByRole('button', { name: '提交审核' }).click();
  await page.getByLabel('审核意见').fill('提交内容审核');
  await page.getByRole('button', { name: /确\s*认/ }).click();
  await expect(page.getByLabel('审核摘要').getByText('待审核', { exact: true })).toBeVisible();

  await page.goto(`/content/${submittedId}`);
  await page.getByRole('button', { name: /批\s*准/ }).click();
  await page.getByLabel('审核意见').fill('批准虚构内容');
  await page.getByRole('button', { name: /确\s*认/ }).click();
  await expect(page.getByLabel('审核摘要').getByText('已批准', { exact: true })).toBeVisible();

  const account = await command(page, '/api/v1/platform-accounts', csrf, { platform_profile_id: profile.id, label: `E2E 账号 ${suffix}`, account_identifier: `e2e-${suffix}` });
  const bytes = Buffer.from(`PartSignal E2E screenshot ${suffix}`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const upload = await command(page, '/api/v1/files/upload-intents', csrf, { category: 'OPERATION_SCREENSHOT', original_filename: 'e2e.txt.png', content_type: 'image/png', size: bytes.length, sha256: digest, access_level: 'INTERNAL' });
  const uploadInstruction = upload.upload as { url: string; headers: Record<string, string> };
  const uploadResponse = await page.request.put(uploadInstruction.url, {
    headers: uploadInstruction.headers,
    data: bytes,
  });
  expect(uploadResponse.status()).toBe(204);
  const file = await command(page, `/api/v1/files/${(upload.file as { id: string }).id}/complete`, csrf, undefined);
  const publication = await body<{ id: string }>(await page.request.post('/api/v1/publication-records/manual', { headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': `e2e-publication-${suffix}` }, data: { content_version_id: submittedId, platform_account_id: account.id, section_url: 'https://forum.example.invalid/board', attachment_file_ids: [file.id] } }));
  await command(page, `/api/v1/publication-records/${publication.id}/mark-platform-review`, csrf, { comment: '平台审核中' });
  await command(page, `/api/v1/publication-records/${publication.id}/mark-published`, csrf, { actual_title: `E2E ${suffix}`, final_url: `https://forum.example.invalid/posts/${suffix}`, published_at: new Date().toISOString(), content_matches: null, comment: '人工发布完成' });
  await command(page, `/api/v1/publication-records/${publication.id}/verify`, csrf, { actual_title: null, final_url: null, published_at: null, content_matches: true, comment: '人工核对一致' });
  const completedTask = await body<{ status: string }>(await page.request.get(`/api/v1/content-tasks/${task.id as string}`));
  expect(completedTask.status).toBe('COMPLETED');
  await page.goto('/publications');
  await page.getByRole('tab', { name: '发布记录' }).click();
  await expect(page.locator(`a[href="https://forum.example.invalid/posts/${suffix}"]`)).toBeVisible();

  await command(page, '/api/v1/geo-observations', csrf, { query_topic_id: topic.id, product_id: product!.id, actual_prompt: `${product!.part_number} 如何替代？`, model_name: 'E2E-DETERMINISTIC', model_version: 'v1', tested_at: new Date().toISOString(), web_search_enabled: true, answer_summary: '虚构 E2E 回答摘要', mentioned: true, recommendation: 'RECOMMENDED', accuracy: 'ACCURATE', citations: [{ url: `https://forum.example.invalid/posts/${suffix}`, source_type: 'EXTERNAL_COMPANY', publication_record_id: publication.id }], publication_record_ids: [publication.id], attachment_file_ids: [file.id], notes: '仅用于自动化验收', supersedes_id: null });
  const metrics = await body<{ sample_count: number; mention_rate: number }>(await page.request.get(`/api/v1/geo-metrics?product_id=${product!.id}`));
  expect(metrics.sample_count).toBe(1);
  expect(metrics.mention_rate).toBe(1);
  await page.goto('/observations');
  await expect(page.getByText('E2E-DETERMINISTIC').first()).toBeVisible();

  await page.goto(`/publications/${publication.id}`);
  await page.getByRole('button', { name: /标\s*记\s*已\s*移\s*除/ }).click();
  await page.getByLabel('说明').fill('E2E 页面已下线');
  await page.getByRole('button', { name: /确\s*认/, exact: true }).click();
  await expect(page.getByText('已移除').first()).toBeVisible();
  expect((await body<{ status: string }>(await page.request.get(`/api/v1/content-tasks/${task.id as string}`))).status).toBe('COMPLETED');
  const attentionList = await body<{ items: Array<{ id: string; publication_record_id: string; status: string; repair_task_id: string | null }> }>(await page.request.get('/api/v1/publication-attentions?status=OPEN'));
  const attention = attentionList.items.find((item) => item.publication_record_id === publication.id);
  expect(attention).toBeTruthy();
  await page.goto(`/publication-attentions/${attention!.id}`);
  await page.getByRole('button', { name: /创\s*建\s*修\s*复\s*任\s*务/ }).click();
  await page.getByRole('combobox', { name: '当前已批准事实版本' }).click();
  await page.getByText(/^V1 ·/).last().click();
  await page.getByRole('combobox', { name: '当前有效平台规则' }).click();
  await page.getByText(/^V1 ·/).last().click();
  await page.getByRole('button', { name: /创\s*建\s*修\s*复\s*任\s*务/ }).click();
  await expect(page.getByRole('heading', { name: '虚构参数与替代边界' })).toBeVisible();
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
  expect(historicalJob.input_snapshot.system_message).toContain('使用技术说明语气');
  const replacementType = await command(page, '/api/v1/platform-types', csrf, { name: `E2E 新类型 ${suffix}`, slug: `e2e-reclassified-${suffix}` });
  await body(await page.request.patch(`/api/v1/platform-profiles/${profile.id as string}`, { headers: { 'X-CSRF-Token': csrf }, data: { expected_revision: profile.revision, name: profile.name, allowed_domains: profile.allowed_domains, platform_type_id: replacementType.id } }));
  expect((await page.request.delete(`/api/v1/platform-types/${platformType.id as string}`, { headers: { 'X-CSRF-Token': csrf } })).status()).toBe(204);
  const historicalTask = await body<{ platform_type_id: string | null; platform_type_snapshot: { name: string } }>(await page.request.get(`/api/v1/content-tasks/${task.id as string}`));
  expect(historicalTask.platform_type_id).toBeNull();
  expect(historicalTask.platform_type_snapshot.name).toBe(`E2E 论坛类型 ${suffix}`);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天的内容链路' })).toBeVisible();
});
