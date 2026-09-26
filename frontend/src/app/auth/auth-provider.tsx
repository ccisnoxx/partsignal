import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { z } from 'zod';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  advancePrincipalEpoch,
  initializePrincipalEpoch,
  invalidatePrincipalEpoch,
} from './principal-epoch';
import {
  createAuthTransitionChannel,
  readAuthTransitionState,
  type AuthTransitionChannel,
  type AuthTransitionMessage,
  type AuthTransitionStorageState,
} from './auth-transition-channel';

type AuthUser = components['schemas']['User'];
type AuthSessionResponse = components['schemas']['AuthSession'];
type LoginRequest = components['schemas']['LoginRequest'];
type ChangePasswordRequest = components['schemas']['ChangePasswordRequest'];

type AuthSession = {
  user: AuthUser;
  csrfToken: string;
  sessionBinding: string;
};

type PrincipalBoundaryRunner = <T>(
  command: (signal: AbortSignal) => Promise<T>,
) => Promise<T>;

type AuthContextValue = {
  user: AuthUser | null;
  csrfToken: string | null;
  isLoading: boolean;
  isSigningOut: boolean;
  error: unknown;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  runPrincipalBoundary: PrincipalBoundaryRunner;
  signOut: () => Promise<void>;
};

type AuthTransition = {
  assertCurrent: () => void;
  commit: (apply: () => void) => Promise<void>;
  finish: () => Promise<void>;
  signal: AbortSignal;
};

type AuthTransitionContextValue = {
  begin: () => Promise<AuthTransition>;
};

type SessionLoadGuard = {
  isCurrent: () => boolean;
  signal: AbortSignal;
};

type AuthTransitionBarrier = {
  active: {
    invalidated: boolean;
    ownerId: string;
    transitionId: string;
  } | null;
  durableEventId: string | null;
  fault: boolean;
  faultInvalidated: boolean;
};

const authSessionQueryKey = ['auth', 'session'] as const;
const AuthContext = createContext<AuthContextValue | null>(null);
const AuthTransitionContext = createContext<AuthTransitionContextValue | null>(null);

const deletionBlockerTypes = [
  'FACT_VERSION',
  'CONTENT_TASK',
  'GEO_OBSERVATION',
  'CONTENT_VERSION',
  'GENERATION_JOB',
  'PUBLISHED_ARTICLE',
  'PLATFORM_PROFILE',
  'PLATFORM_ACCOUNT',
  'PUBLICATION_WORK',
  'PROTECTED_CONTENT_VERSION',
  'PUBLISHED_CONTENT_ISSUE',
  'GEO_OPTIMIZATION_SOURCE',
  'USER_BUSINESS_HISTORY',
] as const;

const authUserSchema = z.strictObject({
  id: z.uuid(),
  username: z.string(),
  display_name: z.string(),
  account_type: z.enum(['ADMIN', 'ENGINEER']),
  is_active: z.boolean(),
  must_change_password: z.boolean(),
  workflow_stage: z.enum(['FIRST_PASSWORD_CHANGE', 'ACTIVE', 'DISABLED']),
  primary_task: z.enum(['MANAGE_LOGIN_SECURITY', 'MANAGE_USER', 'ENABLE_USER']),
  available_actions: z.array(z.enum(['UPDATE', 'RESET_PASSWORD', 'ENABLE', 'DISABLE', 'DELETE'])),
  deletion: z.strictObject({
    blockers: z.array(z.strictObject({
      type: z.enum(deletionBlockerTypes),
      count: z.number().int().positive(),
    })),
  }).nullable(),
  revision: z.number().int(),
  created_at: z.iso.datetime({ offset: true }),
});

const authSessionResponseSchema = z.strictObject({
  user: authUserSchema,
  csrf_token: z.string().min(1).max(256),
  session_binding: z.string().regex(/^[0-9a-f]{64}$/),
});

function clearBusinessQueries(queryClient: QueryClient) {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== authSessionQueryKey[0],
  });
}

function authBoundaryIdentity(session: AuthSession | null): string | null {
  if (!session) return null;
  return JSON.stringify([
    session.sessionBinding,
    session.user.id,
    session.user.account_type,
    session.user.is_active,
    session.user.must_change_password,
    session.user.workflow_stage,
  ]);
}

function commitPrincipalBoundary(queryClient: QueryClient, next: AuthSession | null) {
  if (advancePrincipalEpoch(queryClient, authBoundaryIdentity(next))) {
    clearBusinessQueries(queryClient);
  }
}

function getAuthSession(queryClient: QueryClient): AuthSession | null {
  return queryClient.getQueryData<AuthSession | null>(authSessionQueryKey) ?? null;
}

function getAuthRouteUser(queryClient: QueryClient): AuthUser | null {
  return queryClient.getQueryData<AuthSession | null>(authSessionQueryKey)?.user ?? null;
}

function requestError(action: string, result: { error?: unknown; response: Response }) {
  const payload = result.error as { error?: { message?: string } } | undefined;
  return new Error(payload?.error?.message ?? `${action}失败（HTTP ${result.response.status}）`);
}

function isAuthRequired(result: { error?: unknown; response: Response }) {
  const payload = result.error as { error?: { code?: string } } | undefined;
  return result.response.status === 401 && payload?.error?.code === 'AUTH_REQUIRED';
}

function assertSessionLoadCurrent(guard: SessionLoadGuard) {
  guard.signal.throwIfAborted();
  if (!guard.isCurrent()) {
    throw new DOMException('认证状态转换已被更新的命令取代', 'AbortError');
  }
}

async function loadAuthSession(
  guard: SessionLoadGuard,
): Promise<AuthSession | null> {
  // 在发出网络请求前先证明当前 durable transition 已开放读取；不能只在
  // 响应回来后丢弃，因为 active STARTED 期间连 canonical GET 都不应启动。
  assertSessionLoadCurrent(guard);
  const snapshot = await api.GET('/api/v1/auth/session', { signal: guard.signal });
  assertSessionLoadCurrent(guard);
  if (snapshot.response.status === 204 || isAuthRequired(snapshot)) {
    // Chromium 需要显式消费空响应，否则开发工具可能把已完成请求显示为中止。
    if (snapshot.response.status === 204) await snapshot.response.text();
    assertSessionLoadCurrent(guard);
    return null;
  }
  if (!snapshot.data) throw requestError('读取当前会话', snapshot);

  return authSessionFromResponse(snapshot.data);
}

function authSessionFromResponse(snapshot: AuthSessionResponse): AuthSession {
  const parsed = authSessionResponseSchema.safeParse(snapshot);
  if (!parsed.success) throw new Error('认证会话响应结构无效');
  return {
    user: parsed.data.user,
    csrfToken: parsed.data.csrf_token,
    sessionBinding: parsed.data.session_binding,
  };
}

function createTransitionBarrier(state: AuthTransitionStorageState): AuthTransitionBarrier {
  if (state.status === 'INVALID') {
    return {
      active: null,
      durableEventId: null,
      fault: true,
      faultInvalidated: false,
    };
  }
  if (state.status === 'VALID' && state.message.phase === 'STARTED') {
    return {
      active: {
        invalidated: false,
        ownerId: state.message.ownerId,
        transitionId: state.message.transitionId,
      },
      durableEventId: state.message.eventId,
      fault: false,
      faultInvalidated: false,
    };
  }
  return {
    active: null,
    durableEventId: state.status === 'VALID' ? state.message.eventId : null,
    fault: false,
    faultInvalidated: false,
  };
}

function authTransitionReadIsOpen(state: AuthTransitionStorageState) {
  return state.status === 'ABSENT'
    || (state.status === 'VALID' && state.message.phase === 'SETTLED');
}

function authTransitionReadMatches(
  before: AuthTransitionStorageState,
  after: AuthTransitionStorageState,
) {
  if (before.status === 'ABSENT' || after.status === 'ABSENT') {
    return before.status === after.status;
  }
  if (before.status !== 'VALID' || after.status !== 'VALID') return false;
  return before.message.eventId === after.message.eventId;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  initializePrincipalEpoch(
    queryClient,
    authBoundaryIdentity(getAuthSession(queryClient)),
  );
  const transitionEpochRef = useRef(0);
  const transitionControllerRef = useRef<AbortController | null>(null);
  const authReadGenerationRef = useRef(0);
  const activeCommandEpochRef = useRef<number | null>(null);
  const authTransitionChannelRef = useRef<AuthTransitionChannel | null>(null);
  const [initialTransitionState] = useState(readAuthTransitionState);
  const transitionBarrierRef = useRef<AuthTransitionBarrier>(
    createTransitionBarrier(initialTransitionState),
  );
  const [authReadBlocked, setAuthReadBlocked] = useState(
    () => !authTransitionReadIsOpen(initialTransitionState),
  );
  const [transitionError, setTransitionError] = useState<unknown>(
    () => initialTransitionState.status === 'INVALID'
      ? initialTransitionState.error
      : null,
  );

  const invalidateRemotePrincipal = useCallback(() => {
    transitionEpochRef.current += 1;
    transitionControllerRef.current?.abort(
      new DOMException('认证状态转换已被其他标签页取代', 'AbortError'),
    );
    transitionControllerRef.current = null;
    activeCommandEpochRef.current = null;
    authReadGenerationRef.current += 1;
    void queryClient.cancelQueries({ queryKey: authSessionQueryKey, exact: true });
    invalidatePrincipalEpoch(queryClient);
    clearBusinessQueries(queryClient);
    queryClient.setQueryData<AuthSession | null>(authSessionQueryKey, null);
  }, [queryClient]);

  const failClosedTransition = useCallback((error: unknown) => {
    const barrier = transitionBarrierRef.current!;
    const needsInvalidation = barrier.active !== null
      || !barrier.fault
      || !barrier.faultInvalidated;
    barrier.active = null;
    barrier.durableEventId = null;
    barrier.fault = true;
    if (needsInvalidation) {
      invalidateRemotePrincipal();
      barrier.faultInvalidated = true;
    }
    setAuthReadBlocked(true);
    setTransitionError(error);
  }, [invalidateRemotePrincipal]);

  const handleRemoteTransition = useCallback((state: AuthTransitionStorageState) => {
    const barrier = transitionBarrierRef.current!;
    if (state.status === 'INVALID') {
      failClosedTransition(state.error);
      return;
    }
    if (state.status === 'ABSENT') {
      if (barrier.active !== null || barrier.fault) {
        failClosedTransition(new Error('跨标签页认证状态在收敛前消失'));
        return;
      }
      barrier.durableEventId = null;
      setTransitionError(null);
      setAuthReadBlocked(false);
      return;
    }

    const message: AuthTransitionMessage = state.message;
    if (message.phase === 'STARTED') {
      const sameActive = barrier.active?.transitionId === message.transitionId
        && barrier.active.ownerId === message.ownerId;
      if (!sameActive) {
        barrier.active = {
          invalidated: false,
          ownerId: message.ownerId,
          transitionId: message.transitionId,
        };
      }
      barrier.durableEventId = message.eventId;
      barrier.fault = false;
      barrier.faultInvalidated = false;
      setAuthReadBlocked(true);
      setTransitionError(null);
      if (!barrier.active!.invalidated) {
        invalidateRemotePrincipal();
        barrier.active!.invalidated = true;
      }
      return;
    }

    const boundaryChanged = barrier.active !== null
      || barrier.fault
      || barrier.durableEventId !== message.eventId;
    const needsInvalidation = barrier.active !== null
      ? !barrier.active.invalidated
      : barrier.fault
        ? !barrier.faultInvalidated
        : barrier.durableEventId !== message.eventId;
    if (needsInvalidation) invalidateRemotePrincipal();
    barrier.active = null;
    barrier.durableEventId = message.eventId;
    barrier.fault = false;
    barrier.faultInvalidated = false;
    setTransitionError(null);
    setAuthReadBlocked(false);
    if (boundaryChanged) {
      void queryClient.invalidateQueries({
        queryKey: authSessionQueryKey,
        exact: true,
        refetchType: 'active',
      });
    }
  }, [failClosedTransition, invalidateRemotePrincipal, queryClient]);

  useEffect(() => {
    const channel = createAuthTransitionChannel(handleRemoteTransition, (error) => {
      failClosedTransition(error);
    });
    authTransitionChannelRef.current = channel;
    return () => {
      authTransitionChannelRef.current = null;
      channel.close();
    };
  }, [failClosedTransition, handleRemoteTransition]);

  const beginTransition = useCallback(async (): Promise<AuthTransition> => {
    const channel = authTransitionChannelRef.current;
    if (!channel) throw new Error('认证跨标签页同步尚未就绪');
    const transitionId = globalThis.crypto.randomUUID();
    const owner = await channel.acquire(transitionId);
    const epoch = transitionEpochRef.current + 1;
    transitionEpochRef.current = epoch;
    transitionControllerRef.current?.abort(
      new DOMException('认证状态转换已被更新的命令取代', 'AbortError'),
    );
    const controller = new AbortController();
    transitionControllerRef.current = controller;
    activeCommandEpochRef.current = epoch;
    authReadGenerationRef.current += 1;
    // 本标签页同样先关闭旧主体 continuation；跨标签页消息只负责让其他
    // QueryClient 执行相同边界，不承载任何认证数据。
    invalidatePrincipalEpoch(queryClient, authBoundaryIdentity(getAuthSession(queryClient)));
    clearBusinessQueries(queryClient);
    try {
      owner.start();
    } catch (error) {
      controller.abort(error);
      activeCommandEpochRef.current = null;
      await owner.finish();
      throw error;
    }

    const assertCurrent = () => {
      controller.signal.throwIfAborted();
      if (transitionEpochRef.current !== epoch) {
        throw new DOMException('认证状态转换已被更新的命令取代', 'AbortError');
      }
    };
    try {
      await queryClient.cancelQueries({ queryKey: authSessionQueryKey, exact: true });
      assertCurrent();
    } catch (error) {
      if (activeCommandEpochRef.current === epoch) activeCommandEpochRef.current = null;
      try {
        await owner.finish();
      } catch {
        // 保留原始抢占/取消错误；STARTED 的发送方仍已尽力关闭远端 barrier。
      }
      throw error;
    }

    const closeReadBarrier = async (requireCurrent: boolean) => {
      if (activeCommandEpochRef.current !== epoch) return false;
      authReadGenerationRef.current += 1;
      await queryClient.cancelQueries({ queryKey: authSessionQueryKey, exact: true });
      if (requireCurrent) assertCurrent();
      if (activeCommandEpochRef.current !== epoch) return false;

      // cancelQueries 在调用时同步取消已注册的 query。第二次取消与 generation
      // 递增共同覆盖第一次 await 期间新启动的认证读取。
      authReadGenerationRef.current += 1;
      void queryClient.cancelQueries({ queryKey: authSessionQueryKey, exact: true });
      activeCommandEpochRef.current = null;
      return true;
    };

    let committed = false;
    return {
      assertCurrent,
      commit: async (apply) => {
        assertCurrent();
        if (!await closeReadBarrier(true)) {
          assertCurrent();
          throw new DOMException('认证状态转换已被更新的命令取代', 'AbortError');
        }
        assertCurrent();
        apply();
        committed = true;
      },
      finish: async () => {
        const requiresReconciliation = !committed;
        if (requiresReconciliation) await closeReadBarrier(false);
        try {
          await owner.finish();
        } catch (error) {
          failClosedTransition(error);
          throw error;
        }
        if (requiresReconciliation) channel.reconcile();
      },
      signal: controller.signal,
    };
  }, [failClosedTransition, queryClient]);

  useEffect(() => () => {
    transitionControllerRef.current?.abort(
      new DOMException('认证 Provider 已卸载', 'AbortError'),
    );
  }, []);

  const session = useQuery({
    queryKey: authSessionQueryKey,
    queryFn: ({ signal }) => {
      const generation = authReadGenerationRef.current + 1;
      authReadGenerationRef.current = generation;
      const commandAtStart = activeCommandEpochRef.current;
      const transitionAtStart = readAuthTransitionState();
      const guard = {
        isCurrent: () => {
          const currentTransition = readAuthTransitionState();
          const barrier = transitionBarrierRef.current!;
          return commandAtStart === null
            && activeCommandEpochRef.current === null
            && barrier.active === null
            && !barrier.fault
            && authTransitionReadIsOpen(transitionAtStart)
            && authTransitionReadIsOpen(currentTransition)
            && authTransitionReadMatches(transitionAtStart, currentTransition)
            && authReadGenerationRef.current === generation;
        },
        signal,
      };
      return loadAuthSession(guard).then((next) => {
        assertSessionLoadCurrent(guard);
        // 主体 epoch 必须先失效，再清理旧身份业务缓存，最后才允许 Query 写入新会话。
        commitPrincipalBoundary(queryClient, next);
        return next;
      });
    },
    enabled: !authReadBlocked,
    retry: false,
  });

  const runPrincipalBoundary = useCallback<PrincipalBoundaryRunner>(async (command) => {
    const transition = await beginTransition();
    try {
      const result = await command(transition.signal);
      transition.assertCurrent();
      const refreshedSession = await loadAuthSession({
        isCurrent: () => {
          try {
            transition.assertCurrent();
            return true;
          } catch {
            return false;
          }
        },
        signal: transition.signal,
      });
      transition.assertCurrent();
      await transition.commit(() => {
        commitPrincipalBoundary(queryClient, refreshedSession);
        queryClient.setQueryData(authSessionQueryKey, refreshedSession);
      });
      return result;
    } finally {
      await transition.finish();
    }
  }, [beginTransition, queryClient]);

  const logout = useMutation({
    meta: { authPrincipalBoundary: true },
    mutationFn: async () => {
      if (!session.data) throw new Error('当前没有可退出的登录会话');
      const transition = await beginTransition();
      try {
        const result = await api.POST('/api/v1/auth/logout', {
          params: { header: { 'X-CSRF-Token': session.data.csrfToken } },
          signal: transition.signal,
        });
        transition.assertCurrent();
        if (!result.response.ok) throw requestError('退出登录', result);
        await transition.commit(() => {
          commitPrincipalBoundary(queryClient, null);
          queryClient.setQueryData(authSessionQueryKey, null);
        });
      } finally {
        await transition.finish();
      }
    },
  });

  const user = session.data?.user ?? null;
  const value: AuthContextValue = {
    user,
    csrfToken: session.data?.csrfToken ?? null,
    isLoading: transitionError === null && (authReadBlocked || session.isLoading),
    isSigningOut: logout.isPending,
    error: transitionError ?? session.error,
    isAdmin: user?.account_type === 'ADMIN',
    refresh: async () => {
      if (authReadBlocked || transitionError !== null) {
        authTransitionChannelRef.current?.reconcile();
        return;
      }
      await session.refetch();
    },
    runPrincipalBoundary,
    signOut: logout.mutateAsync,
  };

  return (
    <AuthTransitionContext.Provider value={{ begin: beginTransition }}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </AuthTransitionContext.Provider>
  );
}

function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return value;
}

function useAuthActions() {
  const auth = useAuth();
  const transitions = useContext(AuthTransitionContext);
  const queryClient = useQueryClient();
  if (!transitions) throw new Error('useAuthActions 必须在 AuthProvider 内使用');

  return {
    signIn: async (payload: LoginRequest) => {
      const transition = await transitions.begin();
      try {
        const result = await api.POST('/api/v1/auth/login', {
          body: payload,
          signal: transition.signal,
        });
        transition.assertCurrent();
        if (!result.data) throw requestError('登录', result);

        const next = authSessionFromResponse(result.data);
        await transition.commit(() => {
          commitPrincipalBoundary(queryClient, next);
          queryClient.setQueryData<AuthSession>(authSessionQueryKey, next);
        });
        return result.data.user;
      } finally {
        await transition.finish();
      }
    },
    changePassword: async (payload: ChangePasswordRequest) => {
      if (!auth.csrfToken) throw new Error('当前没有可修改密码的登录会话');
      const transition = await transitions.begin();
      try {
        const result = await api.POST('/api/v1/auth/change-password', {
          body: payload,
          params: { header: { 'X-CSRF-Token': auth.csrfToken } },
          signal: transition.signal,
        });
        transition.assertCurrent();
        if (!result.response.ok) throw requestError('修改密码', result);

        // 改密后的 must-change 状态只能来自服务端，不能在浏览器里推导。
        const refreshedSession = await loadAuthSession({
          isCurrent: () => {
            try {
              transition.assertCurrent();
              return true;
            } catch {
              return false;
            }
          },
          signal: transition.signal,
        });
        transition.assertCurrent();
        if (!refreshedSession) throw new Error('修改密码后登录会话已失效');
        await transition.commit(() => {
          commitPrincipalBoundary(queryClient, refreshedSession);
          queryClient.setQueryData(authSessionQueryKey, refreshedSession);
        });
      } finally {
        await transition.finish();
      }
    },
  };
}

export {
  AuthProvider,
  authBoundaryIdentity,
  authSessionQueryKey,
  getAuthSession,
  getAuthRouteUser,
  useAuth,
  useAuthActions,
};
export type { AuthContextValue, AuthSession, AuthUser, PrincipalBoundaryRunner };
