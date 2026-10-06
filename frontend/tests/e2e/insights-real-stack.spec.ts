/** GEO-605：前置状态通过已验收 API 准备，页面不拦截任何业务 API。 */
import { createHash, randomUUID } from 'node:crypto';
import { defaultParseSearch } from '@tanstack/react-router';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { api, body, detail, login, runs } from './geo-api-support';
import { reviewConfiguration } from './geo-review-support';
import { registerCurrentRealStackCookies } from './real-stack-session';
type Schema = components['schemas'];
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '仅在隔离 PostgreSQL/API 真实栈中运行');
test.skip(Boolean(process.env.PARTSIGNAL_E2E_GEO_MODE), '605 人工分析旅程由 canonical phase 验收');
test.setTimeout(150_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));
function readUrl(page: Page) { return defaultParseSearch(new URL(page.url()).search); }
test('全筛选、真实汇总与明细、URL恢复、表格替代和键盘焦点', async ({ page }, testInfo) => {
  const auth = await login(page);
  const graph = await reviewConfiguration(page, auth.csrf_token);
  const headers = { 'X-CSRF-Token': auth.csrf_token };
  const batch = await body<Schema['GeoBatchCreated']>(await page.request.post(`${api}/api/v1/geo/monitoring-plans/${graph.plan.id}/run`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { expected_revision: graph.plan.revision },
  }), 201);
  const runPage = await body<Schema['GeoRunListPage']>(await page.request.get(`${api}${runs}`, { params: { batch_id: batch.batch_id } }));
  const run = runPage.items[0]; if (!run) throw new Error('605 前置批次没有运行');
  const input = await body<Schema['GeoManualEntryContext']>(await page.request.get(`${api}${runs}/${run.id}/manual-entry`));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
  const upload = await body<Schema['UploadIntent']>(await page.request.post(`${api}/api/v1/files/upload-intents`, { headers, data: { category: 'OPERATION_SCREENSHOT', access_level: 'INTERNAL', original_filename: 'geo605-fixture.png', content_type: 'image/png', size: png.length, sha256: createHash('sha256').update(png).digest('hex') } satisfies Schema['UploadIntentCreate'] }), 201);
  expect((await page.request.put(`${api}${upload.upload.url}`, { headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: png })).status()).toBe(204);
  const file = await body<Schema['FileRecord']>(await page.request.post(`${api}/api/v1/files/${upload.file.id}/complete`, { headers }));
  expect(file.status).toBe('VERIFIED');
  const answer = `${graph.partNumber} 的供电电压为 5 V。\n<script>window.__geo605Unsafe=true</script>`;
  // 虚构观测使用 PG 返回的合法时间；宿主机与容器时钟不能作为同一时间源。
  const submitted = await page.request.post(`${api}${runs}/${run.id}/manual-submit`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { answer_text: answer, answer_format: 'TEXT', source_product: '虚构人工观测', screenshot_file_id: file.id, collected_at: run.created_at, expected_draft_revision: input.draft_revision, citations: [{ original_url: 'https://geo-fixture-owned.test/spec', title: '虚构来源', position: 1, extraction_source: 'MANUAL' }] } satisfies Schema['GeoManualObservationSubmit'],
  });
  if (submitted.status() !== 201) {
    const failure = await submitted.json() as Schema['ErrorEnvelope'];
    expect(submitted.status(), `${failure.error.code}: ${failure.error.message}`).toBe(201);
  }
  await body(submitted, 201);
  await expect.poll(async () => (await detail(page, run.id)).analysis.selection.current_analysis_revision_id, { timeout: 90_000 }).not.toBeNull();
  const machine = await detail(page, run.id);
  const analysisId = machine.analysis.selection.current_analysis_revision_id;
  if (!analysisId) throw new Error('605 前置分析缺少 revision');
  await body(await page.request.post(`${api}${runs}/${run.id}/review`, { headers, data: { analysis_revision_id: analysisId, expected_run_revision: machine.run.revision, decision: 'CONFIRMED', correction_payload: null, comment: '已逐条核对虚构5V声明和批准3.3V事实，确认机器结论。' } satisfies Schema['GeoRunReviewRequest'] }), 201);
  const snapshot = machine.run.input_snapshot;
  const subject = snapshot.subjects[0]; if (!subject?.product_id) throw new Error('605 前置产品对象缺失');
  const end = new Date(Date.now() + 60_000).toISOString(); const start = new Date(Date.now() - 86_400_000).toISOString();
  const query = new URLSearchParams({ date_from: start, date_to: end, subject_ids: JSON.stringify([subject.id]), product_ids: JSON.stringify([subject.product_id]), query_topic_ids: JSON.stringify([snapshot.prompt.query_topic_id]), prompt_variant_ids: JSON.stringify([snapshot.prompt.id]), engine_surface_ids: JSON.stringify([snapshot.profile.surface.id]), collection_profile_ids: JSON.stringify([snapshot.profile.id]), collection_modes: JSON.stringify(['MANUAL']), language_codes: JSON.stringify(['zh-CN']), region_codes: JSON.stringify(['CN']), login_states: JSON.stringify(['ANONYMOUS']), intent_types: JSON.stringify(['PRODUCT']), mention_mode: 'BRANDED', review_policy: 'REVIEWED_ONLY' });
  const observed: { pathname: string; query: URLSearchParams }[] = [];
  page.on('request', (request) => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/v1/geo/insights') || url.pathname.startsWith('/api/v1/geo/overview')) observed.push({ pathname: url.pathname, query: url.searchParams }); });
  await page.goto(`/geo/overview?${query}`);
  await expect(page.getByRole('heading', { name: 'GEO 总览', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '关键产品' })).toBeVisible();
  await expect(page.getByRole('region', { name: '近期批次表' })).toContainText(batch.batch_id);
  await page.getByRole('navigation', { name: 'GEO 分析页面' }).getByRole('link', { name: '回答洞察', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'GEO 回答洞察' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '引用分析' })).toBeVisible();
  await expect(page.getByRole('region', { name: '产品矩阵表格替代' })).toBeVisible();
  await expect(page.getByRole('region', { name: '竞品 SOV 表格替代' })).toBeVisible();
  const baseSearch = readUrl(page);
  const trigger = page.getByRole('button', { name: '查看准确声明率样本', exact: true }).first();
  await trigger.focus(); await page.keyboard.press('Enter');
  let dialog = page.getByRole('dialog', { name: '回答指标样本' });
  await expect(dialog.getByRole('region', { name: '指标组成样本表' })).toContainText(run.id);
  expect(readUrl(page)).toMatchObject({ ...baseSearch, detail: 'metric', metric_code: 'accurate_claim_rate' });
  await page.reload();
  dialog = page.getByRole('dialog', { name: '回答指标样本' }); await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await page.goBack(); await expect(page.getByRole('dialog', { name: '回答指标样本' })).toBeVisible();
  await page.goForward(); await expect(page.getByRole('dialog')).toBeHidden();
  // 重新从当前页触发，关闭后必须返回发起按钮。
  await trigger.focus(); await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  const riskButton = page.getByRole('button', { name: /^全部声明明细：/ }).first();
  await riskButton.click(); const risk = page.getByRole('dialog', { name: '事实风险明细' });
  await expect(risk.getByRole('region', { name: '事实风险声明明细表' })).toContainText(graph.factId);
  expect(await page.evaluate(() => '__geo605Unsafe' in window)).toBe(false);
  await page.keyboard.press('Escape');
  const citation = page.getByRole('button', { name: /^全部引用明细：/ }).first(); await citation.click();
  await expect(page.getByRole('dialog', { name: '引用证据明细' }).getByRole('region', { name: '引用证据明细表' })).toContainText('geo-fixture-owned.test');
  await page.keyboard.press('Escape');
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `viewport ${width}`).toBeLessThanOrEqual(1);
  }
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), '200%').toBeLessThanOrEqual(1);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  await page.screenshot({ path: testInfo.outputPath('geo605-insights.png'), fullPage: true });
  for (const request of observed) {
    expect(request.query.get('date_from')).toBe(start); expect(request.query.get('date_to')).toBe(end);
    expect(request.query.get('subject_ids')).toBe(subject.id); expect(request.query.get('product_ids')).toBe(subject.product_id);
    expect(request.query.get('review_policy')).toBe('REVIEWED_ONLY'); expect(request.query.get('collection_modes')).toBe('MANUAL');
  }
  const filterForm = page.getByRole('form', { name: 'GEO 洞察筛选' });
  await filterForm.locator('summary').click();
  await filterForm.getByRole('textbox', { name: '监测对象 ID', exact: true }).fill(randomUUID());
  await filterForm.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(page.getByText(/当前筛选没有运行样本/)).toBeVisible();
  expect(readUrl(page)).not.toHaveProperty('detail');
  await page.getByRole('navigation', { name: 'GEO 分析页面' }).getByRole('link', { name: '文章关系洞察', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'GEO 洞察', exact: true })).toBeVisible();
});
