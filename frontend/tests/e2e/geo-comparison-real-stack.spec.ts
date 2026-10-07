/** GEO-706：已有机会的继续/人工解决与历史恢复；完整R6纵向验收由707负责。 */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { api, body, detail, login, runs } from './geo-api-support';
import { reviewConfiguration } from './geo-review-support';
import { createRealStackRuntimeAudit } from './real-stack-runtime';
import { registerCurrentRealStackCookies } from './real-stack-session';

type Schema = components['schemas'];
const opportunities = '/api/v1/geo/opportunities';
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '需要隔离PostgreSQL与真实API');
test.skip(Boolean(process.env.PARTSIGNAL_E2E_GEO_MODE), '仅人工证据专项');
test.setTimeout(150_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));

test('已有机会 → 显式继续 → 人工解决 → 刷新保留处理历史', async ({ page }, testInfo) => {
  const auth = await login(page);
  const graph = await reviewConfiguration(page, auth.csrf_token);
  const headers = { 'X-CSRF-Token': auth.csrf_token };
  // 前置只构建一个虚构的已处理机会；本用例不执行内容生成或复测闭环。
  const batch = await body<Schema['GeoBatchCreated']>(await page.request.post(`${api}/api/v1/geo/monitoring-plans/${graph.plan.id}/run`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { expected_revision: graph.plan.revision },
  }), 201);
  const runPage = await body<Schema['GeoRunListPage']>(await page.request.get(`${api}${runs}`, { params: { batch_id: batch.batch_id } }));
  const run = runPage.items[0]; if (!run) throw new Error('706前置没有运行');
  const entry = await body<Schema['GeoManualEntryContext']>(await page.request.get(`${api}${runs}/${run.id}/manual-entry`));
  // require_screenshot=false 仍要求截图或原始证据；走真实上传与校验合同。
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
  const upload = await body<Schema['UploadIntent']>(await page.request.post(`${api}/api/v1/files/upload-intents`, {
    headers, data: { category: 'OPERATION_SCREENSHOT', access_level: 'INTERNAL', original_filename: 'geo706-fixture.png', content_type: 'image/png', size: png.length, sha256: createHash('sha256').update(png).digest('hex') } satisfies Schema['UploadIntentCreate'],
  }), 201);
  expect((await page.request.put(`${api}${upload.upload.url}`, { headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: png })).status()).toBe(204);
  const file = await body<Schema['FileRecord']>(await page.request.post(`${api}/api/v1/files/${upload.file.id}/complete`, { headers }));
  expect(file.status).toBe('VERIFIED');
  await body(await page.request.post(`${api}${runs}/${run.id}/manual-submit`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { answer_text: `${graph.partNumber} 的供电电压为 5 V。`, answer_format: 'TEXT', source_product: 'GEO706虚构观测',
      source_model: 'fixture-model', source_version: 'fixture-v1', screenshot_file_id: file.id, collected_at: run.created_at, expected_draft_revision: entry.draft_revision,
      citations: [{ original_url: 'https://geo706-fictional.test/spec', title: '虚构规格', position: 1, extraction_source: 'MANUAL' }],
    } satisfies Schema['GeoManualObservationSubmit'],
  }), 201);
  await expect.poll(async () => (await detail(page, run.id)).analysis.selection.current_analysis_revision_id, { timeout: 90_000 }).not.toBeNull();
  const machine = await detail(page, run.id);
  const analysis = machine.analysis.selection.current_analysis_revision_id;
  if (!analysis) throw new Error('706前置缺少分析版本');
  await body<Schema['GeoRunReviewCreated']>(await page.request.post(`${api}${runs}/${run.id}/review`, {
    headers, data: { analysis_revision_id: analysis, expected_run_revision: machine.run.revision, decision: 'CONFIRMED', correction_payload: null,
      comment: '虚构测试：确认5V声明与批准3.3V事实不一致。' } satisfies Schema['GeoRunReviewRequest'],
  }), 201);
  const seeded = await promisify(execFile)(resolve(process.cwd(), '../backend/.venv/bin/python'), ['-m', 'tests.geo_opportunity_e2e_seed', run.id], {
    cwd: process.cwd(), timeout: 40_000, env: { ...process.env, GEO_OPPORTUNITY_EVALUATION_ENABLED: 'true' },
  });
  const seed = JSON.parse(seeded.stdout) as { opportunity_id: string };
  const initial = await body<Schema['GeoOpportunityDetail']>(await page.request.get(`${api}${opportunities}/${seed.opportunity_id}`));
  const ack = await body<Schema['GeoOpportunityListItem']>(await page.request.post(`${api}${opportunities}/${seed.opportunity_id}/acknowledge`, {
    headers, data: { expected_revision: initial.opportunity.revision },
  }));
  if (!initial.opportunity.product_id) throw new Error('706前置缺少产品');
  const linked = await body<Schema['GeoOpportunityActionResult']>(await page.request.post(`${api}${opportunities}/${seed.opportunity_id}/actions/fact-revision`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { expected_revision: ack.revision, product_id: initial.opportunity.product_id } satisfies Schema['GeoOpportunityFactRevisionRequest'],
  }));
  // 命令取消旧查询及刷新会中止这三个精确GET；任何写请求失败仍归运行时错误。
  const audit = createRealStackRuntimeAudit({
    apiOrigin: api, getPhase: () => 'geo706',
    allowedCancellations: [opportunities, `${opportunities}/${seed.opportunity_id}`, `${opportunities}/${seed.opportunity_id}/comparison`].map((pathname) => ({
      phase: 'geo706', method: 'GET', origin: new URL(api).origin, pathname, reason: 'net::ERR_ABORTED',
    })),
  }); audit.watch(page);
  await page.goto(`/geo/opportunities?opportunity_id=${seed.opportunity_id}`);
  const drawer = page.getByRole('dialog', { name: '机会详情与历史证据', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('region', { name: '干预前后比较', exact: true })).toContainText('因果');
  await drawer.getByRole('button', { name: '继续跟进', exact: true }).click();
  await drawer.getByRole('textbox', { name: '处理原因代码', exact: true }).fill('FOLLOW_UP');
  await drawer.getByRole('textbox', { name: '处理原因说明', exact: true }).fill('虚构复核：继续收集证据，尚未确认恢复。');
  const continuation = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `${opportunities}/${seed.opportunity_id}/continue`);
  await drawer.getByRole('button', { name: '确认继续跟进', exact: true }).click();
  const continuedHttp = await continuation;
  expect(continuedHttp.request().postDataJSON()).toMatchObject({ expected_revision: linked.opportunity_revision, resolution_code: 'FOLLOW_UP' });
  const continued = await body<Schema['GeoOpportunityDecisionResult']>(continuedHttp);
  expect(continued.opportunity.status).toBe('IN_PROGRESS'); expect(continued.decision.decision).toBe('CONTINUE');
  await expect(drawer.getByText('虚构复核：继续收集证据，尚未确认恢复。', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(drawer.getByText('虚构复核：继续收集证据，尚未确认恢复。', { exact: true }).first()).toBeVisible();
  await drawer.getByRole('button', { name: '人工解决', exact: true }).click();
  await drawer.getByRole('textbox', { name: '处理原因代码', exact: true }).fill('MANUALLY_VERIFIED');
  await drawer.getByRole('textbox', { name: '处理原因说明', exact: true }).fill('虚构测试：人工核对并确认处理完成，保留原始证据。');
  const resolution = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `${opportunities}/${seed.opportunity_id}/resolve`);
  await drawer.getByRole('button', { name: '确认人工解决', exact: true }).click();
  const resolvedHttp = await resolution;
  expect(resolvedHttp.request().postDataJSON()).toMatchObject({ expected_revision: continued.opportunity.revision, resolution_method: 'MANUAL' });
  const resolved = await body<Schema['GeoOpportunityDecisionResult']>(resolvedHttp);
  expect(resolved.opportunity.status).toBe('RESOLVED'); expect(resolved.decision.decision).toBe('MANUAL_RESOLVE');
  await expect(drawer.getByRole('button', { name: '人工解决', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(drawer.getByText('虚构测试：人工核对并确认处理完成，保留原始证据。', { exact: true }).first()).toBeVisible();
  const history = await body<Schema['GeoOpportunityComparisonRead']>(await page.request.get(`${api}${opportunities}/${seed.opportunity_id}/comparison`));
  expect(history.decisions.map((item) => item.decision)).toEqual(['CONTINUE', 'MANUAL_RESOLVE']);
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `viewport ${width}`).toBe(true);
  }
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '200%').toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  await page.screenshot({ path: testInfo.outputPath('geo706-history.png'), fullPage: true, animations: 'disabled' });
  expect(audit.errors).toEqual([]);
});
