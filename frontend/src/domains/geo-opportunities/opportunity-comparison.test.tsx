import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import type { components } from '@/shared/api/generated/schema';
import { opportunityKeys } from './opportunities.api';
import { comparisonRead, decisionResult, detail, failure, list, mockReads, opportunity, opportunityId, renderOpportunities, response, retestId, time } from './opportunities.test-support';

afterEach(() => vi.restoreAllMocks());
const sheet = () => screen.getByRole('dialog', { name: '机会详情与历史证据' });
const inProgress = () => opportunity({ status: 'IN_PROGRESS', workflow_stage: 'IN_PROGRESS', primary_task: 'VIEW_EVIDENCE', available_actions: ['DISMISS', 'RESOLVE', 'CONTINUE'] });
async function reason() {
  await userEvent.type(within(sheet()).getByRole('textbox', { name: '处理原因代码' }), ' REVIEWED ');
  await userEvent.type(within(sheet()).getByRole('textbox', { name: '处理原因说明' }), ' 已核对全部依据 ');
}

describe('GEO706 比较与显式处理', () => {
  it('比较显示真实窗口、分子分母、样本不足/null、排除与实际环境差异，并明确无因果结论', async () => {
    const current = inProgress(); const read = comparisonRead(current, true); const comparison = read.comparison!;
    comparison.comparable = false; comparison.recovery.status = 'NOT_COMPARABLE'; comparison.recovery.reasons = ['MODEL_VERSION_CHANGED'];
    comparison.retest.metrics[0] = { ...comparison.retest.metrics[0]!, value: null, numerator: 0, denominator: 0, eligible_run_count: 0, excluded_run_count: 5, sample_level: 'NONE', unavailable_reasons: ['NO_DENOMINATOR'], exclusion_reason_counts: [{ code: 'RUN_NOT_COMPLETED', run_count: 5 }] };
    comparison.differences = [{ code: 'MODEL_VERSION_CHANGED', field: 'model_version', baseline_run_id: opportunityId, retest_run_id: retestId, baseline_value: 'v1', retest_value: 'v2' }];
    mockReads(() => current, () => detail(current), () => list(current), () => read); const post = vi.spyOn(api, 'POST'); renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    const region = await screen.findByRole('region', { name: '干预前后比较' });
    await within(region).findByRole('region', { name: '干预前基线' });
    expect(within(region).getByRole('region', { name: '干预前基线' })).toHaveTextContent('分子 5 / 分母 5');
    expect(within(region).getByRole('region', { name: '干预后复测' })).toHaveTextContent('值 不可计算 · 分子 0 / 分母 0');
    expect(within(region).getByRole('region', { name: '干预后复测' })).toHaveTextContent('无样本 · 候选 5 · 合格 0 · 排除 5');
    expect(within(region).getByText('排除原因 RUN_NOT_COMPLETED：5')).toBeInTheDocument();
    expect(within(region).getByRole('region', { name: '具体不可比差异' })).toHaveTextContent('模型版本变化');
    expect(within(region).getByRole('region', { name: '具体不可比差异' })).toHaveTextContent('v1');
    expect(within(region).getByRole('region', { name: '干预后复测' })).toHaveTextContent('不含');
    await userEvent.click(within(region).getByRole('region', { name: '干预前基线' }).querySelector('summary')!);
    expect(region).toHaveTextContent('source_model：model-a'); expect(region).toHaveTextContent('collection_mode：人工录入');
    expect(region).toHaveTextContent('不能证明干预与结果之间的因果关系');
    expect(within(sheet()).getByRole('button', { name: '复测恢复确认' })).toBeDisabled(); expect(post).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'UNAVAILABLE', 'INSUFFICIENT_SAMPLE', 'NOT_RECOVERED'] as const)('服务器 %s 不开放复测确认，继续展示真实状态和不可用阈值', async (status) => {
    const current = inProgress(); const read = comparisonRead(current, true); read.comparison!.recovery = { ...read.comparison!.recovery, status, threshold: null, reasons: ['SERVER_REASON'], recovery_configuration: status === 'UNAVAILABLE' ? null : read.comparison!.recovery.recovery_configuration };
    mockReads(() => current, () => detail(current), () => list(current), () => read); renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    await within(sheet()).findByText(/恢复阈值 不可计算/);
    expect(within(sheet()).getByRole('button', { name: '复测恢复确认' })).toBeDisabled();
    if (status === 'UNAVAILABLE') { await userEvent.click(within(sheet()).getByText('冻结恢复规则（只读）')); expect(within(sheet()).getByText(/历史规则没有冻结恢复配置/)).toBeVisible(); }
  });
  it('没有复测仍可人工解决，比较读取失败不阻断人工依据；空白不提交且旧忽略命令不接管 RESOLVE', async () => {
    let current = inProgress();
    vi.spyOn(api, 'GET').mockImplementation(async (path) => path === '/api/v1/geo/opportunities' ? response(list(current)) : path === '/api/v1/geo/opportunities/{opportunity_id}/comparison' ? failure(503, 'COMPARISON_UNAVAILABLE') : response(detail(current)));
    const post = vi.spyOn(api, 'POST').mockImplementation(async (_path, options) => {
      const body = (options as { body: components['schemas']['GeoOpportunityResolveRequest'] }).body;
      current = opportunity({ ...current, status: 'RESOLVED', workflow_stage: 'CLOSED', revision: 2, available_actions: [] });
      return response(decisionResult(current, 'MANUAL_RESOLVE', body));
    });
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await within(sheet()).findByRole('button', { name: '人工解决' });
    await userEvent.click(within(sheet()).getByRole('button', { name: '人工解决' }));
    expect(within(sheet()).getByRole('button', { name: '确认人工解决' })).toBeDisabled(); await reason();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认人工解决' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toMatchObject(['/api/v1/geo/opportunities/{opportunity_id}/resolve', { body: { expected_revision: 1, resolution_method: 'MANUAL', resolution_code: 'REVIEWED', resolution_comment: '已核对全部依据' } }]);
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('body.comparison_fingerprint');
    expect(await within(sheet()).findByText(/已显式解决机会（revision 2）/)).toBeVisible();
  });
  it('达标保持机会处理中，只有再次显式确认才携带 batch 和 fingerprint 解决', async () => {
    let current = inProgress(); const read = () => comparisonRead(current, true);
    mockReads(() => current, () => detail(current), () => list(current), read);
    const post = vi.spyOn(api, 'POST').mockImplementation(async (_path, options) => {
      const body = (options as { body: components['schemas']['GeoOpportunityResolveRequest'] }).body;
      const evidence = read().comparison; current = opportunity({ ...current, status: 'RESOLVED', workflow_stage: 'CLOSED', revision: 2, available_actions: [] });
      return response(decisionResult(current, 'RETEST_RESOLVE', body, evidence));
    });
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); const entry = await within(sheet()).findByRole('button', { name: '复测恢复确认' });
    await waitFor(() => expect(entry).toBeEnabled()); expect(post).not.toHaveBeenCalled();
    await userEvent.click(entry); await reason(); expect(post).not.toHaveBeenCalled();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认复测恢复并解决' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 1, resolution_method: 'RETEST', retest_batch_id: retestId, comparison_fingerprint: 'a'.repeat(64) }, params: { header: { 'X-CSRF-Token': 'geo703-csrf' } } });
  });
  it('继续跟进保持 IN_PROGRESS 并展示服务器返回的不可变依据', async () => {
    let current = inProgress(); let recorded: ReturnType<typeof decisionResult>['decision'] | undefined;
    mockReads(() => current, () => detail(current), () => list(current), () => ({ ...comparisonRead(current), decisions: recorded ? [recorded] : [] }));
    const post = vi.spyOn(api, 'POST').mockImplementation(async (_path, options) => {
      const body = (options as { body: components['schemas']['GeoOpportunityContinueRequest'] }).body;
      current = opportunity({ ...current, revision: 2 }); const result = decisionResult(current, 'CONTINUE', body); recorded = result.decision; return response(result);
    });
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await userEvent.click(await within(sheet()).findByRole('button', { name: '继续跟进' })); await reason();
    expect(within(sheet()).getByText(/当前机会没有复测比较记录/)).toBeVisible();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认继续跟进' }));
    expect(await within(sheet()).findByText(/已记录继续跟进依据，机会保持处理中/)).toBeVisible();
    expect(post.mock.calls[0]?.[0]).toBe('/api/v1/geo/opportunities/{opportunity_id}/continue');
    expect(within(sheet()).getByRole('region', { name: '不可变处理依据' })).toHaveTextContent('已核对全部依据'); expect(current.status).toBe('IN_PROGRESS');
  });
  it('同一指标的多个实际模型分层分别展示，不混合或产生重复 React key', async () => {
    const current = inProgress(); const read = comparisonRead(current, true); const original = read.comparison!.retest.metrics[0]!;
    read.comparison!.recovery.status = 'UNAVAILABLE'; read.comparison!.recovery.reasons = ['MIXED_ENVIRONMENTS'];
    read.comparison!.retest.metrics.push({ ...original, value: null, sample_level: 'OBSERVED', dimensions: { ...original.dimensions!, source_model: 'model-b', model_version: 'v2', collection_mode: 'API' } });
    mockReads(() => current, () => detail(current), () => list(current), () => read);
    const errors = vi.spyOn(console, 'error'); renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    const after = await within(sheet()).findByRole('region', { name: '干预后复测' });
    expect(within(after).getAllByRole('heading', { name: '严重错误运行率' })).toHaveLength(2);
    expect(after).toHaveTextContent('模型 model-a · 模型版本 v1'); expect(after).toHaveTextContent('模型 model-b · 模型版本 v2');
    expect(after).toHaveTextContent('样本不足 · 仅观测'); expect(after).toHaveTextContent('API');
    expect(within(sheet()).getByRole('button', { name: '复测恢复确认' })).toBeDisabled();
    expect(errors.mock.calls.filter((call) => call.some((value) => typeof value === 'string' && /same key|unique.*key/i.test(value)))).toEqual([]);
  });
  it('409 比较漂移保留输入，后台刷新不解锁；显式重读允许同 revision 新指纹再次确认', async () => {
    const current = inProgress(); let read = comparisonRead(current, true);
    mockReads(() => current, () => detail(current), () => list(current), () => read);
    const post = vi.spyOn(api, 'POST').mockResolvedValue(failure(409, 'GEO_RETEST_COMPARISON_CHANGED'));
    const { client } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); const entry = await within(sheet()).findByRole('button', { name: '复测恢复确认' }); await waitFor(() => expect(entry).toBeEnabled());
    await userEvent.click(entry); await reason(); await userEvent.click(within(sheet()).getByRole('button', { name: '确认复测恢复并解决' }));
    expect(await within(sheet()).findByText(/处理依据草稿已保留，提交暂停/)).toBeVisible();
    read = comparisonRead(current, true); read.comparison!.fingerprint = 'b'.repeat(64);
    await act(async () => { client.setQueryData(opportunityKeys.comparison(opportunityId), read); });
    expect(within(sheet()).getByRole('button', { name: '确认复测恢复并解决' })).toBeDisabled(); expect(post).toHaveBeenCalledTimes(1);
    expect(within(sheet()).getByRole('textbox', { name: '处理原因说明' })).toHaveValue(' 已核对全部依据 ');
    await userEvent.click(within(sheet()).getByRole('button', { name: '加载最新机会并保留处理依据' }));
    await waitFor(() => expect(within(sheet()).getByRole('button', { name: '确认复测恢复并解决' })).toBeEnabled());
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认复测恢复并解决' })); await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toMatchObject({ body: { expected_revision: 1, comparison_fingerprint: 'b'.repeat(64), resolution_comment: '已核对全部依据' } });
  });
  it('所选复测进入 URL/query key；旧选择在途读取取消，后到的旧结果不覆盖当前窗口', async () => {
    const current = inProgress(); const newerId = '30000000-0000-4000-8000-000000000003'; let oldSignal: AbortSignal | undefined; let release: ((value: never) => void) | undefined;
    const newer = comparisonRead(current, true); newer.selected_retest_batch_id = newerId; newer.comparison!.retest_batch_id = newerId; newer.comparison!.retest.batch_id = newerId;
    newer.comparison!.retest.date_to = '2026-10-06T08:00:00Z'; newer.retests.push({ batch_id: newerId, baseline_id: opportunityId, baseline_batch_id: opportunityId, created_at: time, status: 'COMPLETED' });
    vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
      if (path === '/api/v1/geo/opportunities') return response(list(current));
      if (path === '/api/v1/geo/opportunities/{opportunity_id}') return response(detail(current));
      const params = options as { signal: AbortSignal; params: { query: { retest_batch_id?: string } } };
      if (params.params.query.retest_batch_id === retestId) { oldSignal = params.signal; return new Promise<never>((resolve) => { release = resolve; }); }
      return response(newer);
    });
    const { router } = renderOpportunities(`/geo/opportunities?opportunity_id=${opportunityId}&retest_batch_id=${retestId}`); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    await within(sheet()).findByRole('heading', { name: current.title });
    await act(async () => { await router.navigate({ to: '/geo/opportunities', search: { opportunity_id: opportunityId, retest_batch_id: newerId } }); });
    await waitFor(() => expect(within(sheet()).getByRole('region', { name: '干预后复测' })).toHaveTextContent(newerId));
    expect(router.state.location.search).toMatchObject({ retest_batch_id: newerId }); expect(oldSignal?.aborted).toBe(true);
    await act(async () => { release?.(response(comparisonRead(current, true))); });
    expect(within(sheet()).getByRole('region', { name: '干预后复测' })).toHaveTextContent(newerId);
  });
  it('通过复测选择控件写入同名 URL 参数，关闭抽屉清理该选择', async () => {
    const current = inProgress(); const read = mockReads(() => current, () => detail(current), () => list(current), () => comparisonRead(current, true));
    const { router } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    await within(sheet()).findByRole('region', { name: '干预后复测' });
    await userEvent.click(within(sheet()).getByRole('combobox', { name: '比较复测批次' }));
    await userEvent.click(await screen.findByRole('option', { name: new RegExp(retestId) }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ opportunity_id: opportunityId, retest_batch_id: retestId }));
    expect(read.requests.filter((request) => request.path.endsWith('/comparison')).at(-1)?.options).toMatchObject({ params: { query: { retest_batch_id: retestId } } });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });
  it('比较权限失效隐藏既有比较与历史敏感快照，不显示旧确认入口', async () => {
    let denied = false; const current = inProgress();
    vi.spyOn(api, 'GET').mockImplementation(async (path) => path === '/api/v1/geo/opportunities' ? response(list(current)) : path === '/api/v1/geo/opportunities/{opportunity_id}' ? response(detail(current)) : denied ? failure(403) : response(comparisonRead(current, true)));
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await within(sheet()).findByRole('region', { name: '干预后复测' }); denied = true;
    await userEvent.click(within(sheet()).getByRole('button', { name: '重新读取比较' }));
    expect(await within(sheet()).findByText(/当前机会不可访问/)).toBeVisible();
    expect(within(sheet()).queryByRole('region', { name: '机会历史来源' })).not.toBeInTheDocument(); expect(within(sheet()).queryByRole('region', { name: '干预后复测' })).not.toBeInTheDocument(); expect(within(sheet()).queryByRole('button', { name: '人工解决' })).not.toBeInTheDocument();
  });
  it('提交期间阻止重复确认，卸载中止 signal；旧主体回执不能写入当前 cache', async () => {
    const current = inProgress(); mockReads(() => current);
    let release: ((value: never) => void) | undefined; let signal: AbortSignal | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(async (_path, options) => {
      signal = (options as { signal: AbortSignal }).signal;
      return new Promise<never>((resolve) => { release = resolve; });
    });
    const { client, view } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    await userEvent.click(await within(sheet()).findByRole('button', { name: '人工解决' })); await reason();
    const confirm = within(sheet()).getByRole('button', { name: '确认人工解决' }); await userEvent.dblClick(confirm);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); expect(confirm).toBeDisabled();
    invalidatePrincipalEpoch(client, 'new-principal');
    const resolved = opportunity({ ...current, revision: 2, status: 'RESOLVED', available_actions: [] });
    await act(async () => { release?.(response(decisionResult(resolved, 'MANUAL_RESOLVE', { resolution_code: 'REVIEWED', resolution_comment: '已核对全部依据' }))); });
    expect(within(sheet()).queryByText(/已显式解决机会/)).not.toBeInTheDocument();
    expect(client.getQueryData(opportunityKeys.detail(opportunityId, { source_page: 1, source_page_size: 20 }))).toMatchObject({ opportunity: { revision: 1 } });
    await userEvent.click(confirm); await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    view.unmount(); expect(signal?.aborted).toBe(true);
  });
});
