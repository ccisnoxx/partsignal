/** GEO-508：严重错误从不可变原文、机器分析到追加复核历史的真实页面验收。 */
import { expect, test, type Page } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { api, body, createBatch, detail, login, runs, uiCommand } from './geo-api-support';
import { reviewConfiguration } from './geo-review-support';
import { registerCurrentRealStackCookies } from './real-stack-session';
import { createRealStackRuntimeAudit, type RuntimeCancellation } from './real-stack-runtime';

type Schema = components['schemas'];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '只由隔离真实栈入口运行');
test.setTimeout(180_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('严重声明禁止默认确认；人工确认与修正追加且原文、机器结果和历史可追溯', async ({ page }, testInfo) => {
  const auth = await login(page);
  const graph = await reviewConfiguration(page, auth.csrf_token);
  const writes: Schema['GeoRunReviewRequest'][] = [];
  const apiOrigin = new URL(api).origin;
  const cancellations: RuntimeCancellation[] = [{ phase: 'flow', method: 'GET', origin: apiOrigin, pathname: runs, reason: 'net::ERR_ABORTED' }];
  const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'flow', allowedCancellations: cancellations });
  audit.watch(page);
  // 与既有上传验收一致：仅收到真正的 204 后允许 Chromium 的空响应结束事件。
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() === 204 && response.request().method() === 'PUT' && url.origin === apiOrigin && /^\/api\/v1\/files\/[0-9a-f-]+\/content$/.test(url.pathname)) {
      cancellations.push({ phase: 'flow', method: 'PUT', origin: apiOrigin, pathname: url.pathname, reason: 'net::ERR_ABORTED' });
    }
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/review')) {
      writes.push(request.postDataJSON() as Schema['GeoRunReviewRequest']);
    }
  });
  const { runId } = await createBatch(page, graph.plan, graph.planName, graph.promptName);
  cancellations.push({ phase: 'flow', method: 'GET', origin: apiOrigin, pathname: `${runs}/${runId}`, reason: 'net::ERR_ABORTED' });
  await page.getByRole('region', { name: '运行详情', exact: true }).getByRole('button', { name: '人工录入', exact: true }).click();
  const answer = `${graph.partNumber} 的供电电压为 5 V。\n<script>window.__geoR4Unsafe = true</script>`;
  await page.getByRole('textbox', { name: '回答原文', exact: true }).fill(answer);
  await page.getByRole('textbox', { name: '实际采集时间', exact: true }).fill(new Date().toISOString());
  await page.getByRole('button', { name: '添加引用', exact: true }).click();
  await page.getByRole('textbox', { name: '引用 1 URL', exact: true }).fill('https://geo-fixture-owned.test/spec');
  await page.getByRole('textbox', { name: '引用 1 标题', exact: true }).fill('虚构参数来源');
  await page.getByLabel('上传人工采集截图', { exact: true }).setInputFiles({ name: 'r4-manual.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText(/^已校验截图：/)).toBeVisible();
  const savedDraft = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `${runs}/${runId}/manual-draft`);
  await page.getByRole('button', { name: '保存人工草稿', exact: true }).click();
  await body(await savedDraft);
  await uiCommand(page, `${runs}/${runId}/manual-submit`, () => page.getByRole('button', { name: '正式提交人工观测', exact: true }).click(), 201);
  await expect.poll(async () => (await detail(page, runId)).analysis.selection.current_analysis_revision_id, { timeout: 90_000 }).not.toBeNull();
  await expect(page.getByRole('region', { name: '当前机器分析', exact: true })).toBeVisible({ timeout: 15_000 });
  const before = await detail(page, runId);
  const machine = before.analysis.revisions[0];
  expect(before.run.status).toBe('NEEDS_REVIEW');
  expect(machine.claims).toHaveLength(1);
  expect(machine.claims[0]).toMatchObject({ verdict: 'INCORRECT', severity: 'HIGH', fact_version_id: graph.factId });
  expect(before.analysis.review_gate_passed).toBe(false);
  expect(before.answer?.answer_text).toBe(answer);
  const machineTable = page.getByRole('region', { name: '机器声明结果', exact: true });
  await expect(machineTable).toContainText('5 V');
  await expect(machineTable).toContainText('3.3 V');
  await expect(machineTable).toContainText(graph.factId);
  expect(await page.evaluate(() => '__geoR4Unsafe' in window)).toBe(false);

  await page.getByRole('button', { name: '开始人工复核', exact: true }).click();
  const form = page.getByRole('form', { name: '人工复核表单', exact: true });
  const submit = form.getByRole('button', { name: '提交人工复核', exact: true });
  const checked = form.getByRole('checkbox', { name: '已核对严重声明 1', exact: true });
  await expect(checked).not.toBeChecked();
  await submit.click();
  await expect(form.getByRole('alert').first()).toBeVisible();
  expect(writes).toHaveLength(0);
  await choose(page, '复核结论', 'CONFIRMED · 确认机器结论');
  const comment = '已对照批准的3.3V事实逐条核对5V原文，确认机器高风险错误判断。';
  await form.getByRole('textbox', { name: '复核说明', exact: true }).fill(comment);
  // runBeforeUnload 原生触发离开，不等待被用户取消的导航完成。
  const unload = page.waitForEvent('dialog', { timeout: 5000 });
  const closing = page.close({ runBeforeUnload: true });
  const dialog = await unload;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await closing;
  expect(page.isClosed()).toBe(false);
  await expect(form.getByRole('textbox', { name: '复核说明', exact: true })).toHaveValue(comment);
  await submit.click();
  expect(writes).toHaveLength(0);
  await checked.focus();
  await page.keyboard.press('Space');
  await expect(checked).toBeChecked();
  await uiCommand(page, `${runs}/${runId}/review`, () => submit.click(), 201);
  await expect(form).toBeHidden();
  await expect.poll(async () => (await detail(page, runId)).analysis.review_gate_passed).toBe(true);
  const confirmed = await detail(page, runId);
  expect(confirmed.analysis.effective_results?.claims[0]).toEqual(machine.claims[0]);
  expect(confirmed.analysis.reviews).toHaveLength(1);
  expect(confirmed.data_quality.metric_eligible).toBeNull();
  expect(writes[0]).toMatchObject({ analysis_revision_id: machine.analysis.id, expected_run_revision: before.run.revision, decision: 'CONFIRMED', correction_payload: null });

  await page.getByRole('button', { name: '开始人工复核', exact: true }).click();
  await choose(page, '复核结论', 'CORRECTED · 提交修正');
  await expect(checked).not.toBeChecked();
  await checked.check();
  await form.getByRole('textbox', { name: '复核说明', exact: true }).fill('已人工处理严重声明，保留错误判定并补充修正说明及来源分类。');
  await form.getByRole('checkbox', { name: '修正声明 1', exact: true }).check();
  const explanation = '人工核验：批准事实为3.3V，原文5V错误，需要纠正原回答。';
  await form.getByRole('textbox', { name: '声明 1 解释', exact: true }).fill(explanation);
  await form.getByRole('checkbox', { name: '修正引用 1', exact: true }).check();
  await choose(page, '引用 1 来源分类', 'COMMUNITY');
  await uiCommand(page, `${runs}/${runId}/review`, () => submit.click(), 201);
  await expect(form).toBeHidden();
  await expect.poll(async () => (await detail(page, runId)).analysis.reviews.length).toBe(2);
  const corrected = await detail(page, runId);
  expect(corrected.answer).toEqual(before.answer);
  expect(corrected.citations).toEqual(before.citations);
  expect(corrected.analysis.revisions).toEqual(before.analysis.revisions);
  expect(corrected.analysis.reviews.map((row) => row.is_current)).toEqual([true, false]);
  expect(corrected.analysis.reviews[1]).toMatchObject({ review: confirmed.analysis.reviews[0].review, is_current: false });
  expect(corrected.analysis.effective_results?.claims[0]).toMatchObject({ verdict: 'INCORRECT', severity: 'HIGH', explanation, confidence: null });
  expect(corrected.analysis.effective_results?.citations[0].source_category).toBe('COMMUNITY');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ analysis_revision_id: machine.analysis.id, expected_run_revision: confirmed.run.revision, decision: 'CORRECTED' });

  await page.reload();
  const history = page.getByRole('region', { name: '分析与复核历史，只读', exact: true });
  await history.locator('summary').filter({ hasText: '复核 CONFIRMED · 历史' }).click();
  await history.locator('summary').filter({ hasText: '复核 CORRECTED · 当前' }).click();
  await expect(history).toContainText(confirmed.analysis.reviews[0].review.comment);
  await expect(history).toContainText(explanation);
  await expect(page.getByRole('region', { name: '有效声明结果', exact: true })).toContainText(explanation);
  await expect(machineTable).toContainText(machine.claims[0].explanation);
  await expect(history.getByRole('textbox')).toHaveCount(0);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: testInfo.outputPath('geo508-review-history.png'), fullPage: true });
  expect(audit.errors).toEqual([]);
});
