import { expect, geoIds, manualObservation, test } from './fixtures/geo.fixture';

const canonical = '/geo/observations?page=1&pageSize=20';

test('八列紧凑列表只提供 canonical links 和服务端投影动作', async ({ page, geoApi }) => {
  await page.goto(canonical);
  await expect(page.getByRole('heading', { level: 1, name: 'GEO 观测记录' })).toBeVisible();
  await expect(page.locator('thead th')).toHaveCount(8);
  await expect(page.getByRole('link', { name: manualObservation.query_text })).toHaveAttribute(
    'href',
    `/geo/observations/${geoIds.manual}`,
  );
  await expect(page.getByText(manualObservation.product.label).first()).toBeVisible();
  await expect(page.getByText('发现 2/3').first()).toBeVisible();
  await expect(page.getByText('准确 1/1（2 未评估）').first()).toBeVisible();
  await expect(page.getByText('发现不适用')).toBeVisible();
  await expect(page.getByText('查看详情')).toHaveCount(0);

  await page.getByRole('button', { name: `更多操作：${manualObservation.query_text}` }).click();
  await expect(page.getByRole('menuitem', { name: '更正' })).toHaveAttribute(
    'href',
    `/geo/observations/${geoIds.manual}/correct`,
  );
  await expect(page.getByRole('menuitem', { name: '删除' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '更多操作：旧模型是否提及目标产品？' }))
    .toHaveCount(0);
  expect(geoApi.listRequests).toHaveLength(1);
});

test('URL 参数逐项映射 API，支持排序、分页和 canonical replace', async ({
  page,
  geoApi,
}, testInfo) => {
  await page.goto(canonical);
  await page.getByRole('searchbox', { name: '搜索 GEO 观测' }).fill('  低噪声  ');
  await page.getByLabel('产品 ID').fill(geoIds.product);
  await page.getByLabel('GEO 平台').fill('  DeepSeek  ');
  await page.getByRole('combobox', { name: '准确性' }).click();
  await page.getByRole('option', { name: '部分准确' }).click();
  await page.getByLabel('观测日期从').fill('2026-08-01');
  await page.getByLabel('观测日期到').fill('2026-08-12');
  await page.getByRole('button', { name: '搜索' }).click();

  await expect(page).toHaveURL(/q=%E4%BD%8E%E5%99%AA%E5%A3%B0/);
  const mapped = geoApi.listRequests.at(-1)?.searchParams;
  expect(mapped?.get('search')).toBe('低噪声');
  expect(mapped?.get('product_id')).toBe(geoIds.product);
  expect(mapped?.get('geo_platform')).toBe('DeepSeek');
  expect(mapped?.get('accuracy')).toBe('PARTIAL');
  expect(mapped?.get('date_from')).toBe('2026-08-01');
  expect(mapped?.get('date_to')).toBe('2026-08-12');

  if (testInfo.project.name === 'foundation-mobile') {
    const url = new URL(page.url());
    url.searchParams.set('sort', 'OBSERVED_ASC');
    await page.goto(url.toString());
  } else {
    await page.getByRole('button', { name: '观测时间' }).click();
  }
  await expect(page).toHaveURL(/sort=OBSERVED_ASC/);
  expect(geoApi.listRequests.at(-1)?.searchParams.get('sort')).toBe('OBSERVED_ASC');

  await page.goto('/geo/observations?page=2&pageSize=10');
  await expect.poll(() => geoApi.listRequests.at(-1)?.searchParams.get('page')).toBe('2');
  expect(geoApi.listRequests.at(-1)?.searchParams.get('page_size')).toBe('10');
  await page.reload();
  await expect(page).toHaveURL('/geo/observations?page=2&pageSize=10');
  await page.goBack();
  await page.goForward();
  await expect(page).toHaveURL('/geo/observations?page=2&pageSize=10');

  await page.goto('/geo/observations?page=0&pageSize=99&search=alias&extra=1');
  await expect(page).toHaveURL(canonical);
});

test('loading、empty、filtered-empty、error 与 retry 诚实可见', async ({ page, geoApi }) => {
  geoApi.setListMode('loading');
  await page.goto(canonical);
  await expect(page.getByRole('rowgroup', { name: '正在加载表格' })).toBeVisible();
  geoApi.releaseLoading();
  await expect(page.getByRole('link', { name: manualObservation.query_text })).toBeVisible();

  geoApi.setListMode('empty');
  await page.goto(`${canonical}&q=all`);
  await expect(page.getByText('未找到匹配观测')).toBeVisible();
  await page.goto('/geo/observations?page=1&pageSize=50');
  await expect(page.getByText('暂无 GEO 观测')).toBeVisible();

  geoApi.setListMode('error');
  await page.goto('/geo/observations?page=1&pageSize=10');
  await expect(page.getByText('GEO 观测列表加载失败')).toBeVisible();
  await expect(page.getByText(/req-geo-list/)).toBeVisible();
  geoApi.setListMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('link', { name: manualObservation.query_text })).toBeVisible();
});

test('键盘 Dialog 返回焦点，删除只发送一次且携带 CSRF', async ({ page, geoApi }) => {
  await page.goto(canonical);
  const trigger = page.getByRole('button', { name: `更多操作：${manualObservation.query_text}` });
  await trigger.focus();
  await trigger.press('Enter');
  await page.getByRole('menuitem', { name: '删除' }).press('Enter');
  const dialog = page.getByRole('dialog', { name: '删除 GEO 观测' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(trigger).toBeFocused();

  await trigger.press('Enter');
  await page.getByRole('menuitem', { name: '删除' }).press('Enter');
  await page.getByRole('dialog', { name: '删除 GEO 观测' })
    .getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('link', { name: manualObservation.query_text })).toHaveCount(0);
  expect(geoApi.deleteRequests).toEqual([{
    path: `/api/v1/geo-observations/${geoIds.manual}`,
    csrfToken: 'geo-e2e-csrf',
  }]);
});

test('375/768/1024/1440 页面根无横向溢出，表格只在区域内滚动', async ({
  page,
}, testInfo) => {
  await page.goto(canonical);
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
    await expect(page.getByRole('region', { name: 'GEO 观测记录列表' })).toBeVisible();
  }
});
