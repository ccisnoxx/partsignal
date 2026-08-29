import type { Page } from '@playwright/test';

import {
  candidates,
  createdObservationId,
  expect,
  fileRecord,
  product,
  test,
  topic,
} from './fixtures/new-geo.fixture';

const canonicalList = '/geo/observations?page=1&pageSize=20';
const canonicalDetail = `/geo/observations/${createdObservationId}`;
const newRoute = '/geo/observations/new';

async function showPanel(page: Page, name: '逐篇观测结果' | '观测上下文' | '证据与备注') {
  if ((page.viewportSize()?.width ?? 1440) < 1280) {
    await page.getByRole('tab', { name }).click();
  }
}

async function chooseSelect(page: Page, trigger: ReturnType<Page['getByRole']>, option: string) {
  await trigger.click();
  const item = page.locator('[role="listbox"]:visible').getByRole('option', { name: option, exact: true });
  await expect(item).toBeVisible();
  await item.press('Enter');
  await expect(page.locator('[role="listbox"]:visible')).toHaveCount(0);
}

async function selectOption(page: Page, label: string, option: string) {
  await chooseSelect(page, page.getByRole('combobox', { name: label }), option);
}

async function chooseContext(page: Page) {
  await showPanel(page, '观测上下文');
  await selectOption(page, 'Product', `${product.brand} · ${product.part_number}`);
  await selectOption(page, 'Query Topic', topic.canonical_question);
  await showPanel(page, '逐篇观测结果');
  await expect(page.getByRole('group', { name: candidates[0].title })).toBeVisible();
}

async function fillObservation(page: Page, includeContext = true) {
  if (includeContext) await chooseContext(page);
  await showPanel(page, '观测上下文');
  await page.getByLabel('GEO platform').fill('  DeepSeek  ');
  await page.getByLabel('观测时间').fill('2026-08-12T16:30');
  await showPanel(page, '逐篇观测结果');
  await page.getByLabel('实际搜索问题').fill('  如何选择低噪声放大器？  ');
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const group = page.getByRole('group', { name: candidate.title });
    await chooseSelect(page, group.getByRole('combobox', { name: '是否发现' }), index === 0 ? '是' : '否');
    await chooseSelect(page, group.getByRole('combobox', { name: '是否提及' }), index === 0 ? '否' : '是');
  }
  const first = page.getByRole('group', { name: candidates[0].title });
  await chooseSelect(page, first.getByRole('combobox', { name: '准确性' }), '部分准确');
  await showPanel(page, '证据与备注');
  await page.getByLabel('Notes').fill('人工复核完成');
}

test('列表 Primary、直接访问和刷新都进入 canonical 创建 Workspace', async ({ page }) => {
  await page.goto(canonicalList);
  await page.getByRole('link', { name: '新建 Observation' }).click();
  await expect(page).toHaveURL(newRoute);
  await expect(page.getByRole('heading', { level: 1, name: '新建 GEO Observation' })).toBeVisible();
  await expect(page.getByRole('region', { name: '新建 GEO Observation 工作区' })).toBeVisible();
  await expect(page.getByText('recommendation')).toHaveCount(0);
  await expect(page.getByText('citation')).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(newRoute);
  await expect(page.getByRole('navigation', { name: '面包屑' })).toContainText('新建 Observation');
});

test('queryTopicId 与 geoPlatform handoff 支持 direct URL 与刷新，不存在 Topic 时明确阻止提交', async ({ page }) => {
  const handoff = `${newRoute}?queryTopicId=${topic.id}&geoPlatform=DeepSeek`;
  await page.goto(handoff);
  await showPanel(page, '观测上下文');
  await expect(page.getByRole('combobox', { name: 'Query Topic' })).toContainText(
    topic.canonical_question,
  );
  await expect(page.getByLabel('GEO platform')).toHaveValue('DeepSeek');
  await page.reload();
  await expect(page).toHaveURL(handoff);
  await showPanel(page, '观测上下文');
  await expect(page.getByRole('combobox', { name: 'Query Topic' })).toContainText(
    topic.canonical_question,
  );
  await expect(page.getByLabel('GEO platform')).toHaveValue('DeepSeek');

  const missing = '40000000-0000-4000-8000-000000000099';
  await page.goto(`${newRoute}?queryTopicId=${missing}`);
  await showPanel(page, '观测上下文');
  await expect(page.getByRole('alert')).toContainText(`URL 指定的 Query Topic 不存在：${missing}`);
  await expect(page.getByRole('button', { name: '创建 Observation' })).toBeDisabled();
});

test('候选 loading 诚实可见且阻止创建', async ({ page, newGeoApi }) => {
  newGeoApi.setCandidateMode('loading');
  await page.goto(newRoute);
  await showPanel(page, '观测上下文');
  await selectOption(page, 'Product', `${product.brand} · ${product.part_number}`);
  await showPanel(page, '逐篇观测结果');
  await expect(page.getByText('正在读取权威 Published Article 候选…')).toBeVisible();
  await expect(page.getByRole('button', { name: '创建 Observation' })).toBeDisabled();
  newGeoApi.releaseCandidates();
  await expect(page.getByRole('group', { name: candidates[0].title })).toBeVisible();
});

test('候选 empty 提供可用出口且阻止创建', async ({ page, newGeoApi }) => {
  newGeoApi.setCandidateMode('empty');
  await page.goto(newRoute);
  await showPanel(page, '观测上下文');
  await selectOption(page, 'Product', `${product.brand} · ${product.part_number}`);
  await showPanel(page, '逐篇观测结果');
  await expect(page.getByText('该 Product 当前没有符合 GEO 资格的 Published Article')).toBeVisible();
  await expect(page.getByRole('link', { name: '查看 Published Articles' })).toHaveAttribute(
    'href',
    '/publishing/articles?page=1&pageSize=20',
  );
});

test('客户端校验显式事实；上传后 POST 防重复并 canonical handoff', async ({
  page,
  geoApi,
  newGeoApi,
}) => {
  await page.goto(newRoute);
  await chooseContext(page);
  await showPanel(page, '观测上下文');
  await page.getByLabel('GEO platform').fill('   ');
  await page.getByRole('button', { name: '创建 Observation' }).click();
  await expect(page.getByRole('alert', { name: 'GEO Observation 尚未创建' })).toContainText('请填写 GEO 平台');
  await expect(page.getByRole('alert', { name: 'GEO Observation 尚未创建' })).toContainText('请选择是否发现');
  expect(newGeoApi.createRequests).toEqual([]);

  await fillObservation(page, false);
  await showPanel(page, '证据与备注');
  await page.getByLabel('上传 GEO 证据截图').setInputFiles({
    name: 'geo-proof.png',
    mimeType: 'image/png',
    buffer: Buffer.from('evidence'),
  });
  await expect(page.getByText('geo-proof.png')).toBeVisible();
  expect(newGeoApi.uploadRequests).toEqual([
    '/api/v1/files/upload-intents',
    'PUT /geo-proof',
    `/api/v1/files/${fileRecord.id}/complete`,
  ]);

  newGeoApi.setCreateMode('pending');
  await page.getByRole('button', { name: '创建 Observation' }).dblclick();
  await expect.poll(() => newGeoApi.createRequests.length).toBe(1);
  const request = newGeoApi.createRequests[0]!;
  expect(request.csrfToken).toBe('geo-e2e-csrf');
  expect(request.idempotencyKey).toBeNull();
  expect(request.body).toMatchObject({
    product_id: product.id,
    query_topic_id: topic.id,
    search_platform: 'DeepSeek',
    search_query: '如何选择低噪声放大器？',
    attachment_file_ids: [fileRecord.id],
    notes: '人工复核完成',
    article_results: [
      { published_article_id: candidates[0].published_article_id, discovered: true, mentioned: false, accuracy: 'PARTIAL' },
      { published_article_id: candidates[1].published_article_id, discovered: false, mentioned: true, accuracy: null },
    ],
  });
  expect(request.body).not.toHaveProperty('supersedes_id');
  expect(request.body).not.toHaveProperty('recommendation');
  expect(request.body).not.toHaveProperty('citation');
  await expect(page.getByRole('button', { name: '创建中…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '取消' })).toBeDisabled();

  newGeoApi.releaseCreate();
  await expect(page).toHaveURL(canonicalDetail);
  await expect(page.getByRole('heading', { name: '如何选择低噪声放大器？' })).toBeVisible();
  expect(newGeoApi.detailRequests).toHaveLength(1);
  expect(geoApi.listRequests.some(
    (request) => request.searchParams.get('search') === createdObservationId,
  )).toBe(false);
  await expect(page.getByRole('dialog', { name: '要离开当前页面吗？' })).toHaveCount(0);
});

test('候选冲突不重放创建，显式刷新后保留输入并允许人工重试', async ({ page, newGeoApi }) => {
  newGeoApi.setCreateMode('conflict');
  await page.goto(newRoute);
  await fillObservation(page);
  await page.getByRole('button', { name: '创建 Observation' }).click();

  await expect(page.getByRole('alert', { name: 'GEO Observation 尚未创建' })).toContainText('Published Article 候选已经变化');
  await expect(page.getByRole('alert', { name: 'GEO Observation 尚未创建' })).toContainText('req-geo-create');
  expect(newGeoApi.createRequests).toHaveLength(1);
  await expect(page.getByRole('button', { name: '创建 Observation' })).toBeDisabled();

  newGeoApi.setCreateMode('success');
  await page.getByRole('button', { name: '重新读取候选' }).click();
  await showPanel(page, '逐篇观测结果');
  await expect(page.getByLabel('实际搜索问题')).toHaveValue('  如何选择低噪声放大器？  ');
  await page.getByRole('button', { name: '创建 Observation' }).click();
  await expect(page).toHaveURL(canonicalDetail);
  expect(newGeoApi.createRequests).toHaveLength(2);
});

test('DirtyGuard 覆盖 Cancel，Back/Forward 可恢复 canonical 页面；四档宽度无溢出', async ({ page }, testInfo) => {
  await page.goto(canonicalList);
  await page.getByRole('link', { name: '新建 Observation' }).click();
  await showPanel(page, '观测上下文');
  await page.getByLabel('GEO platform').fill('DeepSeek');
  await page.getByRole('button', { name: '取消' }).click();
  let dialog = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(page).toHaveURL(newRoute);

  await page.getByRole('button', { name: '取消' }).click();
  dialog = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await dialog.getByRole('button', { name: '放弃修改并离开' }).click();
  await expect(page).toHaveURL(canonicalList);
  await page.goBack();
  await expect(page).toHaveURL(newRoute);
  await page.goForward();
  await expect(page).toHaveURL(canonicalList);

  await page.goto(newRoute);

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 1280) {
      await expect(page.getByRole('tab', { name: '观测上下文' })).toBeVisible();
    } else {
      await expect(page.getByRole('region', { name: '观测上下文' })).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
  await showPanel(page, '观测上下文');
  await page.getByLabel('GEO platform').focus();
  await expect(page.getByLabel('GEO platform')).toBeFocused();
});
