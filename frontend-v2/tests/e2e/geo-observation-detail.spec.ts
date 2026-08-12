import { detailIds, expect, legacyDetail, manualDetail, test } from './fixtures/geo-detail.fixture';
import { geoIds, manualObservation } from './fixtures/geo.fixture';

const listRoute = '/geo/observations?page=1&pageSize=20';
const manualRoute = `/geo/observations/${detailIds.selected}`;
const legacyRoute = `/geo/observations/${geoIds.legacy}`;

test('List 进入 Detail，direct URL、refresh、Back 和 Forward 保持 canonical route', async ({
  page,
  geoDetailApi,
}) => {
  await page.goto(listRoute);
  await page.getByRole('link', { name: manualObservation.query_text }).click();
  await expect(page).toHaveURL(manualRoute);
  await expect(page.getByRole('heading', { level: 1, name: manualObservation.query_text }))
    .toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(manualRoute);
  await page.goBack();
  await expect(page).toHaveURL(listRoute);
  await page.goForward();
  await expect(page).toHaveURL(manualRoute);
  expect(geoDetailApi.detailRequests.every(
    (request) => request.pathname === `/api/v1/geo-observations/${detailIds.selected}/detail`,
  )).toBe(true);
});

test('Manual 一次请求展示 selected record、完整 chain、direct evidence 和 tail actions', async ({
  page,
  geoApi,
  geoDetailApi,
}) => {
  await page.goto(manualRoute);
  await expect(page.getByText(manualDetail.product.label).first()).toBeVisible();
  await expect(page.getByText('如何选择高可靠性低噪声放大器？').first()).toBeVisible();
  await expect(page.getByText('原记录', { exact: true })).toBeVisible();
  await expect(page.getByText('更正 1', { exact: true })).toBeVisible();
  await expect(page.getByText('更正 2', { exact: true })).toBeVisible();
  await expect(page.getByText('当前查看').first()).toBeVisible();
  await expect(page.getByText('历史原记录', { exact: true })).toBeVisible();
  await expect(page.getByText('历史更正', { exact: true })).toBeVisible();
  await expect(page.getByText('当前链尾').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'geo-detail-2.png' }).first()).toHaveAttribute(
    'href',
    'https://files.example.test/geo-detail-2.png',
  );
  await expect(page.getByText('未判断').first()).toBeVisible();
  await expect(page.getByText('准确').first()).toBeVisible();
  await expect(page.getByRole('link', { name: '查看结果' })).toHaveAttribute('href', '#results');

  const trigger = page.getByRole('button', { name: /更多操作/ });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByRole('menuitem', { name: '更正' })).toHaveAttribute(
    'href',
    `/geo/observations/${detailIds.tail}/correct`,
  );
  await page.getByRole('menuitem', { name: '删除' }).press('Enter');
  const dialog = page.getByRole('dialog', { name: '删除 GEO 观测' });
  await expect(dialog).toContainText('完整更正链');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(trigger).toBeFocused();

  await trigger.press('Enter');
  await page.getByRole('menuitem', { name: '删除' }).press('Enter');
  await page.getByRole('dialog', { name: '删除 GEO 观测' })
    .getByRole('button', { name: '确认删除' }).click();
  await expect(page).toHaveURL(listRoute);
  expect(geoApi.deleteRequests).toEqual([{
    path: `/api/v1/geo-observations/${detailIds.tail}`,
    csrfToken: 'geo-e2e-csrf',
  }]);
  expect(geoDetailApi.detailRequests.length).toBeGreaterThanOrEqual(1);
});

test('Legacy 只展示合同真实存在的 recommendation、citation 与 frozen article', async ({
  page,
}) => {
  await page.goto(legacyRoute);
  await expect(page.getByRole('heading', { level: 1, name: legacyDetail.observation.actual_prompt }))
    .toBeVisible();
  await expect(page.getByText('已推荐')).toBeVisible();
  await expect(page.getByText(legacyDetail.observation.answer_summary)).toBeVisible();
  await expect(page.getByRole('link', { name: legacyDetail.observation.citations[0].url }))
    .toHaveAttribute('href', legacyDetail.observation.citations[0].url);
  await expect(page.getByRole('link', { name: legacyDetail.published_articles[0].title }))
    .toHaveAttribute('href', `/publishing/articles/${detailIds.article}`);
  await expect(page.getByRole('heading', { name: 'Correction history' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /更多操作/ })).toHaveCount(0);
});

test('loading、409、retry 与 contract error 均不回退到旧 GET', async ({
  page,
  geoDetailApi,
}) => {
  geoDetailApi.setDetailMode('loading');
  await page.goto(manualRoute);
  await expect(page.getByRole('heading', { name: '正在加载观测详情' })).toBeVisible();
  geoDetailApi.setDetailMode('conflict');
  geoDetailApi.releaseLoading();
  await expect(page.getByRole('heading', { name: 'GEO Observation 暂不可读取' })).toBeVisible();
  await expect(page.getByText(/req-detail-conflict/)).toBeVisible();
  geoDetailApi.setDetailMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { level: 1, name: manualObservation.query_text }))
    .toBeVisible();
  expect(geoDetailApi.detailRequests.every((request) => request.pathname.endsWith('/detail')))
    .toBe(true);
});

test('375/768/1024/1440 无根级横向溢出且键盘可达', async ({ page }, testInfo) => {
  await page.goto(manualRoute);
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
  await page.getByRole('link', { name: '查看结果' }).focus();
  await expect(page.getByRole('link', { name: '查看结果' })).toBeFocused();
});
