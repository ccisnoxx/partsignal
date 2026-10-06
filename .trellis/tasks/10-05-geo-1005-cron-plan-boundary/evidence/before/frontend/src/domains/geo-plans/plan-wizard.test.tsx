import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserHistory, createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useRouter } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializePrincipalEpoch, invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { PlanWizard } from './plan-wizard';
import { planKeys } from './plans.api';
import { PlanOptions } from './plan-options';
import type { PlanDetail, PlanPreview, PlanValues } from './plans.model';

const id = '90000000-0000-4000-8000-000000000001';
const subjectId = '90000000-0000-4000-8000-000000000002';
const promptId = '90000000-0000-4000-8000-000000000003';
const profileId = '90000000-0000-4000-8000-000000000004';
const otherId = '90000000-0000-4000-8000-000000000005';
const time = '2026-10-02T08:00:00Z';
function preview(runCount = 91): PlanPreview {
  return { prompt_count: 1, profile_count: 1, repeat_count: 3, run_count: runCount, manual_run_count: runCount, api_run_count: 0, browser_run_count: 0, unresolved_run_count: 0, estimated_cost: { value: null, currency: null, coverage: 'NONE', known_run_count: 0, unknown_run_count: runCount, known_costs: [] }, blockers: [], warnings: [{ code: 'COST_UNKNOWN', field: 'estimated_cost', resource_id: null, related_resource_id: null }] };
}
function plan(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return { id, name: '原始计划', description: '原始说明', subjects: [{ subject_id: subjectId, role: 'PRIMARY' }], prompt_variant_ids: [promptId], collection_profile_ids: [profileId], repeat_count: 3, schedule_kind: 'MANUAL_ONLY', cron_expression: null, timezone: 'Asia/Shanghai', budget_limit: null, rule_set_revision: 1, status: 'DISABLED', revision: 7, created_by: id, updated_by: id, created_at: time, updated_at: time, preview: preview(), workflow_stage: 'READY', primary_task: 'ACTIVATE', available_actions: ['UPDATE', 'PREVIEW', 'ACTIVATE'], deletion: { blockers: [] }, run_entry: { available: false, reason_code: 'UI_NOT_IMPLEMENTED' }, ...overrides };
}
function subject(subject_id = subjectId, label = '监测品牌'): components['schemas']['GeoSubjectOut'] {
  return { id: subject_id, subject_type: 'OWN_BRAND', product_id: null, product: null, parent_subject_id: null, parent: null, canonical_name: label, display_name: label, description: '', is_active: true, aliases: [], domains: [], references: { child_subject_count: 0, monitoring_plan_count: 0, observation_run_count: 0, analysis_count: 0, opportunity_count: 0 }, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_SUBJECT', available_actions: [], deletion: null, revision: 1, created_by: id, created_at: time, updated_at: time };
}
function prompt(variantId = promptId, label = '测试问题'): components['schemas']['GeoPromptVariantOut'] {
  return { id: variantId, query_topic_id: otherId, prompt_text: label, mention_mode: 'UNBRANDED', language_code: 'zh-cn', region_code: 'CN', priority: 'STANDARD', is_active: true, revision: 1, first_referenced_at: null, created_by: id, created_at: time, updated_at: time, query_topic: { id: otherId, canonical_question: '测试主题', intent_type: 'REPLACEMENT', revision: 1 }, workflow_stage: 'ACTIVE', primary_task: 'EDIT', available_actions: ['UPDATE'], deletion: { blockers: [] }, run_entry: { available: false, reason_code: 'NOT_IMPLEMENTED' } };
}
function profile(): components['schemas']['GeoCollectionProfileRead'] {
  return { summary: { id: profileId, name: '工程师采集摘要', engine_surface_id: otherId, engine_surface: { id: otherId, name: '人工观测面', slug: 'manual-site', surface_kind: 'MANUAL_SITE', provider_brand: 'CUSTOM', compliance_status: 'NOT_REVIEWED', capabilities: { answer_text: true, citations: false, web_search_signal: false, model_version: false, usage: false, cost: false }, is_active: true, revision: 1, created_at: time, updated_at: time }, collection_mode: 'MANUAL', language_code: 'zh-cn', region_code: 'CN', login_state: 'ANONYMOUS', web_search_policy: 'UNKNOWN', is_active: true, last_test_status: 'UNTESTED', last_tested_at: null, revision: 1, created_at: time, updated_at: time }, configuration: null, workflow_stage: 'ACTIVE', primary_task: 'VIEW_SUMMARY', available_actions: [], deletion: null, activation_blockers: null, test_blockers: null, test_error: null };
}
function response<T>(data: T) { return { data, response: Response.json(data) } as never; }
function failure(status = 409) {
  const error = { error: { code: status === 409 ? 'REVISION_CONFLICT' : 'FORBIDDEN', message: '服务端拒绝当前提交', request_id: 'plan-wizard-test-request', details: {} } };
  return { error, response: Response.json(error, { status }) } as never;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function reads() {
  return vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/geo/subjects') return response({ items: [subject()], page: 1, page_size: 10, total: 1 });
    if (path === '/api/v1/geo/prompt-variants') return response({ items: [prompt()], page: 1, page_size: 10, total: 1 });
    if (path === '/api/v1/geo/collection-profiles') return response({ items: [profile()], page: 1, page_size: 10, total: 1 });
    throw new Error(`测试收到未声明读取：${path}`);
  });
}
function renderWizard({ creating = false, browser = false, initialStep = 0, onReload = vi.fn(async () => plan({ revision: 9, name: '服务端新名称', description: '服务端新说明' })), projected = plan({ available_actions: [] }) }: { creating?: boolean; browser?: boolean; initialStep?: number; onReload?: () => Promise<PlanDetail>; projected?: PlanDetail } = {}) {
  const onSaved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  initializePrincipalEpoch(client, 'wizard-test-principal');
  function Demo() {
    const router = useRouter();
    const [current, setCurrent] = useState<PlanDetail | undefined>(creating ? undefined : plan());
    return <><button onClick={() => router.history.push(`/geo/plans?${creating ? 'new=1' : `selected=${id}&edit=1`}&q=changed`)} type="button">更改列表筛选</button><button onClick={() => router.history.push(`/geo/plans?selected=${otherId}&edit=1`)} type="button">切换计划</button><button onClick={() => setCurrent(projected)} type="button">更新后台投影</button><PlanWizard csrfToken="wizard-csrf" initialStep={initialStep} onCancel={() => router.history.push('/geo/plans')} onReload={creating ? undefined : onReload} onSaved={onSaved} plan={current} /></>;
  }
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/geo/plans', component: Demo });
  const entry = `/geo/plans?${creating ? 'new=1' : `selected=${id}&edit=1`}`;
  if (browser) window.history.replaceState(null, '', entry);
  const history = browser ? createBrowserHistory() : createMemoryHistory({ initialEntries: [entry] });
  const router = createRouter({ routeTree: root.addChildren([route]), history });
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { view, router, client, onSaved, onReload };
}
async function serverPreview(driver: ReturnType<typeof userEvent.setup>) {
  await driver.click(screen.getByRole('button', { name: '7. 服务端预览' }));
  await driver.click(screen.getByRole('button', { name: '预览当前配置' }));
  await screen.findByRole('region', { name: '服务端运行预览' });
}
async function fillCreation(driver: ReturnType<typeof userEvent.setup>) {
  await driver.type(await screen.findByRole('textbox', { name: '计划名称' }), '本地新建');
  await driver.click(screen.getByRole('button', { name: '2. 监测对象' }));
  await driver.click(await screen.findByRole('combobox', { name: '选择对象角色：监测品牌' })); await driver.click(await screen.findByRole('option', { name: '主要监测对象' }));
  await driver.click(screen.getByRole('button', { name: '3. 问题变体' })); await driver.click(await screen.findByRole('button', { name: '选择问题变体：测试问题' }));
  await driver.click(screen.getByRole('button', { name: '4. 采集配置' })); await driver.click(await screen.findByRole('button', { name: '选择采集配置：工程师采集摘要' }));
}
afterEach(() => vi.restoreAllMocks());
describe('八步计划向导', () => {
  it('新建各步保持本地草稿，显式选择 PRIMARY，最终只创建一次且不自动启用', async () => {
    reads();
    const post = vi.spyOn(api, 'POST').mockImplementation(async (path) => path === '/api/v1/geo/monitoring-plans/preview' ? response(preview()) : response(plan({ name: '新监测计划', description: '', revision: 0 })));
    const { onSaved } = renderWizard({ creating: true }); const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: '计划名称' }), '新监测计划');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(await screen.findByRole('combobox', { name: '选择对象角色：监测品牌' }));
    await user.click(await screen.findByRole('option', { name: '主要监测对象' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(await screen.findByRole('button', { name: '选择问题变体：测试问题' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(await screen.findByRole('button', { name: '选择采集配置：工程师采集摘要' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '预览当前配置' }));
    await screen.findByText(/1 × 1 × 3 = 91/);
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.dblClick(screen.getByRole('button', { name: '创建监测计划' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(post.mock.calls.map((call) => call[0])).toEqual(['/api/v1/geo/monitoring-plans/preview', '/api/v1/geo/monitoring-plans']);
    const create = post.mock.calls[1]![1] as { body: components['schemas']['GeoMonitoringPlanCreate']; params: { header: Record<string, string> } };
    expect(create.body).toMatchObject({ name: '新监测计划', subjects: [{ subject_id: subjectId, role: 'PRIMARY' }], prompt_variant_ids: [promptId], collection_profile_ids: [profileId], repeat_count: 3, cron_expression: null, budget_limit: null });
    expect(create.params.header['X-CSRF-Token']).toBe('wizard-csrf');
  });
  it('409 保留全部输入与 preview，显式重读只更新 revision，必须重新预览且无自动重放', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(preview()));
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValueOnce(failure()).mockResolvedValue(response(plan({ name: '本地名称', description: '本地说明', revision: 10 })));
    const { onReload, onSaved } = renderWizard(); const user = userEvent.setup();
    await user.clear(await screen.findByRole('textbox', { name: '计划名称' })); await user.type(screen.getByRole('textbox', { name: '计划名称' }), '本地名称');
    await user.clear(screen.getByRole('textbox', { name: '计划说明' })); await user.type(screen.getByRole('textbox', { name: '计划说明' }), '本地说明');
    await serverPreview(user); await user.click(screen.getByRole('button', { name: '8. 保存' }));
    await user.click(screen.getByRole('button', { name: '保存计划配置' }));
    expect(await screen.findByText(/plan-wizard-test-request/)).toBeInTheDocument();
    expect(screen.getByText(/1 × 1 × 3 = 91/)).toBeInTheDocument();
    expect(patch).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: '保存计划配置' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '加载最新计划并保留输入' }));
    expect(onReload).toHaveBeenCalledOnce(); expect(patch).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('region', { name: '最新服务端配置供比较' })).toHaveTextContent('服务端新名称');
    expect(screen.getByRole('button', { name: '保存计划配置' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '1. 基本信息' }));
    expect(screen.getByRole('textbox', { name: '计划名称' })).toHaveValue('本地名称'); expect(screen.getByRole('textbox', { name: '计划说明' })).toHaveValue('本地说明');
    await serverPreview(user); await user.click(screen.getByRole('button', { name: '8. 保存' })); await user.click(screen.getByRole('button', { name: '保存计划配置' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledTimes(2);
    expect((patch.mock.calls[0]![1] as { body: object }).body).toMatchObject({ expected_revision: 7, name: '本地名称', description: '本地说明' });
    expect((patch.mock.calls[1]![1] as { body: object }).body).toMatchObject({ expected_revision: 9, name: '本地名称', description: '本地说明' });
  });
  it('新建 409 后可修正草稿，显式重新 preview 后手动创建，不能陷入不可恢复冲突', async () => {
    reads(); let createAttempts = 0;
    const post = vi.spyOn(api, 'POST').mockImplementation(async (path) => {
      if (path === '/api/v1/geo/monitoring-plans/preview') return response(preview());
      createAttempts += 1;
      return createAttempts === 1 ? failure() : response(plan({ name: '修正后新建', revision: 0 }));
    });
    const { onSaved } = renderWizard({ creating: true }); const user = userEvent.setup(); await fillCreation(user); await serverPreview(user);
    await user.click(screen.getByRole('button', { name: '8. 保存' })); await user.click(screen.getByRole('button', { name: '创建监测计划' }));
    expect(await screen.findByText(/plan-wizard-test-request/)).toBeInTheDocument(); expect(createAttempts).toBe(1);
    expect(screen.getByText(/1 × 1 × 3 = 91/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: '创建监测计划' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '1. 基本信息' })); expect(screen.getByRole('textbox', { name: '计划名称' })).toHaveValue('本地新建');
    await user.clear(screen.getByRole('textbox', { name: '计划名称' })); await user.type(screen.getByRole('textbox', { name: '计划名称' }), '修正后新建');
    await serverPreview(user); expect(createAttempts).toBe(1);
    await user.click(screen.getByRole('button', { name: '8. 保存' })); await user.click(screen.getByRole('button', { name: '创建监测计划' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce()); expect(createAttempts).toBe(2); expect(post).toHaveBeenCalledTimes(4);
  });
  it('422 只采用安全字段定位与消息，可跳回预算并且不展示服务端 input/context', async () => {
    vi.spyOn(api, 'POST').mockResolvedValue(response(preview()));
    const envelope = { error: { code: 'VALIDATION_ERROR', message: '输入未通过校验', request_id: 'safe-field-request', details: { errors: [{ loc: ['body', 'budget_limit'], msg: '预算不符合当前约束', input: 'PRIVATE_INPUT_VALUE', ctx: { value: 'PRIVATE_CONTEXT_VALUE' } }] } } };
    vi.spyOn(api, 'PATCH').mockResolvedValue({ error: envelope, response: Response.json(envelope, { status: 422 }) } as never);
    renderWizard({ initialStep: 6 }); const user = userEvent.setup(); await screen.findByRole('button', { name: '预览当前配置' }); await serverPreview(user);
    await user.click(screen.getByRole('button', { name: '8. 保存' })); await user.click(screen.getByRole('button', { name: '保存计划配置' }));
    await user.click(await screen.findByRole('button', { name: '预算不符合当前约束' }));
    expect(screen.getByRole('textbox', { name: '预算上限' })).toHaveAttribute('aria-invalid', 'true'); expect(document.activeElement).toHaveAttribute('id', 'plan-budget_limit');
    expect(document.body).not.toHaveTextContent('PRIVATE_INPUT_VALUE'); expect(document.body).not.toHaveTextContent('PRIVATE_CONTEXT_VALUE');
  });
  it('预览请求忽略 abort 且草稿 ABA 回到原值时仍丢弃旧结果，当前预览不会被覆盖', async () => {
    const old = deferred<never>();
    const post = vi.spyOn(api, 'POST').mockImplementationOnce(() => old.promise).mockResolvedValue(response(preview(202)));
    renderWizard({ initialStep: 6 }); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '预览当前配置' }));
    await user.click(screen.getByRole('button', { name: '1. 基本信息' }));
    await user.type(screen.getByRole('textbox', { name: '计划名称' }), 'A'); await user.keyboard('{Backspace}');
    expect(screen.getByRole('textbox', { name: '计划名称' })).toHaveValue('原始计划');
    await serverPreview(user);
    expect(screen.getByText(/1 × 1 × 3 = 202/)).toBeInTheDocument();
    await act(async () => old.resolve(response(preview(999))));
    expect(screen.queryByText(/1 × 1 × 3 = 999/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 × 1 × 3 = 202/)).toBeInTheDocument();
    expect((post.mock.calls[0]![1] as { signal: AbortSignal }).signal.aborted).toBe(true);
  });
  it('任意有效草稿变化使已有 preview 失效，后台新配置不会覆盖输入或 CAS 基线', async () => {
    vi.spyOn(api, 'POST').mockResolvedValue(response(preview()));
    renderWizard({ projected: plan({ name: '后台名称', revision: 99 }) }); const user = userEvent.setup();
    await screen.findByRole('textbox', { name: '计划名称' }); await serverPreview(user);
    await user.click(screen.getByRole('button', { name: '1. 基本信息' })); await user.type(screen.getByRole('textbox', { name: '计划名称' }), '本地');
    await user.click(screen.getByRole('button', { name: '更新后台投影' }));
    expect(screen.getByRole('textbox', { name: '计划名称' })).toHaveValue('原始计划本地');
    expect(screen.getByText('提交基线 Revision 7')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '8. 保存' })); expect(screen.getByRole('button', { name: '保存计划配置' })).toBeDisabled();
  });
  it('新投影撤销动作及 403 均阻止写入而保留草稿', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValue(failure(403));
    renderWizard(); const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: '计划名称' }), '保留');
    await user.click(screen.getByRole('button', { name: '7. 服务端预览' })); await user.click(screen.getByRole('button', { name: '预览当前配置' }));
    expect(await screen.findByText(/当前计划只读或读取权限已变化/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1. 基本信息' })); expect(screen.getByRole('textbox', { name: '计划名称' })).toHaveValue('原始计划保留');
    expect(screen.getByRole('textbox', { name: '计划名称' })).toBeDisabled(); expect(post).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '更新后台投影' })); await user.click(screen.getByRole('button', { name: '8. 保存' }));
    expect(screen.queryByRole('button', { name: '保存计划配置' })).not.toBeInTheDocument();
  });
  it('dirty 保护关闭、切换及刷新；安全筛选保持当前输入', async () => {
    const { router, view } = renderWizard({ browser: true }); const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: '计划名称' }), '草稿');
    await user.click(screen.getByRole('button', { name: '更改列表筛选' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'changed' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByRole('textbox', { name: '计划名称' })).toHaveValue('原始计划草稿');
    for (const label of ['关闭向导', '切换计划']) { await user.click(screen.getByRole('button', { name: label })); expect(await screen.findByRole('dialog')).toBeInTheDocument(); await user.click(screen.getByRole('button', { name: '继续编辑' })); }
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    expect(screen.getByRole('textbox', { name: '计划名称' })).toHaveValue('原始计划草稿');
    view.unmount(); router.history.destroy(); window.history.replaceState(null, '', '/');
  });
  it('主体变化或卸载后，迟到保存不能污染缓存或触发 canonical 回调', async () => {
    const late = deferred<never>(); vi.spyOn(api, 'POST').mockResolvedValue(response(preview())); vi.spyOn(api, 'PATCH').mockImplementation(() => late.promise);
    const { client, view, onSaved } = renderWizard({ initialStep: 6 }); const user = userEvent.setup();
    await screen.findByRole('button', { name: '预览当前配置' }); await serverPreview(user); await user.click(screen.getByRole('button', { name: '8. 保存' })); await user.click(screen.getByRole('button', { name: '保存计划配置' }));
    invalidatePrincipalEpoch(client, 'new-principal'); view.unmount();
    await act(async () => late.resolve(response(plan({ revision: 8 }))));
    expect(onSaved).not.toHaveBeenCalled(); expect(client.getQueryData(planKeys.detail(id))).toBeUndefined();
  });
  it('可保存结构完整但有运行 blocker 的未启用计划，并聚焦可修正选择项', async () => {
    reads(); vi.spyOn(api, 'POST').mockResolvedValue(response({ ...preview(), blockers: [{ code: 'PROFILE_DISABLED', field: 'collection_profile_ids.is_active', resource_id: profileId, related_resource_id: null }] }));
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(response(plan({ revision: 8 }))); const { onSaved } = renderWizard({ initialStep: 6 }); const user = userEvent.setup();
    await screen.findByRole('button', { name: '预览当前配置' }); await serverPreview(user);
    await user.click(screen.getByRole('button', { name: '修正此项：collection_profile_ids' }));
    expect(await screen.findByRole('heading', { name: '4. 采集配置' })).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute('id', `plan-collection_profile_ids-${profileId}`);
    await user.click(screen.getByRole('button', { name: '8. 保存' })); await user.click(screen.getByRole('button', { name: '保存计划配置' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce()); expect(patch).toHaveBeenCalledOnce();
  });
});
describe('跨页选项与显式角色', () => {
  it('服务端搜索与分页后保留已选 ID 和可移除入口，支持缺失 ID', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (_path, options) => {
      const query = (options as { params: { query: { page: number; q?: string } } }).params.query;
      const item = query.page === 1 ? prompt() : prompt(otherId, '第二页问题');
      return response({ items: query.q ? [] : [item], page: query.page, page_size: 10, total: 11 });
    });
    function Demo() { const [selected, setSelected] = useState([id]); return <PlanOptions kind="prompts" onChange={setSelected} selected={selected} />; }
    render(<QueryClientProvider client={new QueryClient()}><Demo /></QueryClientProvider>); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '选择问题变体：测试问题' })); await user.click(screen.getByRole('button', { name: '下一页问题变体选项' }));
    await user.click(await screen.findByRole('button', { name: '选择问题变体：第二页问题' }));
    const selected = screen.getByRole('region', { name: '已选问题变体' }); expect(selected).toHaveTextContent('测试问题'); expect(selected).toHaveTextContent('第二页问题');
    await user.type(screen.getByRole('searchbox', { name: '搜索问题变体选项' }), '服务端搜索');
    expect(await screen.findByText('没有匹配的选项，请调整搜索。')).toBeInTheDocument();
    expect(within(selected).getAllByRole('button', { name: /移除问题变体/ })).toHaveLength(3);
    await user.click(within(selected).getByRole('button', { name: `移除问题变体：${id}` }));
    expect(within(selected).queryByText(id)).not.toBeInTheDocument();
    expect(get.mock.calls.some((call) => (call[1] as { params: { query: { q?: string; page: number } } }).params.query.q === '服务端搜索' && (call[1] as { params: { query: { page: number } } }).params.query.page === 1)).toBe(true);
  });
  it('subject 角色由用户明确选择，并能跨页修改和移除', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({ items: [subject()], page: 1, page_size: 10, total: 1 }));
    const changed = vi.fn();
    function Demo() { const [subjects, setSubjects] = useState<PlanValues['subjects']>([]); return <PlanOptions kind="subjects" onChange={() => {}} onSubjectsChange={(items) => { changed(items); setSubjects(items); }} selected={subjects.map((item) => item.subject_id)} subjects={subjects} />; }
    render(<QueryClientProvider client={new QueryClient()}><Demo /></QueryClientProvider>); const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: '选择对象角色：监测品牌' })); await user.click(await screen.findByRole('option', { name: '参考对象' }));
    expect(changed).toHaveBeenLastCalledWith([{ subject_id: subjectId, role: 'REFERENCE' }]);
    await user.type(screen.getByRole('searchbox', { name: '搜索监测对象选项' }), '搜索');
    await user.click(screen.getByRole('combobox', { name: '已选对象角色：监测品牌' })); await user.click(await screen.findByRole('option', { name: '主要监测对象' }));
    expect(changed).toHaveBeenLastCalledWith([{ subject_id: subjectId, role: 'PRIMARY' }]);
    await user.click(screen.getByRole('button', { name: '移除监测对象：监测品牌' })); expect(changed).toHaveBeenLastCalledWith([]);
  });
  it('选项读取错误保留选中项并显示 request ID，无静默空列表', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(failure(403));
    render(<QueryClientProvider client={new QueryClient()}><PlanOptions kind="prompts" onChange={() => {}} selected={[promptId]} /></QueryClientProvider>);
    expect(await screen.findByText(/plan-wizard-test-request/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: `移除问题变体：${promptId}` })).toBeInTheDocument();
    expect(screen.queryByText('暂无问题变体选项。请在已有资源页面准备配置。')).not.toBeInTheDocument();
  });
});
