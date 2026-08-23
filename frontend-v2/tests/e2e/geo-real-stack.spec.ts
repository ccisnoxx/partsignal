/** 在唯一隔离真实栈中验证 GEO Observation 更正链与优化任务来源。 */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIResponse,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';

type AuthSession = components['schemas']['AuthSession'];
type ContentTask = components['schemas']['ContentTask'];
type ContentTaskDetail = components['schemas']['ContentTaskDetail'];
type ContentVersion = components['schemas']['ContentVersion'];
type FactVersion = components['schemas']['FactVersion'];
type FileRecord = components['schemas']['FileRecord'];
type GeoInsights = components['schemas']['GeoInsights'];
type GeoObservationCreate = components['schemas']['GeoObservationCreate'];
type GeoObservationListPage = components['schemas']['GeoObservationListPage'];
type ManualGeoObservation = components['schemas']['ManualGeoObservation'];
type ManualGeoObservationDetail = components['schemas']['ManualGeoObservationDetail'];
type PlatformAccount = components['schemas']['PlatformAccount'];
type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformType = components['schemas']['PlatformType'];
type Product = components['schemas']['Product'];
type ProductFactsDraft = components['schemas']['ProductFactsDraft'];
type PublicationWork = components['schemas']['PublicationWork'];
type PublishedArticle = components['schemas']['PublishedArticle'];
type QueryTopic = components['schemas']['QueryTopic'];
type UploadIntent = components['schemas']['UploadIntent'];

const realStackEnabled = process.env.PARTSIGNAL_E2E_REAL_STACK === '1';
const apiBaseUrl = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';
const browserErrors = new WeakMap<Page, string[]>();

test.skip(!realStackEnabled, '只由隔离真实栈入口运行');
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`requestfailed: ${request.method()} ${request.url()}`);
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), 'GEO 真实栈不得产生未处理浏览器错误').toEqual([]);
});

async function responseBody<T>(response: APIResponse | Response): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `真实 E2E API 请求失败：${response.status()} ${response.url()} ${await response.text()}`,
    );
  }
  return response.json() as Promise<T>;
}

async function login(page: Page) {
  return responseBody<AuthSession>(await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { username: 'admin', password },
  }));
}

async function createGeoPrerequisites(
  page: Page,
  csrfToken: string,
  suffix: string,
) {
  const headers = { 'X-CSRF-Token': csrfToken };
  const platformType = await responseBody<PlatformType>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-types`,
    {
      data: { name: `GEO E2E-${suffix}`, slug: `geo-e2e-${suffix}` },
      headers,
    },
  ));
  const domain = `${suffix}.example.invalid`;
  const platform = await responseBody<PlatformProfile>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-profiles`,
    {
      data: {
        name: `GEO E2E-${suffix}`,
        slug: `geo-e2e-${suffix}`,
        allowed_domains: [domain],
        platform_type_id: platformType.id,
        platform_prompt_id: null,
        website_url: `https://${domain}`,
      },
      headers,
    },
  ));
  const account = await responseBody<PlatformAccount>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-accounts`,
    {
      data: {
        platform_profile_id: platform.id,
        label: `GEO 账号 ${suffix}`,
        account_identifier: `geo-${suffix}`,
      },
      headers,
    },
  ));
  const product = await responseBody<Product>(await page.request.post(
    `${apiBaseUrl}/api/v1/products`,
    {
      data: {
        part_number: `GEO-${suffix}`,
        brand: 'PartSignal E2E',
        category: 'GEO',
      },
      headers,
    },
  ));
  const draft = await responseBody<ProductFactsDraft>(await page.request.get(
    `${apiBaseUrl}/api/v1/products/${product.id}/facts`,
  ));
  const savedDraft = await responseBody<ProductFactsDraft>(await page.request.put(
    `${apiBaseUrl}/api/v1/products/${product.id}/facts`,
    {
      data: {
        expected_revision: draft.revision,
        body_markdown: `# ${product.part_number}\n\n- GEO 真实栈事实：${suffix}`,
        classification: 'PUBLIC',
      },
      headers,
    },
  ));
  const pendingFact = await responseBody<FactVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/products/${product.id}/fact-review-submissions`,
    {
      data: { expected_revision: savedDraft.revision, change_summary: `提交 GEO 事实 ${suffix}` },
      headers,
    },
  ));
  const approvedFact = await responseBody<FactVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/fact-versions/${pendingFact.id}/approve`,
    {
      data: { expected_revision: pendingFact.revision, comment: `批准 GEO 事实 ${suffix}` },
      headers,
    },
  ));
  const task = await responseBody<ContentTask>(await page.request.post(
    `${apiBaseUrl}/api/v1/content-tasks`,
    {
      data: {
        product_id: product.id,
        fact_version_id: approvedFact.id,
        platform_profile_id: platform.id,
      },
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
    },
  ));
  const draftContent = await responseBody<ContentVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/content-tasks/${task.id}/manual-versions`,
    {
      data: {
        title: `${product.part_number} GEO 指南`,
        summary: `GEO 真实栈摘要 ${suffix}`,
        body_markdown: `# ${product.part_number} GEO 指南\n\n用于隔离真实栈验收。`,
        tags: ['GEO', '真实栈'],
        change_summary: `创建 GEO 发布稿 ${suffix}`,
      },
      headers,
    },
  ));
  const pendingContent = await responseBody<ContentVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/content-versions/${draftContent.id}/submit-review`,
    {
      data: { expected_revision: draftContent.revision, comment: `提交 GEO 发布稿 ${suffix}` },
      headers,
    },
  ));
  const approvedContent = await responseBody<ContentVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/content-versions/${pendingContent.id}/approve`,
    {
      data: { expected_revision: pendingContent.revision, comment: `批准 GEO 发布稿 ${suffix}` },
      headers,
    },
  ));
  const work = await responseBody<PublicationWork>(await page.request.post(
    `${apiBaseUrl}/api/v1/publication-works`,
    {
      data: { content_version_id: approvedContent.id, platform_account_id: account.id },
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
    },
  ));
  const actualTitle = `${approvedContent.title} · ${suffix}`;
  const finalUrl = `https://${domain}/articles/${suffix}`;
  const registered = await responseBody<PublicationWork>(await page.request.put(
    `${apiBaseUrl}/api/v1/publication-works/${work.id}/result`,
    {
      data: {
        actual_title: actualTitle,
        final_url: finalUrl,
        published_at: '2026-05-01T08:00:00Z',
        expected_revision: work.revision,
        comment: `登记 GEO 发布成果 ${suffix}`,
        attachment_file_ids: [],
      },
      headers,
    },
  ));
  await responseBody<PublicationWork>(await page.request.post(
    `${apiBaseUrl}/api/v1/publication-works/${work.id}/verifications`,
    {
      data: {
        outcome: 'PASSED',
        content_matches: true,
        expected_revision: registered.revision,
        comment: `核验 GEO 发布成果 ${suffix}`,
      },
      headers,
    },
  ));
  const article = await responseBody<PublishedArticle>(await page.request.get(
    `${apiBaseUrl}/api/v1/published-articles/${work.id}`,
  ));
  const topic = await responseBody<QueryTopic>(await page.request.post(
    `${apiBaseUrl}/api/v1/query-topics`,
    {
      data: {
        canonical_question: `如何验证 ${product.part_number} 的 GEO 表现？`,
        intent_type: 'PRODUCT',
        variants: [`${product.part_number} GEO`],
      },
      headers,
    },
  ));

  return { account, approvedFact, article, platform, product, topic };
}

async function chooseSelect(
  page: Page,
  trigger: ReturnType<Page['getByRole']>,
  option: string,
) {
  await trigger.click();
  const item = page.locator('[role="listbox"]:visible')
    .getByRole('option', { name: option, exact: true });
  await expect(item).toBeVisible();
  await item.press('Enter');
  await expect(page.locator('[role="listbox"]:visible')).toHaveCount(0);
}

async function uploadEvidence(page: Page, filename: string) {
  const [intentResponse, transferRequest, completeResponse] = await Promise.all([
    page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/files/upload-intents'
    )),
    page.waitForRequest((request) => (
      request.method() === 'PUT'
      && new URL(request.url()).port === (process.env.PARTSIGNAL_E2E_STORAGE_PORT ?? '19009')
    )),
    page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && /^\/api\/v1\/files\/[^/]+\/complete$/.test(new URL(response.url()).pathname)
    )),
    page.getByLabel('上传 GEO 证据截图').setInputFiles({
      name: filename,
      mimeType: 'image/png',
      buffer: Buffer.from(`PartSignal GEO evidence ${filename}`),
    }),
  ]);
  const intent = await responseBody<UploadIntent>(intentResponse);
  const file = await responseBody<FileRecord>(completeResponse);
  expect(intent.upload.method).toBe('PUT');
  expect(transferRequest.url()).toBe(intent.upload.url);
  expect(file).toMatchObject({
    id: intent.file.id,
    original_filename: filename,
    status: 'VERIFIED',
  });
  await expect(page.getByText(filename)).toBeVisible();
  return file;
}

function manualDetail(value: components['schemas']['GeoObservationDetail']) {
  expect(value.observation_kind).toBe('MANUAL_ARTICLE_SEARCH');
  return value as ManualGeoObservationDetail;
}

function recordOptimizationRequests(
  request: Request,
  optionRequests: string[],
  createRequests: Array<{ body: unknown; key: string | undefined }>,
) {
  const url = new URL(request.url());
  if (request.method() === 'GET' && url.pathname === '/api/v1/content-tasks/creation-options') {
    optionRequests.push(url.toString());
  }
  if (
    request.method() === 'POST'
    && url.pathname === '/api/v1/geo-insights/optimization-content-tasks'
  ) {
    createRequests.push({
      body: request.postDataJSON(),
      key: request.headers()['idempotency-key'],
    });
  }
}

test('Flow A：新建 Observation 后追加 Correction，原记录保持不可变', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const setup = await createGeoPrerequisites(page, session.csrf_token, suffix);
  const productOptionLabel = `${setup.product.brand} · ${setup.product.part_number}`;
  const productDetailLabel = `${setup.product.brand} ${setup.product.part_number}`;
  const rootQuery = `GEO 原始搜索 ${suffix}`;
  const rootNotes = `GEO 原始备注 ${suffix}`;
  const correctionNotes = `GEO 更正原因 ${suffix}`;

  await page.goto('/geo/observations/new');
  await page.getByLabel('搜索产品').fill(setup.product.part_number);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await chooseSelect(
    page,
    page.getByRole('combobox', { name: 'Product' }),
    productOptionLabel,
  );
  await chooseSelect(
    page,
    page.getByRole('combobox', { name: 'Query Topic' }),
    setup.topic.canonical_question,
  );
  await expect(page.getByRole('group', { name: setup.article.actual_title })).toBeVisible();
  await page.getByLabel('GEO platform').fill('Perplexity');
  await page.getByLabel('观测时间').fill('2026-08-12T10:15');
  await page.getByLabel('实际搜索问题').fill(rootQuery);
  const rootArticle = page.getByRole('group', { name: setup.article.actual_title });
  await chooseSelect(page, rootArticle.getByRole('combobox', { name: '是否发现' }), '是');
  await chooseSelect(page, rootArticle.getByRole('combobox', { name: '是否提及' }), '否');
  await chooseSelect(page, rootArticle.getByRole('combobox', { name: '准确性' }), '部分准确');
  const rootFile = await uploadEvidence(page, `geo-root-${suffix}.png`);
  await page.getByLabel('Notes').fill(rootNotes);

  const rootResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/v1/geo-observations'
  ));
  await page.getByRole('button', { name: '创建 Observation' }).click();
  const root = await responseBody<ManualGeoObservation>(await rootResponsePromise);
  await expect(page).toHaveURL(`/geo/observations/${root.id}`);
  await expect(page.getByRole('heading', { level: 1, name: rootQuery })).toBeVisible();
  await expect(page.getByText(setup.topic.canonical_question).first()).toBeVisible();
  await expect(page.getByText(productDetailLabel).first()).toBeVisible();
  await expect(page.getByText('Perplexity').first()).toBeVisible();
  await expect(page.getByText(setup.article.actual_title).first()).toBeVisible();
  await expect(page.getByRole('link', { name: rootFile.original_filename }).first()).toBeVisible();
  await expect(page.getByText(rootNotes).first()).toBeVisible();
  await expect(page.getByText(root.recorder.display_name).first()).toBeVisible();
  await expect(page.locator(`time[datetime="${root.tested_at}"]`).first()).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
  const geoIssueCard = page.locator('[data-workbench-count="geo_accuracy_issues"]');
  const rootIssueCount = Number(await geoIssueCard.locator('p').nth(1).textContent());
  expect(rootIssueCount).toBeGreaterThan(0);
  await expect(geoIssueCard.getByRole('link', { name: '部分准确' })).toHaveAttribute(
    'href',
    '/geo/observations?accuracy=PARTIAL&page=1&pageSize=20',
  );
  await expect(geoIssueCard.getByRole('link', { name: '不准确' })).toHaveAttribute(
    'href',
    '/geo/observations?accuracy=INCORRECT&page=1&pageSize=20',
  );
  const rootAttention = page.locator('.workbench-attention-link').filter({ hasText: rootQuery });
  await expect(rootAttention).toHaveCount(1);
  await expect(rootAttention).toHaveAttribute('href', `/geo/observations/${root.id}`);
  const discoveryRate = page.getByText('发现率', { exact: true }).locator('..');
  const mentionRate = page.getByText('提及率', { exact: true }).locator('..');
  const accuracyRate = page.getByText('准确率', { exact: true }).locator('..');
  await expect(discoveryRate).toContainText('100%');
  await expect(discoveryRate).toContainText('1 / 1');
  await expect(mentionRate).toContainText('0%');
  await expect(mentionRate).toContainText('0 / 1');
  await expect(accuracyRate).toContainText('0%');
  await expect(accuracyRate).toContainText('0 / 1');
  await rootAttention.click();
  await expect(page).toHaveURL(`/geo/observations/${root.id}`);
  await expect(page.getByRole('heading', { level: 1, name: rootQuery })).toBeVisible();
  await page.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '更正' }).click();
  await expect(page).toHaveURL(`/geo/observations/${root.id}/correct`);
  await expect(page.getByRole('heading', { level: 1, name: '更正 GEO Observation' })).toBeVisible();
  await expect(page.getByText(productDetailLabel).first()).toBeVisible();
  await expect(page.getByText(setup.topic.canonical_question).first()).toBeVisible();
  await expect(page.getByText('Perplexity').first()).toBeVisible();
  await expect(page.getByText(rootQuery).first()).toBeVisible();
  await expect(page.getByRole('textbox', {
    name: /Product|Query Topic|GEO platform|Search query/,
  })).toHaveCount(0);

  await page.getByLabel('本次观测时间').fill('2026-08-13T11:45');
  const correctionArticle = page.getByRole('group', { name: setup.article.actual_title });
  await chooseSelect(
    page,
    correctionArticle.getByRole('combobox', { name: '是否发现' }),
    '否',
  );
  await chooseSelect(
    page,
    correctionArticle.getByRole('combobox', { name: '是否提及' }),
    '否',
  );
  await chooseSelect(
    page,
    correctionArticle.getByRole('combobox', { name: '准确性' }),
    '无法判断',
  );
  const correctionFile = await uploadEvidence(page, `geo-correction-${suffix}.png`);
  await page.getByLabel('更正原因 / Notes').fill(correctionNotes);

  const correctionResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/v1/geo-observations'
  ));
  await page.getByRole('button', { name: '追加 Correction' }).click();
  const correction = await responseBody<ManualGeoObservation>(await correctionResponsePromise);
  expect(correction.supersedes_id).toBe(root.id);
  expect(correction.attachment_file_ids).toEqual([rootFile.id, correctionFile.id]);
  await expect(page).toHaveURL(`/geo/observations/${correction.id}`);
  await expect(page.getByText('原记录', { exact: true })).toBeVisible();
  await expect(page.getByText('更正 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: rootFile.original_filename }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: correctionFile.original_filename }).first())
    .toBeVisible();
  await expect(page.getByText(rootNotes).first()).toBeVisible();
  await expect(page.getByText(correctionNotes).first()).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
  const correctedGeoIssueCard = page.locator('[data-workbench-count="geo_accuracy_issues"]');
  expect(Number(await correctedGeoIssueCard.locator('p').nth(1).textContent()))
    .toBe(rootIssueCount - 1);
  await expect(page.locator('.workbench-attention-link').filter({ hasText: rootQuery }))
    .toHaveCount(0);
  const correctedDiscoveryRate = page.getByText('发现率', { exact: true }).locator('..');
  const correctedMentionRate = page.getByText('提及率', { exact: true }).locator('..');
  const correctedAccuracyRate = page.getByText('准确率', { exact: true }).locator('..');
  await expect(correctedDiscoveryRate).toContainText('0%');
  await expect(correctedDiscoveryRate).toContainText('0 / 1');
  await expect(correctedMentionRate).toContainText('0%');
  await expect(correctedMentionRate).toContainText('0 / 1');
  await expect(correctedAccuracyRate.getByText('暂无数据', { exact: true })).toBeVisible();
  await expect(correctedAccuracyRate).toContainText('0 / 0');
  await expect(correctedAccuracyRate.getByText('0%', { exact: true })).toHaveCount(0);
  await page.goto(`/geo/observations?productId=${setup.product.id}&page=1&pageSize=20`);
  const tailLink = page.getByRole('link', { name: setup.topic.canonical_question });
  await expect(tailLink).toHaveCount(1);
  await expect(tailLink).toHaveAttribute(
    'href',
    `/geo/observations/${correction.id}`,
  );

  await page.goto(`/geo/observations/${root.id}`);
  await expect(page.getByText('历史记录', { exact: true })).toBeVisible();
  await expect(page.getByText(rootNotes).first()).toBeVisible();
  await expect(page.getByText(correctionNotes)).toHaveCount(1);
  await expect(page.getByRole('link', { name: rootFile.original_filename }).first()).toBeVisible();

  const rootDetail = manualDetail(await responseBody(
    await page.request.get(`${apiBaseUrl}/api/v1/geo-observations/${root.id}/detail`),
  ));
  const tailDetail = manualDetail(await responseBody(
    await page.request.get(`${apiBaseUrl}/api/v1/geo-observations/${correction.id}/detail`),
  ));
  const list = await responseBody<GeoObservationListPage>(await page.request.get(
    `${apiBaseUrl}/api/v1/geo-observations/list-items`,
    { params: { product_id: setup.product.id, page: 1, page_size: 20 } },
  ));
  const rootNode = rootDetail.correction_history[0]!;
  const tailNode = tailDetail.correction_history[1]!;
  expect(rootDetail).toMatchObject({
    selected_observation_id: root.id,
    chain_root_id: root.id,
    chain_tail_id: correction.id,
  });
  expect(tailDetail).toMatchObject({
    selected_observation_id: correction.id,
    chain_root_id: root.id,
    chain_tail_id: correction.id,
  });
  expect(tailDetail.correction_history.map((item) => item.observation.id))
    .toEqual([root.id, correction.id]);
  expect(rootNode.observation).toMatchObject({
    id: root.id,
    tested_at: root.tested_at,
    article_results: root.article_results,
    attachment_file_ids: [rootFile.id],
    notes: rootNotes,
    recorder: root.recorder,
    supersedes_id: null,
  });
  expect(rootNode.evidence.map((item) => item.file.id)).toEqual([rootFile.id]);
  expect(tailNode.observation).toMatchObject({
    id: correction.id,
    tested_at: correction.tested_at,
    article_results: correction.article_results,
    attachment_file_ids: [rootFile.id, correctionFile.id],
    notes: correctionNotes,
    supersedes_id: root.id,
  });
  expect(tailNode.evidence.map((item) => item.file.id)).toEqual([correctionFile.id]);
  expect(list.items.filter((item) => item.product.id === setup.product.id).map((item) => item.id))
    .toEqual([correction.id]);
});

test('Flow B：真实 Insights 复算异常并创建带不可变 GEO 来源的优化任务', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const setup = await createGeoPrerequisites(page, session.csrf_token, suffix);
  const headers = { 'X-CSRF-Token': session.csrf_token };
  for (let index = 0; index < 3; index += 1) {
    for (const sample of [
      { date: `2026-06-${10 + index}T08:00:00Z`, hit: true },
      { date: `2026-07-${10 + index}T08:00:00Z`, hit: false },
    ]) {
      const body = {
        product_id: setup.product.id,
        query_topic_id: setup.topic.id,
        search_platform: 'Perplexity',
        search_query: `GEO 洞察样本 ${suffix}`,
        tested_at: sample.date,
        article_results: [{
          published_article_id: setup.article.id,
          discovered: sample.hit,
          mentioned: sample.hit,
          accuracy: 'ACCURATE',
        }],
        attachment_file_ids: [],
        notes: `GEO 洞察样本 ${sample.date}`,
      } satisfies GeoObservationCreate;
      await responseBody<ManualGeoObservation>(await page.request.post(
        `${apiBaseUrl}/api/v1/geo-observations`,
        { data: body, headers },
      ));
    }
  }

  const optionRequests: string[] = [];
  const createRequests: Array<{ body: unknown; key: string | undefined }> = [];
  page.on('request', (request) => recordOptimizationRequests(
    request,
    optionRequests,
    createRequests,
  ));
  const insightsResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/v1/geo-insights'
  ));
  const insightsUrl = new URL('/geo/insights', 'http://127.0.0.1');
  insightsUrl.searchParams.set('from', '2026-07-01');
  insightsUrl.searchParams.set('to', '2026-07-31');
  insightsUrl.searchParams.set('productId', setup.product.id);
  insightsUrl.searchParams.set('contentPlatformId', setup.platform.id);
  insightsUrl.searchParams.set('publishedArticleId', setup.article.id);
  await page.goto(`${insightsUrl.pathname}${insightsUrl.search}`);
  const insights = await responseBody<GeoInsights>(await insightsResponsePromise);
  const decline = insights.content_rankings.declining.find(
    (item) => item.published_article_id === setup.article.id,
  );
  expect(decline).toBeDefined();
  expect(decline?.optimization_action).toEqual({
    rule_code: 'CONTENT_DECLINE',
    date_from: '2026-07-01',
    date_to: '2026-07-31',
    published_article_id: setup.article.id,
    query_topic_id: null,
    geo_platform: null,
  });
  expect(decline?.basis).toEqual(expect.arrayContaining([
    expect.objectContaining({ metric: 'discovery_rate', decline: 1 }),
    expect.objectContaining({ metric: 'mention_rate', decline: 1 }),
  ]));

  const declineRegion = page.getByRole('region', { name: '下降内容' });
  const declineRow = declineRegion.getByRole('row').filter({
    hasText: setup.article.actual_title,
  });
  await expect(declineRow).toContainText('0%');
  await expect(declineRow.getByRole('button', { name: '创建优化任务' })).toBeVisible();
  expect(optionRequests).toEqual([]);
  await declineRow.getByRole('button', { name: '创建优化任务' }).click();
  const dialog = page.getByRole('dialog', { name: '创建 GEO 优化任务' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => optionRequests.length).toBe(1);
  await expect(dialog.getByRole('combobox', { name: '产品' }))
    .toContainText(`${setup.product.brand} · ${setup.product.part_number}`);
  await expect(dialog.getByRole('combobox', { name: '目标平台' }))
    .toContainText(setup.platform.name);
  await dialog.getByRole('combobox', { name: '已批准事实版本' }).click();
  await page.getByRole('option', {
    name: `v${setup.approvedFact.version} · ${setup.approvedFact.classification}`,
  }).click();

  const createResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/v1/geo-insights/optimization-content-tasks'
  ));
  await dialog.getByRole('button', { name: '创建任务' }).dblclick();
  const task = await responseBody<ContentTask>(await createResponsePromise);
  await expect(page).toHaveURL(`/content/tasks/${task.id}`);
  expect(createRequests).toHaveLength(1);
  expect(createRequests[0]?.key).toBeTruthy();
  expect(createRequests[0]?.body).toEqual({
    ...decline?.optimization_action,
    product_id: setup.product.id,
    platform_profile_id: setup.platform.id,
    fact_version_id: setup.approvedFact.id,
  });

  await expect(page.getByRole('heading', { level: 1, name: /^CT-/ })).toBeVisible();
  await expect(page.getByRole('link', { name: `${setup.product.brand} · ${setup.product.part_number}` }))
    .toBeVisible();
  await expect(page.getByRole('link', { name: `v${setup.approvedFact.version} · 已批准` }))
    .toBeVisible();
  await expect(page.getByRole('link', { name: setup.platform.name })).toBeVisible();
  await expect(page.getByText('GEO Optimization')).toBeVisible();
  await expect(page.getByText('内容表现下降')).toBeVisible();
  await expect(page.getByText('2026-07-01 至 2026-07-31')).toBeVisible();
  await expect(page.getByText(`${setup.article.actual_title} · ${setup.platform.name}`))
    .toBeVisible();

  const detail = await responseBody<ContentTaskDetail>(await page.request.get(
    `${apiBaseUrl}/api/v1/content-tasks/${task.id}/detail`,
  ));
  expect(detail.task.id).toBe(task.id);
  expect(detail.product.id).toBe(setup.product.id);
  expect(detail.platform.id).toBe(setup.platform.id);
  expect(detail.fact.id).toBe(setup.approvedFact.id);
  expect(detail.source?.geo_optimization).toEqual({
    rule_code: 'CONTENT_DECLINE',
    date_from: '2026-07-01',
    date_to: '2026-07-31',
    published_article_id: setup.article.id,
    geo_platform: null,
    basis: {
      rule_code: 'CONTENT_DECLINE',
      item: {
        title: setup.article.actual_title,
        content_platform: setup.platform.name,
      },
    },
  });
});
