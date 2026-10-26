/** AUTO-01 production页面交互；到期Worker/PG事务由独立真实PG用例证明。 */
import { test, expect } from './fixtures/foundation.fixture';
import type { components } from '../../src/shared/api/generated/schema';

const planId = '30000000-0000-4000-8000-000000000001';
const batchId = '30000000-0000-4000-8000-000000000002';
const at = '2026-10-25T01:00:00Z';
function plan(): components['schemas']['GeoMonitoringPlanDetail'] {
  return {
    id: planId,
    name: '定时监测计划',
    description: '虚构配置',
    subjects: [{ subject_id: planId, role: 'PRIMARY' }],
    prompt_variant_ids: [planId],
    collection_profile_ids: [planId],
    repeat_count: 2,
    schedule_kind: 'CRON',
    cron_expression: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    budget_limit: null,
    rule_set_revision: 1,
    status: 'DISABLED',
    revision: 0,
    created_by: planId,
    updated_by: planId,
    created_at: at,
    updated_at: at,
    preview: {
      prompt_count: 1,
      profile_count: 1,
      repeat_count: 2,
      run_count: 2,
      manual_run_count: 2,
      api_run_count: 0,
      browser_run_count: 0,
      unresolved_run_count: 0,
      estimated_cost: {
        value: null,
        currency: null,
        coverage: 'NONE',
        known_run_count: 0,
        unknown_run_count: 2,
        known_costs: [],
      },
      blockers: [],
      warnings: [],
    },
    workflow_stage: 'READY',
    primary_task: 'ACTIVATE',
    available_actions: ['ACTIVATE', 'UPDATE', 'PREVIEW'],
    deletion: { blockers: [] },
    run_entry: { available: false, reason_code: 'SCHEDULED_AUTOMATICALLY' },
    schedule: { next_run_at: null, latest_window: null },
  };
}
test('显式启用、暂停恢复与窗口历史，键盘和窄屏可用', async ({ page }, info) => {
  let current = plan();
  const writes: { path: string; body: unknown }[] = [];
  const runtime: string[] = [];
  page.on('pageerror', (error) => runtime.push(error.message));
  await page.route('**/api/v1/geo/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.pathname === '/api/v1/geo/monitoring-plans' &&
      request.method() === 'GET'
    )
      return route.fulfill({
        json: { items: [current], total: 1, page: 1, page_size: 20 },
      });
    if (
      url.pathname === `/api/v1/geo/monitoring-plans/${planId}` &&
      request.method() === 'GET'
    )
      return route.fulfill({ json: current });
    if (
      request.method() === 'POST' &&
      /\/(activate|pause|resume)$/.test(url.pathname)
    ) {
      writes.push({ path: url.pathname, body: request.postDataJSON() });
      const paused = url.pathname.endsWith('/pause');
      current = {
        ...current,
        revision: current.revision + 1,
        status: paused ? 'PAUSED' : 'ACTIVE',
        workflow_stage: paused ? 'PAUSED' : 'ACTIVE',
        primary_task: paused ? 'RESUME' : 'VIEW_RUNTIME',
        available_actions: paused
          ? ['RESUME', 'UPDATE', 'PREVIEW']
          : ['PAUSE', 'CREATE_REVISION', 'PREVIEW'],
        schedule: {
          ...current.schedule!,
          next_run_at: paused ? null : '2026-10-26T01:00:00Z',
        },
      };
      return route.fulfill({ json: current });
    }
    if (
      request.method() === 'GET' &&
      url.pathname.startsWith('/api/v1/geo/observation-batches')
    )
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'DEPENDENCY_UNAVAILABLE',
            message: '目标页夹具没有批次数据',
            request_id: 'auto01-browser',
            details: {},
          },
        },
      });
    return route.fallback();
  });
  await page.goto(`/geo/plans?selected=${planId}`);
  const section = page.getByRole('region', { name: '定时运行进展' });
  await expect(section).toHaveText(/尚无已处理窗口/);
  const activate = page.getByRole('button', { name: '启用计划', exact: true });
  await activate.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(section).toContainText('2026年10月26日');
  await page.getByRole('button', { name: '更多操作：当前计划' }).click();
  await page.getByRole('menuitem', { name: '暂停计划', exact: true }).click();
  await page.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(section).toContainText('尚未启用、已暂停或已归档');
  await page.getByRole('button', { name: '恢复计划', exact: true }).click();
  await page.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(section).toContainText('2026年10月26日');
  expect(writes.map(({ body }) => body)).toEqual([
    { expected_revision: 0 },
    { expected_revision: 1 },
    { expected_revision: 2 },
  ]);
  current.schedule!.latest_window = {
    scheduled_for: at,
    plan_revision: 3,
    status: 'CREATED',
    batch_id: batchId,
    error_code: null,
    covered_until: null,
    created_at: at,
  };
  await page.reload();
  await expect(section).toContainText('已创建批次');
  await expect(section).toContainText('不会自动去平台提问');
  for (const width of info.project.name === 'foundation-mobile'
    ? [375, 768]
    : [1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
  const link = section.getByRole('link', { name: '查看本次批次' });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`batch_id=${batchId}`));
  expect(new URL(page.url()).searchParams.get('plan_id')).toBe(planId);
  expect(runtime).toEqual([]);
});
