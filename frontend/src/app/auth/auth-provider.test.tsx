import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

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
  it('把 204 会话作为匿名状态且不请求 CSRF', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);

    renderAuth();

    expect(await screen.findByText('匿名')).toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/auth/me', {
      signal: expect.any(AbortSignal),
    });
  });

  it('把 /auth/me 成功后的 CSRF AUTH_REQUIRED 收敛为匿名并清除业务缓存', async () => {
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockResolvedValueOnce({
        error: { error: { code: 'AUTH_REQUIRED', message: '登录会话无效或已过期' } },
        response: Response.json({}, { status: 401 }),
      } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['auth', 'session'], { user: admin, csrfToken: 'stale-csrf' });
    queryClient.setQueryData(['users', 'list'], { items: ['上一身份的用户'] });
    queryClient.setQueryData(['audit', 'list'], { items: ['上一身份的审计'] });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><AuthProbe /></AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('匿名')).toBeInTheDocument();
    expect(screen.queryByText('读取失败')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(['users', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['audit', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['auth', 'session'])).toBeNull();
  });

  it('把明确 401 作为已失效会话并清除上一身份的业务缓存', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { code: 'AUTH_REQUIRED', message: '登录会话无效或已过期' } },
      response: Response.json({}, { status: 401 }),
    } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['products', 'list'], { items: ['上一身份的数据'] });
    queryClient.setQueryData(['auth', 'session'], { user: admin, csrfToken: 'stale-csrf' });

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
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockResolvedValueOnce({
        data: { csrf_token: 'csrf-token' },
        response: Response.json({ csrf_token: 'csrf-token' }),
      } as never);
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
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: { user: admin, csrf_token: 'signed-in-csrf' },
      response: Response.json({ user: admin, csrf_token: 'signed-in-csrf' }),
    } as never);
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
    });
  });

  it('修改密码使用 canonical CSRF 并以服务端刷新结果解除 must-change', async () => {
    const mustChangeAdmin = { ...admin, must_change_password: true, workflow_stage: 'FIRST_PASSWORD_CHANGE' as const };
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: mustChangeAdmin, response: Response.json(mustChangeAdmin) } as never)
      .mockResolvedValueOnce({ data: { csrf_token: 'change-csrf' }, response: Response.json({ csrf_token: 'change-csrf' }) } as never)
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockResolvedValueOnce({ data: { csrf_token: 'refreshed-csrf' }, response: Response.json({ csrf_token: 'refreshed-csrf' }) } as never);
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
    expect(get).toHaveBeenCalledTimes(4);
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: admin,
      csrfToken: 'refreshed-csrf',
    });
  });

  it('登录命令胜过迟到的匿名 204，背景读取真实收到 AbortSignal', async () => {
    const lateAnonymous = deferred<never>();
    const get = vi.spyOn(api, 'GET').mockImplementation((_path, options) => {
      const requestOptions = options as unknown as { signal?: AbortSignal } | undefined;
      expect(requestOptions?.signal).toBeInstanceOf(AbortSignal);
      return lateAnonymous.promise;
    });
    vi.spyOn(api, 'POST').mockResolvedValue({
      data: { user: engineer, csrf_token: 'engineer-csrf' },
      response: Response.json({ user: engineer, csrf_token: 'engineer-csrf' }),
    } as never);
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
    });
  });

  it('登录命令胜过 /auth/me 后迟到的 CSRF 401，不清除新身份', async () => {
    const lateCsrf = deferred<never>();
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockImplementationOnce((_path, options) => {
        const requestOptions = options as unknown as { signal?: AbortSignal } | undefined;
        expect(requestOptions?.signal).toBeInstanceOf(AbortSignal);
        return lateCsrf.promise;
      });
    vi.spyOn(api, 'POST').mockResolvedValue({
      data: { user: engineer, csrf_token: 'engineer-csrf' },
      response: Response.json({ user: engineer, csrf_token: 'engineer-csrf' }),
    } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['auth', 'session'], { user: admin, csrfToken: 'old-csrf' });
    renderRace(queryClient);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: '竞态登录' }));
    expect(await screen.findByText('engineer:false')).toBeInTheDocument();

    await act(async () => {
      lateCsrf.resolve({
        error: { error: { code: 'AUTH_REQUIRED', message: '旧会话已失效' } },
        response: Response.json({}, { status: 401 }),
      } as never);
      await Promise.resolve();
    });
    expect(screen.getByText('engineer:false')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: engineer,
      csrfToken: 'engineer-csrf',
    });
  });

  it('退出命令胜过迟到的旧 session 与 CSRF', async () => {
    const lateCsrf = deferred<never>();
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockImplementationOnce(() => lateCsrf.promise);
    vi.spyOn(api, 'POST').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['auth', 'session'], { user: admin, csrfToken: 'old-csrf' });
    renderRace(queryClient);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: '竞态退出' }));
    expect(await screen.findByText('匿名')).toBeInTheDocument();

    await act(async () => {
      lateCsrf.resolve({
        data: { csrf_token: 'late-old-csrf' },
        response: Response.json({ csrf_token: 'late-old-csrf' }),
      } as never);
      await Promise.resolve();
    });
    expect(screen.getByText('匿名')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toBeNull();
  });

  it('改密命令胜过迟到的 must-change session，并只采用命令后的服务端刷新', async () => {
    const mustChangeAdmin = {
      ...admin,
      must_change_password: true,
      workflow_stage: 'FIRST_PASSWORD_CHANGE' as const,
    };
    const lateOldCsrf = deferred<never>();
    let getCall = 0;
    const get = vi.spyOn(api, 'GET').mockImplementation((path) => {
      getCall += 1;
      if (getCall === 1) return Promise.resolve({
        data: mustChangeAdmin,
        response: Response.json(mustChangeAdmin),
      } as never);
      if (getCall === 2) return lateOldCsrf.promise;
      if (getCall === 3 && path === '/api/v1/auth/me') return Promise.resolve({
        data: admin,
        response: Response.json(admin),
      } as never);
      return Promise.resolve({
        data: { csrf_token: 'canonical-csrf' },
        response: Response.json({ csrf_token: 'canonical-csrf' }),
      } as never);
    });
    vi.spyOn(api, 'POST').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['auth', 'session'], { user: mustChangeAdmin, csrfToken: 'old-csrf' });
    renderRace(queryClient);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: '竞态改密' }));
    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(4);

    await act(async () => {
      lateOldCsrf.resolve({
        data: { csrf_token: 'late-old-csrf' },
        response: Response.json({ csrf_token: 'late-old-csrf' }),
      } as never);
      await Promise.resolve();
    });
    expect(screen.getByText('admin:false')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: admin,
      csrfToken: 'canonical-csrf',
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
      loginResult.resolve({
        data: { user: engineer, csrf_token: 'canonical-login-csrf' },
        response: Response.json({ user: engineer, csrf_token: 'canonical-login-csrf' }),
      } as never);
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
    });
  });

  it('退出期间新启动的旧 session 读取不能在 canonical logout 提交后恢复身份', async () => {
    const logoutResult = deferred<never>();
    const lateOldSession = deferred<never>();
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockResolvedValueOnce({
        data: { csrf_token: 'admin-csrf' },
        response: Response.json({ csrf_token: 'admin-csrf' }),
      } as never)
      .mockImplementationOnce(() => lateOldSession.promise);
    const post = vi.spyOn(api, 'POST').mockImplementation(() => logoutResult.promise);
    const { queryClient } = renderRace();
    expect(await screen.findByText('admin:false')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '竞态退出' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    queryClient.setQueryData(['users', 'sensitive'], { value: '旧身份用户' });
    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));

    await act(async () => {
      logoutResult.resolve({ response: new Response(null, { status: 204 }) } as never);
    });
    expect(await screen.findByText('匿名')).toBeInTheDocument();
    expect(queryClient.getQueryData(['users', 'sensitive'])).toBeUndefined();

    await act(async () => {
      lateOldSession.resolve({ data: admin, response: Response.json(admin) } as never);
      await Promise.resolve();
    });
    expect(screen.getByText('匿名')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toBeNull();
  });

  it('改密期间新启动的 must-change 读取不能在 canonical refresh 提交后回退', async () => {
    const mustChangeAdmin = {
      ...admin,
      must_change_password: true,
      workflow_stage: 'FIRST_PASSWORD_CHANGE' as const,
    };
    const changeResult = deferred<never>();
    const lateMustChange = deferred<never>();
    let getCall = 0;
    const get = vi.spyOn(api, 'GET').mockImplementation((path) => {
      getCall += 1;
      if (getCall === 1) return Promise.resolve({
        data: mustChangeAdmin,
        response: Response.json(mustChangeAdmin),
      } as never);
      if (getCall === 2) return Promise.resolve({
        data: { csrf_token: 'must-change-csrf' },
        response: Response.json({ csrf_token: 'must-change-csrf' }),
      } as never);
      if (getCall === 3) return lateMustChange.promise;
      if (path === '/api/v1/auth/me') return Promise.resolve({
        data: admin,
        response: Response.json(admin),
      } as never);
      return Promise.resolve({
        data: { csrf_token: 'canonical-change-csrf' },
        response: Response.json({ csrf_token: 'canonical-change-csrf' }),
      } as never);
    });
    const post = vi.spyOn(api, 'POST').mockImplementation(() => changeResult.promise);
    const { queryClient } = renderRace();
    expect(await screen.findByText('admin:true')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '竞态改密' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    queryClient.setQueryData(['users', 'sensitive'], { value: '强改密身份数据' });
    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));

    await act(async () => {
      changeResult.resolve({ response: new Response(null, { status: 204 }) } as never);
    });
    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    expect(queryClient.getQueryData(['users', 'sensitive'])).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(5);

    await act(async () => {
      lateMustChange.resolve({
        data: mustChangeAdmin,
        response: Response.json(mustChangeAdmin),
      } as never);
      await Promise.resolve();
    });
    expect(screen.getByText('admin:false')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: admin,
      csrfToken: 'canonical-change-csrf',
    });
  });

  it('普通同身份 refresh 更新 canonical CSRF 但保留业务缓存', async () => {
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockResolvedValueOnce({
        data: { csrf_token: 'initial-csrf' },
        response: Response.json({ csrf_token: 'initial-csrf' }),
      } as never)
      .mockResolvedValueOnce({
        data: { ...admin, revision: 2 },
        response: Response.json({ ...admin, revision: 2 }),
      } as never)
      .mockResolvedValueOnce({
        data: { csrf_token: 'refreshed-csrf' },
        response: Response.json({ csrf_token: 'refreshed-csrf' }),
      } as never);
    const { queryClient } = renderRace();
    expect(await screen.findByText('admin:false')).toBeInTheDocument();
    const continuation = capturePrincipalContinuation(queryClient);
    queryClient.setQueryData(['products', 'same-principal'], { value: '保留' });

    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(4));

    expect(queryClient.getQueryData(['products', 'same-principal'])).toEqual({ value: '保留' });
    expect(continuation.isCurrent()).toBe(true);
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: { ...admin, revision: 2 },
      csrfToken: 'refreshed-csrf',
    });
  });

  it('主体变化先失效 principal continuation，再清理全部业务 query', async () => {
    let currentUser = admin;
    vi.spyOn(api, 'GET').mockImplementation((path) => {
      if (path === '/api/v1/auth/me') {
        return Promise.resolve({
          data: currentUser,
          response: Response.json(currentUser),
        } as never);
      }
      return Promise.resolve({
        data: { csrf_token: `${currentUser.username}-csrf` },
        response: Response.json({ csrf_token: `${currentUser.username}-csrf` }),
      } as never);
    });
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

    currentUser = engineer;
    await userEvent.click(screen.getByRole('button', { name: '竞态刷新' }));
    expect(await screen.findByText('engineer:false')).toBeInTheDocument();
    unsubscribe();

    expect(continuation.isCurrent()).toBe(false);
    expect(removalChecks.length).toBeGreaterThan(0);
    expect(removalChecks.every((wasCurrent) => !wasCurrent)).toBe(true);
    expect(queryClient.getQueryData(['products', 'principal-order'])).toBeUndefined();
    expect(queryClient.getQueryData(['audit', 'principal-order'])).toBeUndefined();
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
