import {
  createFactReviewWorkspace,
  createProducts,
  expect,
  test,
  type ProductFactReviewWorkspace,
} from './fixtures/products.fixture';

const productId = '00000000-0000-4000-8000-000000000001';
const reviewPath = `/products/${productId}/facts/review`;

function workspace(): ProductFactReviewWorkspace {
  return createFactReviewWorkspace(createProducts(1)[0]);
}

test('direct/refresh 只读一个审核 context，展示不可变 Markdown、Diff、历史并适配四档宽度', async ({ page, productsApi }, testInfo) => {
  productsApi.setFactReviewWorkspace(workspace());
  await page.goto(reviewPath);

  await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '面包屑' })).toContainText('事实审核');
  await expect(page.getByLabel('事实版本 v2 Markdown 快照')).toContainText('工作电压：5V');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('.cm-editor')).toHaveCount(0);
  expect(productsApi.factReviewRequests).toHaveLength(1);
  expect(productsApi.factRequests).toHaveLength(0);
  expect(productsApi.detailRequests).toHaveLength(0);

  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '审核上下文' }).click();
  }
  await expect(page.getByRole('region', { name: '审核上下文' })).toContainText('补充参数来源');
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '差异与审核历史' }).click();
  }
  await expect(page.getByRole('region', { name: '事实版本 Markdown 差异' })).toContainText('工作电压：3.3V');
  await expect(page.getByRole('heading', { name: '审核历史' }).locator('xpath=ancestor::section[1]')).toContainText('提交审核');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();
  expect(productsApi.factReviewRequests).toHaveLength(2);

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
});

test('APPROVE 使用服务端 token、CSRF 与 expected_revision，成功后刷新 canonical context', async ({ page, productsApi }) => {
  productsApi.setFactReviewWorkspace(workspace());
  await page.goto(reviewPath);

  const approve = page.getByRole('button', { name: '批准事实' });
  await approve.focus();
  await approve.press('Enter');
  let dialog = page.getByRole('dialog', { name: '批准事实版本 v2？' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(approve).toBeFocused();

  await approve.click();
  dialog = page.getByRole('dialog', { name: '批准事实版本 v2？' });
  await dialog.getByRole('button', { name: '确认批准' }).click();
  await expect(page.getByText('事实版本 v2 已批准').first()).toBeVisible();
  await expect(page).toHaveURL(reviewPath);
  await expect(page.getByRole('button', { name: '批准事实' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退回修改' })).toHaveCount(0);
  expect(productsApi.factApproveRequests).toEqual([{
    body: { expected_revision: 0, comment: '' },
    csrfToken: 'products-e2e-csrf',
    factVersionId: workspace().review!.fact_version.id,
  }]);
  expect(productsApi.factReviewRequests).toHaveLength(2);
});

test('REQUEST_CHANGES 不从 status 推导动作，拒绝空意见并追加目标版本历史', async ({ page, productsApi }) => {
  const initial = workspace();
  if (!initial.review) throw new Error('Fact Review fixture 缺少目标版本');
  productsApi.setFactReviewWorkspace({
    ...initial,
    review: { ...initial.review, available_actions: ['REQUEST_CHANGES'] },
  });
  await page.goto(reviewPath);

  await expect(page.getByRole('button', { name: '批准事实' })).toHaveCount(0);
  const trigger = page.getByRole('button', { name: '退回修改' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '退回事实版本 v2' });
  const comment = dialog.getByRole('textbox', { name: '退回意见' });
  await expect(comment).toBeFocused();
  await dialog.getByRole('button', { name: '确认退回' }).click();
  await expect(dialog.getByText('退回意见不能为空').first()).toBeVisible();
  expect(productsApi.factRequestChangesRequests).toHaveLength(0);

  await comment.fill('  请补充参数条件  ');
  await dialog.getByRole('button', { name: '确认退回' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('事实版本 v2 已退回修改').first()).toBeVisible();
  expect(productsApi.factRequestChangesRequests).toEqual([{
    body: { expected_revision: 0, comment: '请补充参数条件' },
    csrfToken: 'products-e2e-csrf',
    factVersionId: initial.review.fact_version.id,
  }]);
  expect(productsApi.factApproveRequests).toHaveLength(0);
  expect(productsApi.factReviewRequests).toHaveLength(2);
});

test('409 不重放命令，展示 request ID 并刷新最新 revision', async ({ page, productsApi }, testInfo) => {
  const initial = workspace();
  if (!initial.review) throw new Error('Fact Review fixture 缺少目标版本');
  productsApi.setFactReviewWorkspace(initial);
  productsApi.setFactApproveMode('revision-conflict');
  await page.goto(reviewPath);

  await page.getByRole('button', { name: '批准事实' }).click();
  const dialog = page.getByRole('dialog', { name: '批准事实版本 v2？' });
  await expect(dialog).toBeVisible();
  productsApi.setFactReviewWorkspace({
    ...initial,
    review: {
      ...initial.review,
      fact_version: { ...initial.review.fact_version, revision: 1 },
    },
  });
  await dialog.getByRole('button', { name: '确认批准' }).click();
  await expect(page.getByText('请求 ID：req-fact-review-conflict')).toBeVisible();
  expect(productsApi.factApproveRequests).toEqual([{
    body: { expected_revision: 0, comment: '' },
    csrfToken: 'products-e2e-csrf',
    factVersionId: initial.review.fact_version.id,
  }]);
  expect(productsApi.factReviewRequests).toHaveLength(2);
  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '审核上下文' }).click();
  }
  await expect(page.getByRole('region', { name: '审核上下文' })).toContainText('Revision1');
});

test('覆盖 loading、empty、404、403、通用错误与 retry', async ({ page, productsApi }) => {
  productsApi.setFactReviewMode('loading');
  await page.goto(reviewPath);
  await expect(page.getByRole('heading', { name: '正在加载事实审核上下文' })).toBeVisible();
  productsApi.releaseFactReviewLoading();
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();

  productsApi.setFactReviewMode('empty');
  await page.reload();
  await expect(page.getByRole('heading', { name: '暂无事实版本可审核' })).toBeVisible();
  productsApi.setFactReviewMode('not-found');
  await page.reload();
  await expect(page.getByRole('heading', { name: '未找到事实审核工作台' })).toBeVisible();
  productsApi.setFactReviewMode('forbidden');
  await page.reload();
  await expect(page.getByRole('heading', { name: '无法访问事实审核工作台' })).toBeVisible();
  productsApi.setFactReviewMode('error');
  await page.reload();
  await expect(page.getByRole('heading', { name: '事实审核工作台加载失败' })).toBeVisible();
  await expect(page.getByText('请求 ID：req-fact-review-error', { exact: true })).toBeVisible();

  productsApi.setFactReviewMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();
});
