import {
  expect,
  loginPassword,
  product,
  test,
} from './fixtures/legacy-routing.fixture';

const id = '00000000-0000-4000-8000-000000000001';

test('全部登记 legacy pathname 进入唯一 canonical pathname', async ({ page }) => {
  const cases = [
    ['/change-password', '/account/security'],
    ['/tasks', '/content/tasks'],
    [`/tasks/${id}`, `/content/tasks/${id}`],
    [`/content/${id}`, `/content/versions/${id}`],
    ['/observations', '/geo/observations'],
    ['/observations/insights', '/geo/insights'],
    ['/observations/insights/print', '/geo/insights/print'],
    ['/observations/topics', '/geo/topics'],
    [`/observations/${id}/correct`, `/geo/observations/${id}/correct`],
    ['/settings', '/settings/platforms'],
    ['/configuration', '/settings/ai'],
    ['/configuration/ai', '/settings/ai'],
    [`/configuration/ai/channels/${id}`, `/settings/ai/${id}`],
    ['/configuration/platform-types', '/settings/platforms/types'],
    ['/configuration/platforms', '/settings/platforms'],
    ['/configuration/prompts', '/settings/prompts'],
    ['/users', '/system/users'],
    ['/audit', '/system/audit'],
    ['/publications', '/publishing/work'],
  ] as const;

  for (const [legacy, canonical] of cases) {
    await page.goto(legacy);
    await expect.poll(() => new URL(page.url()).pathname, legacy).toBe(canonical);
  }
});

test('query 白名单、workspace 与 Publishing 优先级写入 canonical URL', async ({ page }) => {
  await page.goto(`/tasks?q=sensor&status=COMPLETED&archive_status=ARCHIVED&platform_profile_id=${id}&page=2&filter_product_id=${id}`);
  await expect(page).toHaveURL(`/content/tasks?archiveStatus=ARCHIVED&page=2&pageSize=10&q=sensor&workflowStage=VERIFIED&platformId=${id}`);

  await page.goto(`/observations?search=model&product_id=${id}&sort_order=ASC&page_size=50&all_time=1`);
  await expect(page).toHaveURL(`/geo/observations?page=1&pageSize=50&q=model&productId=${id}&sort=OBSERVED_ASC`);

  await page.goto(`/settings?platform_profile_id=${id}&configuration_status=COMPLETE`);
  await expect(page).toHaveURL(`/settings/platforms/${id}?tab=accounts`);

  await page.goto(`/configuration/ai/channels/${id}?tab=logs&q=drop`);
  await expect(page).toHaveURL(`/settings/ai/${id}?tab=basic`);

  await page.goto('/publications?tab=history&work_page=5');
  await expect(page).toHaveURL('/publishing/work?page=5&pageSize=20&status=CLOSED');

  await page.goto(`/publications?kind=issue&selected=${id}&tab=articles`);
  await expect(page).toHaveURL(`/publishing/issues/${id}#issue`);
});

test('replace 保留 refresh、Back 与 Forward 的 canonical 历史', async ({ page }) => {
  await page.goto('/account/security');
  await page.goto('/tasks?status=CANCELLED');
  await expect(page).toHaveURL('/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=10&workflowStage=CANCELLED');
  await page.reload();
  await expect(page).toHaveURL('/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=10&workflowStage=CANCELLED');
  await page.goBack();
  await expect(page).toHaveURL('/account/security');
  await page.goForward();
  await expect(page).toHaveURL('/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=10&workflowStage=CANCELLED');
});

test('匿名 legacy deep link 登录后恢复并归一化，恶意 return-to 回安全默认', async ({ legacySession, page }) => {
  legacySession.set('anonymous');
  await page.goto('/tasks?status=COMPLETED');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  const loginUrl = new URL(page.url());
  expect(loginUrl.pathname).toBe('/login');
  expect(loginUrl.searchParams.get('redirect')).toBe('/tasks?status=COMPLETED');
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByLabel(/^密码/).fill(loginPassword);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=10&workflowStage=VERIFIED');

  legacySession.set('anonymous');
  await page.goto('/login?redirect=%2F%252f%252fevil.example');
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByLabel(/^密码/).fill(loginPassword);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/');
});

test('must-change 与 ENGINEER 权限由既有 boundary 裁决', async ({ legacySession, page }) => {
  legacySession.set('must-change');
  await page.goto('/users');
  await expect(page).toHaveURL('/account/security');

  legacySession.set('engineer');
  await page.goto('/users');
  await expect(page).toHaveURL('/system/users?status=ENABLED&page=1&pageSize=20');
  await expect(page.getByRole('heading', { name: '无权访问系统管理' })).toBeVisible();
});

test('未知 path 显式 404，canonical 资源错误保留，Product Detail 保持 Facts 入口', async ({ page }) => {
  await page.goto('/legacy-path-not-registered');
  await expect(page.getByRole('heading', { level: 1, name: '页面不存在' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '页面不存在' }).locator('xpath=ancestor::section[1]')).toBeFocused();

  await page.goto('/tasks/missing-resource');
  await expect(page).toHaveURL('/content/tasks/missing-resource');
  await expect(page.getByRole('heading', { name: '未找到内容任务' })).toBeVisible();

  await page.goto(`/products/${product.id}`);
  await expect(page).toHaveURL(`/products/${product.id}`);
  await expect(page.getByRole('link', { name: '录入事实' })).toHaveAttribute('href', `/products/${product.id}/facts`);
});
