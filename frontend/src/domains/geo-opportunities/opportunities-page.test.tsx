import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { opportunityKeys } from './opportunities.api';
import { comparisonRead, detail, failure, list, mockReads, opportunity, opportunityId, renderOpportunities, response } from './opportunities.test-support';

afterEach(() => vi.restoreAllMocks());
const dialog = () => screen.getByRole('dialog', { name: '机会详情与历史证据' });
async function openDismiss() { await userEvent.click(await within(dialog()).findByRole('button', { name: '忽略机会' })); }
async function fillReason() { await userEvent.type(within(dialog()).getByRole('textbox', { name: '忽略原因代码' }), '  NOT_ACTIONABLE  '); await userEvent.type(within(dialog()).getByRole('textbox', { name: '忽略原因说明' }), ' 已逐条核对，保留本地原因草稿 '); }

describe('GEO 机会工作台', () => {
  it('已有行动按服务端导航，缺失目标保留ID和来源提示', async () => {
    const value = detail();
    value.actions = [
      { id: '00000000-0000-4000-8000-000000000001', action_type: 'FACT_REVISION', target_type: 'Product', target_id: opportunityId, status_snapshot: 'FACTS_READY', created_by: opportunityId, created_at: value.as_of, source_snapshot: null, target_available: true, navigation_path: `/products/${opportunityId}/facts?source_opportunity_id=${opportunityId}` },
      { id: '00000000-0000-4000-8000-000000000002', action_type: 'CONTENT_TASK', target_type: 'ContentTask', target_id: opportunityId, status_snapshot: 'OPEN', created_by: opportunityId, created_at: value.as_of, source_snapshot: null, target_available: false, navigation_path: null },
    ];
    mockReads(opportunity, () => value); renderOpportunities();
    const sheet = await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    expect(await within(sheet).findByRole('link', { name: '打开行动目标' })).toHaveAttribute('href', value.actions[0]!.navigation_path);
    expect(within(sheet).getByText('目标已删除，来源快照仍保留。')).toBeVisible();
    expect(within(sheet).getAllByRole('link', { name: '打开行动目标' })).toHaveLength(1);
  });
  it('同一状态的主入口随服务端 primary_task 和 available_actions 改变，不猜测写动作', async () => {
    const current = opportunity({ primary_task: 'VIEW_EVIDENCE', available_actions: [] });
    const read = mockReads(() => current);
    const { router } = renderOpportunities('/geo/opportunities?q=电压&page=2&page_size=10');
    const table = await screen.findByRole('region', { name: 'GEO 机会列表' });
    expect(within(table).queryByRole('button', { name: '确认机会' })).not.toBeInTheDocument();
    await userEvent.click(within(table).getByRole('button', { name: '查看证据' }));
    await within(dialog()).findByRole('heading', { name: current.title });
    expect(router.state.location.search).toMatchObject({ q: '电压', page: 2, page_size: 10, opportunity_id: opportunityId });
    expect(within(dialog()).queryByRole('button', { name: '确认机会' })).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: /复测|解决机会|创建行动/ })).not.toBeInTheDocument();
    expect(read.requests.filter((request) => request.path === '/api/v1/geo/opportunities')[0]?.options).toMatchObject({ params: { query: { q: '电压', page: 2, page_size: 10 } } });
  });
  it('详情单一请求展示冻结回答、事实版本、保存的历史复核和受控签名文件', async () => {
    const value = detail(); value.sources.items[0]!.answer!.answer_text = '<script>danger()</script>历史电压5V回答';
    const read = mockReads(opportunity, () => value);
    renderOpportunities();
    const sheet = await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    expect(await within(sheet).findByText('<script>danger()</script>历史电压5V回答')).toBeVisible();
    expect(within(sheet).getByRole('region', { name: '来源绑定历史人工复核' })).toHaveTextContent(value.sources.items[0]!.review_id!);
    expect(within(sheet).getByRole('region', { name: '历史有效声明与事实依据' })).toHaveTextContent('额定电压为3.3V');
    expect(within(sheet).getByRole('region', { name: '历史有效声明与事实依据' })).toHaveTextContent(value.sources.items[0]!.analysis!.claims[0]!.fact_version_id!);
    expect(within(sheet).getByRole('link', { name: '打开受控证据文件' })).toHaveAttribute('href', value.sources.items[0]!.evidence_files[0]!.download.url);
    expect(sheet.querySelector('script')).toBeNull();
    expect(read.requests.map((request) => request.path)).not.toContain('/api/v1/geo/observation-runs/{run_id}');
  });
  it('全部维度使用 list filter_options，筛选、排序与 UTC 日期同名传 API 并回第一页', async () => {
    const read = mockReads(); const { router } = renderOpportunities('/geo/opportunities?page=3');
    const form = await screen.findByRole('form', { name: 'GEO 机会筛选' });
    await userEvent.click(within(form).getByText('维度、创建时间与排序筛选'));
    for (const [name, label] of [['监测对象', '测试零件'], ['产品', '测试产品'], ['问题主题', '冻结标准问题'], ['问题变体', '冻结完整问题'], ['采集配置', '人工配置'], ['观测面', '人工观测面']]) {
      await userEvent.click(within(form).getByRole('combobox', { name })); await userEvent.click(await screen.findByRole('option', { name: label }));
    }
    await userEvent.click(within(form).getByRole('combobox', { name: '采集方式' })); await userEvent.click(await screen.findByRole('option', { name: '人工录入' }));
    await userEvent.click(within(form).getByRole('combobox', { name: '机会排序' })); await userEvent.click(await screen.findByRole('option', { name: '最近评估从新到旧' }));
    await userEvent.type(within(form).getByRole('textbox', { name: '搜索机会' }), '电压');
    await userEvent.type(within(form).getByLabelText('创建开始时间（UTC）'), '2026-10-03T08:00');
    await userEvent.type(within(form).getByLabelText('创建结束时间（UTC，不含）'), '2026-10-04T08:00');
    await userEvent.click(within(form).getByRole('button', { name: '应用筛选' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: '电压', collection_mode: 'MANUAL', sort: 'LAST_SEEN_DESC', subject_id: valueId(), product_id: valueId(), query_topic_id: valueId(), prompt_variant_id: valueId(), collection_profile_id: valueId(), engine_surface_id: valueId(), created_from: '2026-10-03T08:00:00.000Z', created_to: '2026-10-04T08:00:00.000Z' }));
    expect(router.state.location.search).not.toHaveProperty('page');
    await waitFor(() => expect(read.requests.at(-1)?.options).toMatchObject({ params: { query: { q: '电压', subject_id: valueId(), sort: 'LAST_SEEN_DESC', page: 1 } } }));
  });
  it('截图访问失败后，刷新取得新签名 URL 会重新显示图片而保留完整性信息', async () => {
    const value = detail(); mockReads(opportunity, () => value); renderOpportunities();
    const image = await screen.findByRole('img', { name: '机会来源截图证据' });
    fireEvent.error(image); expect(within(dialog()).queryByRole('img', { name: '机会来源截图证据' })).not.toBeInTheDocument();
    value.sources.items[0]!.evidence_files[0]!.download.url = 'https://evidence.test/file?signature=renewed';
    await userEvent.click(within(dialog()).getByRole('button', { name: '刷新证据访问链接' }));
    expect(await within(dialog()).findByRole('img', { name: '机会来源截图证据' })).toHaveAttribute('src', 'https://evidence.test/file?signature=renewed');
    expect(within(dialog()).getByRole('region', { name: '机会证据文件' })).toHaveTextContent(value.sources.items[0]!.evidence_files[0]!.sha256);
  });
  it('合法补充平面字符按字符数提交，不被原生 UTF-16 长度上限截断', async () => {
    mockReads(); const post = vi.spyOn(api, 'POST').mockResolvedValue(failure()); renderOpportunities();
    await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await openDismiss();
    const user = userEvent.setup(); const code = '😀'.repeat(40);
    await user.click(within(dialog()).getByRole('textbox', { name: '忽略原因代码' })); await user.paste(code);
    await user.type(within(dialog()).getByRole('textbox', { name: '忽略原因说明' }), '已核对');
    expect(within(dialog()).getByRole('textbox', { name: '忽略原因代码' })).toHaveValue(code);
    await user.click(within(dialog()).getByRole('button', { name: '确认忽略' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { resolution_code: code, resolution_comment: '已核对' } });
  });
  it('409 保留原因，后台新 revision 不解锁；显式读取后只按新基线再次提交', async () => {
    let current = opportunity(); mockReads(() => current);
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(failure()).mockImplementation(async (_path, options) => {
      const body = (options as { body: { resolution_code: string; resolution_comment: string } }).body;
      current = opportunity({ status: 'DISMISSED', workflow_stage: 'CLOSED', primary_task: 'VIEW_EVIDENCE', revision: 3, available_actions: [], ...body });
      return response(current);
    });
    const { client } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    await openDismiss(); await fillReason(); await userEvent.click(within(dialog()).getByRole('button', { name: '确认忽略' }));
    expect(await within(dialog()).findByText(/原因草稿已保留，提交暂停/)).toBeVisible();
    expect(within(dialog()).getByRole('textbox', { name: '忽略原因说明' })).toHaveValue(' 已逐条核对，保留本地原因草稿 ');
    current = opportunity({ revision: 2, status: 'ACKNOWLEDGED', workflow_stage: 'ACKNOWLEDGED', primary_task: 'VIEW_EVIDENCE', available_actions: ['DISMISS'] });
    await act(async () => { client.setQueryData(opportunityKeys.detail(opportunityId, { source_page: 1, source_page_size: 20 }), detail(current)); });
    expect(within(dialog()).getByRole('button', { name: '确认忽略' })).toBeDisabled(); expect(post).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog()).getByRole('button', { name: '加载最新机会并保留原因' }));
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: '确认忽略' })).toBeEnabled());
    await userEvent.click(within(dialog()).getByRole('button', { name: '确认忽略' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 1, resolution_code: 'NOT_ACTIONABLE', resolution_comment: '已逐条核对，保留本地原因草稿' } });
    expect(post.mock.calls[1]?.[1]).toMatchObject({ body: { expected_revision: 2, resolution_code: 'NOT_ACTIONABLE', resolution_comment: '已逐条核对，保留本地原因草稿' }, params: { header: { 'X-CSRF-Token': 'geo703-csrf' } } });
    expect(await within(dialog()).findByText(/已忽略机会（revision 3）/)).toBeVisible();
    expect(within(dialog()).queryByRole('button', { name: '忽略机会' })).not.toBeInTheDocument();
  });
  it('来源分页属于 URL，读取新页期间原因草稿不会重建；确认只携带 revision', async () => {
    let current = opportunity();
    const read = mockReads(() => current, () => { const value = detail(current); value.sources.total = 41; return value; });
    const post = vi.spyOn(api, 'POST').mockImplementation(async () => { current = opportunity({ revision: 2, status: 'ACKNOWLEDGED', workflow_stage: 'ACKNOWLEDGED', primary_task: 'VIEW_EVIDENCE', available_actions: ['DISMISS'] }); return response(current); });
    const { router } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    await within(dialog()).findByRole('button', { name: '确认机会' });
    await userEvent.click(within(dialog()).getByRole('button', { name: '确认机会' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 1 } });
    await openDismiss(); await fillReason();
    await userEvent.click(within(dialog()).getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ opportunity_id: opportunityId, source_page: 2 }));
    await waitFor(() => expect(within(dialog()).getByRole('textbox', { name: '忽略原因说明' })).toHaveValue(' 已逐条核对，保留本地原因草稿 '));
    expect(read.requests.filter((request) => request.path === '/api/v1/geo/opportunities/{opportunity_id}').at(-1)?.options).toMatchObject({ params: { query: { source_page: 2, source_page_size: 20 } } });
    expect(router.state.location.search).not.toHaveProperty('resolution_comment');
  });
  it('键盘关闭 Drawer 清理来源参数、保留筛选，并恢复原触发器焦点；Back 可恢复选中项', async () => {
    mockReads(); const { router } = renderOpportunities('/geo/opportunities?q=电压&page_size=10');
    const table = await screen.findByRole('region', { name: 'GEO 机会列表' }); const trigger = within(table).getByRole('button', { name: '严重电压事实错误' });
    trigger.focus(); await userEvent.keyboard('{Enter}'); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '机会详情与历史证据' })).not.toBeInTheDocument());
    expect(router.state.location.search).toEqual({ q: '电压', page_size: 10 }); await waitFor(() => expect(trigger).toHaveFocus());
    await act(async () => { router.history.back(); });
    expect(await screen.findByRole('dialog', { name: '机会详情与历史证据' })).toBeVisible(); expect(router.state.location.search).toMatchObject({ q: '电压', page_size: 10, opportunity_id: opportunityId });
  });
  it.each([[403, '当前机会不可访问'], [404, '该机会不存在'], [409, '历史证据关联不完整'], [503, '证据签名服务暂不可用']])('首载详情 %s 有明确状态且不展示旧证据或命令', async (status, message) => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => path === '/api/v1/geo/opportunities' ? response(list()) : failure(status));
    renderOpportunities(); const sheet = await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    expect(await within(sheet).findByText(new RegExp(message))).toBeVisible();
    expect(within(sheet).queryByRole('region', { name: '机会历史来源' })).not.toBeInTheDocument(); expect(within(sheet).queryByRole('button', { name: '确认机会' })).not.toBeInTheDocument();
    if (status === 403 || status === 404) { expect(within(sheet).queryByRole('button', { name: '重试读取' })).not.toBeInTheDocument(); expect(within(sheet).queryByRole('button', { name: '刷新详情' })).not.toBeInTheDocument(); }
    else expect(within(sheet).getByRole('button', { name: '重试读取' })).toBeVisible();
  });
  it('后台详情签名失败保留快照并暂停命令，后续403隐藏全部旧证据', async () => {
    let status = 200;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => path === '/api/v1/geo/opportunities' ? response(list()) : path === '/api/v1/geo/opportunities/{opportunity_id}/comparison' ? response(comparisonRead()) : status === 200 ? response(detail()) : failure(status));
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await within(dialog()).findByRole('heading', { name: '严重电压事实错误' });
    status = 503; await userEvent.click(within(dialog()).getByRole('button', { name: '刷新详情' }));
    expect(await within(dialog()).findByText(/保留同一条件的上次成功快照/)).toBeVisible(); expect(within(dialog()).getByRole('region', { name: '机会历史来源' })).toBeVisible(); expect(within(dialog()).getByRole('button', { name: '确认机会' })).toBeDisabled();
    status = 403; await userEvent.click(within(dialog()).getByRole('button', { name: '刷新详情' }));
    expect(await within(dialog()).findByText(/当前机会不可访问/)).toBeVisible(); expect(within(dialog()).queryByRole('region', { name: '机会历史来源' })).not.toBeInTheDocument();
  });
  it('空页提供返回第一页，首载错误可以重试，后台列表失败保留已读结果', async () => {
    let status = 503;
    vi.spyOn(api, 'GET').mockImplementation(async () => status === 200 ? response({ ...list(), items: [], total: 21 }) : failure(status));
    const { router } = renderOpportunities('/geo/opportunities?page=3');
    expect(await screen.findByText(/读取机会失败/)).toBeVisible(); status = 200;
    await userEvent.click(screen.getByRole('button', { name: '重试读取' })); expect(await screen.findByText('暂无匹配机会')).toBeVisible();
    status = 503; await userEvent.click(screen.getByRole('button', { name: '刷新列表' })); expect(await screen.findByText(/保留同一条件的上次成功快照/)).toBeVisible(); expect(screen.getByRole('region', { name: 'GEO 机会列表' })).toBeVisible();
    status = 200; await userEvent.click(screen.getByRole('button', { name: '返回第一页' })); await waitFor(() => expect(router.state.location.search).toEqual({}));
  });
});
function valueId() { return opportunity().scope.subject_id; }
