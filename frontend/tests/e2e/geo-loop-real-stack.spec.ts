/** GEO-707：真实监测 → 内容行动 → 同环境复测 → 显式解决及安全审计。 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { defaultStringifySearch } from '@tanstack/react-router';
import type { components } from '../../src/shared/api/generated/schema';
import { api, body, login, runs, uiCommand } from './geo-api-support';
import { completeLoopContent, createLoopBaseline, evaluateLoopBaseline, loopConfiguration, opportunities, sourceEnvironment, submitLoopBatch } from './geo-loop-support';
import { createRealStackRuntimeAudit, type RuntimeCancellation } from './real-stack-runtime';
import { registerCurrentRealStackCookies } from './real-stack-session';

type Schema = components['schemas'];
function retainedSources(sources: Schema['GeoOpportunitySourcePage']) {
  // 下载签名和到期时间是每次读取生成的临时权限；其余证据身份、摘要与历史逐项保留。
  return { ...sources, items: sources.items.map((source) => ({
    ...source, evidence_files: source.evidence_files.map((file) => ({ ...file, download: null })),
  })) };
}
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '需要隔离 PostgreSQL、真实 API 与分析 Worker');
test.skip(Boolean(process.env.PARTSIGNAL_E2E_GEO_MODE), '仅在人工观测的 canonical 真实栈运行');
test.setTimeout(300_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));

test('五次覆盖缺口 → 确认与内容发布 → 五次严格复测恢复 → 人工显式解决 → 历史与审计保留', async ({ page }, testInfo) => {
  const auth = await login(page);
  const graph = await loopConfiguration(page, auth.csrf_token);
  const headers = { 'X-CSRF-Token': auth.csrf_token };
  const apiOrigin = new URL(api).origin;
  const cancellations: RuntimeCancellation[] = [];
  const allowedPaths = new Set<string>();
  const allowRead = (pathname: string) => {
    if (allowedPaths.has(pathname)) return;
    allowedPaths.add(pathname);
    cancellations.push({ phase: 'geo707', method: 'GET', origin: apiOrigin, pathname, reason: 'net::ERR_ABORTED' });
  };
  // 明确的旧查询取消与人工导航；未知 API、未确认成功的写请求和静态资源失败仍使测试失败。
  [runs, '/api/v1/geo/observation-batches', opportunities, '/api/v1/content-tasks', '/api/v1/publication-works', '/api/v1/publication-ready-items', '/api/v1/publication-workbench-summary'].forEach(allowRead);
  const runtime = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'geo707', allowedCancellations: cancellations });
  runtime.watch(page);
  // 与既有真实上传验收一致：只在真正收到204后接受Chromium空响应结束事件，仍核验文件摘要与VERIFIED。
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() === 204 && response.request().method() === 'PUT' && url.origin === apiOrigin && /^\/api\/v1\/files\/[0-9a-f-]+\/content$/.test(url.pathname)) {
      cancellations.push({ phase: 'geo707', method: 'PUT', origin: apiOrigin, pathname: url.pathname, reason: 'net::ERR_ABORTED' });
    }
  });

  const baselineBatch = await createLoopBaseline(page, graph);
  const baseline = await submitLoopBatch(page, baselineBatch.batch_id, graph.partNumber, 'baseline', allowRead);
  expect(baseline.map((item) => item.run.repeat_index)).toEqual([1, 2, 3, 4, 5]);
  const seed = await evaluateLoopBaseline(baselineBatch.batch_id);
  const path = `${opportunities}/${seed.opportunity_id}`;
  allowRead(path); allowRead(`${path}/comparison`);
  const initial = await body<Schema['GeoOpportunityDetail']>(await page.request.get(`${api}${path}`));
  expect(initial.opportunity).toMatchObject({ status: 'OPEN', rule_code: 'TOPIC_COVERAGE_GAP', numerator: 0, denominator: 5, product_id: graph.product.id });
  expect(initial.trigger_snapshot.rule_snapshot.configuration).toMatchObject({ sample_policy: { stable_minimum: 5 }, recovery: { topic_visibility_minimum_rate: 0.6 } });
  expect(initial.sources.total).toBe(5);
  expect(new Set(initial.sources.items.map((source) => source.run_id))).toEqual(new Set(baseline.map((item) => item.run.id)));
  await page.waitForLoadState('networkidle');
  await page.goto(`/geo/opportunities?opportunity_id=${seed.opportunity_id}`);
  const drawer = page.getByRole('dialog', { name: '机会详情与历史证据', exact: true });
  const waitForSourceImages = async (expectedUrls: string[] | null = null) => {
    const images = drawer.getByRole('img', { name: '机会来源截图证据', exact: true });
    await expect.poll(() => images.evaluateAll((elements, urls) => elements.length === 5 && elements.every((element, index) => {
      const image = element as HTMLImageElement;
      return image.complete && image.naturalWidth > 0 && (urls === null || image.src === urls[index]);
    }), expectedUrls)).toBe(true);
  };
  await expect(drawer.getByRole('region', { name: '首次触发快照（不可变）', exact: true })).toContainText('分子 0 / 分母 5');
  // 确认会重新读取签名证据并重挂载图片；先完成五张真实截图读取，不能只等文本可见。
  await waitForSourceImages();
  const refreshedEvidence = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === path);
  const acknowledged = await uiCommand<Schema['GeoOpportunityListItem']>(page, `${path}/acknowledge`, () => drawer.getByRole('button', { name: '确认机会', exact: true }).click());
  expect(acknowledged.status).toBe('ACKNOWLEDGED');
  const refreshed = await body<Schema['GeoOpportunityDetail']>(await refreshedEvidence);
  expect(refreshed.opportunity.revision).toBe(acknowledged.revision);
  const refreshedUrls = refreshed.sources.items.flatMap((source) => source.evidence_files.filter((file) => file.kind === 'SCREENSHOT').map((file) => file.download.url));
  expect(refreshedUrls.length).toBe(5);
  await expect(drawer.getByRole('button', { name: '确认机会', exact: true })).toHaveCount(0);
  await waitForSourceImages(refreshedUrls);

  // 704 当前没有行动创建 UI，使用公共 API；目标域保留审批与发布的所有裁决。
  const linked = await body<Schema['GeoOpportunityActionResult']>(await page.request.post(`${api}${path}/actions/content-task`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { expected_revision: acknowledged.revision, product_id: graph.product.id, fact_version_id: graph.fact.id, platform_profile_id: graph.platform.id } satisfies Schema['GeoOpportunityContentTaskRequest'],
  }));
  expect(linked.action).toMatchObject({ action_type: 'CONTENT_TASK', target_type: 'ContentTask', status_snapshot: 'OPEN', source_snapshot: { opportunity_id: seed.opportunity_id, fact_version_id: graph.fact.id, trigger_snapshot: initial.trigger_snapshot } });
  const content = await completeLoopContent(page, linked.action.target_id, graph, allowRead);
  const afterContent = await body<Schema['GeoOpportunityDetail']>(await page.request.get(`${api}${path}`));
  expect(afterContent.opportunity).toMatchObject({ status: 'IN_PROGRESS', revision: linked.opportunity_revision });
  expect(afterContent.trigger_snapshot).toEqual(initial.trigger_snapshot);
  expect(afterContent.actions[0]).toMatchObject({ id: linked.action.id, target_id: content.task.task.id, status_snapshot: 'OPEN' });

  // 705 当前没有复测创建 UI，preview/create 仍经过真实 CSRF、revision、同环境校验和 dispatch。
  const preview = await body<Schema['GeoRetestPreview']>(await page.request.get(`${api}${path}/retest-preview`, { params: { baseline_batch_id: baselineBatch.batch_id } }));
  expect(preview).toMatchObject({ comparable: true, requires_new_baseline: false, differences: [], opportunity_revision: afterContent.opportunity.revision });
  expect(preview.snapshot.cells).toHaveLength(5);
  const retest = await body<Schema['GeoRetestCreated']>(await page.request.post(`${api}${path}/retest`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { expected_revision: preview.opportunity_revision, baseline_batch_id: baselineBatch.batch_id } satisfies Schema['GeoRetestRequest'],
  }), 201);
  expect(retest).toMatchObject({ requested_run_count: 5, replayed: false });
  const repeated = await submitLoopBatch(page, retest.batch_id, graph.partNumber, 'retest', allowRead);
  for (let index = 0; index < baseline.length; index += 1) {
    expect(repeated[index].run.input_snapshot).toEqual(baseline[index].run.input_snapshot);
    expect(repeated[index].answer).toMatchObject(sourceEnvironment);
    expect(repeated[index].analysis.effective_results?.mentions).toEqual(expect.arrayContaining([expect.objectContaining({ subject_id: graph.subject.id })]));
  }
  const comparisonRead = await body<Schema['GeoOpportunityComparisonRead']>(await page.request.get(`${api}${path}/comparison`, { params: { retest_batch_id: retest.batch_id } }));
  const comparison = comparisonRead.comparison;
  if (!comparison) throw new Error('GEO707 复测缺少真实比较投影');
  expect(comparisonRead.opportunity).toMatchObject({ status: 'IN_PROGRESS', revision: retest.opportunity_revision });
  expect(comparisonRead.decisions).toEqual([]);
  expect(comparison).toMatchObject({ comparable: true, differences: [], causal_claim: 'NOT_ESTABLISHED', recovery: { status: 'RECOVERED', required_run_count: 5, threshold: 0.6, observed_value: 1, manual_confirmation_required: true } });
  expect(comparison.baseline.metrics).toEqual([expect.objectContaining({ metric_code: 'natural_visibility', value: 0, numerator: 0, denominator: 5, eligible_run_count: 5, excluded_run_count: 0, sample_level: 'STABLE' })]);
  expect(comparison.retest.metrics).toEqual([expect.objectContaining({ metric_code: 'natural_visibility', value: 1, numerator: 5, denominator: 5, eligible_run_count: 5, excluded_run_count: 0, sample_level: 'STABLE' })]);
  for (const environment of comparison.retest.environments) {
    const before = comparison.baseline.environments.find((item) => item.repeat_index === environment.repeat_index);
    if (!before) throw new Error('GEO707 比较丢失对应重复序号');
    expect(environment.input_snapshot).toEqual(before.input_snapshot);
    expect(environment).toMatchObject(sourceEnvironment);
    const { window_key: beforeWindow, ...beforeDimensions } = before.dimensions;
    const { window_key: afterWindow, ...afterDimensions } = environment.dimensions;
    expect(beforeWindow).not.toBe(afterWindow);
    expect(afterDimensions).toEqual(beforeDimensions);
  }

  await page.waitForLoadState('networkidle');
  await page.goto(`/geo/opportunities?opportunity_id=${seed.opportunity_id}&retest_batch_id=${retest.batch_id}`);
  const recovery = drawer.getByRole('region', { name: '冻结恢复判断', exact: true });
  await expect(recovery).toContainText('已达到冻结恢复条件，待人工确认');
  await expect(drawer.getByRole('region', { name: '干预前后比较', exact: true })).toContainText('不能证明干预与结果之间的因果关系');
  await expect(drawer.getByRole('region', { name: '机会概要', exact: true })).toContainText('处理中');
  await drawer.getByRole('button', { name: '复测恢复确认', exact: true }).click();
  const reason = 'GEO707 人工确认五次同环境复测达到冻结覆盖阈值；关联变化不证明因果关系。';
  await drawer.getByRole('textbox', { name: '处理原因代码', exact: true }).fill('COVERAGE_RECOVERED');
  await drawer.getByRole('textbox', { name: '处理原因说明', exact: true }).fill(reason);
  const pendingResolution = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `${path}/resolve`);
  await drawer.getByRole('button', { name: '确认复测恢复并解决', exact: true }).click();
  const resolutionHttp = await pendingResolution;
  expect(resolutionHttp.request().postDataJSON()).toMatchObject({ expected_revision: comparisonRead.opportunity_revision, resolution_method: 'RETEST', retest_batch_id: retest.batch_id, comparison_fingerprint: comparison.fingerprint });
  const resolution = await body<Schema['GeoOpportunityDecisionResult']>(resolutionHttp);
  expect(resolution.opportunity.status).toBe('RESOLVED');
  expect(resolution.decision).toMatchObject({ decision: 'RETEST_RESOLVE', retest_batch_id: retest.batch_id, comparison_fingerprint: comparison.fingerprint, comparison_snapshot: comparison });
  await expect(drawer.getByRole('button', { name: '复测恢复确认', exact: true })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(drawer.getByRole('region', { name: '不可变处理依据', exact: true })).toContainText(reason);
  await expect(drawer.getByRole('region', { name: '首次触发快照（不可变）', exact: true })).toContainText('分子 0 / 分母 5');
  await expect(drawer.getByRole('region', { name: '机会已有行动记录', exact: true })).toContainText(content.task.task.id);
  const retained = await body<Schema['GeoOpportunityDetail']>(await page.request.get(`${api}${path}`));
  const retainedComparison = await body<Schema['GeoOpportunityComparisonRead']>(await page.request.get(`${api}${path}/comparison`, { params: { retest_batch_id: retest.batch_id } }));
  expect(retained.trigger_snapshot).toEqual(initial.trigger_snapshot);
  // 机会来源表保留首次触发来源；复测来源由冻结比较与处理依据独立持有。
  expect(retainedSources(retained.sources)).toEqual(retainedSources(initial.sources));
  expect(retainedComparison.comparison?.baseline.sources).toEqual(comparison.baseline.sources);
  expect(retainedComparison.comparison?.retest.sources).toEqual(comparison.retest.sources);
  expect(comparison.baseline.sources).toHaveLength(5);
  expect(new Set(comparison.retest.sources.map((item) => item.run_id))).toEqual(new Set(repeated.map((item) => item.run.id)));
  expect(retained.actions).toEqual(afterContent.actions);
  expect(retainedComparison.decisions).toEqual([resolution.decision]);
  for (const observation of [...baseline, ...repeated]) {
    const current = await body<Schema['GeoRunDetail']>(await page.request.get(`${api}${runs}/${observation.run.id}`));
    expect(current.answer).toEqual(observation.answer);
    expect(current.analysis.revisions).toEqual(observation.analysis.revisions);
  }
  const frozenFact = await body<Schema['FactVersion']>(await page.request.get(`${api}/api/v1/fact-versions/${graph.fact.id}`));
  // 新内容引用会改变删除资格投影，事实身份、批准正文和版本保持不变。
  expect(frozenFact).toMatchObject({ id: graph.fact.id, product_id: graph.product.id, version: graph.fact.version, status: 'APPROVED', body_markdown: graph.fact.body_markdown, classification: 'PUBLIC', change_summary: graph.fact.change_summary, revision: graph.fact.revision, created_by: graph.fact.created_by, approved_by: graph.fact.approved_by, created_at: graph.fact.created_at, approved_at: graph.fact.approved_at });

  const auditLabels = [
    ['geo_opportunity.opened', '创建 GEO 机会'], ['geo_opportunity.acknowledged', '确认 GEO 机会'],
    ['geo_opportunity.action_linked', '关联 GEO 机会行动'], ['geo.retest.created', '创建 GEO 严格复测'],
    ['geo_opportunity.resolved', '解决 GEO 机会'],
  ] as const;
  allowRead('/api/v1/audit-logs'); allowRead('/api/v1/audit-logs/filter-options');
  const auditList = await body<Schema['AuditLogList']>(await page.request.get(`${api}/api/v1/audit-logs`, { params: { target_type: 'GeoOpportunity', target_id: seed.opportunity_id, page_size: 50 } }));
  expect(auditList.items.map((item) => item.action)).toEqual([...auditLabels.map(([action]) => action)].reverse());
  const safeFacts = new Set(['revision', 'status', 'action_id', 'action_type', 'target_type', 'target_id', 'baseline_id', 'baseline_batch_id', 'batch_id', 'requested_run_count', 'decision_id', 'decision']);
  for (const [action, label] of auditLabels) {
    const record = auditList.items.find((item) => item.action === action);
    if (!record) throw new Error(`GEO707 缺少 ${action} 审计`);
    allowRead(`/api/v1/audit-logs/${record.id}`);
    const auditDetail = await body<Schema['AuditLogDetail']>(await page.request.get(`${api}/api/v1/audit-logs/${record.id}`));
    expect(auditDetail).toMatchObject({ outcome: 'SUCCESS', business_module: 'GEO_OBSERVATION', target_type: 'GeoOpportunity', target_id: seed.opportunity_id, changes: [] });
    expect(Object.keys(auditDetail.facts).every((key) => safeFacts.has(key))).toBe(true);
    if (action === 'geo_opportunity.opened') expect(auditDetail.request_id).toBe(seed.request_id);
    if (action === 'geo.retest.created') expect(auditDetail.facts).toMatchObject({ baseline_id: retest.baseline_id, baseline_batch_id: baselineBatch.batch_id, batch_id: retest.batch_id, requested_run_count: 5 });
    const safeProjection = JSON.stringify(auditDetail);
    for (const sensitiveBody of [graph.fact.body_markdown, content.version.body_markdown, ...baseline.map((item) => item.answer?.answer_text), ...repeated.map((item) => item.answer?.answer_text)].filter((value): value is string => Boolean(value))) {
      expect(safeProjection.includes(sensitiveBody)).toBe(false);
    }
    await page.waitForLoadState('networkidle');
    await page.goto(`/system/audit${defaultStringifySearch({ action, targetType: 'GeoOpportunity', targetId: seed.opportunity_id, logId: record.id })}`);
    await expect(page.getByRole('heading', { name: '系统审计', exact: true })).toBeVisible();
    const auditPanel = page.getByRole('complementary', { name: '审计详情', exact: true });
    await expect(auditPanel.getByText(label, { exact: true })).toBeVisible();
    await expect(auditPanel.getByRole('heading', { name: '安全变更摘要', exact: true })).toBeVisible();
    // 全局筛选仍可能隐藏其他任务未登记的动作；本闭环的列表、当前动作与详情必须安全投影。
    await expect(auditPanel.getByText(/安全投影失败|无法安全投影/)).toHaveCount(0);
    await expect(page.getByRole('row', { name: '审计记录动作无法安全投影', exact: true })).toHaveCount(0);
    await expect(page.getByText('当前动作无法安全投影，请清除或改选。', { exact: true })).toHaveCount(0);
    await expect(auditPanel).toContainText(seed.opportunity_id);
  }
  await page.screenshot({ path: testInfo.outputPath('geo707-safe-audit.png'), fullPage: true, animations: 'disabled' });
  expect(runtime.errors).toEqual([]);
});
