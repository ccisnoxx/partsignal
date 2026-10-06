/** GEO-703/704：真实 API 历史证据、确认、事实行动导航与忽略。 */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { defaultParseSearch } from '@tanstack/react-router';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { api, body, detail, login, runs } from './geo-api-support';
import { reviewConfiguration } from './geo-review-support';
import { createRealStackRuntimeAudit } from './real-stack-runtime';
import { registerCurrentRealStackCookies } from './real-stack-session';

type Schema = components['schemas'];
const opportunities = '/api/v1/geo/opportunities';
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '仅在隔离 PostgreSQL/API 真实栈中运行');
test.skip(Boolean(process.env.PARTSIGNAL_E2E_GEO_MODE), '703 人工证据旅程由 canonical phase 验收');
test.setTimeout(150_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));
function readUrl(page: Page) { return defaultParseSearch(new URL(page.url()).search); }

test('历史回答、事实、复核与签名证据 → 确认 → 忽略 → 刷新和 Back 恢复', async ({ page }, testInfo) => {
  const auth = await login(page);
  const graph = await reviewConfiguration(page, auth.csrf_token);
  const headers = { 'X-CSRF-Token': auth.csrf_token };
  const batch = await body<Schema['GeoBatchCreated']>(await page.request.post(`${api}/api/v1/geo/monitoring-plans/${graph.plan.id}/run`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { expected_revision: graph.plan.revision } }), 201);
  const runPage = await body<Schema['GeoRunListPage']>(await page.request.get(`${api}${runs}`, { params: { batch_id: batch.batch_id } }));
  const run = runPage.items[0]; if (!run) throw new Error('703 前置批次没有运行');
  const input = await body<Schema['GeoManualEntryContext']>(await page.request.get(`${api}${runs}/${run.id}/manual-entry`));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
  const upload = await body<Schema['UploadIntent']>(await page.request.post(`${api}/api/v1/files/upload-intents`, { headers, data: { category: 'OPERATION_SCREENSHOT', access_level: 'INTERNAL', original_filename: 'geo703-fictional.png', content_type: 'image/png', size: png.length, sha256: createHash('sha256').update(png).digest('hex') } satisfies Schema['UploadIntentCreate'] }), 201);
  expect((await page.request.put(`${api}${upload.upload.url}`, { headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: png })).status()).toBe(204);
  const file = await body<Schema['FileRecord']>(await page.request.post(`${api}/api/v1/files/${upload.file.id}/complete`, { headers }));
  expect(file.status).toBe('VERIFIED');
  const answer = `${graph.partNumber} 的供电电压为 5 V。\n<script>window.__geo703Unsafe=true</script>`;
  await body(await page.request.post(`${api}${runs}/${run.id}/manual-submit`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { answer_text: answer, answer_format: 'TEXT', source_product: 'GEO703 虚构人工观测', screenshot_file_id: file.id, collected_at: run.created_at, expected_draft_revision: input.draft_revision, citations: [{ original_url: 'https://geo703-fictional.test/spec', title: 'GEO703 虚构规格来源', position: 1, extraction_source: 'MANUAL' }] } satisfies Schema['GeoManualObservationSubmit'] }), 201);
  await expect.poll(async () => (await detail(page, run.id)).analysis.selection.current_analysis_revision_id, { timeout: 90_000 }).not.toBeNull();
  const machine = await detail(page, run.id); const analysisId = machine.analysis.selection.current_analysis_revision_id;
  if (!analysisId) throw new Error('703 前置分析缺少 revision');
  const historicalComment = 'GEO703 历史复核：已核对虚构 5V 声明与批准 3.3V 事实，确认机器结论。';
  const reviewed = await body<Schema['GeoRunReviewCreated']>(await page.request.post(`${api}${runs}/${run.id}/review`, { headers, data: { analysis_revision_id: analysisId, expected_run_revision: machine.run.revision, decision: 'CONFIRMED', correction_payload: null, comment: historicalComment } satisfies Schema['GeoRunReviewRequest'] }), 201);
  const seeded = await promisify(execFile)(resolve(process.cwd(), '../backend/.venv/bin/python'), ['-m', 'tests.geo_opportunity_e2e_seed', run.id], { cwd: process.cwd(), timeout: 40_000, env: { ...process.env, GEO_OPPORTUNITY_EVALUATION_ENABLED: 'true' } });
  const seed = JSON.parse(seeded.stdout) as { opportunity_id: string; run_id: string };
  expect(seed.run_id).toBe(run.id);
  const initial = await body<Schema['GeoOpportunityDetail']>(await page.request.get(`${api}${opportunities}/${seed.opportunity_id}`));
  expect(initial.opportunity).toMatchObject({ status: 'OPEN', rule_code: 'CRITICAL_FACT_ERROR', available_actions: ['ACKNOWLEDGE', 'DISMISS'] });
  expect(initial.sources.items[0]).toMatchObject({ run_id: run.id, analysis_revision_id: analysisId, review_id: reviewed.review.id });
  // 追加当前复核后，机会仍必须读取保存的旧复核身份。
  const newer = await body<Schema['GeoRunReviewCreated']>(await page.request.post(`${api}${runs}/${run.id}/review`, { headers, data: { analysis_revision_id: analysisId, expected_run_revision: reviewed.run_revision, decision: 'CONFIRMED', correction_payload: null, comment: 'GEO703 新当前复核，不得替换机会来源保存的历史复核。' } satisfies Schema['GeoRunReviewRequest'] }), 201);
  expect(newer.review.id).not.toBe(reviewed.review.id);
  const scope = initial.opportunity.scope;
  const query = new URLSearchParams({ q: graph.partNumber, collection_mode: 'MANUAL', rule_code: 'CRITICAL_FACT_ERROR', priority: initial.opportunity.priority, sort: 'CREATED_DESC', page_size: '10', created_from: new Date(new Date(initial.opportunity.created_at).getTime() - 60_000).toISOString(), created_to: new Date(new Date(initial.opportunity.created_at).getTime() + 60_000).toISOString() });
  for (const [key, value] of Object.entries({ subject_id: scope.subject_id, product_id: initial.opportunity.product_id, query_topic_id: scope.query_topic_id, prompt_variant_id: scope.prompt_variant_id, collection_profile_id: scope.collection_profile_id, engine_surface_id: scope.engine_surface_id })) if (value !== null) query.set(key, value);
  const apiOrigin = new URL(api).origin;
  const audit = createRealStackRuntimeAudit({
    apiOrigin, getPhase: () => 'opportunities',
    // 页面刷新、Drawer 切换和命令前取消旧读取；706增加比较读请求，仍只允许三个精确GET路径。
    allowedCancellations: [opportunities, `${opportunities}/${seed.opportunity_id}`, `${opportunities}/${seed.opportunity_id}/comparison`].map((pathname) => ({
      phase: 'opportunities', method: 'GET', origin: apiOrigin, pathname, reason: 'net::ERR_ABORTED',
    })),
  }); audit.watch(page);
  await page.goto(`/geo/opportunities?${query}`);
  const table = page.getByRole('region', { name: 'GEO 机会列表', exact: true });
  await expect(table.getByRole('button', { name: initial.opportunity.title, exact: true })).toBeVisible();
  const baseSearch = readUrl(page); const trigger = table.getByRole('button', { name: initial.opportunity.title, exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: '机会详情与历史证据', exact: true });
  await expect(drawer.getByRole('region', { name: '历史原始回答', exact: true })).toContainText(answer);
  await expect(drawer.getByRole('region', { name: '历史有效声明与事实依据', exact: true })).toContainText(graph.factId);
  await expect(drawer.getByRole('region', { name: '历史有效声明与事实依据', exact: true })).toContainText('3.3');
  const history = drawer.getByRole('region', { name: '来源绑定历史人工复核', exact: true });
  await expect(history).toContainText(reviewed.review.id); await expect(history).toContainText(historicalComment); await expect(history).not.toContainText(newer.review.id);
  await expect(drawer.getByRole('link', { name: 'GEO703 虚构规格来源', exact: true })).toHaveAttribute('href', 'https://geo703-fictional.test/spec');
  const image = drawer.getByRole('img', { name: '机会来源截图证据', exact: true }); await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const signedUrl = await drawer.getByRole('link', { name: '打开受控证据文件', exact: true }).getAttribute('href');
  if (!signedUrl) throw new Error('703 历史截图缺少受控访问 URL');
  expect((await page.request.get(new URL(signedUrl, api).href)).status()).toBe(200);
  expect(await page.evaluate(() => '__geo703Unsafe' in window)).toBe(false);
  expect(readUrl(page)).toMatchObject({ ...baseSearch, opportunity_id: seed.opportunity_id });
  await expect(drawer.getByRole('button', { name: /复测|解决机会|创建行动/ })).toHaveCount(0);
  await expect(drawer).toHaveCSS('opacity', '1');
  expect(await drawer.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(700);
  await page.screenshot({ path: testInfo.outputPath('geo703-opportunity-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 1000 });
  await expect(drawer.getByRole('button', { name: '确认机会', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('geo703-opportunity-mobile.png'), fullPage: true, animations: 'disabled' });
  const ackResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `${opportunities}/${seed.opportunity_id}/acknowledge`);
  await drawer.getByRole('button', { name: '确认机会', exact: true }).click();
  const ackHttp = await ackResponse; expect(ackHttp.request().postDataJSON()).toEqual({ expected_revision: initial.opportunity.revision });
  const ack = await body<Schema['GeoOpportunityListItem']>(ackHttp); expect(ack.status).toBe('ACKNOWLEDGED'); expect(ack.revision).toBe(initial.opportunity.revision + 1);
  await expect(drawer.getByText(`已确认机会（revision ${ack.revision}）。历史证据继续保留。`, { exact: true })).toBeVisible();
  if (!initial.opportunity.product_id) throw new Error('704 严重事实错误缺少产品身份');
  const action = await body<Schema['GeoOpportunityActionResult']>(await page.request.post(`${api}${opportunities}/${seed.opportunity_id}/actions/fact-revision`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { expected_revision: ack.revision, product_id: initial.opportunity.product_id } satisfies Schema['GeoOpportunityFactRevisionRequest'] }));
  expect(action.replayed).toBe(false); expect(action.action.source_snapshot?.sources[0]?.review_id).toBe(reviewed.review.id);
  await page.reload();
  const actionLink = drawer.getByRole('link', { name: '打开行动目标', exact: true });
  await expect(actionLink).toHaveAttribute('href', action.action.navigation_path!);
  await actionLink.focus(); await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/products/${initial.opportunity.product_id}/facts`);
  await page.goBack(); await expect(drawer).toBeVisible(); await expect(actionLink).toBeVisible();
  await drawer.getByRole('button', { name: '忽略机会', exact: true }).click();
  await drawer.getByRole('textbox', { name: '忽略原因代码', exact: true }).fill('NON_ACTIONABLE');
  await drawer.getByRole('textbox', { name: '忽略原因说明', exact: true }).fill('虚构验收：人工核对后忽略，原始证据继续保存。');
  const dismissResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `${opportunities}/${seed.opportunity_id}/dismiss`);
  await drawer.getByRole('button', { name: '确认忽略', exact: true }).click();
  const dismissed = await body<Schema['GeoOpportunityListItem']>(await dismissResponse); expect(dismissed.status).toBe('DISMISSED'); expect(dismissed.revision).toBe(action.opportunity_revision + 1);
  await expect(drawer.getByRole('region', { name: '处理记录', exact: true })).toContainText('NON_ACTIONABLE');
  await expect(drawer.getByRole('button', { name: '确认机会', exact: true })).toHaveCount(0); await expect(drawer.getByRole('button', { name: '忽略机会', exact: true })).toHaveCount(0);
  await page.reload(); await expect(drawer.getByRole('region', { name: '历史原始回答', exact: true })).toContainText(answer); await expect(history).toContainText(reviewed.review.id);
  expect(readUrl(page)).toMatchObject({ ...baseSearch, opportunity_id: seed.opportunity_id });
  await page.keyboard.press('Escape'); await expect(drawer).toBeHidden(); expect(readUrl(page)).toEqual(baseSearch);
  await trigger.focus(); await page.keyboard.press('Enter'); await expect(drawer).toBeVisible(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await page.goBack(); await expect(drawer).toBeVisible(); await expect(history).toContainText(reviewed.review.id);
  await page.goForward(); await expect(drawer).toBeHidden(); expect(readUrl(page)).toEqual(baseSearch);
  for (const width of [375, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `viewport ${width}`).toBe(true); }
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '200%').toBe(true); await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  expect((await body<Schema['GeoOpportunityDetail']>(await page.request.get(`${api}${opportunities}/${seed.opportunity_id}`))).sources.items[0]?.review_id).toBe(reviewed.review.id);
  expect(audit.errors).toEqual([]);
});
