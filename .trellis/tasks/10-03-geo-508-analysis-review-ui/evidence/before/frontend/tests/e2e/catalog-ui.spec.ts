/** GEO-105 production artifact 的布局、键盘和 URL 验证；API 使用明确 fixture，真实 Catalog 纵向验收属于 GEO-106。 */
import { test, expect } from './fixtures/platforms.fixture';
import type { components } from '../../src/shared/api/generated/schema';
import { fixtureArtifactSecrets } from './fixture-secrets';

const subjectId = '10000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000099';
const subject: components['schemas']['GeoSubjectOut'] = {
  id: subjectId, subject_type: 'COMPETITOR_BRAND', product_id: null, product: null,
  canonical_name: 'Competitor long name', display_name: '竞品品牌与精确身份配置示例长名称', description: '身份配置只影响未来监测，历史快照保持不变。',
  parent_subject_id: null, parent: null, is_active: true, aliases: [],
  domains: [{ id: '10000000-0000-4000-8000-000000000003', subject_id: subjectId, hostname: 'long-subdomain-for-responsive-check.example.invalid', relation_type: 'OFFICIAL', is_active: true, available_actions: ['DELETE'], created_at: '2026-10-02T08:00:00Z' }],
  references: { child_subject_count: 2, monitoring_plan_count: 0, observation_run_count: 0, analysis_count: 0, opportunity_count: 0 },
  workflow_stage: 'ACTIVE', primary_task: 'MANAGE_SUBJECT', available_actions: ['UPDATE', 'DISABLE', 'CREATE_ALIAS', 'CREATE_DOMAIN'], deletion: { blockers: [{ type: 'CHILD_SUBJECT', count: 2 }] }, revision: 7, created_by: actorId, created_at: '2026-10-02T08:00:00Z', updated_at: '2026-10-02T08:00:00Z',
};

test('Catalog 页面局部滚动、URL 恢复、键盘确认与焦点返回', async ({ page }, testInfo) => {
  await page.route('**/api/v1/geo/subjects**', async (route) => {
    expect(route.request().method(), '本检查只读取 fixture，不执行业务命令').toBe('GET');
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({ json: pathname === '/api/v1/geo/subjects' ? { items: [subject], total: 1, page: 1, page_size: 20 } satisfies components['schemas']['GeoSubjectListPage'] : subject });
  });
  await page.goto(`/configuration/geo-entities?subject_id=${subjectId}&is_active=false&sort=UPDATED_DESC&q=%E7%AB%9E%E5%93%81`);
  await expect(page.getByRole('heading', { name: '监测对象与竞品', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜索名称、别名或域名' })).toHaveValue('竞品');
  await expect(page.getByRole('combobox', { name: '筛选启用状态' })).toContainText('已停用');
  const detail = page.getByRole('region', { name: '监测对象详情' });
  await expect(detail.getByText('子对象：2', { exact: false })).toBeVisible();
  const more = detail.getByRole('button', { name: `更多操作：${subject.display_name}` });
  await more.focus();
  await more.press('Enter');
  await page.getByRole('menuitem', { name: '停用对象', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: '确认停用对象' });
  await expect(dialog).toBeVisible();
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根没有横向溢出`).toBe(true);
    await expect(page.getByRole('region', { name: '监测对象列表' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`catalog-${width}.png`), fullPage: true });
  }
  await page.reload();
  await expect(page.getByRole('textbox', { name: '搜索名称、别名或域名' })).toHaveValue('竞品');
  await expect(page.getByRole('heading', { name: subject.display_name, exact: true })).toBeVisible();
});

test('ENGINEER 直接访问只读详情及 new URL，无配置入口或写操作', async ({ page }) => {
  const readonly: components['schemas']['GeoSubjectOut'] = { ...subject, available_actions: [], deletion: null, domains: subject.domains.map((domain) => ({ ...domain, available_actions: [] })) };
  await page.route('**/api/v1/auth/session', async (route) => {
    await route.fulfill({ json: { user: { id: actorId, username: 'engineer', display_name: '只读工程师', account_type: 'ENGINEER', is_active: true, must_change_password: false, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_USER', available_actions: [], deletion: null, revision: 1, created_at: '2026-10-02T08:00:00Z' }, csrf_token: fixtureArtifactSecrets.authCsrf, session_binding: 'b'.repeat(64) } satisfies components['schemas']['AuthSession'] });
  });
  await page.route('**/api/v1/geo/subjects**', async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: new URL(route.request().url()).pathname === '/api/v1/geo/subjects' ? { items: [readonly], total: 1, page: 1, page_size: 20 } : readonly });
  });
  await page.goto(`/configuration/geo-entities?subject_id=${subjectId}`);
  await expect(page.getByText('当前为只读视图。监测对象、别名和域名由管理员维护。')).toBeVisible();
  await expect(page.getByRole('button', { name: /更多操作|新建监测对象|新增别名|新增域名/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '监测对象与竞品', exact: true })).toHaveCount(0);
  await page.goto('/configuration/geo-entities?new=1');
  await expect(page.getByText('当前账号没有创建监测对象的权限。')).toBeVisible();
  await expect(page.getByRole('form', { name: '新建监测对象' })).toHaveCount(0);
});
