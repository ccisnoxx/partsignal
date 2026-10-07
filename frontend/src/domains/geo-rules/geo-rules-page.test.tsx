import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import { geoRulesKey } from './geo-rules.api';
import { auth, configuration, failure, mockRead, previewResult, renderRules, renderTokenRules, response, ruleSet } from './geo-rules.test-support';

beforeAll(() => Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) }));
afterEach(() => vi.restoreAllMocks());
const previewButton = () => screen.getByRole('button', { name: '预览配置与样本资格' });
async function loaded() { return screen.findByRole('spinbutton', { name: '可见度下降阈值' }); }
function change(input: HTMLElement, value: number | string) { fireEvent.change(input, { target: { value: String(value) } }); }

describe('GEO 规则配置工作区', () => {
  it('管理员读取结构化配置，null 保持未配置，硬性恢复条件只读', async () => {
    mockRead(); renderRules(); await loaded();
    expect(screen.getAllByPlaceholderText('未配置')).toHaveLength(3);
    expect(screen.getByRole('spinbutton', { name: '机会去重窗口' })).toHaveValue(30);
    expect(screen.getByText('严格可比条件：必须满足（只读）')).toBeInTheDocument();
    expect(screen.getByText('人工确认：必须完成（只读）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存规则' })).toHaveAttribute('aria-disabled', 'true');
  });
  it('非管理员在 route 边界拒绝，保留地址且不读取规则 API', async () => {
    const get = mockRead(); const { router } = renderRules({ isAdmin: false });
    expect(await screen.findByRole('heading', { name: '无权访问 GEO 规则配置' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/configuration/geo-rules');
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'GEO 规则与阈值' })).not.toBeInTheDocument();
  });
  it('操作资格只消费 available_actions，不因为管理员身份补充入口', async () => {
    mockRead(() => ruleSet({ available_actions: [] })); renderRules();
    expect(await loaded()).toBeDisabled();
    expect(previewButton()).toBeDisabled();
    expect(screen.queryByRole('button', { name: '保存规则' })).not.toBeInTheDocument();
    expect(screen.getByText('服务端当前未授权保存和预览操作。')).toBeInTheDocument();
  });
  it('保存提交完整配置与 expected_revision，使用 canonical 响应重置基线和 cache', async () => {
    mockRead(); const updated = { ...configuration(), visibility_drop_points: 0.2, data_quality_minimum_success_rate: 0.8 };
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(response(ruleSet({ revision: 2, configuration: updated })));
    const { queryClient } = renderRules(); change(await loaded(), 0.2);
    change(screen.getByRole('spinbutton', { name: '数据质量：最低成功率' }), 0.8);
    await userEvent.click(screen.getByRole('button', { name: '保存规则' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/v1/geo/rules', { body: { expected_revision: 1, configuration: updated }, params: { header: { 'X-CSRF-Token': auth.csrfToken } } }));
    expect(await screen.findByText('规则已保存（revision 2），仅用于未来评估。')).toBeInTheDocument();
    expect(queryClient.getQueryData(geoRulesKey)).toMatchObject({ revision: 2, configuration: updated });
    expect(screen.getByRole('button', { name: '保存规则' })).toHaveAttribute('aria-disabled', 'true');
  });
  it('409 保留草稿并阻止提交；离开须确认，显式重读基线后按新 revision 保存', async () => {
    let canonical = ruleSet(); mockRead(() => canonical);
    const put = vi.spyOn(api, 'PUT').mockResolvedValueOnce(failure(409));
    const { router } = renderRules(); change(await loaded(), 0.25);
    await userEvent.click(screen.getByRole('button', { name: '保存规则' }));
    expect(await screen.findByText(/规则版本已变化。本地草稿已保留/)).toBeInTheDocument();
    expect(await loaded()).toHaveValue(0.25); expect(screen.getByRole('button', { name: '保存规则' })).toHaveAttribute('aria-disabled', 'true');
    void act(() => { void router.navigate({ to: '/' }); });
    const dialog = await screen.findByRole('dialog', { name: '要离开当前页面吗？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '继续编辑' }));
    expect(router.state.location.pathname).toBe('/configuration/geo-rules');
    canonical = ruleSet({ revision: 4, configuration: { ...configuration(), visibility_drop_points: 0.4 } });
    await userEvent.click(screen.getByRole('button', { name: '加载最新基线并保留草稿' }));
    expect(await screen.findByText(/最新基线已加载，本地草稿已保留/)).toBeInTheDocument();
    expect(await loaded()).toHaveValue(0.25); expect(screen.getByText('有未保存修改')).toBeInTheDocument();
    put.mockResolvedValue(response(ruleSet({ revision: 5, configuration: { ...configuration(), visibility_drop_points: 0.25 } })));
    await userEvent.click(screen.getByRole('button', { name: '保存规则' }));
    await waitFor(() => expect(put).toHaveBeenLastCalledWith('/api/v1/geo/rules', expect.objectContaining({ body: expect.objectContaining({ expected_revision: 4 }) })));
  });
  it('server cache 后台更新不覆盖草稿或更新编辑 revision', async () => {
    mockRead(); const { queryClient } = renderRules(); change(await loaded(), 0.27);
    act(() => queryClient.setQueryData(geoRulesKey, ruleSet({ revision: 8, configuration: { ...configuration(), visibility_drop_points: 0.5 } })));
    expect(await loaded()).toHaveValue(0.27); expect(screen.getByText(/当前编辑基线 revision 1/)).toBeInTheDocument();
  });
  it('preview 提交当前配置和样本，列表直接显示服务端等级、门槛与资格', async () => {
    mockRead(); const post = vi.spyOn(api, 'POST').mockResolvedValue(response(previewResult())); renderRules(); await loaded();
    change(screen.getByRole('spinbutton', { name: '当前窗口样本数' }), 2);
    await userEvent.click(previewButton());
    const result = await screen.findByRole('region', { name: '服务端规则预览结果' });
    expect(within(result).getByText('当前窗口：仅观察；前期窗口：无样本')).toBeInTheDocument();
    expect(within(result).getByText('样本充足')).toBeInTheDocument();
    expect(within(result).getByRole('cell', { name: '未配置' })).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/v1/geo/rules/preview', expect.objectContaining({ body: { expected_revision: 1, configuration: configuration(), samples: { current_runs: 2, previous_runs: 0 } }, signal: expect.any(AbortSignal) }));
    expect(screen.getByText(/仅验证配置和样本门槛/)).toBeInTheDocument();
  });
  it.each(['configuration', 'samples'])('%s 输入变化立即撤销已完成的 preview', async (target) => {
    mockRead(); vi.spyOn(api, 'POST').mockResolvedValue(response(previewResult())); renderRules(); await loaded();
    await userEvent.click(previewButton()); await screen.findByRole('region', { name: '服务端规则预览结果' });
    change(target === 'configuration' ? await loaded() : screen.getByRole('spinbutton', { name: '当前窗口样本数' }), 1);
    expect(screen.queryByRole('region', { name: '服务端规则预览结果' })).not.toBeInTheDocument();
  });
  it('输入变化取消进行中的 preview，并忽略未尊重取消的迟到响应', async () => {
    mockRead(); let resolve!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    renderRules(); await loaded(); await userEvent.click(previewButton());
    await screen.findByRole('button', { name: '取消预览' });
    const signal = (post.mock.calls[0]?.[1] as unknown as { signal: AbortSignal }).signal;
    change(await loaded(), 0.3); expect(signal.aborted).toBe(true);
    await act(async () => { resolve(response(previewResult())); });
    expect(screen.queryByRole('region', { name: '服务端规则预览结果' })).not.toBeInTheDocument();
    post.mockResolvedValueOnce(response(previewResult({ proposed_revision: 2, changed: true })));
    await userEvent.click(previewButton()); expect(await screen.findByRole('region', { name: '服务端规则预览结果' })).toBeInTheDocument();
  });
  it('取消按钮使 preview 失效，迟到结果不会重新出现', async () => {
    mockRead(); let resolve!: (value: never) => void;
    vi.spyOn(api, 'POST').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    renderRules(); await loaded(); await userEvent.click(previewButton());
    await userEvent.click(await screen.findByRole('button', { name: '取消预览' }));
    await act(async () => { resolve(response(previewResult())); });
    expect(screen.queryByRole('region', { name: '服务端规则预览结果' })).not.toBeInTheDocument();
    expect(previewButton()).toBeEnabled();
  });
  it('preview 版本冲突同样保留草稿并要求显式重读', async () => {
    mockRead(); vi.spyOn(api, 'POST').mockResolvedValue(failure(409)); renderRules(); change(await loaded(), 0.2);
    await userEvent.click(previewButton()); expect(await screen.findByText(/规则版本已变化。本地草稿已保留/)).toBeInTheDocument();
    expect(await loaded()).toHaveValue(0.2); expect(previewButton()).toBeDisabled();
  });
  it.each([['PUT', 503], ['POST', 503]] as const)('%s 失败提供真实请求 ID 并保留输入', async (method, status) => {
    mockRead(); vi.spyOn(api, method).mockResolvedValue(failure(status, 'SERVICE_UNAVAILABLE', '规则服务不可用'));
    renderRules(); change(await loaded(), 0.2);
    await userEvent.click(method === 'PUT' ? screen.getByRole('button', { name: '保存规则' }) : previewButton());
    expect(await screen.findByText('规则服务不可用（请求 ID：geo-rules-request-1）')).toBeInTheDocument();
    expect(await loaded()).toHaveValue(0.2);
  });
  it('GET 失败支持重读，403 保留安全说明且不给无效重试', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValueOnce(failure(503, 'SERVICE_UNAVAILABLE', '读取失败'));
    renderRules(); const retry = await screen.findByRole('button', { name: '重新读取规则' });
    get.mockResolvedValueOnce(failure(403, 'PERMISSION_DENIED', '无权限'));
    await userEvent.click(retry);
    expect(await screen.findByText('当前会话无权读取或操作 GEO 规则，请使用有权限的管理员账号。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新读取规则' })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('主体切换后丢弃旧保存 continuation，不向新主体 cache 写入', async () => {
    mockRead(); let resolve!: (value: never) => void;
    vi.spyOn(api, 'PUT').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { queryClient } = renderRules(); change(await loaded(), 0.2);
    await userEvent.click(screen.getByRole('button', { name: '保存规则' }));
    act(() => { invalidatePrincipalEpoch(queryClient, 'another-principal'); queryClient.removeQueries({ queryKey: geoRulesKey }); });
    await act(async () => { resolve(response(ruleSet({ revision: 9 }))); });
    expect(queryClient.getQueryData(geoRulesKey)).toBeUndefined();
    expect(screen.queryByText('规则已保存（revision 9），仅用于未来评估。')).not.toBeInTheDocument();
  });
  it('token 改变隐藏已有 preview，取消旧请求并保留编辑草稿', async () => {
    mockRead(); let resolve!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(response(previewResult()));
    const { changeToken } = renderTokenRules(); change(await loaded(), 0.3);
    await userEvent.click(previewButton()); await screen.findByRole('region', { name: '服务端规则预览结果' });
    changeToken('renewed-token');
    expect(screen.queryByRole('region', { name: '服务端规则预览结果' })).not.toBeInTheDocument();
    changeToken(auth.csrfToken);
    expect(screen.queryByRole('region', { name: '服务端规则预览结果' })).not.toBeInTheDocument();
    expect(await loaded()).toHaveValue(0.3);
    post.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await userEvent.click(previewButton()); await screen.findByRole('button', { name: '取消预览' });
    changeToken('third-token');
    await act(async () => { resolve(response(previewResult())); });
    expect(screen.queryByRole('region', { name: '服务端规则预览结果' })).not.toBeInTheDocument();
    expect(previewButton()).toBeEnabled();
  });
  it('新 token commit 当下取消旧预览，不留下等待 passive effect 的可写窗口', async () => {
    mockRead(); let resolve!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    let abortedAtCommit: boolean | undefined;
    const { changeToken } = renderTokenRules((token) => {
      if (token !== 'commit-token') return;
      const signal = (post.mock.calls[0]?.[1] as unknown as { signal: AbortSignal }).signal;
      abortedAtCommit = signal.aborted;
      resolve(response(previewResult()));
    });
    await loaded(); await userEvent.click(previewButton());
    await screen.findByRole('button', { name: '取消预览' });
    await act(async () => { changeToken('commit-token'); });
    expect(abortedAtCommit).toBe(true);
    expect(screen.queryByRole('region', { name: '服务端规则预览结果' })).not.toBeInTheDocument();
  });
  it('卸载后忽略旧保存结果，不再更新 cache', async () => {
    mockRead(); let resolve!: (value: never) => void;
    vi.spyOn(api, 'PUT').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { queryClient, view } = renderTokenRules(); change(await loaded(), 0.2);
    await userEvent.click(screen.getByRole('button', { name: '保存规则' })); view.unmount();
    await act(async () => { resolve(response(ruleSet({ revision: 9 }))); });
    expect(queryClient.getQueryData(geoRulesKey)).toMatchObject({ revision: 1 });
  });
  it('token A → B → A 后仍拒绝旧 A 的保存响应', async () => {
    mockRead(); let resolve!: (value: never) => void;
    vi.spyOn(api, 'PUT').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { queryClient, changeToken } = renderTokenRules(); change(await loaded(), 0.2);
    await userEvent.click(screen.getByRole('button', { name: '保存规则' }));
    changeToken('another-token'); changeToken(auth.csrfToken);
    await act(async () => { resolve(response(ruleSet({ revision: 9 }))); });
    expect(queryClient.getQueryData(geoRulesKey)).toMatchObject({ revision: 1 });
    expect(await loaded()).toHaveValue(0.2);
    expect(screen.queryByText('规则已保存（revision 9），仅用于未来评估。')).not.toBeInTheDocument();
  });
  it('保存期间失去权限，保留草稿并冻结旧命令入口', async () => {
    mockRead(); vi.spyOn(api, 'PUT').mockResolvedValue(failure(403, 'PERMISSION_DENIED', '管理员权限已撤销'));
    renderRules(); change(await loaded(), 0.2); await userEvent.click(screen.getByRole('button', { name: '保存规则' }));
    expect(await screen.findByText(/当前会话无权操作 GEO 规则/)).toBeInTheDocument();
    expect(await loaded()).toHaveValue(0.2); expect(await loaded()).toBeDisabled(); expect(previewButton()).toBeDisabled();
    expect(screen.queryByRole('button', { name: '保存规则' })).not.toBeInTheDocument();
  });
});
