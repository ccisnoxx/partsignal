import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { opportunityKeys } from './opportunities.api';
import type { Opportunity, OpportunityDetail } from './opportunities.model';
import { comparisonRead, detail, failure, list, opportunity, opportunityId, renderOpportunities, response, retestId, time } from './opportunities.test-support';

afterEach(() => vi.restoreAllMocks());
const productId = '10000000-0000-4000-8000-000000000001';
const otherProductId = '40000000-0000-4000-8000-000000000001';
const factId = '40000000-0000-4000-8000-000000000002';
const platformId = '40000000-0000-4000-8000-000000000003';
const taskId = '40000000-0000-4000-8000-000000000004';
const otherBaselineId = '40000000-0000-4000-8000-000000000005';
const sheet = () => screen.getByRole('dialog', { name: '机会详情与历史证据' });
const active = () => opportunity({ rule_code: 'TOPIC_COVERAGE_GAP', status: 'IN_PROGRESS', workflow_stage: 'IN_PROGRESS', primary_task: 'VIEW_EVIDENCE', available_actions: ['DISMISS', 'RESOLVE', 'CONTINUE'] });
function businessDetail(current = active()): OpportunityDetail { return { ...detail(current), available_action_types: ['CONTENT_TASK', 'ADDITIONAL_MONITORING'] }; }
function options(): components['schemas']['ContentTaskCreationOptions'] {
  return { products: [{ id: productId, brand: '测试品牌', part_number: 'PS-123', approved_fact_versions: [{ id: factId, version: 2, classification: 'PUBLIC' }] }, { id: otherProductId, brand: '其他品牌', part_number: 'PS-456', approved_fact_versions: [{ id: retestId, version: 5, classification: 'INTERNAL' }] }], platforms: [{ id: platformId, name: '测试发布平台' }], requested_product: { product_id: productId, brand: '测试品牌', part_number: 'PS-123', eligibility: 'ELIGIBLE' } };
}
function preview(current = active(), baselineId = businessDetail(current).sources.items[0]!.run.batch_id): components['schemas']['GeoRetestPreview'] {
  const source = businessDetail(current).sources.items[0]!;
  return { opportunity_id: current.id, opportunity_revision: current.revision, baseline_id: null, baseline_batch_id: baselineId, comparable: true, requires_new_baseline: false, differences: [], snapshot: { schema_version: 1, opportunity_id: current.id, baseline_batch_id: baselineId, trigger_snapshot: businessDetail(current).trigger_snapshot,
    plan_snapshot: { schema_version: 1, plan_id: null, plan_revision: null, name: '冻结独立基线', description: '', subjects: [{ subject_id: productId, role: 'PRIMARY' }], prompt_variant_ids: [productId], collection_profile_ids: [productId], repeat_count: 1, schedule_kind: 'MANUAL_ONLY', cron_expression: null, timezone: 'Asia/Shanghai', budget_limit: null, rule_set_revision: 1 }, rule_snapshot: { schema_version: 1, rule_set_revision: 1 },
    cells: [{ root_run_id: source.run_id, repeat_index: 1, input_snapshot: source.run.input_snapshot, answer_snapshot_id: source.answer!.id, source_product: '实际产品', source_model: '实际模型', source_version: 'v1' }] } };
}
function contentReceipt(body: components['schemas']['GeoOpportunityContentTaskRequest'], replayed = false): components['schemas']['GeoOpportunityActionResult'] {
  return { opportunity_revision: body.expected_revision + 1, replayed, action: { id: retestId, action_type: 'CONTENT_TASK', target_type: 'ContentTask', target_id: taskId, status_snapshot: 'OPEN', created_by: opportunityId, created_at: time, navigation_path: `/content/tasks/${taskId}`, target_available: true, source_snapshot: { schema_version: 1, opportunity_id: opportunityId, opportunity_revision: body.expected_revision, trigger_snapshot: detail().trigger_snapshot, sources: [], product_id: body.product_id, fact_version_id: body.fact_version_id, platform_profile_id: body.platform_profile_id, query_topic_id: null, published_article_id: null, published_content_issue_id: null, request_id: 'content-create-test' } } };
}
function retestReceipt(revision = 1, replayed = false): components['schemas']['GeoRetestCreated'] { return { baseline_id: otherBaselineId, batch_id: retestId, requested_run_count: 1, opportunity_revision: revision + 1, created_at: time, replayed }; }
function reads(current: () => Opportunity = active, config: { detail?: () => OpportunityDetail; detailResponse?: () => ReturnType<typeof response>; comparison?: () => ReturnType<typeof comparisonRead>; options?: () => ReturnType<typeof response>; preview?: (baselineId: string) => ReturnType<typeof response> | Promise<never> } = {}) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path, params) => {
    if (path === '/api/v1/geo/opportunities') return response(list(current()));
    if (path === '/api/v1/geo/opportunities/{opportunity_id}') return config.detailResponse?.() ?? response(config.detail?.() ?? businessDetail(current()));
    if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') return response(config.comparison?.() ?? comparisonRead(current()));
    if (path === '/api/v1/content-tasks/creation-options') return config.options?.() ?? response(options());
    if (path === '/api/v1/geo/opportunities/{opportunity_id}/retest-preview') {
      const baselineId = (params as { params: { query: { baseline_batch_id: string } } }).params.query.baseline_batch_id;
      return config.preview?.(baselineId) ?? response(preview(current(), baselineId));
    }
    throw new Error(`测试收到未声明 GET：${path}`);
  });
}
async function select(label: string, option: string | RegExp) { await userEvent.click(within(sheet()).getByRole('combobox', { name: label })); await userEvent.click(await screen.findByRole('option', { name: option })); }
async function contentInput() {
  await userEvent.click(await within(sheet()).findByRole('button', { name: '创建 Content Task' }));
  await within(sheet()).findByRole('combobox', { name: 'Content Task 产品' });
  await userEvent.type(within(sheet()).getByRole('textbox', { name: '搜索 Content Task 产品' }), 'PS-123');
  await select('Content Task 产品', '测试品牌 · PS-123');
  await select('Content Task 已批准事实版本', /FactVersion v2/);
  await select('Content Task 目标平台', '测试发布平台');
}
async function retestInput(baselineId?: string) {
  await userEvent.click(await within(sheet()).findByRole('button', { name: '预览并创建 Retest' }));
  if (baselineId) await userEvent.type(within(sheet()).getByRole('textbox', { name: 'Retest 基线批次 ID' }), baselineId);
  else await userEvent.click(within(sheet()).getByRole('button', { name: /^基线批次 / }));
  await userEvent.click(within(sheet()).getByRole('button', { name: '预览 Retest' }));
  await within(sheet()).findByRole('region', { name: 'Retest 可比性预览' });
}

describe('GEO-1010 Opportunity 创建闭环', () => {
  it.each(['content', 'retest'] as const)('详情刷新403时卸载已打开的%s业务快照与表单', async (kind) => {
    let denied = false;
    reads(active, { detailResponse: () => denied ? failure(403) : response(businessDetail()) });
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    if (kind === 'content') await contentInput(); else await retestInput();
    denied = true;
    await userEvent.click(within(sheet()).getByRole('button', { name: '刷新详情' }));
    await within(sheet()).findByText(/当前机会不可访问/);
    expect(within(sheet()).queryByRole('region', { name: '从机会创建 Content Task' })).not.toBeInTheDocument();
    expect(within(sheet()).queryByRole('region', { name: 'Retest 可比性预览' })).not.toBeInTheDocument();
    expect(within(sheet()).queryByRole('region', { name: 'Retest 冻结矩阵' })).not.toBeInTheDocument();
  });
  it('只按服务端 action_types 显示创建入口，不按 IN_PROGRESS 状态补资格', async () => {
    const get = reads(active, { detail: () => detail(active()) }); const post = vi.spyOn(api, 'POST'); renderOpportunities();
    await screen.findByRole('heading', { name: active().title });
    expect(within(sheet()).queryByRole('button', { name: '创建 Content Task' })).not.toBeInTheDocument();
    expect(within(sheet()).queryByRole('button', { name: '预览并创建 Retest' })).not.toBeInTheDocument();
    expect(get.mock.calls.some(([path]: [string, unknown]) => path.includes('creation-options'))).toBe(false); expect(post).not.toHaveBeenCalled();
  });
  it('可搜索选项创建三字段内容任务，来源/revision/事实/平台可核对并提供 canonical 目标链接', async () => {
    let current = active(); const get = reads(() => current);
    const post = vi.spyOn(api, 'POST').mockImplementation(async (_path, params) => { const body = (params as { body: components['schemas']['GeoOpportunityContentTaskRequest'] }).body; current = { ...current, revision: 2 }; return response(contentReceipt(body)); });
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await contentInput();
    expect(within(sheet()).getByRole('region', { name: '从机会创建 Content Task' })).toHaveTextContent(`来源 Opportunity：${opportunityId} · 提交 revision 1`);
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Content Task' }));
    const link = await within(sheet()).findByRole('link', { name: '打开新 Content Task' }); expect(link).toHaveAttribute('href', `/content/tasks/${taskId}`);
    expect(post.mock.calls[0]).toMatchObject(['/api/v1/geo/opportunities/{opportunity_id}/actions/content-task', { body: { expected_revision: 1, product_id: productId, fact_version_id: factId, platform_profile_id: platformId }, params: { header: { 'X-CSRF-Token': 'geo703-csrf', 'Idempotency-Key': expect.any(String) } } }]);
    expect(Object.keys((post.mock.calls[0]![1] as { body: object }).body)).toEqual(['expected_revision', 'product_id', 'fact_version_id', 'platform_profile_id']);
    expect(get.mock.calls.filter(([path]: [string, unknown]) => path === '/api/v1/geo/opportunities/{opportunity_id}').length).toBeGreaterThan(1);
  });
  it('更换产品清除依赖 FactVersion，保留独立平台；过期选项不会继续提交', async () => {
    reads(); const post = vi.spyOn(api, 'POST'); renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await contentInput();
    await userEvent.clear(within(sheet()).getByRole('textbox', { name: '搜索 Content Task 产品' }));
    await select('Content Task 产品', '其他品牌 · PS-456');
    expect(within(sheet()).getByRole('combobox', { name: 'Content Task 已批准事实版本' })).toHaveTextContent('请选择');
    expect(within(sheet()).getByRole('combobox', { name: 'Content Task 目标平台' })).toHaveTextContent('测试发布平台');
    expect(within(sheet()).getByRole('button', { name: '确认创建 Content Task' })).toBeDisabled(); expect(post).not.toHaveBeenCalled();
  });
  it('Content Task 未知结果冻结输入，显式恢复精确继承同 payload 和 key，双击不重复提交', async () => {
    reads(); const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(failure(503, 'UNAVAILABLE')).mockImplementation(async (_path, params) => response(contentReceipt((params as { body: components['schemas']['GeoOpportunityContentTaskRequest'] }).body, true)));
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await contentInput();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Content Task' }));
    const recovery = await within(sheet()).findByRole('button', { name: '确认原 Content Task 创建结果' });
    expect(post).toHaveBeenCalledTimes(1); expect(within(sheet()).getByRole('combobox', { name: 'Content Task 产品' })).toBeDisabled();
    await userEvent.dblClick(recovery); await within(sheet()).findByRole('link', { name: '打开新 Content Task' });
    expect(post).toHaveBeenCalledTimes(2); expect(post.mock.calls[1]![1]).toMatchObject({ body: (post.mock.calls[0]![1] as { body: object }).body, params: (post.mock.calls[0]![1] as { params: object }).params });
  });
  it('Content Task 409 保留选择，后台刷新不解锁，显式加载后重新确认使用新 revision 与 key', async () => {
    let current = active(); reads(() => current); const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(failure(409)).mockImplementation(async (_path, params) => response(contentReceipt((params as { body: components['schemas']['GeoOpportunityContentTaskRequest'] }).body)));
    const { client } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await contentInput();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Content Task' })); await within(sheet()).findByRole('button', { name: '加载最新机会与创建选项' });
    current = { ...current, revision: 3 }; await act(async () => { client.setQueryData(opportunityKeys.detail(opportunityId, { source_page: 1, source_page_size: 20 }), businessDetail(current)); });
    expect(within(sheet()).getByRole('button', { name: '确认创建 Content Task' })).toBeDisabled(); expect(post).toHaveBeenCalledTimes(1);
    await userEvent.click(within(sheet()).getByRole('button', { name: '加载最新机会与创建选项' }));
    await waitFor(() => expect(within(sheet()).getByRole('button', { name: '确认创建 Content Task' })).toBeEnabled());
    expect(within(sheet()).getByRole('combobox', { name: 'Content Task 产品' })).toHaveTextContent('PS-123');
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Content Task' })); await within(sheet()).findByRole('link', { name: '打开新 Content Task' });
    expect(post.mock.calls[1]![1]).toMatchObject({ body: { expected_revision: 3 } });
    expect((post.mock.calls[1]![1] as { params: { header: object } }).params.header).not.toEqual((post.mock.calls[0]![1] as { params: { header: object } }).params.header);
  });
  it('Content Task 422 字段错误定位已知选择，未知 issue 保留在服务端反馈，原选择不清空', async () => {
    reads(); const post = vi.spyOn(api, 'POST').mockResolvedValue({ error: { error: { code: 'VALIDATION_ERROR', message: '服务端输入校验失败', request_id: 'field-422', details: { errors: [{ loc: ['body', 'fact_version_id'], msg: '该事实版本已不再批准' }, { loc: ['body', 'new_unknown_field'], msg: '未知合同字段' }] } } }, response: Response.json({}, { status: 422 }) } as never);
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await contentInput();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Content Task' }));
    await within(sheet()).findByText(/服务端输入校验失败/);
    expect(within(sheet()).getByRole('combobox', { name: 'Content Task 已批准事实版本' })).toHaveAttribute('aria-invalid', 'true');
    expect(within(sheet()).getByRole('combobox', { name: 'Content Task 产品' })).toHaveTextContent('PS-123'); expect(post).toHaveBeenCalledTimes(1);
  });
  it('选项 403 隐藏历史敏感证据与创建表单，不暴露服务器原始拒绝内容', async () => {
    reads(active, { options: () => failure(403, 'PRIVATE_DETAIL') }); renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    await userEvent.click(await within(sheet()).findByRole('button', { name: '创建 Content Task' }));
    await within(sheet()).findByText(/当前机会不可访问/);
    expect(within(sheet()).queryByRole('region', { name: '机会历史来源' })).not.toBeInTheDocument();
    expect(within(sheet()).queryByRole('form', { name: 'Opportunity Content Task 创建表单' })).not.toBeInTheDocument();
    expect(within(sheet()).queryByText(/服务端拒绝当前请求/)).not.toBeInTheDocument();
  });
  it('不可比 preview 显示具体差异与冻结矩阵，禁止创建，不自动换基线', async () => {
    const get = reads(active, { preview: (id) => response({ ...preview(active(), id), comparable: false, requires_new_baseline: true, differences: [{ code: 'MODEL_VERSION_UNKNOWN', field: 'source_version', resource_id: productId, reason: '来源版本未记录' }] }) });
    const post = vi.spyOn(api, 'POST'); renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await retestInput(otherBaselineId);
    expect(within(sheet()).getByRole('region', { name: 'Retest 可比性预览' })).toHaveTextContent('不可比较');
    expect(within(sheet()).getByRole('region', { name: 'Retest 具体差异' })).toHaveTextContent('MODEL_VERSION_UNKNOWN');
    expect(within(sheet()).getByRole('region', { name: 'Retest 冻结矩阵' })).toHaveTextContent('冻结完整问题');
    expect(within(sheet()).getByRole('button', { name: '确认创建 Retest' })).toBeDisabled(); expect(post).not.toHaveBeenCalled();
    expect(get.mock.calls.filter(([path]: [string, unknown]) => path.endsWith('/retest-preview'))).toHaveLength(1);
    expect(within(sheet()).getByRole('textbox', { name: 'Retest 基线批次 ID' })).toHaveValue(otherBaselineId);
  });
  it('比较通过后显式创建 Retest，冻结 revision/基线并衔接比较 URL 与批次链接', async () => {
    let current = active(); reads(() => current); const post = vi.spyOn(api, 'POST').mockImplementation(async () => { current = { ...current, revision: 2 }; return response(retestReceipt()); });
    const { router } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await retestInput(); expect(post).not.toHaveBeenCalled();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Retest' }));
    const link = await within(sheet()).findByRole('link', { name: '打开新 Retest 批次' }); expect(link).toHaveAttribute('href', `/geo/runs?batch_id=${retestId}`);
    await waitFor(() => expect(router.state.location.search).toMatchObject({ opportunity_id: opportunityId, retest_batch_id: retestId }));
    expect(post.mock.calls[0]).toMatchObject(['/api/v1/geo/opportunities/{opportunity_id}/retest', { body: { expected_revision: 1, baseline_batch_id: preview().baseline_batch_id } }]);
    expect(within(sheet()).getByRole('region', { name: 'Retest 预览与创建' })).toHaveTextContent('结果变化不能证明因果');
  });
  it('Retest 创建在途切换来源页，迟到成功只补充复测选择且保留当前 URL', async () => {
    reads(); let release!: (value: never) => void;
    vi.spyOn(api, 'POST').mockImplementation(() => new Promise<never>((resolve) => { release = resolve; }));
    const { router } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await retestInput();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Retest' }));
    await act(async () => { await router.navigate({ to: '/geo/opportunities', search: { ...router.state.location.search, source_page: 2 } }); });
    expect(router.state.location.search).toHaveProperty('source_page', 2);
    await act(async () => { release(response(retestReceipt())); });
    await waitFor(() => expect(router.state.location.search).toMatchObject({ opportunity_id: opportunityId, retest_batch_id: retestId, source_page: 2 }));
  });
  it('Retest 创建在途后选择已有比较批次，迟到成功保留用户后选批次', async () => {
    reads(active, { comparison: () => comparisonRead(active(), true) }); let release!: (value: never) => void;
    vi.spyOn(api, 'POST').mockImplementation(() => new Promise<never>((resolve) => { release = resolve; }));
    const { router } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await retestInput();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Retest' }));
    await select('比较复测批次', new RegExp(retestId));
    await waitFor(() => expect(router.state.location.search).toHaveProperty('retest_batch_id', retestId));
    await act(async () => { release(response({ ...retestReceipt(), batch_id: taskId })); });
    await within(sheet()).findByRole('link', { name: '打开新 Retest 批次' });
    expect(router.state.location.search).toHaveProperty('retest_batch_id', retestId);
  });
  it('Retest 409 保留基线，显式刷新后必须重新 preview，才可携带新 revision 创建', async () => {
    let current = active(); reads(() => current); const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(failure(409)).mockImplementation(async () => response(retestReceipt(2)));
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await retestInput();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Retest' })); await within(sheet()).findByRole('button', { name: '加载最新机会并保留 Retest 基线' }); current = { ...current, revision: 2 };
    await userEvent.click(within(sheet()).getByRole('button', { name: '加载最新机会并保留 Retest 基线' }));
    await waitFor(() => expect(within(sheet()).getByRole('button', { name: '预览 Retest' })).toBeEnabled());
    expect(within(sheet()).queryByRole('button', { name: '确认创建 Retest' })).not.toBeInTheDocument();
    expect(within(sheet()).getByRole('textbox', { name: 'Retest 基线批次 ID' })).toHaveValue(preview().baseline_batch_id);
    await userEvent.click(within(sheet()).getByRole('button', { name: '预览 Retest' })); await within(sheet()).findByRole('region', { name: 'Retest 可比性预览' });
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Retest' })); await within(sheet()).findByRole('link', { name: '打开新 Retest 批次' });
    expect(post.mock.calls[1]![1]).toMatchObject({ body: { expected_revision: 2, baseline_batch_id: preview().baseline_batch_id } });
  });
  it('Retest 网络未知结果显式恢复同 key 同 payload，不再次 preview 或自动重发', async () => {
    const get = reads(); const post = vi.spyOn(api, 'POST').mockRejectedValueOnce(new TypeError('network unavailable')).mockResolvedValue(response(retestReceipt(1, true)));
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await retestInput();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认创建 Retest' }));
    const recover = await within(sheet()).findByRole('button', { name: '确认原 Retest 创建结果' });
    expect(within(sheet()).getByRole('textbox', { name: 'Retest 基线批次 ID' })).toBeDisabled(); expect(post).toHaveBeenCalledTimes(1);
    await userEvent.click(recover); await within(sheet()).findByRole('link', { name: '打开新 Retest 批次' });
    expect(post).toHaveBeenCalledTimes(2); expect(post.mock.calls[1]![1]).toMatchObject({ body: (post.mock.calls[0]![1] as { body: object }).body, params: (post.mock.calls[0]![1] as { params: object }).params });
    expect(get.mock.calls.filter(([path]: [string, unknown]) => path.endsWith('/retest-preview'))).toHaveLength(1);
  });
  it('更换基线取消旧 preview，迟到响应不覆盖新选择', async () => {
    let release: ((value: never) => void) | undefined;
    const current = active(); const firstId = preview().baseline_batch_id;
    const get = reads(() => current, { preview: (id) => id === firstId ? new Promise<never>((resolve) => { release = resolve; }) : response(preview(current, id)) });
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await userEvent.click(await within(sheet()).findByRole('button', { name: '预览并创建 Retest' }));
    await userEvent.click(within(sheet()).getByRole('button', { name: /^基线批次 / })); await userEvent.click(within(sheet()).getByRole('button', { name: '预览 Retest' }));
    await within(sheet()).findByText('正在核对基线与冻结矩阵…'); const oldSignal = (get.mock.calls.find(([path]: [string, unknown]) => path.endsWith('/retest-preview'))![1] as { signal: AbortSignal }).signal;
    const input = within(sheet()).getByRole('textbox', { name: 'Retest 基线批次 ID' }); await userEvent.clear(input); await userEvent.type(input, otherBaselineId);
    expect(oldSignal.aborted).toBe(true); await userEvent.click(within(sheet()).getByRole('button', { name: '预览 Retest' }));
    await within(sheet()).findByRole('region', { name: 'Retest 可比性预览' });
    await act(async () => { release?.(response(preview(current, firstId))); });
    expect(within(sheet()).getByRole('region', { name: 'Retest 可比性预览' })).toHaveTextContent(otherBaselineId);
  });
  it.each(['principal', 'unmount'] as const)('%s 边界隔离在途 Retest，迟到成功不导航或改变机会缓存', async (boundary) => {
    reads(); let release: ((value: never) => void) | undefined; let signal: AbortSignal | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(async (_path, params) => { signal = (params as { signal: AbortSignal }).signal; return new Promise<never>((resolve) => { release = resolve; }); });
    const { client, router, view } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await retestInput();
    await userEvent.dblClick(within(sheet()).getByRole('button', { name: '确认创建 Retest' })); expect(post).toHaveBeenCalledTimes(1);
    if (boundary === 'principal') invalidatePrincipalEpoch(client, 'new-owner'); else { view.unmount(); expect(signal?.aborted).toBe(true); }
    await act(async () => { release?.(response(retestReceipt())); });
    expect(router.state.location.search).not.toHaveProperty('retest_batch_id');
    expect(client.getQueryData(opportunityKeys.detail(opportunityId, { source_page: 1, source_page_size: 20 }))).toMatchObject({ opportunity: { revision: 1 } });
  });
  it('有业务草稿关闭详情时显示 DirtyGuard，选择继续编辑保留输入', async () => {
    reads(); const { router } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await contentInput();
    act(() => { void router.navigate({ to: '/geo/opportunities', search: {} }); });
    const guard = await screen.findByRole('dialog', { name: '要离开当前页面吗？' }); await userEvent.click(within(guard).getByRole('button', { name: '继续编辑' }));
    expect(within(sheet()).getByRole('combobox', { name: 'Content Task 产品' })).toHaveTextContent('PS-123');
    expect(router.state.location.search).toHaveProperty('opportunity_id', opportunityId);
  });
});
