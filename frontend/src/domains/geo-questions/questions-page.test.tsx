import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import { questionKeys } from './questions.api';
import { failure, mockReads, renderQuestions, response, topicId, variant, variantId } from './questions.test-support';

afterEach(() => vi.restoreAllMocks());
async function choose(label: string, option: string) {
  const driver = userEvent.setup();
  await driver.click(await screen.findByRole('combobox', { name: label }));
  await driver.click(await screen.findByRole('option', { name: option }));
}
async function edit() {
  const driver = userEvent.setup();
  await driver.click(await screen.findByRole('button', { name: '编辑变体' }));
  return driver;
}
async function action(label: string) {
  const driver = userEvent.setup();
  await driver.click(await screen.findByRole('button', { name: '更多操作：当前变体' }));
  await driver.click(await screen.findByRole('menuitem', { name: label }));
  return driver;
}
describe('GEO 问题库工作区', () => {
  it('ENGINEER 显式选择维度，文本改动不猜测点名；创建使用嵌套主题 ID', async () => {
    mockReads();
    const created = vi.spyOn(api, 'POST').mockResolvedValue(response(variant()));
    renderQuestions('/geo/questions?new=1');
    const driver = userEvent.setup();
    for (const label of ['问题主题', '点名属性', '优先级']) {
      expect(await screen.findByRole('combobox', { name: label })).toBeRequired();
    }
    await choose('问题主题', '标准主题');
    await driver.type(screen.getByRole('textbox', { name: '完整问题文本' }), 'PartSignal 型号有哪些替代品？');
    expect(screen.getByRole('combobox', { name: '点名属性' })).toHaveTextContent('请选择点名属性');
    await choose('点名属性', '非点名'); await choose('优先级', '核心');
    await driver.type(screen.getByRole('textbox', { name: '语言代码' }), 'zh-CN');
    await driver.type(screen.getByRole('textbox', { name: '地区代码' }), 'CN');
    await driver.clear(screen.getByRole('textbox', { name: '完整问题文本' }));
    await driver.type(screen.getByRole('textbox', { name: '完整问题文本' }), '没有品牌名称的文本');
    expect(screen.getByRole('combobox', { name: '点名属性' })).toHaveTextContent('非点名');
    await driver.click(screen.getByRole('button', { name: '创建变体' }));
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(created).toHaveBeenCalledWith('/api/v1/geo/query-topics/{query_topic_id}/prompt-variants', { body: { query_topic_id: topicId, prompt_text: '没有品牌名称的文本', mention_mode: 'UNBRANDED', language_code: 'zh-CN', region_code: 'CN', priority: 'CORE' }, params: { path: { query_topic_id: topicId }, header: { 'X-CSRF-Token': 'questions-csrf' } } });
    expect(await screen.findByRole('dialog', { name: '问题变体工作区' })).toBeVisible();
  });
  it('已引用的动作只来自服务端投影，运行禁用且不调用执行 API', async () => {
    mockReads(() => variant({ workflow_stage: 'REFERENCED', primary_task: 'VIEW_DETAILS', available_actions: ['DISABLE', 'COPY'], deletion: { blockers: ['HISTORY_REFERENCE'] }, first_referenced_at: '2026-10-02T09:00:00Z' }));
    const post = vi.spyOn(api, 'POST');
    renderQuestions();
    const region = await screen.findByRole('region', { name: '问题变体详情' });
    expect(within(region).queryByRole('button', { name: '编辑变体' })).not.toBeInTheDocument();
    expect(within(region).getByRole('button', { name: '立即运行' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(region).getByText(/NOT_IMPLEMENTED/)).toBeVisible();
    expect(within(region).getByText(/HISTORY_REFERENCE/)).toBeVisible();
    const driver = userEvent.setup(); await driver.click(within(region).getByRole('button', { name: '更多操作：当前变体' }));
    expect(await screen.findByRole('menuitem', { name: '复制为新变体' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: '查看删除条件' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: /删除变体|启用变体|编辑变体/ })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  it('后台成功与失败都保留草稿，409 后显式读取仅合并 revision，不重放提交', async () => {
    let current = variant(); let backgroundFails = false;
    mockReads(() => current, undefined, () => backgroundFails);
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValueOnce(failure()).mockResolvedValueOnce(response(variant({ prompt_text: '本地草稿', revision: 9 })));
    const { client } = renderQuestions();
    const driver = await edit();
    const text = screen.getByRole('textbox', { name: '完整问题文本' }); await driver.clear(text); await driver.type(text, '本地草稿');
    current = variant({ prompt_text: '他人的最新文本', revision: 8 });
    await act(async () => { await client.invalidateQueries({ queryKey: questionKeys.detail(variantId) }); });
    expect(text).toHaveValue('本地草稿'); expect(screen.getByText(/提交基线 Revision 7/)).toBeVisible();
    backgroundFails = true;
    await act(async () => { await client.invalidateQueries({ queryKey: questionKeys.detail(variantId) }); });
    expect(screen.getByText(/后台读取失败/)).toBeVisible(); expect(text).toHaveValue('本地草稿');
    await driver.click(screen.getByRole('button', { name: '保存变体' }));
    expect(await screen.findByText(/变体已被其他操作更新/)).toBeVisible(); expect(patch).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '保存变体' })).toBeDisabled();
    backgroundFails = false;
    await driver.click(screen.getByRole('button', { name: '加载最新版本并保留输入' }));
    await screen.findByText(/提交基线 Revision 8/); expect(text).toHaveValue('本地草稿'); expect(patch).toHaveBeenCalledOnce();
    await driver.click(screen.getByRole('button', { name: '保存变体' }));
    await screen.findByText('已保存 · Revision 9');
    expect(patch.mock.calls[1]?.[1]).toMatchObject({ body: { expected_revision: 8, prompt_text: '本地草稿', mention_mode: 'UNBRANDED' } });
  });
  it('复制创建遇到语义重复 409 保留全部输入和源身份，不自动重试', async () => {
    mockReads(); const post = vi.spyOn(api, 'POST').mockResolvedValue(failure('GEO_PROMPT_VARIANT_EXISTS'));
    const { router } = renderQuestions(`/geo/questions?copy=${variantId}&q=原始`);
    const driver = userEvent.setup(); const field = await screen.findByRole('textbox', { name: '完整问题文本' });
    await driver.clear(field); await driver.type(field, '复制输入');
    await driver.click(screen.getByRole('button', { name: '创建变体' }));
    expect(await screen.findByText(/question-request-test/)).toBeVisible(); expect(field).toHaveValue('复制输入');
    expect(screen.getByRole('combobox', { name: '优先级' })).toHaveTextContent('标准');
    expect(router.state.location.search).toMatchObject({ copy: variantId, q: '原始' }); expect(post).toHaveBeenCalledOnce();
  });
  it('筛选 URL 可恢复且不会切换选中编辑身份，dirty 关闭会阻断导航', async () => {
    const get = mockReads(); const { router } = renderQuestions(`/geo/questions?selected=${variantId}&mention_mode=BRANDED&is_active=false&language_code=en&region_code=US&page=2&page_size=10&sort=TEXT_ASC`);
    const driver = await edit(); const text = screen.getByRole('textbox', { name: '完整问题文本' }); await driver.type(text, '草稿');
    await act(async () => { await router.navigate({ to: '/geo/questions', search: { ...router.state.location.search, q: '新筛选' } }); });
    expect(text).toHaveValue('原始问题变体草稿');
    expect(get).toHaveBeenCalledWith('/api/v1/geo/prompt-variants', expect.objectContaining({ params: { query: expect.objectContaining({ mention_mode: 'BRANDED', is_active: false, language_code: 'en', region_code: 'US', page: 2, page_size: 10, sort: 'TEXT_ASC', q: '新筛选' }) } }));
    await driver.click(screen.getByRole('button', { name: '关闭' }));
    expect(await screen.findByRole('dialog', { name: '要离开当前页面吗？' })).toBeVisible();
    await driver.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(router.state.location.search).toMatchObject({ selected: variantId, q: '新筛选' }); expect(text).toHaveValue('原始问题变体草稿');
  });
  it('删除成功清理 selected 与列表，不再次 GET 已删除详情', async () => {
    let removed = false; const get = mockReads(variant, () => removed ? [] : [variant()]);
    const remove = vi.spyOn(api, 'DELETE').mockImplementation(async () => { removed = true; return { response: new Response(null, { status: 204 }) } as never; });
    const { router } = renderQuestions(); const driver = await action('删除变体');
    expect(remove).not.toHaveBeenCalled(); await driver.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(router.state.location.search.selected).toBeUndefined());
    await screen.findByText('暂无问题变体');
    expect(get.paths.filter((path) => path === '/api/v1/geo/prompt-variants/{variant_id}')).toHaveLength(1);
    expect(remove).toHaveBeenCalledWith('/api/v1/geo/prompt-variants/{variant_id}', { params: { path: { variant_id: variantId }, query: { expected_revision: 7 }, header: { 'X-CSRF-Token': 'questions-csrf' } } });
  });
  it('同一选中变体的重复编辑动作不重挂草稿或清除 dirty', async () => {
    mockReads(); renderQuestions(); const driver = await edit();
    const input = screen.getByRole('textbox', { name: '完整问题文本' }); await driver.type(input, '保留草稿');
    const list = screen.getAllByRole('region', { hidden: true }).find((element) => element.getAttribute('aria-label') === '问题变体列表')!;
    // Sheet 隔离了后台列表；模拟来自该列表的同资源动作事件，验证重入不丢草稿。
    fireEvent.click(within(list).getAllByRole('button', { hidden: true }).find((element) => element.textContent === '编辑')!);
    expect(screen.getByRole('textbox', { name: '完整问题文本' })).toHaveValue('原始问题变体保留草稿');
    expect(screen.getByText('有未保存的修改')).toBeVisible();
  });
  it.each(['主体变化', '编辑器卸载'])('%s 后旧响应不能写回缓存或导航', async (boundary) => {
    mockReads(); let resolve!: (value: ReturnType<typeof response>) => void;
    const patch = vi.spyOn(api, 'PATCH').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { client, router, view } = renderQuestions(); const driver = await edit();
    await driver.type(screen.getByRole('textbox', { name: '完整问题文本' }), '修改'); await driver.click(screen.getByRole('button', { name: '保存变体' }));
    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    if (boundary === '主体变化') invalidatePrincipalEpoch(client); else view.unmount();
    await act(async () => { resolve(response(variant({ prompt_text: '旧主体成功响应', revision: 8 }))); });
    expect(client.getQueryData(questionKeys.detail(variantId))).toMatchObject({ revision: 7 }); expect(router.state.location.search.selected).toBe(variantId);
  });
  it('直接访问不存在变体显示真实 404，提供关闭入口，不重复 GET 或猜测数据', async () => {
    const paths: string[] = [];
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      paths.push(path);
      if (path === '/api/v1/geo/prompt-variants/{variant_id}') return failure('NOT_FOUND', 404);
      if (path === '/api/v1/geo/prompt-variants') return response({ items: [], total: 0, page: 1, page_size: 20 });
      if (path === '/api/v1/query-topics') return response({ items: [] });
      throw new Error(`测试收到未声明请求：${path}`);
    });
    const { router } = renderQuestions();
    const detail = await screen.findByRole('dialog', { name: '问题变体工作区' });
    expect(await within(detail).findByText(/question-request-test/)).toBeVisible();
    expect(within(detail).queryByRole('button', { name: '重试详情读取' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('region', { name: '问题变体详情' })).not.toBeInTheDocument();
    await userEvent.setup().click(within(detail).getByRole('button', { name: '关闭详情' }));
    await waitFor(() => expect(router.state.location.search.selected).toBeUndefined());
    expect(paths.filter((path) => path === '/api/v1/geo/prompt-variants/{variant_id}')).toHaveLength(1);
  });
});
