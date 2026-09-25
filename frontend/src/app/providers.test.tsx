import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';
import { queryClient } from './query-client';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { authSessionQueryKey } from './auth/auth-provider';

type AuthUser = components['schemas']['User'];
type WorkbenchAggregate = components['schemas']['WorkbenchAggregate'];

const admin: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: ['UPDATE', 'RESET_PASSWORD', 'DISABLE'],
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

const emptyWorkbenchAggregate = {
  generated_at: '2026-08-23T08:00:00Z',
  actionable_counts: {
    fact_reviews: { value: 0, href: '/products?workbench=fact-review' },
    content_reviews: { value: 0, href: '/content/tasks?workbench=content-review' },
    publication_verifications: { value: 0, href: '/publishing/work?workbench=verification' },
    publication_actions: { value: 0, links: [{ label: '处理待开始发布', href: '/publishing/work?workbench=ready' }] },
    content_issues: { value: 0, href: '/publishing/issues?workbench=open' },
    geo_accuracy_issues: { value: 0, links: [{ label: '检查准确性异常', href: '/geo/observations?workbench=accuracy' }] },
  },
  workflow_health: {
    product_facts: { status: 'CLEAR', summary: '产品事实流程正常' },
    content: { status: 'CLEAR', summary: '内容流程正常' },
    publication: { status: 'CLEAR', summary: '发布流程正常' },
    geo: { status: 'CLEAR', summary: 'GEO 流程正常' },
  },
  geo_summary: {
    window: { date_from: '2026-07-25', date_to: '2026-08-23' },
    discovery_rate: { numerator: 0, denominator: 0, value: null },
    mention_rate: { numerator: 0, denominator: 0, value: null },
    accuracy_rate: { numerator: 0, denominator: 0, value: null },
  },
  recent_attention_items: [],
} satisfies WorkbenchAggregate;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('AppProviders', () => {
  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('匿名根路由进入登录页且不渲染 App Shell', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '工作台' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(queryClient.getQueryCache()).toBeDefined();
  });

  it('有效会话才渲染根业务页面', async () => {
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockResolvedValueOnce({ data: { csrf_token: 'admin-csrf' }, response: Response.json({ csrf_token: 'admin-csrf' }) } as never);
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    await waitFor(() => expect(screen.queryByLabelText('正在读取账户信息')).not.toBeInTheDocument());
  });

  it('must-change 会话进入独立安全页且不渲染 App Shell', async () => {
    const mustChangeAdmin = { ...admin, must_change_password: true, workflow_stage: 'FIRST_PASSWORD_CHANGE' as const };
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: mustChangeAdmin, response: Response.json(mustChangeAdmin) } as never)
      .mockResolvedValueOnce({ data: { csrf_token: 'admin-csrf' }, response: Response.json({ csrf_token: 'admin-csrf' }) } as never);
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(await screen.findByRole('heading', { name: '修改密码' })).toBeInTheDocument();
    expect(screen.getByText('首次登录必须修改临时密码，完成前不能进入业务页面。')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/account/security');
  });

  it('认证查询失败后重新计算路由上下文并显式显示错误', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { message: '会话服务不可用' } },
      response: Response.json({}, { status: 503 }),
    } as never);
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(await screen.findByRole('alert')).toHaveTextContent('当前无法确认账户状态');
    expect(screen.queryByRole('heading', { name: '工作台' })).not.toBeInTheDocument();
  });

  it('旧会话返回 401 后清理业务缓存并回到可操作登录页', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { code: 'AUTH_REQUIRED', message: '登录会话无效或已过期' } },
      response: Response.json({}, { status: 401 }),
    } as never);
    queryClient.setQueryData(['auth', 'session'], { user: admin, csrfToken: 'stale-csrf' });
    queryClient.setQueryData(['products', 'list'], { items: ['旧身份数据'] });
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(queryClient.getQueryData(['products', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['auth', 'session'])).toBeNull();
  });

  it('ADMIN 变为 ENGINEER 时清除 Users/Audit 缓存并重新裁决当前 System 路由', async () => {
    let currentUser = admin;
    vi.spyOn(api, 'GET').mockImplementation((path) => {
      if (path === '/api/v1/auth/me') {
        return Promise.resolve({
          data: currentUser,
          response: Response.json(currentUser),
        } as never);
      }
      if (path === '/api/v1/auth/csrf') {
        return Promise.resolve({
          data: { csrf_token: `${currentUser.username}-csrf` },
          response: Response.json({ csrf_token: `${currentUser.username}-csrf` }),
        } as never);
      }
      if (path === '/api/v1/users') {
        return Promise.resolve({
          data: {
            items: [admin],
            page: 1,
            page_size: 20,
            total: 1,
            summary: {
              user_total: 1,
              enabled_total: 1,
              disabled_total: 0,
              must_change_password_total: 0,
              admin_total: 1,
            },
          },
          response: Response.json({}),
        } as never);
      }
      throw new Error(`测试收到未声明的 GET：${path}`);
    });
    window.history.replaceState(null, '', '/system/users?status=ENABLED&page=1&pageSize=20');

    render(<AppProviders />);
    expect(await screen.findByRole('heading', { name: '用户管理' })).toBeInTheDocument();

    const usersSensitiveKey = ['identity', 'users', 'sensitive'];
    const auditSensitiveKey = ['audit', 'detail', 'sensitive'];
    queryClient.setQueryData(usersSensitiveKey, { secret: 'ADMIN Users cache' });
    queryClient.setQueryData(auditSensitiveKey, { secret: 'ADMIN Audit cache' });
    currentUser = engineer;
    await queryClient.refetchQueries({ queryKey: authSessionQueryKey, exact: true });

    expect(await screen.findByRole('heading', { name: '无权访问系统管理' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/system/users');
    expect(queryClient.getQueryData(usersSensitiveKey)).toBeUndefined();
    expect(queryClient.getQueryData(auditSensitiveKey)).toBeUndefined();
    expect(queryClient.getQueryData(authSessionQueryKey)).toEqual({
      user: engineer,
      csrfToken: 'engineer-csrf',
    });
  });

  it('登录期间启动的旧读取迟到后仍保留 canonical 身份、缓存清理和路由', async () => {
    const loginResult = deferred<never>();
    const lateAnonymous = deferred<never>();
    let authMeCalls = 0;
    vi.spyOn(api, 'GET').mockImplementation((path) => {
      if (path === '/api/v1/workbench') return Promise.resolve({
        data: emptyWorkbenchAggregate,
        response: Response.json(emptyWorkbenchAggregate),
      } as never);
      if (path === '/api/v1/auth/me') {
        authMeCalls += 1;
        if (authMeCalls === 1) return Promise.resolve({
          response: new Response(null, { status: 204 }),
        } as never);
        return lateAnonymous.promise;
      }
      throw new Error(`测试收到未声明的 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST').mockImplementation(() => loginResult.promise);
    window.history.replaceState(null, '', '/login');
    render(<AppProviders />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '登录' });

    await user.type(screen.getByRole('textbox', { name: '用户名' }), 'engineer');
    await user.type(screen.getByLabelText(/^密码/), 'password-123');
    await user.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    queryClient.setQueryData(['audit', 'sensitive-race'], { value: '旧审计' });
    const staleRefetch = queryClient.refetchQueries({ queryKey: authSessionQueryKey, exact: true });
    await waitFor(() => expect(authMeCalls).toBe(2));

    await act(async () => {
      loginResult.resolve({
        data: { user: engineer, csrf_token: 'canonical-login-csrf' },
        response: Response.json({ user: engineer, csrf_token: 'canonical-login-csrf' }),
      } as never);
    });
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(queryClient.getQueryData(['audit', 'sensitive-race'])).toBeUndefined();

    await act(async () => {
      lateAnonymous.resolve({ response: new Response(null, { status: 204 }) } as never);
      await staleRefetch;
    });
    expect(window.location.pathname).toBe('/');
    expect(queryClient.getQueryData(authSessionQueryKey)).toEqual({
      user: engineer,
      csrfToken: 'canonical-login-csrf',
    });
  });

  it('退出期间启动的旧读取迟到后仍保留匿名身份、缓存清理和登录路由', async () => {
    const logoutResult = deferred<never>();
    const lateAdmin = deferred<never>();
    let authMeCalls = 0;
    vi.spyOn(api, 'GET').mockImplementation((path) => {
      if (path === '/api/v1/workbench') return Promise.resolve({
        data: emptyWorkbenchAggregate,
        response: Response.json(emptyWorkbenchAggregate),
      } as never);
      if (path === '/api/v1/auth/me') {
        authMeCalls += 1;
        return authMeCalls === 1
          ? Promise.resolve({ data: admin, response: Response.json(admin) } as never)
          : lateAdmin.promise;
      }
      if (path === '/api/v1/auth/csrf') return Promise.resolve({
        data: { csrf_token: 'admin-csrf' },
        response: Response.json({ csrf_token: 'admin-csrf' }),
      } as never);
      throw new Error(`测试收到未声明的 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST').mockImplementation(() => logoutResult.promise);
    window.history.replaceState(null, '', '/');
    render(<AppProviders />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '工作台' });

    await user.click(screen.getByRole('button', { name: /系统管理员/ }));
    await user.click(await screen.findByRole('menuitem', { name: '退出登录' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    queryClient.setQueryData(['users', 'sensitive-race'], { value: '旧用户' });
    const staleRefetch = queryClient.refetchQueries({ queryKey: authSessionQueryKey, exact: true });
    await waitFor(() => expect(authMeCalls).toBe(2));

    await act(async () => {
      logoutResult.resolve({ response: new Response(null, { status: 204 }) } as never);
    });
    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(queryClient.getQueryData(['users', 'sensitive-race'])).toBeUndefined();

    await act(async () => {
      lateAdmin.resolve({ data: admin, response: Response.json(admin) } as never);
      await staleRefetch;
    });
    expect(window.location.pathname).toBe('/login');
    expect(queryClient.getQueryData(authSessionQueryKey)).toBeNull();
  });

  it('改密期间启动的 must-change 读取迟到后仍保留 canonical 身份、缓存清理和业务路由', async () => {
    const mustChangeAdmin = {
      ...admin,
      must_change_password: true,
      workflow_stage: 'FIRST_PASSWORD_CHANGE' as const,
    };
    const changeResult = deferred<never>();
    const lateMustChange = deferred<never>();
    let authMeCalls = 0;
    let csrfCalls = 0;
    vi.spyOn(api, 'GET').mockImplementation((path) => {
      if (path === '/api/v1/workbench') return Promise.resolve({
        data: emptyWorkbenchAggregate,
        response: Response.json(emptyWorkbenchAggregate),
      } as never);
      if (path === '/api/v1/auth/me') {
        authMeCalls += 1;
        if (authMeCalls === 1) return Promise.resolve({
          data: mustChangeAdmin,
          response: Response.json(mustChangeAdmin),
        } as never);
        if (authMeCalls === 2) return lateMustChange.promise;
        return Promise.resolve({ data: admin, response: Response.json(admin) } as never);
      }
      if (path === '/api/v1/auth/csrf') {
        csrfCalls += 1;
        const csrfToken = csrfCalls === 1 ? 'must-change-csrf' : 'canonical-change-csrf';
        return Promise.resolve({
          data: { csrf_token: csrfToken },
          response: Response.json({ csrf_token: csrfToken }),
        } as never);
      }
      throw new Error(`测试收到未声明的 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST').mockImplementation(() => changeResult.promise);
    window.history.replaceState(null, '', '/account/security');
    render(<AppProviders />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '修改密码' });

    await user.type(screen.getByLabelText(/^当前密码/), 'password-123');
    await user.type(screen.getByLabelText(/^新密码/), 'password-456');
    await user.click(screen.getByRole('button', { name: '确认修改' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    queryClient.setQueryData(['audit', 'must-change-race'], { value: '强改密审计' });
    const staleRefetch = queryClient.refetchQueries({ queryKey: authSessionQueryKey, exact: true });
    await waitFor(() => expect(authMeCalls).toBe(2));

    await act(async () => {
      changeResult.resolve({ response: new Response(null, { status: 204 }) } as never);
    });
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(queryClient.getQueryData(['audit', 'must-change-race'])).toBeUndefined();

    await act(async () => {
      lateMustChange.resolve({
        data: mustChangeAdmin,
        response: Response.json(mustChangeAdmin),
      } as never);
      await staleRefetch;
    });
    expect(window.location.pathname).toBe('/');
    expect(queryClient.getQueryData(authSessionQueryKey)).toEqual({
      user: admin,
      csrfToken: 'canonical-change-csrf',
    });
  });
});
