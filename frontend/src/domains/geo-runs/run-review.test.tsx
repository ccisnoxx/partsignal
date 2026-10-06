import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import { analyzedDetail, analysisId, factId, failure, renderReview, response, reviewReceipt } from './analysis.test-support';
import { runId } from './runs.test-support';
import { runKeys } from './runs.api';
import type { ReviewRequest } from './review.model';

afterEach(() => vi.restoreAllMocks());
async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}
async function begin(decision = 'CONFIRMED · 确认机器结论') {
  await userEvent.click(await screen.findByRole('button', { name: '开始人工复核' }));
  await choose('复核结论', decision);
}
async function checked() {
  await userEvent.type(screen.getByRole('textbox', { name: '复核说明' }), '已核对严重电压错误');
  await userEvent.click(screen.getByRole('checkbox', { name: '已核对严重声明 1' }));
}
describe('人工复核闭环与命令生命周期', () => {
  it('严重声明未核对或无说明不发送；明确确认携带冻结起点、CSRF、null，双击只发一次', async () => {
    const value = analyzedDetail();
    vi.spyOn(api, 'GET').mockResolvedValue(response(value));
    let release!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    renderReview(value); await begin();
    expect(screen.getByRole('checkbox', { name: '已核对严重声明 1' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '复核说明' })).toHaveAttribute('aria-invalid', 'true');
    await checked();
    await userEvent.dblClick(screen.getByRole('button', { name: '提交人工复核' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/api/v1/geo/observation-runs/{run_id}/review', {
      body: { analysis_revision_id: analysisId, expected_run_revision: 7, decision: 'CONFIRMED', correction_payload: null, comment: '已核对严重电压错误' },
      params: { path: { run_id: runId }, header: { 'X-CSRF-Token': 'csrf' } },
    });
    expect(screen.getByRole('textbox', { name: '复核说明' })).toBeDisabled();
    await act(async () => release(response(reviewReceipt())));
    expect(await screen.findByText('人工复核已追加；正在读取服务端当前有效结果。')).toBeVisible();
    expect(screen.queryByRole('form', { name: '人工复核表单' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始人工复核' })).toHaveFocus();
  });
  it('四栏输入提交真实结构化修正，0提及自动清空、引用对象可为空', async () => {
    const value = analyzedDetail(); vi.spyOn(api, 'GET').mockResolvedValue(response(value));
    const post = vi.spyOn(api, 'POST').mockImplementation(async (_path, options) => response(reviewReceipt((options as { body: ReviewRequest }).body)));
    renderReview(value); await begin('CORRECTED · 提交修正'); await checked();
    await userEvent.click(screen.getByRole('checkbox', { name: '修正提及 1' }));
    const count = screen.getByRole('textbox', { name: '提及 1 次数' }); await userEvent.clear(count); await userEvent.type(count, '0');
    expect(screen.getByRole('textbox', { name: '提及 1 匹配别名' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: '提及 1 首次字符位置' })).toHaveValue('');
    await userEvent.click(screen.getByRole('checkbox', { name: '修正推荐 1' }));
    await choose('推荐 1 类型', 'CONSIDERED');
    await userEvent.click(screen.getByRole('checkbox', { name: '修正声明 1' }));
    const explanation = screen.getByRole('textbox', { name: '声明 1 解释' }); await userEvent.clear(explanation); await userEvent.type(explanation, '人工核对参数差异');
    await userEvent.click(screen.getByRole('checkbox', { name: '修正引用 1' }));
    await choose('引用 1 来源分类', 'INDUSTRY_MEDIA');
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect((post.mock.calls[0]?.[1] as unknown as { body: ReviewRequest }).body).toMatchObject({ correction_payload: { schema_version: 1,
      mentions: [{ mention_count: 0, first_character_offset: null, matched_aliases: [] }],
      recommendations: [{ recommendation: 'CONSIDERED', rank: 1, rationale_excerpt: '推荐使用' }],
      claims: [{ explanation: '人工核对参数差异' }], citations: [{ source_category: 'INDUSTRY_MEDIA', subject_id: null }],
    } });
  });
  it.each(['REVISION_CONFLICT', 'GEO_REVIEW_STALE_ANALYSIS'])('409 %s 保留输入，显式读取后重新核对，不自动重放', async (code) => {
    const fresh = analyzedDetail(); fresh.run.revision = 9;
    vi.spyOn(api, 'GET').mockResolvedValue(response(fresh));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(failure(code));
    renderReview(); await begin(); await checked();
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    const read = await screen.findByRole('button', { name: '读取最新复核上下文并保留输入' });
    expect(screen.getByRole('textbox', { name: '复核说明' })).toHaveValue('已核对严重电压错误');
    expect(screen.getByRole('button', { name: '提交人工复核' })).toBeDisabled();
    await userEvent.click(read);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '已核对严重声明 1' })).not.toBeChecked());
    expect(screen.getByRole('textbox', { name: '复核说明' })).toHaveValue('已核对严重电压错误');
    expect(post).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    expect(post).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('checkbox', { name: '已核对严重声明 1' }));
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect((post.mock.calls[1]?.[1] as unknown as { body: ReviewRequest }).body).toMatchObject({ expected_run_revision: 9 });
  });
  it.each(['network', '5xx'])('%s 未知结果只读取历史，关闭并重开不恢复提交资格', async (kind) => {
    const value = analyzedDetail(); const get = vi.spyOn(api, 'GET').mockResolvedValue(response(value));
    const post = vi.spyOn(api, 'POST');
    if (kind === 'network') post.mockRejectedValue(new TypeError('连接断开')); else post.mockResolvedValue(failure('INTERNAL_ERROR', 503));
    const { client, view } = renderReview(value); await begin(); await checked();
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    await userEvent.click(await screen.findByRole('button', { name: '读取复核历史核对结果' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '提交人工复核' })).toBeDisabled();
    view.unmount(); renderReview(value, client);
    await userEvent.click(await screen.findByRole('button', { name: '查看人工复核提交结果' }));
    expect(screen.getByRole('button', { name: '提交人工复核' })).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each([null, 17])('CORRECTED 畸形回执 %j 保留草稿与未知命令，不关闭或重发', async (correction) => {
    const value = analyzedDetail(); vi.spyOn(api, 'GET').mockResolvedValue(response(value));
    const post = vi.spyOn(api, 'POST').mockImplementation(async (_path, options) => {
      const body = (options as { body: ReviewRequest }).body;
      const receipt = reviewReceipt(body);
      return response({ ...receipt, review: { ...receipt.review, correction_payload: correction } });
    });
    renderReview(value); await begin('CORRECTED · 提交修正'); await checked();
    await userEvent.click(screen.getByRole('checkbox', { name: '修正声明 1' }));
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    expect(await screen.findByRole('button', { name: '读取复核历史核对结果' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '复核说明' })).toHaveValue('已核对严重电压错误');
    expect(screen.getByRole('button', { name: '提交人工复核' })).toBeDisabled();
    expect(screen.queryByText('人工复核已追加；正在读取服务端当前有效结果。')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('后台读取不覆盖草稿；revision变化使旧提交冻结', async () => {
    const { client } = renderReview(); await begin(); await checked();
    const editor = screen.getByRole('form', { name: '人工复核表单' });
    const post = vi.spyOn(api, 'POST');
    const fresh = analyzedDetail(); fresh.run.revision = 8;
    act(() => client.setQueryData(runKeys.detail(runId), fresh));
    expect(within(editor).getByRole('textbox', { name: '复核说明' })).toHaveValue('已核对严重电压错误');
    expect(post).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: '提交人工复核' })).toBeDisabled());
  });
  it('review动作撤回立即禁止提交；同状态不凭status/primary任务补动作', async () => {
    const value = analyzedDetail(); value.analysis.available_actions = [];
    const { client } = renderReview(value);
    await screen.findByRole('region', { name: '当前机器分析' });
    expect(screen.queryByRole('button', { name: '开始人工复核' })).not.toBeInTheDocument();
    act(() => client.setQueryData(runKeys.detail(runId), analyzedDetail()));
    await begin(); await checked();
    const post = vi.spyOn(api, 'POST');
    act(() => client.setQueryData(runKeys.detail(runId), value));
    await waitFor(() => expect(screen.getByRole('button', { name: '提交人工复核' })).toBeDisabled());
    expect(screen.getByRole('textbox', { name: '复核说明' })).toHaveValue('已核对严重电压错误');
    expect(post).not.toHaveBeenCalled();
  });
  it('新的analysis需明确放弃旧目标再重新开始；旧草稿不自动套到新声明', async () => {
    const fresh = analyzedDetail(); fresh.run.revision = 9;
    fresh.analysis.selection.current_analysis_revision_id = factId;
    fresh.analysis.revisions[0]!.analysis.id = factId;
    vi.spyOn(api, 'GET').mockResolvedValue(response(fresh));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(failure('GEO_REVIEW_STALE_ANALYSIS'));
    renderReview(); await begin(); await checked();
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    await userEvent.click(await screen.findByRole('button', { name: '读取最新复核上下文并保留输入' }));
    const restart = await screen.findByRole('button', { name: '以最新分析重新开始复核（替换本地草稿）' });
    expect(screen.getByRole('textbox', { name: '复核说明' })).toHaveValue('已核对严重电压错误');
    expect(screen.getByRole('button', { name: '提交人工复核' })).toBeDisabled();
    await userEvent.click(restart);
    expect(screen.getByRole('textbox', { name: '复核说明' })).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: '已核对严重声明 1' })).not.toBeChecked();
    expect(screen.getByRole('form', { name: '人工复核表单' })).toHaveTextContent(`Analysis ${factId} · Run Revision 9`);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('后台临时读取失败冻结旧资格，显式读取可恢复；403不给无效恢复', async () => {
    const { client } = renderReview(); await begin(); await checked();
    const fresh = analyzedDetail(); const get = vi.spyOn(api, 'GET').mockResolvedValue(failure('INTERNAL_ERROR', 503));
    await act(async () => { await client.refetchQueries({ queryKey: runKeys.detail(runId), exact: true }); });
    const read = await screen.findByRole('button', { name: '读取最新复核上下文并保留输入' });
    expect(read).toBeEnabled(); expect(screen.getByRole('button', { name: '提交人工复核' })).toBeDisabled();
    get.mockResolvedValue(response(fresh)); await userEvent.click(read);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '复核说明' })).toBeEnabled());
    get.mockResolvedValue(failure('PERMISSION_DENIED', 403));
    await act(async () => { await client.refetchQueries({ queryKey: runKeys.detail(runId), exact: true }); });
    expect(await screen.findByRole('button', { name: '读取最新复核上下文并保留输入' })).toBeDisabled();
  });
  it('卸载后迟到网络失败仍保留会话未知命令，重进不会重放', async () => {
    let reject!: (error: unknown) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const { client, view } = renderReview(); await begin(); await checked();
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => reject(new TypeError('断开')));
    renderReview(analyzedDetail(), client);
    await userEvent.click(await screen.findByRole('button', { name: '查看人工复核提交结果' }));
    expect(screen.getByRole('button', { name: '提交人工复核' })).toBeDisabled();
    expect(screen.getByText('原请求说明：已核对严重电压错误')).toBeVisible();
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('dirty阻断站内离开，筛选允许；局部取消也要求明确放弃并返回触发焦点', async () => {
    const { router } = renderReview(); await begin(); await checked();
    await userEvent.click(screen.getByRole('button', { name: '改变筛选' }));
    await waitFor(() => expect(router.state.location.searchStr).toContain('q=changed'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '去计划' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('尚未保存');
    await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('button', { name: '去计划' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: '取消本次复核' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('放弃本次复核');
    await userEvent.click(screen.getByRole('button', { name: '放弃本次复核' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始人工复核' })).toHaveFocus());
  });
  it('账号 epoch变化清除草稿，迟到成功不污染新主体cache或显示成功', async () => {
    let release!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const { client } = renderReview(); await begin(); await checked();
    await userEvent.click(screen.getByRole('button', { name: '提交人工复核' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    act(() => { invalidatePrincipalEpoch(client, 'actor-b'); client.setQueryData(runKeys.detail(runId), analyzedDetail()); });
    expect(await screen.findByText('认证主体已变化，旧复核输入已清除。请重新进入运行详情。')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: '复核说明' })).not.toBeInTheDocument();
    await act(async () => release(response(reviewReceipt())));
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.queryByText('人工复核已追加；正在读取服务端当前有效结果。')).not.toBeInTheDocument();
  });
});
