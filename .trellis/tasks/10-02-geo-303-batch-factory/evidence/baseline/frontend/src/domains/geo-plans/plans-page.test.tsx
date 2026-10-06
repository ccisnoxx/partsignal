import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import { planKeys } from './plans.api';
import { failure, mockReads, plan, planId, renderPlans, response } from './plans.test-support';

afterEach(() => vi.restoreAllMocks());
async function action(label: string) {
  const driver = userEvent.setup();
  await driver.click(await screen.findByRole('button', { name: '更多操作：当前计划' }));
  await driver.click(await screen.findByRole('menuitem', { name: label }));
  return driver;
}
describe('计划真实路由与状态工作区', () => {
  it('URL 恢复筛选和详情，直接显示服务端矩阵值', async () => {
    const get = mockReads(() => plan({ preview: { ...plan().preview, run_count: 97 } }));
    const { router } = renderPlans(`/geo/plans?selected=${planId}&q=原始&status=DISABLED&schedule_kind=MANUAL_ONLY&page=2&page_size=10&sort=NAME_ASC`);
    const workspace = await screen.findByRole('region', { name: '监测计划详情' });
    expect(within(workspace).getByText(/NOT_IMPLEMENTED/)).toBeVisible();
    expect(within(workspace).getByText('97')).toBeVisible();
    expect(get).toHaveBeenCalledWith('/api/v1/geo/monitoring-plans', expect.objectContaining({ params: { query: { q: '原始', status: 'DISABLED', schedule_kind: 'MANUAL_ONLY', page: 2, page_size: 10, sort: 'NAME_ASC' } } }));
    await userEvent.setup().click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(router.state.location.search.selected).toBeUndefined());
    expect(router.state.location.search).toMatchObject({ q: '原始', page: 2 });
  });
  it('状态 409 必须显式读取和重新确认，不自动重放；发送服务端 revision', async () => {
    let current = plan(); mockReads(() => current);
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(failure()).mockImplementationOnce(async () => { current = plan({ status: 'ACTIVE', workflow_stage: 'ACTIVE', primary_task: 'VIEW_RUNTIME', revision: 9, available_actions: ['CREATE_REVISION', 'PREVIEW', 'PAUSE', 'ARCHIVE', 'COPY'] }); return response(current); });
    const driver = userEvent.setup(); renderPlans();
    await driver.click(await screen.findByRole('region', { name: '监测计划详情' }).then((region) => within(region).getByRole('button', { name: '启用计划' })));
    const dialog = await screen.findByRole('dialog', { name: '确认启用计划' });
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await within(dialog).findByText(/plan-test-request/);
    expect(post).toHaveBeenCalledOnce(); expect(within(dialog).getByRole('button', { name: '确认操作' })).toBeDisabled();
    current = plan({ revision: 8 });
    await driver.click(within(dialog).getByRole('button', { name: '重新读取并重新确认' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '确认操作' })).toBeEnabled());
    expect(post).toHaveBeenCalledOnce();
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await screen.findByText('启用计划已完成。');
    expect(post.mock.calls[1]).toEqual(['/api/v1/geo/monitoring-plans/{plan_id}/activate', { body: { expected_revision: 8 }, params: { path: { plan_id: planId }, header: { 'X-CSRF-Token': 'plans-csrf' } } }]);
  });
  it('复制 409、后台更新与显式重新读取都保留名称输入', async () => {
    let current = plan(); mockReads(() => current); const post = vi.spyOn(api, 'POST').mockResolvedValue(failure('GEO_PLAN_REFERENCE_CONFLICT'));
    const { client } = renderPlans(); const driver = await action('复制为新计划');
    const field = screen.getByRole('textbox', { name: '新计划名称' }); await driver.clear(field); await driver.type(field, '用户自己的复制名称');
    await driver.click(screen.getByRole('button', { name: '确认操作' })); await screen.findByText(/plan-test-request/);
    current = plan({ revision: 8, name: '远端名称' });
    await act(async () => { await client.invalidateQueries({ queryKey: planKeys.detail(planId) }); });
    expect(field).toHaveValue('用户自己的复制名称');
    await driver.click(screen.getByRole('button', { name: '重新读取并重新确认' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认操作' })).toBeEnabled());
    expect(field).toHaveValue('用户自己的复制名称'); expect(post).toHaveBeenCalledOnce();
  });
  it('409后关闭重开确认且后台版本已刷新，仍须显式读取，保留复制输入', async () => {
    let current = plan(); mockReads(() => current); const post = vi.spyOn(api, 'POST').mockResolvedValue(failure());
    const { client } = renderPlans(); const driver = await action('复制为新计划');
    await driver.clear(screen.getByRole('textbox', { name: '新计划名称' }));
    await driver.type(screen.getByRole('textbox', { name: '新计划名称' }), '保留复制名');
    await driver.click(screen.getByRole('button', { name: '确认操作' })); await screen.findByText(/plan-test-request/);
    await driver.click(screen.getByRole('button', { name: '取消' }));
    current = plan({ revision: 8 });
    await act(async () => { await client.invalidateQueries({ queryKey: planKeys.detail(planId) }); });
    await action('复制为新计划');
    expect(screen.getByRole('textbox', { name: '新计划名称' })).toHaveValue('保留复制名');
    expect(screen.getByRole('button', { name: '确认操作' })).toBeDisabled();
    expect(post).toHaveBeenCalledOnce();
    await driver.click(screen.getByRole('button', { name: '重新读取并重新确认' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认操作' })).toBeEnabled());
    expect(post).toHaveBeenCalledOnce();
  });
  it('删除204清理URL与列表，不再次GET已删除详情', async () => {
    let removed = false; const get = mockReads(plan, () => removed ? [] : [plan()]);
    const remove = vi.spyOn(api, 'DELETE').mockImplementation(async () => { removed = true; return { response: new Response(null, { status: 204 }) } as never; });
    const { router } = renderPlans(); const driver = await action('删除计划');
    await driver.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(router.state.location.search.selected).toBeUndefined());
    await screen.findByText('暂无监测计划');
    expect(get.paths.filter((path) => path.endsWith('/{plan_id}'))).toHaveLength(1);
    expect(remove).toHaveBeenCalledWith('/api/v1/geo/monitoring-plans/{plan_id}', { params: { path: { plan_id: planId }, query: { expected_revision: 7 }, header: { 'X-CSRF-Token': 'plans-csrf' } } });
  });
  it.each(['主体变化', '卸载'])('%s后迟到状态响应不回写缓存', async (boundary) => {
    mockReads(); let resolve!: (value: ReturnType<typeof response>) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { client, view, router } = renderPlans(); const driver = await action('归档计划');
    await driver.click(screen.getByRole('button', { name: '确认操作' })); await waitFor(() => expect(post).toHaveBeenCalledOnce());
    if (boundary === '主体变化') invalidatePrincipalEpoch(client); else view.unmount();
    await act(async () => resolve(response(plan({ revision: 8, status: 'ARCHIVED' }))));
    expect(client.getQueryData(planKeys.detail(planId))).toMatchObject({ revision: 7 }); expect(router.state.location.search.selected).toBe(planId);
  });
  it('取消旧查询期间工作区卸载，状态命令不再发送', async () => {
    mockReads(); const post = vi.spyOn(api, 'POST');
    const { client, view } = renderPlans(); const driver = await action('归档计划');
    let release!: () => void;
    const cancellation = new Promise<void>((resolve) => { release = resolve; });
    const cancel = vi.spyOn(client, 'cancelQueries').mockImplementation(() => cancellation);
    await driver.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(cancel).toHaveBeenCalled());
    view.unmount(); await act(async () => release());
    expect(post).not.toHaveBeenCalled();
  });
  it('直接访问404可安全关闭，没有猜测详情或无效重试', async () => {
    const get = mockReads(plan, () => [], () => failure('NOT_FOUND', 404)); const { router } = renderPlans();
    const workspace = await screen.findByRole('dialog', { name: '监测计划工作区' });
    await within(workspace).findByText(/plan-test-request/);
    expect(within(workspace).queryByRole('button', { name: '重试详情读取' })).not.toBeInTheDocument();
    await userEvent.setup().click(within(workspace).getByRole('button', { name: '关闭工作区' }));
    await waitFor(() => expect(router.state.location.search.selected).toBeUndefined());
    expect(get.paths.filter((path) => path.endsWith('/{plan_id}'))).toHaveLength(1);
  });
});
