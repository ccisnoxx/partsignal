/** GEO-606：真实 PostgreSQL/API、当前分析和复核，原生下载与打印介质。 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { defaultParseSearch } from '@tanstack/react-router';
import { expect, test } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { api, body, detail, login, runs } from './geo-api-support';
import { reviewConfiguration } from './geo-review-support';
import { registerCurrentRealStackCookies } from './real-stack-session';
type Schema = components['schemas'];
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '仅在隔离 PostgreSQL/API 真实栈中运行');
test.skip(Boolean(process.env.PARTSIGNAL_E2E_GEO_MODE), '人工报告旅程由 canonical phase 验收');
test.setTimeout(150_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));
test('完整筛选报告、打印样式、三类原生CSV、审计与空数据', async ({ page }, testInfo) => {
  const auth = await login(page); const graph = await reviewConfiguration(page, auth.csrf_token);
  const headers = { 'X-CSRF-Token': auth.csrf_token };
  const batch = await body<Schema['GeoBatchCreated']>(await page.request.post(`${api}/api/v1/geo/monitoring-plans/${graph.plan.id}/run`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { expected_revision: graph.plan.revision },
  }), 201);
  const list = await body<Schema['GeoRunListPage']>(await page.request.get(`${api}${runs}`, { params: { batch_id: batch.batch_id } }));
  const run = list.items[0]; if (!run) throw new Error('报告前置批次没有运行');
  const input = await body<Schema['GeoManualEntryContext']>(await page.request.get(`${api}${runs}/${run.id}/manual-entry`));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
  const upload = await body<Schema['UploadIntent']>(await page.request.post(`${api}/api/v1/files/upload-intents`, { headers, data: { category: 'OPERATION_SCREENSHOT', access_level: 'INTERNAL', original_filename: 'geo606-fixture.png', content_type: 'image/png', size: png.length, sha256: createHash('sha256').update(png).digest('hex') } satisfies Schema['UploadIntentCreate'] }), 201);
  expect((await page.request.put(`${api}${upload.upload.url}`, { headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: png })).status()).toBe(204);
  const file = await body<Schema['FileRecord']>(await page.request.post(`${api}/api/v1/files/${upload.file.id}/complete`, { headers }));
  expect(file.status).toBe('VERIFIED');
  await body(await page.request.post(`${api}${runs}/${run.id}/manual-submit`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { answer_text: `${graph.partNumber} 的供电电压为 5 V。`, answer_format: 'TEXT', source_product: '虚构报告观测', screenshot_file_id: file.id, collected_at: run.created_at, expected_draft_revision: input.draft_revision, citations: [{ original_url: 'https://geo-fixture-owned.test/spec?signed=fixture-only', title: '=1+1', position: 1, extraction_source: 'MANUAL' }] } satisfies Schema['GeoManualObservationSubmit'],
  }), 201);
  await expect.poll(async () => (await detail(page, run.id)).analysis.selection.current_analysis_revision_id, { timeout: 90_000 }).not.toBeNull();
  const machine = await detail(page, run.id); const analysisId = machine.analysis.selection.current_analysis_revision_id;
  if (!analysisId) throw new Error('报告前置分析缺少 revision');
  await body(await page.request.post(`${api}${runs}/${run.id}/review`, { headers, data: { analysis_revision_id: analysisId, expected_run_revision: machine.run.revision, decision: 'CONFIRMED', correction_payload: null, comment: '已核对虚构5V声明与批准3.3V事实。' } satisfies Schema['GeoRunReviewRequest'] }), 201);
  const snapshot = machine.run.input_snapshot; const subject = snapshot.subjects[0];
  if (!subject?.product_id) throw new Error('报告前置对象缺失');
  const start = new Date(new Date(run.created_at).getTime() - 60_000).toISOString();
  const end = new Date(new Date(run.created_at).getTime() + 60_000).toISOString();
  const base = { date_from: start, date_to: end, subject_ids: [subject.id], product_ids: [subject.product_id], query_topic_ids: [snapshot.prompt.query_topic_id], prompt_variant_ids: [snapshot.prompt.id], engine_surface_ids: [snapshot.profile.surface.id], collection_profile_ids: [snapshot.profile.id], collection_modes: ['MANUAL'], language_codes: ['zh-cn'], region_codes: ['CN'], login_states: ['ANONYMOUS'], intent_types: ['PRODUCT'], mention_mode: 'BRANDED', review_policy: 'REVIEWED_ONLY' };
  const query = new URLSearchParams(Object.entries(base).map(([key, value]) => [key, Array.isArray(value) ? JSON.stringify(value) : value]));
  await page.goto(`/geo/insights/answers?${query}`);
  await page.getByRole('navigation', { name: 'GEO 分析页面' }).getByRole('link', { name: '报告预览', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'GEO 报告预览', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '报告公式字典' })).toContainText('geo-answer-v1');
  await expect(page.getByRole('heading', { name: '运行与数据质量' })).toBeVisible();
  expect(defaultParseSearch(new URL(page.url()).search)).toMatchObject(base);
  for (const kind of ['运行', '引用', '声明']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('navigation', { name: 'CSV 下载' }).getByRole('link', { name: `${kind} CSV`, exact: true }).click();
    const download = await pending; expect(await download.failure()).toBeNull();
    const path = await download.path(); if (!path) throw new Error('原生下载未返回文件');
    const bytes = await readFile(path); expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    const text = bytes.toString('utf8'); expect(text).toContain(run.id); expect(text).toContain(analysisId);
    expect(text).not.toContain('signed='); expect(text).not.toContain('raw_payload'); expect(text).not.toContain('answer_text');
    if (kind === '引用') { expect(text).toContain("'=1+1"); expect(text).toContain('normalized_url_sha256'); }
    if (kind === '声明') expect(text).toContain(graph.factId);
    expect(download.suggestedFilename()).toMatch(/^geo-(runs|citations|claims)-\d{8}-\d{6}Z\.csv$/);
  }
  await expect(page.getByRole('navigation', { name: 'CSV 下载' }).getByRole('link', { name: '机会 CSV', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '打开打印报告', exact: true }).click();
  await expect(page.getByRole('button', { name: '打印', exact: true })).toBeVisible();
  expect(defaultParseSearch(new URL(page.url()).search)).toMatchObject(base);
  const dateFrom = page.locator('.geo-answer-report dt').filter({ hasText: /^date_from$/ }).locator('..').locator('dd');
  expect(new Date(await dateFrom.innerText()).toISOString()).toBe(start);
  await expect(page.getByRole('article')).toContainText(subject.id);
  await expect(page.getByRole('article')).toContainText('as_of'); await expect(page.getByRole('article')).toContainText('尚未实现');
  expect(await page.locator('.geo-answer-report details').count()).toBe(0);
  let printed = false; await page.exposeFunction('recordPrint', () => { printed = true; });
  await page.evaluate(() => { window.print = () => { void (window as unknown as { recordPrint: () => Promise<void> }).recordPrint(); }; });
  await page.getByRole('button', { name: '打印', exact: true }).click(); expect(printed).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: '打印', exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'GEO 报告打印', exact: true })).toBeVisible();
  const clipped = await page.locator('.geo-answer-report .ps-table-region').evaluateAll((regions) => regions.some((region) => region.scrollWidth > region.clientWidth + 1));
  expect(clipped).toBe(false);
  const pdf = await page.pdf({ path: testInfo.outputPath('geo606-report.pdf'), format: 'A4', printBackground: true }); expect(pdf.length).toBeGreaterThan(5000);
  await page.emulateMedia({ media: 'screen' });
  const audit = await body<Schema['AuditLogList']>(await page.request.get(`${api}/api/v1/audit-logs`, { params: { business_module: 'GEO_OBSERVATION', page_size: 50 } }));
  expect(audit.items.some((item) => item.action === 'geo_report.print_prepared')).toBe(true);
  expect(audit.items.filter((item) => item.action === 'geo_report.export_started').length).toBeGreaterThanOrEqual(3);
  await page.getByRole('link', { name: '返回报告预览', exact: true }).click();
  const form = page.getByRole('form', { name: 'GEO 洞察筛选' }); await form.locator('summary').click();
  await form.getByRole('textbox', { name: '监测对象 ID', exact: true }).fill(randomUUID());
  await form.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(page.getByRole('article')).toContainText('当前筛选没有运行数据');
  expect(await page.getByRole('link', { name: '打开打印报告', exact: true }).count()).toBe(0);
  const nativeParams = new URLSearchParams({ date_from: start, date_to: end, subject_ids: randomUUID() });
  const empty = await body<Schema['ErrorEnvelope']>(await page.request.get(`${api}/api/v1/geo/reports/runs.csv?${nativeParams}`), 409);
  expect(empty.error.code).toBe('GEO_REPORT_EMPTY');
  const unsupported = await body<Schema['ErrorEnvelope']>(await page.request.get(`${api}/api/v1/geo/reports/opportunities.csv?${nativeParams}`), 501);
  expect(unsupported.error.code).toBe('NOT_IMPLEMENTED');
});
