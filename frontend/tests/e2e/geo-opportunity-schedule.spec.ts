/** AUTO-02 production页面交互；持久化/并发由独立真实PG证明。 */
import { test, expect } from './fixtures/foundation.fixture';
import type { components } from '../../src/shared/api/generated/schema';

const path = '/api/v1/geo/opportunities/evaluation-schedule';
const id = '30000000-0000-4000-8000-000000000001';
const at = '2026-10-25T08:00:00Z';
test('管理员显式保存启用暂停，窗口结果、键盘与响应式布局', async ({ page }, info) => {
  let current: components['schemas']['GeoOpportunityScheduleDetail'] = {
    revision: 0, status: 'UNCONFIGURED', configuration: null, authorizer_id: null,
    next_run_at: null, latest_window: null, available_actions: ['CONFIGURE'], blocked_reason: null,
  };
  const writes: { method: string; path: string; body: unknown }[] = [];
  const runtime: string[] = [];
  let reads = 0;
  page.on('pageerror', (error) => runtime.push(error.message));
  await page.route('**/api/v1/geo/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === '/api/v1/geo/opportunities' && request.method() === 'GET')
      return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 20, as_of: at, filter_options: { subjects: [], products: [], query_topics: [], prompt_variants: [], collection_profiles: [], engine_surfaces: [] } } });
    if (url.pathname === path && request.method() === 'GET') {
      reads += 1;
      return route.fulfill({ json: current });
    }
    if (url.pathname === path && request.method() === 'PUT') {
      writes.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
      current = { ...current, revision: 1, status: 'DISABLED', configuration: request.postDataJSON().configuration, authorizer_id: id, available_actions: ['CONFIGURE', 'ACTIVATE'] };
      return route.fulfill({ json: current });
    }
    if (url.pathname.startsWith(path + '/') && request.method() === 'POST') {
      writes.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
      const paused = url.pathname.endsWith('/pause');
      current = { ...current, revision: current.revision + 1, status: paused ? 'PAUSED' : 'ACTIVE', next_run_at: paused ? null : at, available_actions: paused ? ['CONFIGURE', 'RESUME'] : ['CONFIGURE', 'PAUSE'] };
      return route.fulfill({ json: current });
    }
    return route.fallback();
  });
  await page.goto('/geo/opportunities');
  await expect(page.getByRole('heading', { name: 'GEO 机会工作台' })).toBeVisible();
  expect(reads).toBe(0);
  const open = page.getByRole('button', { name: '自动周期评估', exact: true });
  await open.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '编辑周期配置' }).click();
  await page.getByRole('spinbutton', { name: '评估周期（小时）' }).fill('12');
  await page.getByRole('spinbutton', { name: '回看天数' }).fill('3');
  await page.getByRole('button', { name: '保存周期配置' }).click();
  const progress = page.getByRole('region', { name: '自动评估运行进展' });
  await expect(progress).toContainText('未启用');
  expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: '启用周期评估', exact: true }).click();
  await page.getByRole('button', { name: '确认周期状态操作' }).click();
  await expect(progress).toContainText('已启用');
  await page.getByRole('button', { name: '暂停周期评估', exact: true }).click();
  await page.getByRole('button', { name: '确认周期状态操作' }).click();
  await expect(progress).toContainText('已暂停');
  await page.getByRole('button', { name: '恢复周期评估', exact: true }).click();
  await page.getByRole('button', { name: '确认周期状态操作' }).click();
  await expect(progress).toContainText('已启用');
  expect(writes.map(({ body }) => body)).toEqual([
    { expected_revision: 0, configuration: { scope: 'ALL', subject_ids: [], engine_surface_ids: [], collection_profile_ids: [], collection_modes: ['MANUAL'], rule_set_revision: 1, interval_hours: 12, lookback_days: 3 } },
    { expected_revision: 1 }, { expected_revision: 2 }, { expected_revision: 3 },
  ]);
  current.latest_window = {
    scheduled_for: at, configuration_revision: current.revision, configuration: current.configuration!, status: 'COMPLETED', covered_until: null, error_code: null, created_at: at,
    receipt: { evaluation_run_id: id, rule_set_revision: 1, evaluated_cells: 3, created: 1, existing_reused: 1, skipped: 1, unavailable_reasons: [{ code: 'INSUFFICIENT_SAMPLE', count: 1 }], as_of: at, replayed: false },
  };
  await page.getByRole('button', { name: '刷新运行记录与配置' }).click();
  await expect(progress).toContainText('评估已完成');
  await expect(progress).toContainText('有效样本不足');
  for (const width of info.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await progress.getByRole('link', { name: '查看机会结果' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/geo\/opportunities$/);
  expect(writes).toHaveLength(4);
  expect(runtime).toEqual([]);
});
