/** 通过真实登录和真实查询验证编辑与 Prompt 工作区的视觉、表单可用性边界。 */
import { expect, test, type APIResponse, type Page } from '@playwright/test';

const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';
const themeStorageKey = 'partsignal.theme-mode';

type RuntimeTarget = {
  key: 'products' | 'facts' | 'content' | 'prompts';
  path: string;
  heading: string;
  root: string;
};

test.setTimeout(180_000);

async function body<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`${response.status()} ${response.url()}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('账号').fill('admin');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await body<{ id: string }>(await page.request.get('/api/v1/auth/me'));
}

async function resolveTargets(page: Page): Promise<RuntimeTarget[]> {
  const products = await body<{ items: Array<{ id: string; part_number: string }> }>(
    await page.request.get('/api/v1/products'),
  );
  if (!products.items[0]) throw new Error('真实测试库缺少产品，无法验证产品事实工作区');

  const tasks = await body<{ items: Array<{ id: string }> }>(
    await page.request.get('/api/v1/content-tasks'),
  );
  let content: { id: string; title: string } | undefined;
  for (const task of tasks.items) {
    const versions = await body<{ items: Array<{ id: string; title: string }> }>(
      await page.request.get(`/api/v1/content-tasks/${task.id}/content-versions`),
    );
    if (versions.items[0]) {
      content = versions.items[0];
      break;
    }
  }
  if (!content) throw new Error('真实测试库缺少内容版本，无法验证内容编辑工作区');

  const profiles = await body<{ items: Array<{ id: string }> }>(
    await page.request.get('/api/v1/platform-profiles'),
  );
  if (!profiles.items[0]) throw new Error('真实测试库缺少平台，无法验证 Prompt 工作区');

  return [
    { key: 'products', path: '/products', heading: '产品事实', root: '.products-page' },
    { key: 'facts', path: `/products/${products.items[0].id}`, heading: products.items[0].part_number, root: '.product-facts-page' },
    { key: 'content', path: `/content/${content.id}`, heading: content.title, root: '.content-review-page' },
    { key: 'prompts', path: `/configuration/prompts?tab=platform&page=1&page_size=10&platform_profile_id=${profiles.items[0].id}`, heading: 'Prompt 管理', root: '.prompt-management-page' },
  ];
}

async function openTarget(page: Page, target: RuntimeTarget) {
  await page.goto(target.path);
  await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator(target.root)).toBeVisible();
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, new URL(page.url()).pathname)
    .toBeLessThanOrEqual(dimensions.clientWidth);
}

test('未配置自然化 Prompt 时空编辑器可用且浏览器无失败信号', async ({ page }) => {
  await login(page);
  await page.waitForLoadState('networkidle');
  await page.route('**/api/v1/content-humanization-prompt', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.continue();
  });
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? '未知错误';
    if (errorText !== 'net::ERR_ABORTED') {
      failedRequests.push(`${request.method()} ${request.url()}: ${errorText}`);
    }
  });

  await page.goto('/configuration/prompts?tab=humanization&page=1&page_size=10');
  const editor = page.getByRole('textbox', { name: '自然化 Prompt Markdown' });
  await expect(editor).toHaveValue('');
  await expect(page.getByText('尚未配置 Prompt；首次保存后才可用于新生成作业。')).toBeVisible();
  const firstSave = page.getByRole('button', { name: '首次保存' });
  await expect(firstSave).toBeDisabled();
  await editor.fill('E2E 未保存自然化 Prompt');
  await expect(firstSave).toBeEnabled();
  await page.waitForLoadState('networkidle');

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('四个目标路由在明暗主题下统一使用 PageHeader 与语义表面', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  await login(page);
  const targets = await resolveTargets(page);
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const mode of ['light', 'dark'] as const) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [themeStorageKey, mode]);
    for (const target of targets) {
      await openTarget(page, target);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expectNoDocumentOverflow(page);
      await expect(page.locator(`${target.root} .page-header`).first()).toBeVisible();
      if (target.key === 'products') {
        await page.getByRole('button', { name: '新增产品' }).click();
        const dialog = page.getByRole('dialog', { name: '新增产品' });
        const borderContrast = await dialog.getByRole('textbox', { name: '产品型号' }).evaluate((element) => {
          const parse = (color: string) => color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [];
          const luminance = (color: string) => {
            const [red, green, blue] = parse(color).map((channel) => {
              const value = channel / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          };
          const style = getComputedStyle(element);
          const values = [luminance(style.borderTopColor), luminance(style.backgroundColor)];
          return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
        });
        expect(borderContrast, `${mode} 模式未聚焦输入边界`).toBeGreaterThanOrEqual(3);
        await dialog.getByRole('button', { name: /取\s*消/ }).click();
      }
      await page.screenshot({
        path: testInfo.outputPath(`${target.key}-${mode}-1440x1000.png`),
        fullPage: true,
      });
    }
  }
  expect(runtimeErrors).toEqual([]);
});

test('1024 至 320px 无页面横向溢出，Prompt 列表保持有界', async ({ page }) => {
  await login(page);
  const targets = await resolveTargets(page);
  await page.evaluate((key) => localStorage.setItem(key, 'light'), themeStorageKey);

  for (const width of [1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const target of targets) {
      await openTarget(page, target);
      await expectNoDocumentOverflow(page);
    }
  }

  await page.setViewportSize({ width: 375, height: 900 });
  const prompts = targets.find((target) => target.key === 'prompts')!;
  await openTarget(page, prompts);
  const promptPanel = page.locator('.prompt-platform-panel');
  const panelHeight = await promptPanel.evaluate((element) => element.getBoundingClientRect().height);
  expect(panelHeight).toBeLessThanOrEqual(520);
});

test('键盘、错误聚焦和未保存提示保留本地输入', async ({ page }) => {
  await login(page);
  const targets = await resolveTargets(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await openTarget(page, targets.find((target) => target.key === 'products')!);
  const addProduct = page.getByRole('button', { name: '新增产品' });
  await addProduct.focus();
  await addProduct.press('Enter');
  const createDialog = page.getByRole('dialog', { name: '新增产品' });
  await createDialog.getByRole('button', { name: '创建事实工作区' }).click();
  await expect(createDialog.getByRole('textbox', { name: '产品型号' })).toBeFocused();
  await createDialog.getByRole('textbox', { name: '产品型号' }).fill('E2E-UNSAVED');
  await createDialog.getByRole('button', { name: /取\s*消/ }).click();
  const productDiscard = page.getByRole('dialog', { name: '放弃未保存的产品信息？' });
  await productDiscard.getByRole('button', { name: '继续编辑' }).click();
  await expect(createDialog.getByRole('textbox', { name: '产品型号' })).toHaveValue('E2E-UNSAVED');

  await openTarget(page, targets.find((target) => target.key === 'facts')!);
  await page.getByRole('textbox', { name: '事实 Markdown' }).fill('# E2E 未保存事实');
  await page.getByRole('tab', { name: /事实版本/ }).click();
  const factsDiscard = page.getByRole('dialog', { name: '放弃未保存的事实修改？' });
  await factsDiscard.getByRole('button', { name: '继续编辑' }).click();
  await expect(page.getByText('有未保存修改')).toBeVisible();

  await openTarget(page, targets.find((target) => target.key === 'content')!);
  const editTab = page.getByRole('tab', { name: '编辑', exact: true });
  if (await editTab.count()) {
    await editTab.click();
    await page.getByRole('textbox', { name: '变更说明' }).fill('E2E 未保存修订');
    await page.getByRole('link', { name: /返回内容任务/ }).click();
    const contentDiscard = page.getByRole('dialog', { name: '放弃未保存的内容修订？' });
    await contentDiscard.getByRole('button', { name: '继续编辑' }).click();
    await expect(page.getByRole('textbox', { name: '变更说明' })).toHaveValue('E2E 未保存修订');
  }

  await openTarget(page, targets.find((target) => target.key === 'prompts')!);
  const promptEditor = page.getByRole('textbox', { name: 'Prompt Markdown' });
  await promptEditor.fill(`${await promptEditor.inputValue()}\nE2E 未保存`);
  await page.getByRole('tab', { name: '全局自然化 Prompt' }).click();
  const promptDiscard = page.getByRole('dialog', { name: '放弃未保存的 Prompt 修改？' });
  await promptDiscard.getByRole('button', { name: '继续编辑' }).click();
  await expect(promptEditor).toHaveValue(/E2E 未保存/);
});

test('Prompt 放弃站内导航只确认一次', async ({ page }, testInfo) => {
  const nativeDialogs: string[] = [];
  const runtimeErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('dialog', async (dialog) => {
    nativeDialogs.push(dialog.type());
    await dialog.accept();
  });
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? '未知错误';
    if (errorText !== 'net::ERR_ABORTED') failedRequests.push(`${request.method()} ${request.url()}: ${errorText}`);
  });

  await login(page);
  const targets = await resolveTargets(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTarget(page, targets.find((target) => target.key === 'prompts')!);
  const promptEditor = page.getByRole('textbox', { name: 'Prompt Markdown' });
  await promptEditor.fill(`${await promptEditor.inputValue()}\nE2E 单次确认`);
  await page.getByRole('link', { name: '产品事实' }).click();
  const discard = page.getByRole('dialog', { name: '放弃未保存的 Prompt 修改？' });
  await expect(discard).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('prompt-unsaved-confirmation-1440x900.png') });
  await discard.getByRole('button', { name: '放弃并离开' }).click();
  await expect(page).toHaveURL(/\/products$/);
  await expect(discard).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '产品事实' })).toBeVisible();
  expect(nativeDialogs).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('服务端错误聚焦 Alert，跟随系统与 reduced-motion 保留工作区信息', async ({ page }) => {
  await login(page);
  const targets = await resolveTargets(page);
  await openTarget(page, targets.find((target) => target.key === 'products')!);
  await page.route('**/api/v1/products', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'E2E_FAILURE', message: 'E2E 产品服务暂不可用' } }),
    });
  });
  await page.getByRole('button', { name: '新增产品' }).click();
  const dialog = page.getByRole('dialog', { name: '新增产品' });
  await dialog.getByRole('textbox', { name: '产品型号' }).fill('E2E-ERROR');
  await dialog.getByRole('textbox', { name: '品牌' }).fill('PartSignal');
  await dialog.getByRole('textbox', { name: '类别' }).fill('MCU');
  await dialog.getByRole('button', { name: '创建事实工作区' }).click();
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('E2E 产品服务暂不可用');
  await expect(alert.locator('..')).toBeFocused();
  await expect(dialog.getByRole('textbox', { name: '产品型号' })).toHaveValue('E2E-ERROR');
  await page.unroute('**/api/v1/products');

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate((key) => localStorage.setItem(key, 'system'), themeStorageKey);
  for (const target of targets) {
    await openTarget(page, target);
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.locator(target.root).evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  }
});
