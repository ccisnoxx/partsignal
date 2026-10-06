# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: fact-workspace.spec.ts >> direct/refresh 只读取一个 workspace read model，并适配 375/768/1024/1440
- Location: tests/e2e/fact-workspace.spec.ts:16:1

# Error details

```
Error: expect(locator).toBeFocused() failed

Locator:  getByRole('textbox', { name: '事实 Markdown' })
Expected: focused
Received: inactive
Timeout:  5000ms

Call log:
  - Expect "toBeFocused" with timeout 5000ms
  - waiting for getByRole('textbox', { name: '事实 Markdown' })
    14 × locator resolved to <div translate="no" role="textbox" autocorrect="off" spellcheck="false" autocapitalize="off" aria-multiline="true" contenteditable="true" aria-label="事实 Markdown" id="fact-workspace-body" data-language="markdown" writingsuggestions="false" class="cm-content cm-lineWrapping" aria-describedby="fact-workspace-body-description">…</div>
       - unexpected value "inactive"

```

```yaml
- textbox "事实 Markdown"
```

# Test source

```ts
  1   | import {
  2   |   createProductFacts,
  3   |   createProducts,
  4   |   expect,
  5   |   test,
  6   |   type ProductFactsDraft,
  7   | } from './fixtures/products.fixture';
  8   | 
  9   | const productId = '00000000-0000-4000-8000-000000000001';
  10  | const factsPath = `/products/${productId}/facts`;
  11  | 
  12  | function workspace(): ProductFactsDraft {
  13  |   return createProductFacts(createProducts(1)[0]);
  14  | }
  15  | 
  16  | test('direct/refresh 只读取一个 workspace read model，并适配 375/768/1024/1440', async ({ page, productsApi }, testInfo) => {
  17  |   productsApi.setFactWorkspace(workspace());
  18  |   await page.goto(factsPath);
  19  | 
  20  |   await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();
  21  |   await expect(page.getByRole('navigation', { name: '面包屑' })).toContainText('事实工作台');
  22  |   await expect(page.getByRole('textbox', { name: '事实 Markdown' })).toBeVisible();
  23  |   expect(productsApi.factRequests).toHaveLength(1);
  24  |   expect(productsApi.detailRequests).toHaveLength(0);
  25  | 
  26  |   await page.reload();
  27  |   await expect(page.getByRole('heading', { level: 1, name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();
  28  |   expect(productsApi.factRequests).toHaveLength(2);
  29  | 
  30  |   const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  31  |   for (const width of widths) {
  32  |     await page.setViewportSize({ width, height: 1000 });
  33  |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根不应横向溢出`).toBe(true);
  34  |   }
  35  | 
  36  |   if (testInfo.project.name === 'foundation-mobile') {
  37  |     await page.getByRole('tab', { name: '产品上下文' }).click();
  38  |     await expect(page.getByRole('region', { name: '产品上下文' })).toContainText('PartSignal Extremely Long Browser Fixture Brand Name');
  39  |     await page.getByRole('tab', { name: '事实 Markdown' }).click();
  40  |   }
  41  |   const editor = page.getByRole('textbox', { name: '事实 Markdown' });
  42  |   await editor.focus();
> 43  |   await expect(editor).toBeFocused();
      |                        ^ Error: expect(locator).toBeFocused() failed
  44  | });
  45  | 
  46  | test('DirtyGuard 保留编辑，Ctrl/Cmd+S 携带 CSRF/expected_revision 并采用 canonical response', async ({ page, productsApi }, testInfo) => {
  47  |   productsApi.setFactWorkspace(workspace());
  48  |   await page.goto(factsPath);
  49  |   const editor = page.getByRole('textbox', { name: '事实 Markdown' });
  50  |   await editor.fill('## 已更新事实\n\n- 工作电压：5V');
  51  |   await expect(page.getByText(/有未保存修改/)).toBeVisible();
  52  | 
  53  |   await page.getByRole('navigation', { name: '面包屑' }).locator('a[href="/products"]').click();
  54  |   const guard = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  55  |   await expect(guard).toBeVisible();
  56  |   await guard.getByRole('button', { name: '继续编辑' }).click();
  57  |   await expect(editor).toHaveText(/已更新事实/);
  58  | 
  59  |   await editor.press(testInfo.project.name === 'foundation-mobile' ? 'Control+s' : 'Meta+s');
  60  |   await expect(page.getByText('已保存 · Revision 4')).toBeVisible();
  61  |   expect(productsApi.factSaveRequests).toEqual([{
  62  |     body: {
  63  |       expected_revision: 3,
  64  |       body_markdown: '## 已更新事实\n\n- 工作电压：5V',
  65  |       classification: 'INTERNAL',
  66  |     },
  67  |     csrfToken: 'products-e2e-csrf',
  68  |     productId,
  69  |   }]);
  70  |   await expect(page.getByText(/有未保存修改/)).toHaveCount(0);
  71  | });
  72  | 
  73  | test('revision conflict 保留本地 Markdown，只有显式 reload 才采用服务端版本', async ({ page, productsApi }) => {
  74  |   const initial = workspace();
  75  |   productsApi.setFactWorkspace(initial);
  76  |   productsApi.setFactSaveMode('revision-conflict');
  77  |   await page.goto(factsPath);
  78  |   const editor = page.getByRole('textbox', { name: '事实 Markdown' });
  79  |   await editor.fill('## 本地未保存事实');
  80  |   await page.getByRole('button', { name: '保存事实' }).click();
  81  | 
  82  |   await expect(page.getByRole('alert').filter({ hasText: '检测到 revision 冲突' })).toBeVisible();
  83  |   await expect(page.getByText('请求 ID：req-facts-conflict')).toBeVisible();
  84  |   await expect(editor).toHaveText('## 本地未保存事实');
  85  | 
  86  |   productsApi.setFactWorkspace({ ...initial, body_markdown: '## 服务端最新事实', revision: 4 });
  87  |   productsApi.setFactSaveMode('success');
  88  |   await page.getByRole('button', { name: '重新加载最新版本' }).click();
  89  |   await expect(editor).toHaveText('## 服务端最新事实');
  90  |   await expect(page.locator('form').getByText('已重新加载 Revision 4')).toBeVisible();
  91  | });
  92  | 
  93  | test('提交创建 PENDING_REVIEW 响应后停留工作台，并以 refetch actions 隐藏提交', async ({ page, productsApi }) => {
  94  |   productsApi.setFactWorkspace(workspace());
  95  |   await page.goto(factsPath);
  96  |   await page.getByRole('button', { name: '提交事实审核' }).click();
  97  |   const dialog = page.getByRole('dialog', { name: '提交事实审核' });
  98  |   await dialog.getByRole('button', { name: '确认提交审核' }).click();
  99  |   await expect(dialog.getByRole('alert').filter({ hasText: '变更摘要不能为空' }).first()).toBeVisible();
  100 |   await dialog.getByRole('textbox', { name: '变更摘要' }).fill('补充电压参数来源');
  101 |   await dialog.getByRole('button', { name: '确认提交审核' }).click();
  102 | 
  103 |   await expect(dialog).toBeHidden();
  104 |   await expect(page).toHaveURL(factsPath);
  105 |   await expect(page.getByText('事实版本 v3 已提交审核').first()).toBeVisible();
  106 |   await expect(page.getByRole('button', { name: '提交事实审核' })).toHaveCount(0);
  107 |   expect(productsApi.factSubmitRequests).toEqual([{
  108 |     body: { expected_revision: 3, change_summary: '补充电压参数来源' },
  109 |     csrfToken: 'products-e2e-csrf',
  110 |     productId,
  111 |   }]);
  112 |   expect(productsApi.factRequests).toHaveLength(2);
  113 | });
  114 | 
  115 | test('提交时 revision conflict 保留当前工作台并显示请求 ID', async ({ page, productsApi }) => {
  116 |   productsApi.setFactWorkspace(workspace());
  117 |   productsApi.setFactSubmitMode('revision-conflict');
  118 |   await page.goto(factsPath);
  119 |   await page.getByRole('button', { name: '提交事实审核' }).click();
  120 |   const dialog = page.getByRole('dialog', { name: '提交事实审核' });
  121 |   await dialog.getByRole('textbox', { name: '变更摘要' }).fill('冲突提交');
  122 |   await dialog.getByRole('button', { name: '确认提交审核' }).click();
  123 | 
  124 |   await expect(dialog.getByRole('alert').first()).toContainText('事实工作区已被其他请求修改');
  125 |   await expect(dialog.getByText('请求 ID：req-facts-submit-conflict')).toBeVisible();
  126 |   await dialog.getByRole('button', { name: '取消' }).click();
  127 |   await expect(page.getByRole('alert').filter({ hasText: '检测到 revision 冲突' })).toBeVisible();
  128 |   await expect(page).toHaveURL(factsPath);
  129 |   expect(productsApi.factRequests).toHaveLength(1);
  130 | });
  131 | 
  132 | test('覆盖 loading、空 Markdown、预期错误、retry 与 RETIRED 只读状态', async ({ page, productsApi }) => {
  133 |   const initial = workspace();
  134 |   productsApi.setFactWorkspace({ ...initial, body_markdown: '', available_actions: ['SAVE'] });
  135 |   productsApi.setFactsMode('loading');
  136 |   await page.goto(factsPath);
  137 |   await expect(page.getByRole('heading', { name: '正在加载事实工作台' })).toBeVisible();
  138 |   productsApi.releaseFactsLoading();
  139 |   await expect(page.getByText('当前尚无事实正文。填写非空 Markdown 后即可保存。')).toBeVisible();
  140 | 
  141 |   productsApi.setFactsMode('not-found');
  142 |   await page.reload();
  143 |   await expect(page.getByRole('heading', { name: '未找到产品事实工作台' })).toBeVisible();
```