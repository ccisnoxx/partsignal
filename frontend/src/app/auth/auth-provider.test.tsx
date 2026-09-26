import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import {
  authTransitionStorageKey,
  parseAuthTransitionMessage,
} from './auth-transition-channel';
import type { AuthUser } from './auth-provider';
import { AuthProvider, useAuth, useAuthActions } from './auth-provider';
import { capturePrincipalContinuation } from './principal-epoch';

const admin: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-08T00:00:00Z',
};

const engineer: AuthUser = {
  ...admin,
  id: '00000000-0000-4000-8000-000000000002',
  username: 'engineer',
  display_name: '内容工程师',
  account_type: 'ENGINEER',
};

const adminBinding = 'a'.repeat(64);
const engineerBinding = 'e'.repeat(64);
const remoteOwnerId = '00000000-0000-4000-8000-000000000009';

function authSnapshot(
  user: AuthUser,
  csrfToken: string,
  sessionBinding = user.id === admin.id ? adminBinding : engineerBinding,
) {
  const data = {
    user,
    csrf_token: csrfToken,
    session_binding: sessionBinding,
  };
  return { data, response: Response.json(data) } as never;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function AuthProbe() {
  const auth = useAuth();
  const actions = useAuthActions();
  if (auth.isLoading) return <p>读取中</p>;
  if (auth.error) return <p>读取失败</p>;
  return (
    <div>
      <p>{auth.user ? `${auth.user.display_name}:${auth.isAdmin}:${auth.csrfToken}` : '匿名'}</p>
      {!auth.user && (
        <button onClick={() => void actions.signIn({ username: 'admin', password: 'password-123' })}>
          登录
        </button>
      )}
      {auth.user && (
        <>
          <p>{auth.user.must_change_password ? '必须改密' : '正常会话'}</p>
          <button onClick={() => void actions.changePassword({ old_password: 'password-123', new_password: 'password-456' })}>
            修改密码
          </button>
          <button onClick={() => void auth.signOut()}>退出</button>
        </>
      )}
    </div>
  );
}

function AuthRaceProbe() {
  const auth = useAuth();
  const actions = useAuthActions();
  return (
    <div>
      <p>{auth.user ? `${auth.user.username}:${auth.user.must_change_password}` : '匿名'}</p>
      <button onClick={() => void actions.signIn({ username: 'engineer', password: 'password-123' })}>
        竞态登录
      </button>
      <button onClick={() => void auth.refresh()}>竞态刷新</button>
      {auth.user && (
        <>
          <button onClick={() => void auth.signOut()}>竞态退出</button>
          <button onClick={() => void actions.changePassword({ old_password: 'password-123', new_password: 'password-456' })}>
            竞态改密
          </button>
        </>
      )}
    </div>
  );
}

function AuthActionErrorProbe() {
  const auth = useAuth();
  const actions = useAuthActions();
  const [actionError, setActionError] = useState('');
  if (auth.isLoading) return <p>读取中</p>;
  return (
    <div>
      <p>{auth.user ? auth.user.username : '匿名'}</p>
      <button onClick={() => {
        void actions.signIn({ username: 'admin', password: 'password-123' })
          .catch((error: unknown) => setActionError(error instanceof Error ? error.message : '登录失败'));
      }}>
        捕获登录错误
      </button>
      {actionError && <p>{actionError}</p>}
    </div>
  );
}

function renderAuth() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><AuthProbe /></AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function renderRace(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><AuthRaceProbe /></AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

describe('AuthProvider', () => {
  it.each([
    ['旧协议版本', { version: 1 }],
    ['非法 owner', { ownerId: 'not-an-owner' }],
    ['非法 lease', { leaseExpiresAt: Number.NaN }],
    ['额外字段', { unexpected: 'secret-shaped-data' }],
  ])('拒绝 %s 的认证 transition marker', (_caseName, override) => {
    expect(parseAuthTransitionMessage({
      eventId: '00000000-0000-4000-8000-000000000041',
      leaseExpiresAt: Date.now() + 60_000,
      ownerId: remoteOwnerId,
      phase: 'STARTED',
      transitionId: '00000000-0000-4000-8000-000000000040',
      version: 2,
      ...override,
    })).toBeNull();
  });

  it('把原子 session 204 作为匿名状态', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);

    renderAuth();

    expect(await screen.findByText('匿名')).toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/auth/session', {
      signal: expect.any(AbortSignal),
    });
  });

  it('原子 session 的 CSRF_INVALID 显式失败且不提交混合认证状态', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { code: 'CSRF_INVALID', message: 'CSRF Cookie 无效' } },
      response: Response.json({}, { status: 403 }),
    } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const previous = { user: admin, csrfToken: 'stale-csrf', sessionBinding: adminBinding };
    queryClient.setQueryData(['auth', 'session'], previous);
    queryClient.setQueryData(['users', 'list'], { items: ['上一身份的用户'] });
    queryClient.setQueryData(['audit', 'list'], { items: ['上一身份的审计'] });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><AuthProbe /></AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('读取失败')).toBeInTheDocument();
    expect(queryClient.getQueryData(['users', 'list'])).toEqual({ items: ['上一身份的用户'] });
    expect(queryClient.getQueryData(['audit', 'list'])).toEqual({ items: ['上一身份的审计'] });
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual(previous);
  });

  it.each([
    ['缺少 CSRF', { user: admin, session_binding: adminBinding }],
    ['binding 非法', { user: admin, csrf_token: 'csrf-token', session_binding: 'not-a-binding' }],
    ['缺少权限字段', {
      user: { ...admin, account_type: undefined },
      csrf_token: 'csrf-token',
      session_binding: adminBinding,
    }],
  ])('200 %s 时显式失败且不替换既有 canonical session', async (_caseName, data) => {
    vi.spyOn(api, 'GET').mockResolvedValue({ data, response: Response.json(data) } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const previous = { user: admin, csrfToken: 'previous-csrf', sessionBinding: adminBinding };
    queryClient.setQueryData(['auth', 'session'], previous);
    queryClient.setQueryData(['audit', 'sensitive'], { value: '旧主体审计' });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><AuthProbe /></AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('读取失败')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual(previous);
    expect(queryClient.getQueryData(['audit', 'sensitive'])).toEqual({ value: '旧主体审计' });
  });

  it('malformed 登录 200 显式失败且不得提交部分 session', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    vi.spyOn(api, 'POST').mockResolvedValue({
      data: { user: admin, session_binding: adminBinding },
      response: Response.json({ user: admin, session_binding: adminBinding }),
    } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['products', 'pre-login'], { value: '保留' });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><AuthActionErrorProbe /></AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('匿名')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '捕获登录错误' }));
    expect(await screen.findByText('认证会话响应结构无效')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toBeNull();
    expect(queryClient.getQueryData(['products', 'pre-login'])).toBeUndefined();
  });

  it('把明确 401 作为已失效会话并清除上一身份的业务缓存', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { code: 'AUTH_REQUIRED', message: '登录会话无效或已过期' } },
      response: Response.json({}, { status: 401 }),
    } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['products', 'list'], { items: ['上一身份的数据'] });
    queryClient.setQueryData(['auth', 'session'], {
      user: admin,
      csrfToken: 'stale-csrf',
      sessionBinding: adminBinding,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><AuthProbe /></AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('匿名')).toBeInTheDocument();
    expect(queryClient.getQueryData(['products', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['auth', 'session'])).toBeNull();
  });

  it('使用真实会话身份和 CSRF header 退出', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(authSnapshot(admin, 'csrf-token'));
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);

    renderAuth();
    expect(await screen.findByText('系统管理员:true:csrf-token')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '退出' }));

    expect(await screen.findByText('匿名')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/v1/auth/logout', {
      params: { header: { 'X-CSRF-Token': 'csrf-token' } },
      signal: expect.any(AbortSignal),
    });
  });

  it('登录写入 canonical session 并清除上一身份的业务缓存', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue(
      authSnapshot(admin, 'signed-in-csrf'),
    );
    const { queryClient } = renderAuth();
    queryClient.setQueryData(['products', 'list'], { items: ['上一身份的数据'] });

    await userEvent.click(await screen.findByRole('button', { name: '登录' }));

    expect(await screen.findByText('系统管理员:true:signed-in-csrf')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/v1/auth/login', {
      body: { username: 'admin', password: 'password-123' },
      signal: expect.any(AbortSignal),
    });
    expect(queryClient.getQueryData(['products', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: admin,
      csrfToken: 'signed-in-csrf',
      sessionBinding: adminBinding,
    });
  });

  it('修改密码使用 canonical CSRF 并以服务端刷新结果解除 must-change', async () => {
    const mustChangeAdmin = { ...admin, must_change_password: true, workflow_stage: 'FIRST_PASSWORD_CHANGE' as const };
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(mustChangeAdmin, 'change-csrf'))
      .mockResolvedValueOnce(authSnapshot(admin, 'refreshed-csrf'));
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const { queryClient } = renderAuth();

    expect(await screen.findByText('必须改密')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '修改密码' }));

    expect(await screen.findByText('正常会话')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/v1/auth/change-password', {
      body: { old_password: 'password-123', new_password: 'password-456' },
      params: { header: { 'X-CSRF-Token': 'change-csrf' } },
      signal: expect.any(AbortSignal),
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: admin,
      csrfToken: 'refreshed-csrf',
      sessionBinding: adminBinding,
    });
  });

  it('登录命令胜过迟到的匿名 204，背景读取真实收到 AbortSignal', async () => {
    const lateAnonymous = deferred<never>();
    const get = vi.spyOn(api, 'GET').mockImplementation((_path, options) => {
      const requestOptions = options as unknown as { signal?: AbortSignal } | undefined;
      expect(requestOptions?.signal).toBeInstanceOf(AbortSignal);
      return lateAnonymous.promise;
    });
    vi.spyOn(api, 'POST').mockResolvedValue(authSnapshot(engineer, 'engineer-csrf'));
    const { queryClient } = renderRace();

    await waitFor(() => expect(get).toHaveBeenCalledOnce());
    const backgroundSignal = (
      get.mock.calls[0]?.[1] as unknown as { signal?: AbortSignal } | undefined
    )?.signal;
    await userEvent.click(screen.getByRole('button', { name: '竞态登录' }));
    expect(await screen.findByText('engineer:false')).toBeInTheDocument();
    expect(backgroundSignal?.aborted).toBe(true);

    await act(async () => {
      lateAnonymous.resolve({ response: new Response(null, { status: 204 }) } as never);
      await Promise.resolve();
    });
    expect(screen.getByText('engineer:false')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: engineer,
      csrfToken: 'engineer-csrf',
      sessionBinding: engineerBinding,
    });
  });

  it('退出命令胜过迟到的旧 session snapshot', async () => {
    const lateSnapshot = deferred<never>();
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(admin, 'old-csrf'))
      .mockImplementationOnce(() => lateSnapshot.promise);
    vi.spyOn(api, 'POST').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const { queryClient } = renderRace();

    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: '竞态退出' }));
    expect(await screen.findByText('匿名')).toBeInTheDocument();

    await act(async () => {
      lateSnapshot.resolve(authSnapshot(admin, 'late-old-csrf'));
      await Promise.resolve();
    });
    expect(screen.getByText('匿名')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toBeNull();
  });

  it('改密后的原子 snapshot 胜过改密前迟到响应', async () => {
    const mustChangeAdmin = {
      ...admin,
      must_change_password: true,
      workflow_stage: 'FIRST_PASSWORD_CHANGE' as const,
    };
    const lateOldSnapshot = deferred<never>();
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(mustChangeAdmin, 'old-csrf'))
      .mockImplementationOnce(() => lateOldSnapshot.promise)
      .mockResolvedValueOnce(authSnapshot(admin, 'canonical-csrf', 'c'.repeat(64)));
    vi.spyOn(api, 'POST').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const { queryClient } = renderRace();

    expect(await screen.findByText('admin:true')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: '竞态改密' }));
    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(3);

    await act(async () => {
      lateOldSnapshot.resolve(authSnapshot(mustChangeAdmin, 'late-old-csrf'));
      await Promise.resolve();
    });
    expect(screen.getByText('admin:false')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: admin,
      csrfToken: 'canonical-csrf',
      sessionBinding: 'c'.repeat(64),
    });
  });

  it('登录期间新启动的读取不能在 canonical login 提交后覆盖会话', async () => {
    const loginResult = deferred<never>();
    const lateAnonymous = deferred<never>();
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ response: new Response(null, { status: 204 }) } as never)
      .mockImplementationOnce(() => lateAnonymous.promise);
    const post = vi.spyOn(api, 'POST').mockImplementation(() => loginResult.promise);
    const { queryClient } = renderRace();
    expect(await screen.findByText('匿名')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '竞态登录' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    queryClient.setQueryData(['audit', 'sensitive'], { value: '旧身份审计' });
    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    await act(async () => {
      loginResult.resolve(authSnapshot(engineer, 'canonical-login-csrf'));
    });
    expect(await screen.findByText('engineer:false')).toBeInTheDocument();
    expect(queryClient.getQueryData(['audit', 'sensitive'])).toBeUndefined();

    await act(async () => {
      lateAnonymous.resolve({ response: new Response(null, { status: 204 }) } as never);
      await Promise.resolve();
    });
    expect(screen.getByText('engineer:false')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: engineer,
      csrfToken: 'canonical-login-csrf',
      sessionBinding: engineerBinding,
    });
  });

  it('同一 binding 的普通 refresh 更新 canonical CSRF 并保留业务缓存', async () => {
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(admin, 'initial-csrf'))
      .mockResolvedValueOnce(authSnapshot(
        { ...admin, revision: 2 },
        'refreshed-csrf',
        adminBinding,
      ));
    const { queryClient } = renderRace();
    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    const continuation = capturePrincipalContinuation(queryClient);
    queryClient.setQueryData(['products', 'same-principal'], { value: '保留' });

    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    expect(queryClient.getQueryData(['products', 'same-principal'])).toEqual({ value: '保留' });
    expect(continuation.isCurrent()).toBe(true);
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: { ...admin, revision: 2 },
      csrfToken: 'refreshed-csrf',
      sessionBinding: adminBinding,
    });
  });

  it('同一公开 user 的新 session binding 先失效 continuation 再清理业务 query', async () => {
    const replacementBinding = 'b'.repeat(64);
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(admin, 'initial-csrf', adminBinding))
      .mockResolvedValueOnce(authSnapshot(
        { ...admin, revision: 2 },
        'replacement-csrf',
        replacementBinding,
      ));
    const { queryClient } = renderRace();
    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    const continuation = capturePrincipalContinuation(queryClient);
    queryClient.setQueryData(['products', 'old-session'], { value: '旧 session' });
    const removalChecks: boolean[] = [];
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed' && event.query.queryKey[0] !== 'auth') {
        removalChecks.push(continuation.isCurrent());
      }
    });

    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    unsubscribe();

    expect(continuation.isCurrent()).toBe(false);
    expect(removalChecks.length).toBeGreaterThan(0);
    expect(removalChecks.every((wasCurrent) => !wasCurrent)).toBe(true);
    expect(queryClient.getQueryData(['products', 'old-session'])).toBeUndefined();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: { ...admin, revision: 2 },
      csrfToken: 'replacement-csrf',
      sessionBinding: replacementBinding,
    });
  });

  it('跨标签页 STARTED 立即失效旧主体，SETTLED 只触发一次 canonical session 重读', async () => {
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(admin, 'admin-csrf', adminBinding))
      .mockResolvedValueOnce(authSnapshot(engineer, 'engineer-csrf', engineerBinding));
    const { queryClient } = renderRace();
    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    const continuation = capturePrincipalContinuation(queryClient);
    queryClient.setQueryData(['products', 'cross-tab'], { value: 'A 主体缓存' });
    const transitionId = '00000000-0000-4000-8000-000000000010';
    const started = JSON.stringify({
      eventId: '00000000-0000-4000-8000-000000000011',
      leaseExpiresAt: Date.now() + 60_000,
      ownerId: remoteOwnerId,
      phase: 'STARTED',
      transitionId,
      version: 2,
    });
    const settled = JSON.stringify({
      eventId: '00000000-0000-4000-8000-000000000012',
      leaseExpiresAt: Date.now() + 60_000,
      ownerId: remoteOwnerId,
      phase: 'SETTLED',
      transitionId,
      version: 2,
    });

    act(() => {
      localStorage.setItem(authTransitionStorageKey, started);
      window.dispatchEvent(new StorageEvent('storage', {
        key: authTransitionStorageKey,
        newValue: started,
      }));
    });
    expect(continuation.isCurrent()).toBe(false);
    expect(queryClient.getQueryData(['products', 'cross-tab'])).toBeUndefined();
    expect(queryClient.getQueryData(['auth', 'session'])).toBeNull();
    expect(get).toHaveBeenCalledOnce();

    act(() => {
      localStorage.setItem(authTransitionStorageKey, settled);
      window.dispatchEvent(new StorageEvent('storage', {
        key: authTransitionStorageKey,
        newValue: settled,
      }));
      // BroadcastChannel/storage/focus 重复投递同一 event 不得形成 refetch storm。
      window.dispatchEvent(new StorageEvent('storage', {
        key: authTransitionStorageKey,
        newValue: settled,
      }));
    });

    expect(await screen.findByText('engineer:false')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: engineer,
      csrfToken: 'engineer-csrf',
      sessionBinding: engineerBinding,
    });
  });

  it('孤儿 STARTED 在 owner 消失且 lease 到期后先失效旧主体再 canonical refetch', async () => {
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(admin, 'admin-csrf', adminBinding))
      .mockResolvedValueOnce(authSnapshot(engineer, 'engineer-csrf', engineerBinding));
    const { queryClient } = renderRace();
    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    const continuation = capturePrincipalContinuation(queryClient);
    queryClient.setQueryData(['products', 'orphan-owner'], { value: '旧主体' });
    const started = JSON.stringify({
      eventId: '00000000-0000-4000-8000-000000000021',
      leaseExpiresAt: Date.now() - 1,
      ownerId: remoteOwnerId,
      phase: 'STARTED',
      transitionId: '00000000-0000-4000-8000-000000000020',
      version: 2,
    });

    act(() => {
      localStorage.setItem(authTransitionStorageKey, started);
      window.dispatchEvent(new StorageEvent('storage', {
        key: authTransitionStorageKey,
        newValue: started,
      }));
    });

    expect(await screen.findByText('engineer:false')).toBeInTheDocument();
    expect(continuation.isCurrent()).toBe(false);
    expect(queryClient.getQueryData(['products', 'orphan-owner'])).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(2);
    expect(parseAuthTransitionMessage(localStorage.getItem(authTransitionStorageKey))).toMatchObject({
      ownerId: remoteOwnerId,
      phase: 'SETTLED',
      transitionId: '00000000-0000-4000-8000-000000000020',
      version: 2,
    });
  });

  it('页面重载从持久孤儿 STARTED 恢复且不提交被 barrier 拒绝的旧 snapshot', async () => {
    const started = JSON.stringify({
      eventId: '00000000-0000-4000-8000-000000000031',
      leaseExpiresAt: Date.now() - 1,
      ownerId: remoteOwnerId,
      phase: 'STARTED',
      transitionId: '00000000-0000-4000-8000-000000000030',
      version: 2,
    });
    localStorage.setItem(authTransitionStorageKey, started);
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(engineer, 'canonical-engineer-csrf', engineerBinding));

    const { queryClient } = renderRace();

    expect(await screen.findByText('engineer:false')).toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: engineer,
      csrfToken: 'canonical-engineer-csrf',
      sessionBinding: engineerBinding,
    });
  });

  it('认证 transition marker 只包含版本、owner、lease、事件、阶段和 transition id', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    vi.spyOn(api, 'POST').mockResolvedValue(authSnapshot(admin, 'signed-in-secret'));

    renderAuth();
    await userEvent.click(await screen.findByRole('button', { name: '登录' }));
    expect(await screen.findByText('系统管理员:true:signed-in-secret')).toBeInTheDocument();

    const stored = JSON.parse(localStorage.getItem(authTransitionStorageKey) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual([
      'eventId',
      'leaseExpiresAt',
      'ownerId',
      'phase',
      'transitionId',
      'version',
    ]);
    expect(stored.phase).toBe('SETTLED');
    expect(stored.version).toBe(2);
    expect(stored.ownerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.leaseExpiresAt).toEqual(expect.any(Number));
    expect(JSON.stringify(stored)).not.toContain('signed-in-secret');
    expect(JSON.stringify(stored)).not.toContain('password-123');
    expect(JSON.stringify(stored)).not.toContain(admin.id);
  });

  it('ADMIN 降为同一用户 ENGINEER 时先失效 continuation 再清理业务 query', async () => {
    const downgraded = { ...admin, account_type: 'ENGINEER' as const, revision: 2 };
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(admin, 'admin-csrf'))
      .mockResolvedValueOnce(authSnapshot(downgraded, 'engineer-csrf'));
    const { queryClient } = renderRace();
    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    queryClient.setQueryData(['products', 'principal-order'], { value: '旧主体' });
    queryClient.setQueryData(['audit', 'principal-order'], { value: '旧主体' });
    const continuation = capturePrincipalContinuation(queryClient);
    const removalChecks: boolean[] = [];
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed' && event.query.queryKey[0] !== 'auth') {
        removalChecks.push(continuation.isCurrent());
      }
    });

    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    unsubscribe();

    expect(continuation.isCurrent()).toBe(false);
    expect(removalChecks.length).toBeGreaterThan(0);
    expect(removalChecks.every((wasCurrent) => !wasCurrent)).toBe(true);
    expect(queryClient.getQueryData(['products', 'principal-order'])).toBeUndefined();
    expect(queryClient.getQueryData(['audit', 'principal-order'])).toBeUndefined();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: downgraded,
      csrfToken: 'engineer-csrf',
      sessionBinding: adminBinding,
    });
  });

  it('A→B snapshot 不会产生 user A 与 csrf B 的跨 session 组合', async () => {
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(admin, 'admin-csrf', adminBinding))
      .mockResolvedValueOnce(authSnapshot(engineer, 'engineer-csrf', engineerBinding));
    const { queryClient } = renderRace();
    expect(await screen.findByText('admin:false')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    expect(await screen.findByText('engineer:false')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: engineer,
      csrfToken: 'engineer-csrf',
      sessionBinding: engineerBinding,
    });
  });

  it('A→B→A 中迟到的旧 B response 不能覆盖较新的 A snapshot', async () => {
    const lateB = deferred<never>();
    const latestABinding = 'c'.repeat(64);
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(authSnapshot(admin, 'a-initial', adminBinding))
      .mockImplementationOnce(() => lateB.promise)
      .mockResolvedValueOnce(authSnapshot(admin, 'a-latest', latestABinding));
    const { queryClient } = renderRace();
    expect(await screen.findByText('admin:false')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: admin,
      csrfToken: 'a-latest',
      sessionBinding: latestABinding,
    });

    await act(async () => {
      lateB.resolve(authSnapshot(engineer, 'b-stale', engineerBinding));
      await Promise.resolve();
    });
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: admin,
      csrfToken: 'a-latest',
      sessionBinding: latestABinding,
    });
  });

  it('显式暴露认证错误', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { message: '会话服务不可用' } },
      response: Response.json({}, { status: 503 }),
    } as never);

    renderAuth();

    expect(await screen.findByText('读取失败')).toBeInTheDocument();
  });

  it('网络错误仍保持为可重试的认证服务失败', async () => {
    vi.spyOn(api, 'GET').mockRejectedValue(new TypeError('Failed to fetch'));

    renderAuth();

    expect(await screen.findByText('读取失败')).toBeInTheDocument();
  });
});
