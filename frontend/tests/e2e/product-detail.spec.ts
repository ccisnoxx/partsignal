import { createProductDetail, createProducts, expect, test, type ProductDetail } from './fixtures/products.fixture';

const productId = '00000000-0000-4000-8000-000000000001';

function completeDetail(): ProductDetail {
  const base = createProductDetail(createProducts(1)[0]);
  return {
    ...base,
    product: {
      ...base.product,
      workflow_stage: 'FACT_APPROVED',
      primary_task: 'CREATE_CONTENT_TASK',
      available_actions: ['UPDATE', 'DELETE'],
      deletion: { blockers: [] },
      revision: 4,
    },
    approved_fact: {
      id: '10000000-0000-4000-8000-000000000001',
      version: 3,
      status: 'APPROVED',
      classification: 'PUBLIC',
      approved_at: '2026-08-09T07:00:00Z',
    },
    pending_fact: {
      id: '10000000-0000-4000-8000-000000000002',
      version: 4,
      status: 'CHANGES_REQUESTED',
      classification: 'INTERNAL',
      created_at: '2026-08-09T08:00:00Z',
    },
    content: {
      task_count: 1,
      latest_task: {
        task_id: '20000000-0000-4000-8000-000000000001',
        workflow_stage: 'REVIEW_PENDING',
        created_at: '2026-08-09T06:00:00Z',
      },
    },
    publishing: {
      published_article_count: 1,
      latest: {
        work_id: '30000000-0000-4000-8000-000000000001',
        article_id: '30000000-0000-4000-8000-000000000001',
        status: 'COMPLETED',
        actual_title: `${base.product.part_number} 发布成果`,
        updated_at: '2026-08-09T05:00:00Z',
      },
    },
    geo: { observation_count: 3, article_result_count: 2, discovery_rate: 0.75, mention_rate: 0.5, accuracy_rate: 1 },
    activity: [
      {
        id: '50000000-0000-4000-8000-000000000001',
        kind: 'GEO_OBSERVATION',
        label: '记录 GEO 观测',
        timestamp: '2026-08-09T09:00:00Z',
        actor: null,
        target: { kind: 'GEO_OBSERVATION', id: '40000000-0000-4000-8000-000000000001', label: 'GEO 观测' },
      },
      {
        id: '50000000-0000-4000-8000-000000000002',
        kind: 'CONTENT_TASK',
        label: '创建内容任务',
        timestamp: '2026-08-09T08:00:00Z',
        actor: null,
        target: { kind: 'CONTENT_TASK', id: '20000000-0000-4000-8000-000000000001', label: '内容任务' },
      },
    ],
  };
}

test('从 Products 名称进入单请求详情，并支持 direct URL、refresh、Back/Forward 与导航上下文', async ({ page, productsApi }) => {
  productsApi.setDetail(completeDetail());
  await page.goto('/products?page=1');
  await page.getByRole('link', { name: 'PS-0001-VERY-LONG-MODEL-NUMBER' }).click();
  await expect(page).toHaveURL(`/products/${productId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '面包屑' })).toContainText('产品详情');
  await expect(page.locator('aside a[href="/products"]')).toHaveAttribute('aria-current', 'page');
  expect(productsApi.detailRequests).toHaveLength(1);

  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();
  expect(productsApi.detailRequests).toHaveLength(2);
  await page.goto('/products?page=1');
  await page.goBack();
  await expect(page).toHaveURL(`/products/${productId}`);
  await page.goForward();
  await expect(page).toHaveURL('/products?page=1');
  await expect(page.getByRole('heading', { level: 1, name: '产品事实' })).toBeVisible();
  await page.waitForLoadState('networkidle');
});

test('按既定顺序展示 facts/content/publishing/GEO compact summary 与服务端已排序 Activity', async ({ page, productsApi }) => {
  productsApi.setDetail(completeDetail());
  await page.goto(`/products/${productId}`);

  const sections = page.locator('main section').filter({ has: page.locator('h2') });
  await expect(sections).toHaveCount(7);
  await expect(sections.locator('h2')).toHaveText([
    '摘要', '基本信息', '事实', '内容任务', '发布成果', 'GEO 摘要', '最近 Activity',
  ]);
  await expect(page.getByRole('region', { name: '当前批准事实' })).toContainText('v3');
  await expect(page.getByRole('region', { name: '当前待审核或待修订事实' })).toContainText('v4');
  await expect(page.getByRole('heading', { name: '内容任务' }).locator('xpath=ancestor::section[1]')).toContainText('1');
  await expect(page.getByRole('heading', { name: '发布成果' }).locator('xpath=ancestor::section[1]')).toContainText('1');
  await expect(page.getByText('75%')).toBeVisible();

  const activity = page.getByRole('heading', { name: '最近 Activity' }).locator('xpath=ancestor::section[1]');
  const labels = activity.locator('ol > li > div > p');
  await expect(labels).toHaveText(['记录 GEO 观测', '创建内容任务']);
  await expect(activity.getByRole('link', { name: '查看GEO 观测' })).toHaveAttribute('href', '/geo/observations/40000000-0000-4000-8000-000000000001');
  expect(productsApi.detailRequests).toHaveLength(1);
});

test('空摘要只显示“暂无”，primary/overflow 只随服务端 token 与 projection 变化', async ({ page, productsApi }) => {
  const base = completeDetail();
  productsApi.setDetail({
    ...base,
    product: {
      ...base.product,
      primary_task: 'REVISE_FACT',
      available_actions: ['UPDATE'],
      deletion: { blockers: [{ type: 'FACT_VERSION', count: 2 }] },
    },
    approved_fact: null,
    pending_fact: null,
    content: { task_count: 0, latest_task: null },
    publishing: { published_article_count: 0, latest: null },
    geo: { observation_count: 0, article_result_count: 0, discovery_rate: null, mention_rate: null, accuracy_rate: null },
    activity: [],
  });
  await page.goto(`/products/${productId}`);
  await expect(page.getByRole('link', { name: '修订' })).toBeVisible();
  await expect(page.getByText('暂无 Activity')).toBeVisible();
  await expect(page.getByText('暂无')).toHaveCount(8);
  await page.getByRole('button', { name: /更多操作/ }).click();
  await expect(page.getByRole('menuitem', { name: '编辑产品' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '查看删除条件' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '删除产品' })).toHaveCount(0);
});

test('UPDATE 仅发送 ProductUpdate；REVISION_CONFLICT 展示请求 ID 并刷新 canonical detail', async ({ page, productsApi }) => {
  productsApi.setDetail(completeDetail());
  await page.goto(`/products/${productId}`);
  await page.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '编辑产品' }).click();
  let dialog = page.getByRole('dialog', { name: '编辑产品基本信息' });
  await dialog.getByRole('textbox', { name: '类别' }).fill('处理器');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  expect(productsApi.updateRequests[0]).toEqual({
    productId,
    csrfToken: 'products-e2e-csrf',
    body: {
      expected_revision: 4,
      part_number: 'PS-0001-VERY-LONG-MODEL-NUMBER',
      brand: 'PartSignal Extremely Long Browser Fixture Brand Name',
      category: '处理器',
      status: 'ACTIVE',
    },
  });

  productsApi.setUpdateMode('revision-conflict');
  await page.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '编辑产品' }).click();
  dialog = page.getByRole('dialog', { name: '编辑产品基本信息' });
  const canonical = completeDetail();
  productsApi.setDetail({ ...canonical, product: { ...canonical.product, brand: '服务端品牌', revision: 9 } });
  await dialog.getByRole('textbox', { name: '品牌' }).fill('本地品牌');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog.getByRole('alert')).toContainText('产品已被其他请求更新');
  await expect(dialog.getByRole('alert')).toContainText('req-update-conflict');
  await expect(dialog.getByRole('textbox', { name: '品牌' })).toHaveValue('服务端品牌');
  expect(productsApi.detailRequests.length).toBeGreaterThanOrEqual(3);
});

test('删除入口消费 blocker、expected_revision；冲突刷新后可按 canonical projection 重试', async ({ page, productsApi }) => {
  const blocked = completeDetail();
  productsApi.setDetail({
    ...blocked,
    product: { ...blocked.product, available_actions: ['UPDATE'], deletion: { blockers: [{ type: 'CONTENT_TASK', count: 2 }] } },
  });
  await page.goto(`/products/${productId}`);
  await page.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '查看删除条件' }).click();
  const conditions = page.getByRole('dialog', { name: /暂时不能删除/ });
  await expect(conditions).toContainText('内容任务');
  expect(productsApi.deleteRequests).toEqual([]);

  const deletable = completeDetail();
  productsApi.setDetail(deletable);
  await conditions.getByRole('button', { name: '重新检查' }).click();
  await expect(conditions).toBeHidden();
  productsApi.setDeleteMode('revision-conflict');
  await page.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '删除产品' }).click();
  await page.getByRole('dialog', { name: /确认删除产品/ }).getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('alert')).toContainText('产品已被其他请求更新');
  expect(productsApi.deleteRequests[0]).toEqual({ productId, expectedRevision: 4, csrfToken: 'products-e2e-csrf' });

  productsApi.setDeleteMode('success');
  await page.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '删除产品' }).click();
  const deleted = page.waitForResponse((response) => response.request().method() === 'DELETE');
  await page.getByRole('dialog', { name: /确认删除产品/ }).getByRole('button', { name: '确认删除' }).click();
  await deleted;
  await expect(page).toHaveURL('/products?page=1');
  expect(productsApi.deleteRequests).toHaveLength(2);
});

test('明确区分 404、403、普通错误 retry，并在 375/768/1024/1440 保持键盘可达且无横向溢出', async ({ page, productsApi }, testInfo) => {
  productsApi.setDetailMode('not-found');
  await page.goto(`/products/${productId}`);
  await expect(page.getByRole('heading', { name: '未找到产品' })).toBeVisible();
  productsApi.setDetailMode('forbidden');
  await page.reload();
  await expect(page.getByRole('heading', { name: '无法访问产品详情' })).toBeVisible();
  productsApi.setDetailMode('error');
  await page.reload();
  await expect(page.getByRole('heading', { name: '产品详情加载失败' })).toBeVisible();
  productsApi.setDetailMode('success');
  productsApi.setDetail(completeDetail());
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根不应横向溢出`).toBe(true);
  }
  const more = page.getByRole('button', { name: /更多操作/ });
  await more.focus();
  await expect(more).toBeFocused();
  await more.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '编辑产品' })).toHaveAttribute('data-highlighted');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
});
