import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializePrincipalEpoch, invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { createAppQueryClient } from '@/app/query-client';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { api } from '@/shared/api/client';
import type { paths } from '@/shared/api/generated/schema';
import { browserSessionKeys, browserSessionQueryOptions, BrowserSessionRequestError, checkBrowserSessionHealth, importBrowserSession, purgeBrowserSessions, revokeBrowserSession, type BrowserSessionContext } from './browser-session.api';
import { BrowserSessionPanel } from './browser-session-panel';
import { surfacesKeys } from './surfaces.api';
import type { Profile } from './surfaces.model';
import { profileFixture, profileId, renderSurfaces, response, surfaceId } from './surfaces.test-support';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/shared/api/client', async () => {
  const { default: createClient } = await import('openapi-fetch');
  return { api: createClient<paths>({ baseUrl: 'http://localhost', credentials: 'include', fetch: fetchMock }) };
});
const reference = 'b0000000-0000-4000-8000-000000000001';
const anotherReference = 'b0000000-0000-4000-8000-000000000002';
const now = '2026-10-05T08:00:00Z';
const canary = 'FICTIONAL-COOKIE-GEO802';
const storageState = JSON.stringify({ cookies: [{ name: 'fixture', value: canary, domain: 'example.test', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] });
function context(overrides: Partial<BrowserSessionContext> = {}): BrowserSessionContext {
  return { profile_id: profileId, profile_revision: 7, session: null, cleanup_pending_count: 0, available_actions: ['IMPORT'], login_probe: 'NOT_IMPLEMENTED', ...overrides };
}
function session(health: NonNullable<BrowserSessionContext['session']>['health'] = 'AVAILABLE') {
  return { session_reference: reference, health, expires_at: '2099-01-01T18:00:00Z', imported_at: now, last_checked_at: now, revoked_at: null, purged_at: null };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function fail(status = 409, code = 'REVISION_CONFLICT') {
  const error = { error: { code, message: canary, details: { input: storageState }, request_id: canary } };
  return { error, response: Response.json(error, { status }) } as never;
}
function browserProfile(): Profile {
  const base = profileFixture();
  return { ...base, summary: { ...base.summary, name: '浏览器配置', collection_mode: 'BROWSER', login_state: 'AUTHENTICATED' }, configuration: { ...base.configuration!, collection_mode: 'BROWSER', adapter_key: 'fixture-browser', login_state: 'AUTHENTICATED', settings: { require_screenshot: true, answer_timeout_seconds: 120 } } } as Profile;
}
function mountPanel(value: BrowserSessionContext | null = context(), unavailable = false) {
  const client = createAppQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  initializePrincipalEpoch(client, 'admin-A');
  if (value) client.setQueryData(browserSessionKeys.context(profileId), value);
  const route = createRootRoute({ component: () => <BrowserSessionPanel profileId={profileId} token="browser-csrf" unavailable={unavailable} /> });
  const router = createRouter({ routeTree: route, history: createMemoryHistory({ initialEntries: ['/'] }) });
  const view = render(<QueryClientProvider client={client}><TooltipProvider><RouterProvider router={router} /></TooltipProvider></QueryClientProvider>);
  return { client, view };
}
async function open(label = '导入浏览器会话') {
  const driver = userEvent.setup();
  await driver.click(await screen.findByRole('button', { name: '更多操作：浏览器会话' }));
  await driver.click(await screen.findByRole('menuitem', { name: label }));
  return { driver, dialog: await screen.findByRole('dialog') };
}
async function fillImport(driver: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  const selected = new File([storageState], 'state.json', { type: 'application/json' });
  const read = vi.fn().mockResolvedValue(storageState);
  Object.defineProperty(selected, 'text', { value: read });
  await driver.upload(within(dialog).getByLabelText('会话 JSON 文件'), selected);
  fireEvent.change(within(dialog).getByLabelText('有效期（本地时间）'), { target: { value: '2099-01-01T10:00' } });
  await driver.click(within(dialog).getByRole('checkbox'));
  return { selected, read };
}
beforeAll(() => Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true, media: '', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })) }));
beforeEach(() => { fetchMock.mockReset().mockRejectedValue(new Error('未声明请求')); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); });

describe('浏览器会话 typed HTTP 边界', () => {
  const importBody = { expected_revision: 7, storage_state: storageState, expires_at: '2099-01-01T18:00:00Z', approved_account: true as const };
  const commandBody = { expected_revision: 7, session_reference: reference };
  it.each([
    { path: 'import', body: importBody, execute: (token: string | null) => importBrowserSession(profileId.toUpperCase(), importBody, token) },
    { path: 'health', body: commandBody, execute: (token: string | null) => checkBrowserSessionHealth(profileId, commandBody, token) },
    { path: 'revoke', body: commandBody, execute: (token: string | null) => revokeBrowserSession(profileId, commandBody, token) },
    { path: 'purge', body: { expected_revision: 7 }, execute: (token: string | null) => purgeBrowserSessions(profileId, 7, token) },
  ])('$path 使用准确 JSON/CSRF/CAS，不自动重放，缺 CSRF 零请求', async ({ path, body, execute }) => {
    fetchMock.mockResolvedValueOnce(Response.json(context()));
    await expect(execute('browser-csrf')).resolves.toEqual(context());
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.url).toBe(`http://localhost/api/v1/geo/collection-profiles/${profileId}/browser-session/${path}`);
    expect(request.method).toBe('POST');
    expect(request.headers.get('X-CSRF-Token')).toBe('browser-csrf');
    expect(await request.json()).toEqual(body);
    await expect(execute(null)).rejects.toBeInstanceOf(BrowserSessionRequestError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('错误信封、异常及多余成功字段的敏感内容不进入 Error 或 query cache', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'GEO_BROWSER_SESSION_INVALID', message: canary, details: { input: storageState }, request_id: canary } }, { status: 422 }));
    await expect(importBrowserSession(profileId, importBody, 'browser-csrf')).rejects.toMatchObject({ status: 422, message: '会话文件或有效期不符合要求，请检查后重新选择。' });
    fetchMock.mockRejectedValueOnce(new Error(canary));
    await expect(importBrowserSession(profileId, importBody, 'browser-csrf')).rejects.toMatchObject({ message: '浏览器会话请求未完成，请重新读取以核实结果。' });
    const client = createAppQueryClient();
    fetchMock.mockResolvedValueOnce(Response.json({ ...context(), storage_state: storageState }));
    await expect(client.fetchQuery(browserSessionQueryOptions(profileId))).rejects.toMatchObject({ message: '浏览器会话响应结构无效，请重新读取。' });
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.state))).not.toContain(canary);
    expect(client.getQueryData(browserSessionKeys.context(profileId))).toBeUndefined();
  });
});

describe('管理员 Browser 会话闭环', () => {
  it('只在管理员 Browser 配置挂载；ENGINEER configuration=null 不读 metadata', async () => {
    const browser = browserProfile();
    let readonly = false;
    const read = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      const profile = readonly ? { ...browser, configuration: null, available_actions: [], activation_blockers: null, test_blockers: null, test_error: null, deletion: null } : browser;
      if (path === '/api/v1/geo/collection-profiles') return response({ items: [profile], page: 1, page_size: 20, total: 1 });
      if (path === '/api/v1/geo/collection-profiles/{profile_id}') return response(profile);
      if (path === '/api/v1/geo/collection-profiles/{profile_id}/browser-session') return response(context());
      throw new Error('未声明请求');
    });
    const admin = renderSurfaces(`/configuration/geo-surfaces?tab=profiles&profile_id=${profileId}`);
    await screen.findByText('尚未导入浏览器会话。使用已获批准的专用账号人工登录后导出的 Playwright storage state。');
    expect(read.mock.calls.filter((call) => String(call[0]).endsWith('/browser-session'))).toHaveLength(1);
    admin.view.unmount(); readonly = true; read.mockClear();
    renderSurfaces(`/configuration/geo-surfaces?tab=profiles&profile_id=${profileId}`, true);
    await screen.findByRole('region', { name: '采集配置详情' });
    expect(screen.queryByRole('region', { name: '浏览器会话' })).not.toBeInTheDocument();
    expect(read.mock.calls.filter((call) => String(call[0]).endsWith('/browser-session'))).toHaveLength(0);
  });
  it('健康文字不提供动作资格；服务端 EXPIRED 仍可提供检查动作', async () => {
    const { client } = mountPanel(context({ session: session(), available_actions: ['IMPORT'] }));
    const { driver } = await open();
    expect(screen.queryByRole('menuitem', { name: '检查存储健康' })).not.toBeInTheDocument();
    await driver.keyboard('{Escape}');
    await act(async () => client.setQueryData(browserSessionKeys.context(profileId), context({ session: session('EXPIRED'), available_actions: ['CHECK_HEALTH'] })));
    const next = await open('检查存储健康');
    expect(within(next.dialog).getByRole('button', { name: '确认操作' })).toBeEnabled();
    expect(screen.getByText(/在线登录探测尚未实现/)).toHaveTextContent('NOT_IMPLEMENTED');
  });
  it('直接 awaited 导入在 pending/success 不泄露 cache/storage，重复提交一次，精准刷新 profile/list', async () => {
    const pending = deferred<never>();
    const write = vi.spyOn(api, 'POST').mockImplementation(() => pending.promise);
    const read = vi.spyOn(api, 'GET');
    const { client } = mountPanel();
    client.setQueryData(surfacesKeys.profile(profileId), profileFixture());
    const ownLists = surfacesKeys.profiles({ sort: 'NAME_ASC', page: 1, page_size: 20 });
    const surfaceList = surfacesKeys.surfaces({ sort: 'NAME_ASC', page: 1, page_size: 20 });
    client.setQueryData(ownLists, { items: [], total: 0 });
    client.setQueryData(surfaceList, { items: [], total: 0 });
    client.setQueryData(surfacesKeys.surface(surfaceId), {});
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const { driver, dialog } = await open();
    await fillImport(driver, dialog);
    fireEvent.submit(dialog.querySelector('form')!); fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(write.mock.calls[0]).toEqual(['/api/v1/geo/collection-profiles/{profile_id}/browser-session/import', expect.objectContaining({ body: { expected_revision: 7, storage_state: storageState, expires_at: new Date('2099-01-01T10:00').toISOString(), approved_account: true }, params: { path: { profile_id: profileId }, header: { 'X-CSRF-Token': 'browser-csrf' } } })]);
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => [query.queryKey, query.state]))).not.toContain(canary);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    expect(document.body.textContent).not.toContain(canary);
    expect(storage).not.toHaveBeenCalled();
    const canonical = context({ profile_revision: 8, session: session(), available_actions: ['IMPORT', 'CHECK_HEALTH', 'REVOKE'] });
    await act(async () => pending.resolve(response(canonical)));
    await screen.findByText('导入浏览器会话已完成。');
    await waitFor(() => expect(client.getQueryState(ownLists)?.isInvalidated).toBe(true));
    expect(client.getQueryData(browserSessionKeys.context(profileId))).toEqual(canonical);
    expect(client.getQueryState(surfacesKeys.profile(profileId))?.isInvalidated).toBe(true);
    expect(client.getQueryState(surfaceList)?.isInvalidated).toBe(false);
    expect(client.getQueryState(surfacesKeys.surface(surfaceId))?.isInvalidated).toBe(false);
    expect(read).not.toHaveBeenCalled();
    const reopened = await open();
    expect((within(reopened.dialog).getByLabelText('会话 JSON 文件') as HTMLInputElement).files).toHaveLength(0);
    expect(within(reopened.dialog).getByLabelText('有效期（本地时间）')).toHaveValue('');
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
  it('409 保留 File 与有效期，不重放；显式 reload 清除账号确认，用新 revision 再确认', async () => {
    const write = vi.spyOn(api, 'POST').mockResolvedValueOnce(fail()).mockResolvedValueOnce(response(context({ profile_revision: 10, session: session() })));
    const read = vi.spyOn(api, 'GET').mockResolvedValue(response(context({ profile_revision: 9 })));
    const { client } = mountPanel();
    const { driver, dialog } = await open();
    const { selected, read: fileRead } = await fillImport(driver, dialog);
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await screen.findByText('配置已经变化，请重新读取并重新确认。');
    expect(write).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: '确认操作' })).toBeDisabled();
    expect((within(dialog).getByLabelText('会话 JSON 文件') as HTMLInputElement).files?.[0]).toBe(selected);
    expect(within(dialog).getByLabelText('有效期（本地时间）')).toHaveValue('2099-01-01T10:00');
    expect(document.body.textContent).not.toContain(canary);
    await driver.click(within(dialog).getByRole('button', { name: '重新读取并重新确认' }));
    await waitFor(() => expect(within(dialog).getByRole('checkbox')).not.toBeChecked());
    expect(write).toHaveBeenCalledOnce();
    await driver.click(within(dialog).getByRole('checkbox'));
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await screen.findByText('导入浏览器会话已完成。');
    expect(write).toHaveBeenCalledTimes(2); expect(fileRead).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![1]).toMatchObject({ body: { expected_revision: 9, storage_state: storageState } });
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
  it.each(['CHECK_HEALTH', 'REVOKE', 'PURGE'] as const)('%s 使用当前 context revision/reference，并展示撤销或待清理事实', async (action) => {
    const labels = { CHECK_HEALTH: '检查存储健康', REVOKE: '撤销浏览器会话', PURGE: '清理已撤销会话' };
    const paths = { CHECK_HEALTH: 'health', REVOKE: 'revoke', PURGE: 'purge' };
    const original = context({ session: session('UNREADABLE'), cleanup_pending_count: 1, available_actions: [action] });
    const canonical = context({ profile_revision: 8, session: { ...session('REVOKED'), revoked_at: now }, cleanup_pending_count: 1, available_actions: ['IMPORT', 'PURGE'] });
    const write = vi.spyOn(api, 'POST').mockResolvedValue(response(canonical));
    mountPanel(original);
    const { driver, dialog } = await open(labels[action]);
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await screen.findByText(/旧引用无法恢复/);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]).toEqual([`/api/v1/geo/collection-profiles/{profile_id}/browser-session/${paths[action]}`, expect.objectContaining({ body: action === 'PURGE' ? { expected_revision: 7 } : { expected_revision: 7, session_reference: reference } })]);
    expect(screen.getByText(/仍有 1 份已撤销材料待清理/)).toBeInTheDocument();
  });
  it('后台 revision 变化使旧确认失效，读取失败保留 metadata 且暂停动作', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(fail(503, 'DEPENDENCY_UNAVAILABLE'));
    const write = vi.spyOn(api, 'POST');
    const { client } = mountPanel(context({ session: session(), available_actions: ['CHECK_HEALTH'] }));
    const { dialog } = await open('检查存储健康');
    await act(async () => client.setQueryData(browserSessionKeys.context(profileId), context({ profile_revision: 8, session: { ...session(), session_reference: anotherReference }, available_actions: ['CHECK_HEALTH'] })));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '确认操作' })).toBeDisabled());
    await act(async () => { await client.refetchQueries({ queryKey: browserSessionKeys.context(profileId) }); });
    expect(await screen.findByText('上次会话信息仍显示，当前操作已暂停。')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '确认操作' })).toBeDisabled();
    expect(write).not.toHaveBeenCalled();
  });
  it('关闭与 Escape 释放 File 并恢复触发器焦点', async () => {
    mountPanel();
    const { driver, dialog } = await open();
    await fillImport(driver, dialog);
    await driver.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: '更多操作：浏览器会话' })).toHaveFocus());
    const reopened = await open();
    expect((within(reopened.dialog).getByLabelText('会话 JSON 文件') as HTMLInputElement).files).toHaveLength(0);
  });
  it.each(['principal', 'unmount'] as const)('%s 在 File 等待期间取消旧导入，不发 POST、不回写旧状态', async (event) => {
    const fileText = deferred<string>();
    const write = vi.spyOn(api, 'POST');
    const { client, view } = mountPanel();
    const { driver, dialog } = await open();
    const { read } = await fillImport(driver, dialog);
    read.mockReturnValueOnce(fileText.promise);
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    if (event === 'principal') await act(async () => { invalidatePrincipalEpoch(client, 'admin-B'); client.removeQueries(); });
    else view.unmount();
    await act(async () => fileText.resolve(storageState));
    expect(write).not.toHaveBeenCalled();
    if (event === 'principal') expect(client.getQueryData(browserSessionKeys.context(profileId))).toBeUndefined();
    else expect(client.getQueryData(browserSessionKeys.context(profileId))).toEqual(context());
  });
  it('初始 loading 后 403 明确退出，无无效重试或动作入口', async () => {
    const pending = deferred<never>();
    const read = vi.spyOn(api, 'GET').mockImplementation(() => pending.promise);
    mountPanel(null);
    await screen.findByText('正在读取浏览器会话…');
    await act(async () => pending.resolve(fail(403, 'PERMISSION_DENIED')));
    await screen.findByText('当前账号无权管理浏览器会话。');
    expect(screen.queryByRole('button', { name: '重新读取会话' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更多操作：浏览器会话' })).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledOnce();
  });
  it('身份切换中已发送的导入被取消，迟到 canonical 不恢复旧主体 cache/成功提示', async () => {
    const pending = deferred<never>();
    let signal: AbortSignal | undefined;
    vi.spyOn(api, 'POST').mockImplementation((_path, options) => { signal = (options as { signal?: AbortSignal }).signal; return pending.promise; });
    const { client } = mountPanel();
    const { driver, dialog } = await open();
    await fillImport(driver, dialog);
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(signal).toBeDefined());
    await act(async () => { invalidatePrincipalEpoch(client, 'admin-B'); client.removeQueries(); });
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(response(context({ session: session(), profile_revision: 8 }))));
    expect(client.getQueryData(browserSessionKeys.context(profileId))).toBeUndefined();
    expect(screen.queryByText('导入浏览器会话已完成。')).not.toBeInTheDocument();
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
  it('网络结果未知时释放 File 并冻结旧确认；关闭重开也不能重发，须显式读取', async () => {
    const write = vi.spyOn(api, 'POST').mockRejectedValue(new Error(canary));
    const read = vi.spyOn(api, 'GET').mockResolvedValue(response(context({ profile_revision: 8, session: session() })));
    mountPanel();
    const { driver, dialog } = await open();
    await fillImport(driver, dialog);
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await screen.findByText('浏览器会话请求未完成，请重新读取以核实结果。');
    expect((within(dialog).getByLabelText('会话 JSON 文件') as HTMLInputElement).files).toHaveLength(0);
    await driver.click(within(dialog).getByRole('button', { name: '取消' }));
    const reopened = await open();
    await fillImport(reopened.driver, reopened.dialog);
    expect(within(reopened.dialog).getByRole('button', { name: '确认操作' })).toBeDisabled();
    expect(read).not.toHaveBeenCalled(); expect(write).toHaveBeenCalledOnce();
    await reopened.driver.click(within(reopened.dialog).getByRole('button', { name: '重新读取并重新确认' }));
    await waitFor(() => expect(within(reopened.dialog).getByRole('checkbox')).not.toBeChecked());
    expect(write).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain(canary);
  });
});
