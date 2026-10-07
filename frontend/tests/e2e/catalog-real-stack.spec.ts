/** GEO-106：页面写入真实 Catalog，产品事实与批准历史保持不变。 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page, type Response } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { createAuthTrafficScope, createRealStackRuntimeAudit, trafficExpectationErrors, type TrafficExpectation } from './real-stack-runtime';
import { registerCurrentRealStackCookies, registerRealStackLoginSecrets } from './real-stack-session';
import { registerArtifactSecrets } from './secret-artifact';

type Subject = components['schemas']['GeoSubjectOut'];
const apiBaseUrl = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const apiOrigin = new URL(apiBaseUrl).origin;
const catalogPath = '/api/v1/geo/subjects';
const catalogRoute = '/configuration/geo-entities';
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '只由隔离真实栈入口运行');
test.setTimeout(90_000);
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, apiBaseUrl));

async function body<T>(response: APIResponse | Response, status = 200): Promise<T> {
  // 失败只报告状态和路径，避免登录响应或任意正文进入日志。
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}

async function get<T>(page: Page, path: string): Promise<T> {
  return body<T>(await page.request.get(`${apiBaseUrl}${path}`));
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function factsSnapshot(page: Page, productId: string) {
  const product = await get<components['schemas']['Product']>(page, `/api/v1/products/${productId}`);
  // 新监测引用合法改变删除投影；其余产品身份/工作流及时间戳仍必须保持。
  const identity = {
    id: product.id, part_number: product.part_number, brand: product.brand,
    category: product.category, status: product.status, revision: product.revision,
    workflow_stage: product.workflow_stage, primary_task: product.primary_task,
    created_at: product.created_at, updated_at: product.updated_at,
  };
  return {
    identity,
    draft: await get<components['schemas']['ProductFactsDraft']>(page, `/api/v1/products/${productId}/facts`),
    versions: await get<components['schemas']['FactVersionList']>(page, `/api/v1/products/${productId}/fact-versions`),
    review: await get<components['schemas']['ProductFactReviewWorkspace']>(page, `/api/v1/products/${productId}/fact-review-context`),
  };
}

test('从已批准事实的 Product 建立唯一监测身份、竞品和字典，刷新及 ENGINEER 只读', async ({ page, browser }, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const partNumber = `GEO106-${suffix}`;
  const login = await body<components['schemas']['AuthSession']>(await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { username: 'admin', password: process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev' },
  }));
  await registerRealStackLoginSecrets(page.context(), apiBaseUrl, login.csrf_token);

  await page.goto('/products/new');
  await page.getByRole('textbox', { name: '产品型号' }).fill(partNumber);
  await page.getByRole('textbox', { name: '品牌', exact: true }).fill('虚构验收品牌');
  await page.getByRole('textbox', { name: '类别' }).fill('虚构验收类别');
  await page.getByRole('button', { name: '创建产品' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+$/i);
  const productId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('link', { name: '录入事实', exact: true }).click();
  await page.getByRole('textbox', { name: '事实 Markdown' }).fill(`# ${partNumber}\n\n- 虚构参数：保留批准原文`);
  await choose(page, '数据级别', '受限');
  await page.getByRole('button', { name: '保存事实' }).click();
  await expect(page.getByText(/已保存 · Revision \d+/)).toBeVisible();
  await page.getByRole('button', { name: '提交事实审核' }).click();
  const submit = page.getByRole('dialog', { name: '提交事实审核' });
  await submit.getByRole('textbox', { name: '变更摘要' }).fill('Catalog 验收前冻结虚构事实');
  await submit.getByRole('button', { name: '确认提交审核' }).click();
  await expect(submit).toBeHidden();
  await page.goto(`/products/${productId}/facts/review`);
  await page.getByRole('button', { name: '批准事实', exact: true }).click();
  await page.getByRole('dialog', { name: /批准事实版本 v\d+？/ }).getByRole('button', { name: '确认批准' }).click();
  await expect(page.getByText(/事实版本 v\d+ 已批准/).first()).toBeVisible();
  const before = await factsSnapshot(page, productId);
  expect(before.versions.items).toHaveLength(1);
  expect(before.versions.items[0].status).toBe('APPROVED');
  expect(before.review.review?.review_history.map((record) => record.action)).toEqual(['submit-review', 'approve']);

  let phase = 'catalog';
  const audit = createRealStackRuntimeAudit({
    apiOrigin, getPhase: () => phase,
    // 创建成功会取消并重新读取旧对象列表；只允许这三个已观测的 GET 取消。
    allowedCancellations: ['own', '竞品品牌', '竞品产品'].map((label) => ({
      phase: label, method: 'GET', origin: apiOrigin, pathname: catalogPath, reason: 'net::ERR_ABORTED',
    })),
    allowedHttpErrors: [{ phase: 'duplicate', method: 'POST', origin: apiOrigin, pathname: catalogPath, status: 409 }],
    allowedConsoleErrors: [{ phase: 'duplicate', text: 'Failed to load resource: the server responded with a status of 409 (Conflict)' }],
  });
  audit.watch(page);
  const expectations: TrafficExpectation[] = [];
  async function save(label: string, pathname: string, button: string, status: number): Promise<Response> {
    phase = label;
    expectations.push({ phase, origin: apiOrigin, pathname, method: 'POST', attempts: 1, responses: 1, status });
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === pathname && response.request().method() === 'POST');
    await page.getByRole('button', { name: button, exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(status);
    return response;
  }
  async function newNamed(type: string, name: string, parent?: string) {
    await page.getByRole('button', { name: '新建监测对象', exact: true }).click();
    await choose(page, '对象类型', type);
    await page.getByRole('textbox', { name: '规范名称', exact: true }).fill(name);
    await page.getByRole('textbox', { name: '显示名称', exact: true }).fill(name);
    if (parent) {
      await page.getByRole('searchbox', { name: '搜索父级品牌' }).fill(parent);
      await choose(page, '父级品牌', parent);
    }
    const result = await body<Subject>(await save(type, catalogPath, '创建监测对象', 201), 201);
    await expect(page).toHaveURL(new RegExp(`subject_id=${result.id}`));
    return result;
  }
  async function addDictionary(subject: Subject, alias: string, hostname: string, label: string) {
    const detail = page.getByRole('region', { name: '监测对象详情' });
    await detail.getByRole('button', { name: '新增别名' }).click();
    const form = page.getByRole('form', { name: '新增别名' });
    await form.getByRole('textbox', { name: '别名文本' }).fill(alias);
    await choose(page, '别名类型', '型号');
    await form.getByRole('textbox', { name: '语言标签' }).fill('zh-CN');
    await save(`${label}-alias`, `${catalogPath}/${subject.id}/aliases`, '保存别名', 200);
    await expect(form).toBeHidden();
    await detail.getByRole('button', { name: '新增域名' }).click();
    const domainForm = page.getByRole('form', { name: '新增域名' });
    await domainForm.getByRole('textbox', { name: '域名', exact: true }).fill(hostname);
    await choose(page, '域名关系', '官方域名');
    await save(`${label}-domain`, `${catalogPath}/${subject.id}/domains`, '保存域名', 200);
    await expect(domainForm).toBeHidden();
  }

  await page.goto(catalogRoute);
  await page.getByRole('button', { name: '新建监测对象', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索现有产品' }).fill(partNumber);
  await choose(page, '现有产品', `虚构验收品牌 ${partNumber}`);
  await page.getByRole('textbox', { name: '监测说明' }).fill('仅作为监测身份，事实仍在产品工作区维护');
  const own = await body<Subject>(await save('own', catalogPath, '创建监测对象', 201), 201);
  await expect(page).toHaveURL(new RegExp(`subject_id=${own.id}`));
  expect(own.product_id).toBe(productId);
  expect(own.canonical_name).toBe(partNumber);
  await addDictionary(own, `  ＰＳ-${suffix}  `, `产品-${suffix}.example.invalid`, 'own');
  const competitorBrand = await newNamed('竞品品牌', `虚构竞品品牌-${suffix}`);
  const competitor = await newNamed('竞品产品', `虚构竞品型号-${suffix}`, competitorBrand.display_name);
  await addDictionary(competitor, `PS-${suffix}`, `competitor-${suffix}.example.invalid`, 'competitor');

  const persisted = await get<Subject>(page, `${catalogPath}/${own.id}`);
  expect(persisted.revision).toBe(2);
  expect(persisted.aliases[0]).toMatchObject({ alias: `PS-${suffix}`, normalized_alias: `ps-${suffix}`, language_code: 'zh-cn', alias_kind: 'PART_NUMBER' });
  expect(persisted.domains[0]).toMatchObject({ hostname: new URL(`https://产品-${suffix}.example.invalid`).hostname, relation_type: 'OFFICIAL' });
  const storedCompetitor = await get<Subject>(page, `${catalogPath}/${competitor.id}`);
  expect(storedCompetitor.parent_subject_id).toBe(competitorBrand.id);
  expect(storedCompetitor.product_id).toBeNull();
  expect(storedCompetitor.aliases[0].normalized_alias).toBe(persisted.aliases[0].normalized_alias);
  expect(storedCompetitor.domains[0].hostname).toBe(`competitor-${suffix}.example.invalid`);
  // 路由预加载尚未完成时整页导航会取消静态资源；等本地有限请求结束再验收刷新。
  await page.waitForLoadState('networkidle');
  await page.goto(`${catalogRoute}?subject_id=${own.id}&q=${encodeURIComponent(partNumber)}`);
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(page.getByRole('region', { name: '监测对象详情' })).toContainText(persisted.domains[0].hostname);
  await expect(page.getByRole('region', { name: '监测对象列表' }).getByText(own.display_name, { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索名称、别名或域名' }).fill(`PS-${suffix}`);
  await page.getByRole('button', { name: '应用搜索' }).click();
  await expect(page.getByRole('region', { name: '监测对象列表' }).getByText(competitor.display_name, { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '搜索名称、别名或域名' })).toHaveValue(`PS-${suffix}`);
  await expect(page.getByRole('region', { name: '监测对象详情' })).toContainText(persisted.domains[0].hostname);
  await page.screenshot({ path: testInfo.outputPath('catalog-real-api.png'), fullPage: true });

  await page.getByRole('button', { name: '新建监测对象', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索现有产品' }).fill(partNumber);
  await choose(page, '现有产品', own.display_name);
  const duplicateNote = '重复绑定后的本地输入仍需保留';
  await page.getByRole('textbox', { name: '监测说明' }).fill(duplicateNote);
  const duplicateResponse = await save('duplicate', catalogPath, '创建监测对象', 409);
  const rejected = await body<components['schemas']['ErrorEnvelope']>(duplicateResponse, 409);
  expect(rejected.error.code).toBe('GEO_SUBJECT_PRODUCT_EXISTS');
  expect(rejected.error.request_id).toBe(await duplicateResponse.headerValue('X-Request-ID'));
  await expect(page.getByRole('textbox', { name: '监测说明' })).toHaveValue(duplicateNote);
  await expect(page.getByRole('combobox', { name: '现有产品' })).toContainText(own.display_name);
  const active = await get<components['schemas']['GeoSubjectListPage']>(page, `${catalogPath}?product_id=${productId}&is_active=true`);
  expect(active.total).toBe(1);
  expect(active.items[0].id).toBe(own.id);
  expect(await factsSnapshot(page, productId)).toEqual(before);
  const product = await get<components['schemas']['Product']>(page, `/api/v1/products/${productId}`);
  expect(product.deletion?.blockers).toContainEqual({ type: 'GEO_SUBJECT', count: 1 });
  expect(trafficExpectationErrors(audit.attempts, audit.responses, expectations, createAuthTrafficScope(apiOrigin))).toEqual([]);
  expect(audit.errors).toEqual([]);

  // 独立账号/会话作为只读验收前置，不修改共享 seed 工程师或 Catalog。
  const temporaryPassword = `Geo106-temp-${randomUUID()}`;
  const newPassword = `Geo106-final-${randomUUID()}`;
  await registerArtifactSecrets([temporaryPassword, newPassword]);
  const username = `geo106-${suffix}`;
  await body(await page.request.post(`${apiBaseUrl}/api/v1/users`, {
    headers: { 'X-CSRF-Token': login.csrf_token },
    data: { username, display_name: '虚构验收工程师', temporary_password: temporaryPassword, account_type: 'ENGINEER' } satisfies components['schemas']['UserCreate'],
  }), 201);
  const engineerContext = await browser.newContext();
  try {
    const engineer = await engineerContext.newPage();
    const session = await body<components['schemas']['AuthSession']>(await engineer.request.post(`${apiBaseUrl}/api/v1/auth/login`, { data: { username, password: temporaryPassword } }));
    await registerRealStackLoginSecrets(engineerContext, apiBaseUrl, session.csrf_token);
    const changed = await engineer.request.post(`${apiBaseUrl}/api/v1/auth/change-password`, {
      headers: { 'X-CSRF-Token': session.csrf_token },
      data: { old_password: temporaryPassword, new_password: newPassword } satisfies components['schemas']['ChangePasswordRequest'],
    });
    expect(changed.status()).toBe(204);
    await registerCurrentRealStackCookies(engineerContext, apiBaseUrl);
    const readonlyAudit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'engineer-read' });
    readonlyAudit.watch(engineer);
    await engineer.goto(`${catalogRoute}?subject_id=${own.id}`);
    await expect(engineer.getByText('当前为只读视图。监测对象、别名和域名由管理员维护。')).toBeVisible();
    await expect(engineer.getByRole('button', { name: /更多操作|新建监测对象|新增别名|新增域名/ })).toHaveCount(0);
    await engineer.goto(`${catalogRoute}?new=1`);
    await expect(engineer.getByText('当前账号没有创建监测对象的权限。')).toBeVisible();
    await expect(engineer.getByRole('form', { name: '新建监测对象' })).toHaveCount(0);
    expect(readonlyAudit.errors).toEqual([]);
  } finally {
    await registerCurrentRealStackCookies(engineerContext, apiBaseUrl);
    await engineerContext.close();
  }
});
