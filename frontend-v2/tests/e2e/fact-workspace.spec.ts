import {
  createProductFacts,
  createProducts,
  expect,
  test,
  type ProductFactsDraft,
} from './fixtures/products.fixture';

const productId = '00000000-0000-4000-8000-000000000001';
const factsPath = `/products/${productId}/facts`;

function workspace(): ProductFactsDraft {
  return createProductFacts(createProducts(1)[0]);
}

test('direct/refresh 只读取一个 workspace read model，并适配 375/768/1024/1440', async ({ page, productsApi }, testInfo) => {
  productsApi.setFactWorkspace(workspace());
  await page.goto(factsPath);

  await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '面包屑' })).toContainText('事实工作台');
  await expect(page.getByRole('textbox', { name: '事实 Markdown' })).toBeVisible();
  expect(productsApi.factRequests).toHaveLength(1);
  expect(productsApi.detailRequests).toHaveLength(0);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();
  expect(productsApi.factRequests).toHaveLength(2);

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根不应横向溢出`).toBe(true);
  }

  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('tab', { name: '产品上下文' }).click();
    await expect(page.getByRole('region', { name: '产品上下文' })).toContainText('PartSignal Extremely Long Browser Fixture Brand Name');
    await page.getByRole('tab', { name: '事实 Markdown' }).click();
  }
  const editor = page.getByRole('textbox', { name: '事实 Markdown' });
  await editor.focus();
  await expect(editor).toBeFocused();
});

test('DirtyGuard 保留编辑，Ctrl/Cmd+S 携带 CSRF/expected_revision 并采用 canonical response', async ({ page, productsApi }, testInfo) => {
  productsApi.setFactWorkspace(workspace());
  await page.goto(factsPath);
  const editor = page.getByRole('textbox', { name: '事实 Markdown' });
  await editor.fill('## 已更新事实\n\n- 工作电压：5V');
  await expect(page.getByText(/有未保存修改/)).toBeVisible();

  await page.getByRole('navigation', { name: '面包屑' }).locator('a[href="/products"]').click();
  const guard = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: '继续编辑' }).click();
  await expect(editor).toHaveText(/已更新事实/);

  await editor.press(testInfo.project.name === 'foundation-mobile' ? 'Control+s' : 'Meta+s');
  await expect(page.getByText('已保存 · Revision 4')).toBeVisible();
  expect(productsApi.factSaveRequests).toEqual([{
    body: {
      expected_revision: 3,
      body_markdown: '## 已更新事实\n\n- 工作电压：5V',
      classification: 'INTERNAL',
    },
    csrfToken: 'products-e2e-csrf',
    productId,
  }]);
  await expect(page.getByText(/有未保存修改/)).toHaveCount(0);
});

test('revision conflict 保留本地 Markdown，只有显式 reload 才采用服务端版本', async ({ page, productsApi }) => {
  const initial = workspace();
  productsApi.setFactWorkspace(initial);
  productsApi.setFactSaveMode('revision-conflict');
  await page.goto(factsPath);
  const editor = page.getByRole('textbox', { name: '事实 Markdown' });
  await editor.fill('## 本地未保存事实');
  await page.getByRole('button', { name: '保存事实' }).click();

  await expect(page.getByRole('alert').filter({ hasText: '检测到 revision 冲突' })).toBeVisible();
  await expect(page.getByText('请求 ID：req-facts-conflict')).toBeVisible();
  await expect(editor).toHaveText('## 本地未保存事实');

  productsApi.setFactWorkspace({ ...initial, body_markdown: '## 服务端最新事实', revision: 4 });
  productsApi.setFactSaveMode('success');
  await page.getByRole('button', { name: '重新加载最新版本' }).click();
  await expect(editor).toHaveText('## 服务端最新事实');
  await expect(page.locator('form').getByText('已重新加载 Revision 4')).toBeVisible();
});

test('提交创建 PENDING_REVIEW 响应后停留工作台，并以 refetch actions 隐藏提交', async ({ page, productsApi }) => {
  productsApi.setFactWorkspace(workspace());
  await page.goto(factsPath);
  await page.getByRole('button', { name: '提交事实审核' }).click();
  const dialog = page.getByRole('dialog', { name: '提交事实审核' });
  await dialog.getByRole('button', { name: '确认提交审核' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: '变更摘要不能为空' }).first()).toBeVisible();
  await dialog.getByRole('textbox', { name: '变更摘要' }).fill('补充电压参数来源');
  await dialog.getByRole('button', { name: '确认提交审核' }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(factsPath);
  await expect(page.getByText('事实版本 v3 已提交审核').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '提交事实审核' })).toHaveCount(0);
  expect(productsApi.factSubmitRequests).toEqual([{
    body: { expected_revision: 3, change_summary: '补充电压参数来源' },
    csrfToken: 'products-e2e-csrf',
    productId,
  }]);
  expect(productsApi.factRequests).toHaveLength(2);
});

test('提交时 revision conflict 保留当前工作台并显示请求 ID', async ({ page, productsApi }) => {
  productsApi.setFactWorkspace(workspace());
  productsApi.setFactSubmitMode('revision-conflict');
  await page.goto(factsPath);
  await page.getByRole('button', { name: '提交事实审核' }).click();
  const dialog = page.getByRole('dialog', { name: '提交事实审核' });
  await dialog.getByRole('textbox', { name: '变更摘要' }).fill('冲突提交');
  await dialog.getByRole('button', { name: '确认提交审核' }).click();

  await expect(dialog.getByRole('alert').first()).toContainText('事实工作区已被其他请求修改');
  await expect(dialog.getByText('请求 ID：req-facts-submit-conflict')).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '检测到 revision 冲突' })).toBeVisible();
  await expect(page).toHaveURL(factsPath);
  expect(productsApi.factRequests).toHaveLength(1);
});

test('覆盖 loading、空 Markdown、预期错误、retry 与 RETIRED 只读状态', async ({ page, productsApi }) => {
  const initial = workspace();
  productsApi.setFactWorkspace({ ...initial, body_markdown: '', available_actions: ['SAVE'] });
  productsApi.setFactsMode('loading');
  await page.goto(factsPath);
  await expect(page.getByRole('heading', { name: '正在加载事实工作台' })).toBeVisible();
  productsApi.releaseFactsLoading();
  await expect(page.getByText('当前尚无事实正文。填写非空 Markdown 后即可保存。')).toBeVisible();

  productsApi.setFactsMode('not-found');
  await page.reload();
  await expect(page.getByRole('heading', { name: '未找到产品事实工作台' })).toBeVisible();
  productsApi.setFactsMode('forbidden');
  await page.reload();
  await expect(page.getByRole('heading', { name: '无法访问事实工作台' })).toBeVisible();
  productsApi.setFactsMode('error');
  await page.reload();
  await expect(page.getByRole('heading', { name: '事实工作台加载失败' })).toBeVisible();

  productsApi.setFactsMode('success');
  productsApi.setFactWorkspace({
    ...initial,
    product: { ...initial.product, status: 'RETIRED', workflow_stage: 'RETIRED' },
    available_actions: [],
  });
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('textbox', { name: '事实 Markdown' })).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('button', { name: '保存事实' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交事实审核' })).toHaveCount(0);
});
