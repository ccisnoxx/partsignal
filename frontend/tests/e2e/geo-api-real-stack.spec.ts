/** GEO-408：production preview → 真实 API/PG/Celery → loopback fake provider。 */
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { registerCurrentRealStackCookies } from './real-stack-session';
import { api, batches, body, calls, configuration, createBatch, createPlan, detail, login, runs, uiCommand } from './geo-api-support';

type Schema = components['schemas'];
const mode = process.env.PARTSIGNAL_E2E_GEO_MODE;
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1' || !mode, '只由隔离 GEO 真实栈入口运行');
test.setTimeout(240_000);
test.use({ trace: 'off', video: 'off', actionTimeout: 15_000 });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));

test('API 自动轮询、原文引用、部分 usage、费用、429/未知结果与显式新尝试', async ({ page }, testInfo) => {
  test.skip(mode !== 'enabled', '开关关闭另有真实待消费任务验收');
  await login(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const graph = await configuration(page);
  const seen: Schema['GeoRunDetail'][] = [];
  const browserWrites: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith(runs)) browserWrites.push(new URL(request.url()).pathname);
  });
  page.on('response', (response) => {
    if (response.request().method() === 'GET' && new URL(response.url()).pathname.match(/\/observation-runs\/[0-9a-f-]+$/) && response.ok()) {
      void response.json().then((value: Schema['GeoRunDetail']) => seen.push(value));
    }
  });
  const successPlan = await createPlan(page, graph, 'SUCCESS');
  const success = await createBatch(page, successPlan.plan, successPlan.planName, successPlan.promptName);
  const region = page.getByRole('region', { name: '运行详情', exact: true });
  await expect(region.getByText('已完成', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const collected = await detail(page, success.runId);
  expect(collected.run).toMatchObject({ status: 'COMPLETED', workflow_stage: 'COMPLETED', external_call_state: 'COMPLETED', prompt_tokens: 7, completion_tokens: null, total_tokens: null, cost_amount: '0.0012', cost_currency: 'USD' });
  expect(collected.data_quality.assessment).toBe('NOT_IMPLEMENTED');
  expect(collected.data_quality.unavailable_sections).toEqual(['METRICS', 'OPPORTUNITIES', 'RETEST']);
  expect(collected.answer?.web_search_observed).toBeNull();
  expect(collected.citations.find((citation) => citation.hostname === 'geo-fixture-a.test')?.occurrences).toEqual([1, 3]);
  await expect(region.locator('pre').filter({ hasText: collected.answer!.answer_text })).toBeVisible();
  await expect(region.locator('dt').filter({ hasText: /^输入 tokens$/ }).locator('+ dd')).toHaveText('7');
  await expect(region.locator('dt').filter({ hasText: /^输出 tokens$/ }).locator('+ dd')).toHaveText('未报告');
  await expect(region.locator('dt').filter({ hasText: /^总 tokens$/ }).locator('+ dd')).toHaveText('未报告');
  await expect(region.getByText(/0\.0012 USD/)).toBeVisible();
  await expect(region.getByRole('button', { name: '创建新采集尝试', exact: true })).toHaveCount(0);
  expect(seen.filter((value) => value.run.id === success.runId).some((value) => ['PENDING', 'RUNNING'].includes(value.run.status))).toBe(true);
  expect(seen.filter((value) => value.run.id === success.runId).some((value) => value.run.status === 'COMPLETED')).toBe(true);
  expect(await calls(page, success.runId)).toMatchObject({ count: 1 });
  // 测试控制只重复真实 Celery 稳定 ID，不改状态、不新增业务 API。
  const repo = resolve(process.cwd(), '..');
  // CLI 的消费期限为 30 秒，外层等待保留进程启动和归属校验余量。
  await promisify(execFile)(resolve(repo, 'backend/.venv/bin/python'), ['-m', 'tests.geo_e2e_runtime', 'duplicate', success.runId], { cwd: repo, timeout: 40_000 });
  expect(await calls(page, success.runId)).toMatchObject({ count: 1 });
  expect((await detail(page, success.runId)).run).toEqual(collected.run);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`geo408-analyzed-${width}.png`), fullPage: true });
  }

  for (const failureMode of ['RATE_LIMIT', 'UNKNOWN'] as const) {
    const selected = await createPlan(page, graph, failureMode);
    const old = await createBatch(page, selected.plan, selected.planName, selected.promptName);
    const code = failureMode === 'RATE_LIMIT' ? 'PROVIDER_RATE_LIMITED' : 'COLLECTOR_UNKNOWN_OUTCOME';
    await expect(region.getByText(new RegExp(`错误阶段：COLLECTION · ${code}`))).toBeVisible({ timeout: 30_000 });
    const before = await detail(page, old.runId);
    expect(before.run.status).toBe('FAILED');
    expect(before.answer).toBeNull();
    expect(before.citations).toEqual([]);
    expect(before.run.cost_amount).toBeNull();
    if (failureMode === 'RATE_LIMIT') {
      expect(before.run).toMatchObject({ provider_status: 429, retry_after_seconds: 2 });
      await expect(region.locator('dt').filter({ hasText: /^Retry-After$/ }).locator('+ dd')).toHaveText('2 秒');
    } else {
      expect(before.run.external_call_state).toBe('UNKNOWN');
      await expect(region.getByText('结果未知 · UNKNOWN', { exact: true })).toBeVisible();
    }
    expect(await calls(page, old.runId)).toMatchObject({ count: 1 });
    const postsBefore = browserWrites.length;
    await page.getByRole('button', { name: '创建新采集尝试', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认创建新采集尝试', exact: true });
    await expect(dialog).toContainText('外部调用及费用');
    expect(browserWrites).toHaveLength(postsBefore);
    const retry = await uiCommand<Schema['GeoRunRetryCreated']>(page, `${runs}/${old.runId}/retry`, () => dialog.getByRole('button', { name: '确认创建新尝试', exact: true }).click(), 201);
    expect(retry).toMatchObject({ batch_id: old.batchId, previous_attempt_id: old.runId, attempt_no: 2 });
    expect(retry.run_id).not.toBe(old.runId);
    await expect(page).toHaveURL(new RegExp(`run_id=${retry.run_id}`));
    await expect(region.getByText('已完成', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    expect(browserWrites.slice(postsBefore)).toEqual([`${runs}/${old.runId}/retry`]);
    const after = await detail(page, old.runId);
    for (const field of ['input_snapshot', 'status', 'external_call_state', 'error_code', 'error_summary', 'cost_amount', 'collected_at', 'finished_at'] as const) expect(after.run[field]).toEqual(before.run[field]);
    const next = await detail(page, retry.run_id);
    expect(next.run.input_snapshot).toEqual(before.run.input_snapshot);
    expect(next.attempts.map((attempt) => attempt.id)).toEqual([old.runId, retry.run_id]);
    expect(await calls(page, old.runId)).toMatchObject({ count: 1 });
    expect(await calls(page, retry.run_id)).toMatchObject({ count: 1 });
    const batch = await body<Schema['GeoBatchDetail']>(await page.request.get(`${api}${batches}/${old.batchId}`));
    expect(batch.summary.cost).toMatchObject({ known_attempt_count: 1, unknown_attempt_count: 1, known_costs: [{ currency: 'USD', value: '0.0012' }] });
    await page.getByRole('button', { name: '尝试 1', exact: true }).click();
    await expect(region.getByRole('alert').getByText(`错误阶段：COLLECTION · ${code}`, { exact: true })).toBeVisible();
    await expect(region.getByRole('button', { name: '创建新采集尝试', exact: true })).toHaveCount(0);
  }
  for (const blocked of ['INTERNAL', 'BUDGET'] as const) {
    const selected = await createPlan(page, graph, blocked);
    const current = await createBatch(page, selected.plan, selected.planName, selected.promptName);
    const code = blocked === 'INTERNAL' ? 'DATA_CLASSIFICATION_FORBIDDEN' : 'BUDGET_EXCEEDED';
    await expect(region.getByText(new RegExp(`错误阶段：COLLECTION · ${code}`))).toBeVisible({ timeout: 30_000 });
    const value = await detail(page, current.runId);
    expect(value.run).toMatchObject({ external_call_state: 'NOT_STARTED', error_code: code });
    expect(value.answer).toBeNull();
    expect(await calls(page, current.runId)).toMatchObject({ count: 0 });
  }
  // 控制响应、页面和浏览器存储不得反射 fake credential。
  const visible = await page.locator('body').innerText();
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(visible.includes(graph.secret)).toBe(false);
  expect(storage.includes(graph.secret)).toBe(false);
  expect(errors).toEqual([]);
});

test('关闭开关的新 API/Worker 消费真实 PENDING，明确失败且 provider 零调用', async ({ page }) => {
  test.skip(mode === 'enabled', '正常阶段使用完整 UI 旅程');
  const file = process.env.PARTSIGNAL_E2E_GEO_FIXTURE_FILE;
  if (!file) throw new Error('关闭开关验收缺少隔离栈前置任务回执');
  const fixture = JSON.parse(await readFile(file, 'utf8')) as { run_id: string; batch_id: string; profile_id: string };
  const auth = await login(page);
  await page.goto(`/geo/runs?view=runs&batch_id=${fixture.batch_id}&run_id=${fixture.run_id}`);
  const region = page.getByRole('region', { name: '运行详情', exact: true });
  await expect(region.getByText(/错误阶段：COLLECTION · COLLECTOR_DISABLED/)).toBeVisible({ timeout: 30_000 });
  const value = await detail(page, fixture.run_id);
  expect(value.run).toMatchObject({ status: 'FAILED', external_call_state: 'NOT_STARTED', error_code: 'COLLECTOR_DISABLED', available_actions: [] });
  expect(value.answer).toBeNull();
  expect(await calls(page, fixture.run_id)).toMatchObject({ count: 0 });
  await expect(region.getByRole('button', { name: '创建新采集尝试', exact: true })).toHaveCount(0);
  const rejected = await page.request.post(`${api}${runs}/${fixture.run_id}/retry`, { headers: { 'X-CSRF-Token': auth.csrf_token }, data: { expected_revision: value.run.revision } });
  expect(rejected.status()).toBe(422);
  expect(await rejected.json()).toMatchObject({ error: { code: 'GEO_PLAN_PROFILE_INELIGIBLE' } });
  const profile = await body<Schema['GeoCollectionProfileRead']>(await page.request.get(`${api}/api/v1/geo/collection-profiles/${fixture.profile_id}`));
  const blocker = mode === 'api-disabled' ? 'API_COLLECTION_DISABLED' : 'MONITORING_DISABLED';
  expect(profile.activation_blockers?.some((item) => item.code === blocker)).toBe(true);
  expect(await calls(page, fixture.run_id)).toMatchObject({ count: 0 });
});
