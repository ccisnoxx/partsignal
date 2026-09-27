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
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import {
  advancePrincipalEpoch,
  assertPrincipalCommandOpen,
  beginPrincipalCommandBarrier,
  capturePrincipalContinuation,
  initializePrincipalEpoch,
  invalidatePrincipalEpoch,
  isPrincipalCommandBlocked,
  type PrincipalCommandBarrier,
} from './principal-epoch';
import {
  createAuthTransitionChannel,
  readAuthTransitionState,
  type AuthTransitionChannel,
  type AuthTransitionMessage,
  type AuthTransitionOwner,
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

type PrincipalBoundaryOwner = {
  assertCanSend: () => void;
};

type PrincipalBoundaryRunner = <T>(
  command: (signal: AbortSignal, owner: PrincipalBoundaryOwner) => Promise<T>,
) => Promise<T>;

type AuthContextValue = {
  user: AuthUser | null;
  csrfToken: string | null;
  isLoading: boolean;
  isSigningOut: boolean;
  error: unknown;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  reconcileUnknownPrincipalResult: () => Promise<void>;
  runPrincipalBoundary: PrincipalBoundaryRunner;
  signOut: () => Promise<void>;
};

type AuthTransition = {
  assertOwner: () => void;
  assertCurrent: () => void;
  commit: (apply: () => void) => Promise<void>;
  finish: () => Promise<void>;
  signal: AbortSignal;
};

type AuthTransitionContextValue = {
  begin: () => Promise<AuthTransition>;
};

type AuthTransitionMode = 'command' | 'result-reconciliation';

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
  id: canonicalUuidSchema,
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
  if (isPrincipalCommandBlocked(queryClient)) return null;
  return getAuthSession(queryClient)?.user ?? null;
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
  const activeAuthReadsRef = useRef(new Set<Promise<AuthSession | null>>());
  const activeCommandEpochRef = useRef<number | null>(null);
  const commandBarrierRef = useRef<PrincipalCommandBarrier | null>(null);
  const pendingResultReconciliationsRef = useRef(0);
  const resultReconciliationTailRef = useRef<Promise<void>>(Promise.resolve());
  const pendingCommandBarrierReleaseRef = useRef<{
    authReadGeneration: number;
    eventId: string;
  } | null>(null);
  const authTransitionChannelRef = useRef<AuthTransitionChannel | null>(null);
  const [initialTransitionState] = useState(readAuthTransitionState);
  const [localCommandActive, setLocalCommandActive] = useState(false);
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

  const enterCommandBarrier = useCallback(() => {
    if (commandBarrierRef.current) return;
    commandBarrierRef.current = beginPrincipalCommandBarrier(queryClient);
  }, [queryClient]);

  const releaseCommandBarrier = useCallback((force = false) => {
    if (!force && pendingResultReconciliationsRef.current > 0) return;
    commandBarrierRef.current?.release();
    commandBarrierRef.current = null;
    pendingCommandBarrierReleaseRef.current = null;
  }, []);

  const releaseCommandBarrierIfCanonical = useCallback((eventId?: string) => {
    if (pendingResultReconciliationsRef.current > 0) return;
    const pending = pendingCommandBarrierReleaseRef.current;
    if (!pending || (eventId && pending.eventId !== eventId)) return;
    const barrier = transitionBarrierRef.current!;
    const sessionState = queryClient.getQueryState(authSessionQueryKey);
    if (
      barrier.active === null
      && !barrier.fault
      && authReadGenerationRef.current > pending.authReadGeneration
      && sessionState?.fetchStatus === 'idle'
      && sessionState?.status === 'success'
    ) releaseCommandBarrier();
  }, [queryClient, releaseCommandBarrier]);

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
    enterCommandBarrier();
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
  }, [enterCommandBarrier, invalidateRemotePrincipal]);

  const trackAuthRead = useCallback((guard: SessionLoadGuard) => {
    const read = loadAuthSession(guard);
    activeAuthReadsRef.current.add(read);
    void read.then(
      () => activeAuthReadsRef.current.delete(read),
      () => activeAuthReadsRef.current.delete(read),
    );
    return read;
  }, []);

  const waitForActiveAuthReads = useCallback(async (signal: AbortSignal) => {
    while (activeAuthReadsRef.current.size > 0) {
      const reads = Array.from(activeAuthReadsRef.current);
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort);
          reject(signal.reason ?? new DOMException('认证状态转换观察已取消', 'AbortError'));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        void Promise.allSettled(reads).then(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
      });
    }
  }, []);

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
      enterCommandBarrier();
      pendingCommandBarrierReleaseRef.current = null;
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
      pendingCommandBarrierReleaseRef.current = {
        authReadGeneration: authReadGenerationRef.current,
        eventId: message.eventId,
      };
      void queryClient.invalidateQueries({
        queryKey: authSessionQueryKey,
        exact: true,
        refetchType: 'active',
      }).then(() => releaseCommandBarrierIfCanonical(message.eventId));
    } else {
      releaseCommandBarrierIfCanonical();
    }
  }, [
    enterCommandBarrier,
    failClosedTransition,
    invalidateRemotePrincipal,
    queryClient,
    releaseCommandBarrierIfCanonical,
  ]);

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

  const beginTransition = useCallback(async (
    mode: AuthTransitionMode = 'command',
  ): Promise<AuthTransition> => {
    const channel = authTransitionChannelRef.current;
    if (!channel) throw new Error('认证跨标签页同步尚未就绪');
    const acquisitionContinuation = mode === 'command'
      ? (assertPrincipalCommandOpen(queryClient), capturePrincipalContinuation(queryClient))
      : null;
    const transitionId = globalThis.crypto.randomUUID();
    let owner: AuthTransitionOwner;
    try {
      owner = await channel.acquire(transitionId);
    } catch (error) {
      if (authTransitionChannelRef.current === channel) failClosedTransition(error);
      throw error;
    }
    try {
      if (acquisitionContinuation) {
        acquisitionContinuation.assertCurrent();
        assertPrincipalCommandOpen(queryClient);
      } else if (!commandBarrierRef.current) {
        throw new Error('结果已知的认证收敛缺少 principal fence');
      }
    } catch (error) {
      await owner.finish();
      throw error;
    }
    const epoch = transitionEpochRef.current + 1;
    transitionEpochRef.current = epoch;
    transitionControllerRef.current?.abort(
      new DOMException('认证状态转换已被更新的命令取代', 'AbortError'),
    );
    const controller = new AbortController();
    transitionControllerRef.current = controller;
    activeCommandEpochRef.current = epoch;
    setLocalCommandActive(true);
    const previousSession = getAuthSession(queryClient);
    enterCommandBarrier();
    const ownerBarrier = commandBarrierRef.current;
    if (!ownerBarrier) throw new Error('本地认证 transition 缺少命令 owner barrier');
    pendingCommandBarrierReleaseRef.current = null;
    authReadGenerationRef.current += 1;
    const barrier = transitionBarrierRef.current!;
    barrier.active = {
      invalidated: true,
      ownerId: 'local-owner',
      transitionId,
    };
    barrier.durableEventId = null;
    barrier.fault = false;
    barrier.faultInvalidated = false;
    setTransitionError(null);
    setAuthReadBlocked(true);
    // owner 页必须在 durable STARTED 与业务请求之前同步关闭命令、路由、
    // session snapshot 和旧 continuation；自身 controller 不经过远端 abort 路径。
    invalidatePrincipalEpoch(queryClient, authBoundaryIdentity(previousSession));
    clearBusinessQueries(queryClient);
    try {
      const started = owner.start();
      barrier.active = {
        invalidated: true,
        ownerId: started.ownerId,
        transitionId: started.transitionId,
      };
      barrier.durableEventId = started.eventId;
    } catch (error) {
      controller.abort(error);
      activeCommandEpochRef.current = null;
      setLocalCommandActive(false);
      await owner.finish();
      failClosedTransition(error);
      throw error;
    }

    const assertCurrent = () => {
      controller.signal.throwIfAborted();
      if (transitionEpochRef.current !== epoch) {
        throw new DOMException('认证状态转换已被更新的命令取代', 'AbortError');
      }
    };
    try {
      if (mode === 'result-reconciliation') {
        // fence 先于本 transition 登记并关闭了旧主体。已在服务端
        // 读取的旧 canonical GET 必须真正 settle，再从新 owner 内发起
        // 结果后读取；不能把 Query 取消状态当成网络读取已收敛。
        await waitForActiveAuthReads(controller.signal);
      } else {
        await queryClient.cancelQueries({ queryKey: authSessionQueryKey, exact: true });
      }
      assertCurrent();
    } catch (error) {
      if (activeCommandEpochRef.current === epoch) activeCommandEpochRef.current = null;
      setLocalCommandActive(false);
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
      return true;
    };

    let committed = false;
    return {
      assertOwner: ownerBarrier.assertOwner,
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
        let settled: AuthTransitionMessage | null;
        try {
          settled = await owner.finish();
        } catch (error) {
          setLocalCommandActive(false);
          failClosedTransition(error);
          throw error;
        }
        if (
          !settled
          || settled.phase !== 'SETTLED'
          || settled.transitionId !== transitionId
        ) {
          const error = new Error('本地认证 transition 未形成合法 SETTLED');
          setLocalCommandActive(false);
          failClosedTransition(error);
          throw error;
        }
        if (activeCommandEpochRef.current === epoch) activeCommandEpochRef.current = null;
        if (transitionControllerRef.current === controller) transitionControllerRef.current = null;
        if (requiresReconciliation) {
          try {
            const refreshedSession = await loadAuthSession({
              isCurrent: () => {
                try {
                  assertCurrent();
                } catch {
                  return false;
                }
                const durable = readAuthTransitionState();
                return durable.status === 'VALID'
                  && durable.message.phase === 'SETTLED'
                  && durable.message.eventId === settled.eventId;
              },
              signal: controller.signal,
            });
            assertCurrent();
            commitPrincipalBoundary(queryClient, refreshedSession);
            queryClient.setQueryData(authSessionQueryKey, refreshedSession);
          } catch (error) {
            setLocalCommandActive(false);
            failClosedTransition(error);
            throw error;
          }
        }
        barrier.active = null;
        barrier.durableEventId = settled.eventId;
        barrier.fault = false;
        barrier.faultInvalidated = false;
        setTransitionError(null);
        setLocalCommandActive(false);
        if (pendingResultReconciliationsRef.current === 0) {
          releaseCommandBarrier();
          setAuthReadBlocked(false);
        } else {
          setAuthReadBlocked(true);
        }
      },
      signal: controller.signal,
    };
  }, [
    enterCommandBarrier,
    failClosedTransition,
    queryClient,
    releaseCommandBarrier,
    waitForActiveAuthReads,
  ]);

  useEffect(() => () => {
    transitionControllerRef.current?.abort(
      new DOMException('认证 Provider 已卸载', 'AbortError'),
    );
    releaseCommandBarrier(true);
  }, [releaseCommandBarrier]);

  const session = useQuery({
    queryKey: authSessionQueryKey,
    meta: { authSessionReconciliation: true },
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
      return trackAuthRead(guard).then((next) => {
        assertSessionLoadCurrent(guard);
        // 主体 epoch 必须先失效，再清理旧身份业务缓存，最后才允许 Query 写入新会话。
        commitPrincipalBoundary(queryClient, next);
        return next;
      });
    },
    // 本地 owner 的 Query observer 保持挂载，避免 canonical commit 后因
    // disable→enable 产生第三次读取；其 queryFn 仍由 active command guard
    // 在发出网络前拒绝。远端 STARTED 没有本地 owner，继续真正 disable。
    enabled: !authReadBlocked || localCommandActive,
    retry: false,
  });

  useEffect(() => {
    releaseCommandBarrierIfCanonical();
  }, [
    releaseCommandBarrierIfCanonical,
    session.dataUpdatedAt,
    session.fetchStatus,
    session.status,
  ]);

  const runPrincipalBoundary = useCallback<PrincipalBoundaryRunner>(async (command) => {
    const transition = await beginTransition();
    try {
      const result = await command(transition.signal, { assertCanSend: transition.assertOwner });
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

  const reconcileUnknownPrincipalResult = useCallback(() => {
    // 调用时即为业务结果的最早可知点。在读取任何旧 barrier
    // 之前同步登记 fence，使较早启动、较晚返回的 canonical GET
    // 无法重开 route/cache。队列中每个请求都完成自己的结果后读取，
    // 不将它合并进无法证明读取点更晚的在途 reconciliation。
    pendingResultReconciliationsRef.current += 1;
    enterCommandBarrier();
    authReadGenerationRef.current += 1;
    invalidatePrincipalEpoch(queryClient);
    clearBusinessQueries(queryClient);
    queryClient.setQueryData<AuthSession | null>(authSessionQueryKey, null);
    setAuthReadBlocked(true);

    const previous = resultReconciliationTailRef.current;
    let completed = false;
    const reconciliation = previous.catch(() => undefined).then(async () => {
      const transition = await beginTransition('result-reconciliation');
      await transition.finish();
      completed = true;
    }).finally(() => {
      pendingResultReconciliationsRef.current -= 1;
      if (completed && pendingResultReconciliationsRef.current === 0) {
        releaseCommandBarrier();
        setAuthReadBlocked(false);
      }
    });
    resultReconciliationTailRef.current = reconciliation.catch(() => undefined);
    return reconciliation;
  }, [beginTransition, enterCommandBarrier, queryClient, releaseCommandBarrier]);

  const logout = useMutation({
    meta: { authProviderReconciliationOwner: true },
    mutationFn: async () => {
      if (!session.data) throw new Error('当前没有可退出的登录会话');
      const transition = await beginTransition();
      try {
        transition.assertOwner();
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
      releaseCommandBarrierIfCanonical();
    },
    reconcileUnknownPrincipalResult,
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
        transition.assertOwner();
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
        return next.user;
      } finally {
        await transition.finish();
      }
    },
    changePassword: async (payload: ChangePasswordRequest) => {
      if (!auth.csrfToken) throw new Error('当前没有可修改密码的登录会话');
      const transition = await transitions.begin();
      try {
        transition.assertOwner();
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
export type {
  AuthContextValue,
  AuthSession,
  AuthUser,
  PrincipalBoundaryOwner,
  PrincipalBoundaryRunner,
};
