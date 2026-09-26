type AuthTransitionPhase = 'STARTED' | 'SETTLED';

type AuthTransitionMessage = {
  eventId: string;
  leaseExpiresAt: number;
  ownerId: string;
  phase: AuthTransitionPhase;
  transitionId: string;
  version: 2;
};

type AuthTransitionStorageState =
  | { status: 'ABSENT' }
  | { error: Error; reason: 'INVALID' | 'LEGACY' | 'UNREADABLE'; status: 'INVALID' }
  | { message: AuthTransitionMessage; status: 'VALID' };

type AuthTransitionOwner = {
  finish: () => Promise<AuthTransitionMessage | null>;
  start: () => AuthTransitionMessage;
};

type AuthTransitionChannel = {
  acquire: (transitionId: string) => Promise<AuthTransitionOwner>;
  close: () => void;
  reconcile: () => void;
};

const authTransitionBroadcastName = 'partsignal.auth-transition.v2';
const authTransitionStorageKey = 'partsignal.auth-transition.v2';
const authTransitionLegacyStorageKey = 'partsignal.auth-transition.v1';
const authTransitionOwnerLockName = 'partsignal.auth-transition.owner.v2';
const authTransitionLeaseDurationMs = 10_000;
const authTransitionLeaseHeartbeatMs = 2_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messageKeys = [
  'eventId',
  'leaseExpiresAt',
  'ownerId',
  'phase',
  'transitionId',
  'version',
] as const;

function parseAuthTransitionMessage(value: unknown): AuthTransitionMessage | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as Record<string, unknown>;
  if (
    Object.keys(record).length !== messageKeys.length
    || messageKeys.some((key) => !(key in record))
    || record.version !== 2
    || (record.phase !== 'STARTED' && record.phase !== 'SETTLED')
    || typeof record.eventId !== 'string'
    || typeof record.ownerId !== 'string'
    || typeof record.transitionId !== 'string'
    || !uuidPattern.test(record.eventId)
    || !uuidPattern.test(record.ownerId)
    || !uuidPattern.test(record.transitionId)
    || typeof record.leaseExpiresAt !== 'number'
    || !Number.isSafeInteger(record.leaseExpiresAt)
    || record.leaseExpiresAt <= 0
  ) return null;
  return {
    eventId: record.eventId,
    leaseExpiresAt: record.leaseExpiresAt,
    ownerId: record.ownerId,
    phase: record.phase,
    transitionId: record.transitionId,
    version: 2,
  };
}

function readAuthTransitionState(): AuthTransitionStorageState {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return {
        error: new Error('浏览器无法读取跨标签页认证状态'),
        reason: 'UNREADABLE',
        status: 'INVALID',
      };
    }
    if (storage.getItem(authTransitionLegacyStorageKey) !== null) {
      return {
        error: new Error('检测到无法安全协调的旧版认证 transition'),
        reason: 'LEGACY',
        status: 'INVALID',
      };
    }
    const raw = storage.getItem(authTransitionStorageKey);
    if (raw === null) return { status: 'ABSENT' };
    const message = parseAuthTransitionMessage(raw);
    if (!message) {
      return {
        error: new Error('跨标签页认证状态格式无效'),
        reason: 'INVALID',
        status: 'INVALID',
      };
    }
    return { message, status: 'VALID' };
  } catch (cause) {
    return {
      error: new Error('浏览器无法读取跨标签页认证状态', { cause }),
      reason: 'UNREADABLE',
      status: 'INVALID',
    };
  }
}

function abortError() {
  return new DOMException('认证状态转换观察已取消', 'AbortError');
}

function waitUntil(timestamp: number, signal: AbortSignal): Promise<void> {
  const delay = Math.max(0, timestamp - Date.now());
  if (delay === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      globalThis.clearTimeout(timeout);
      reject(signal.reason ?? abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function requireLockManager(): LockManager {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager) throw new Error('浏览器不支持安全的跨标签页认证 owner');
  return lockManager;
}

function storageStateToken(state: AuthTransitionStorageState) {
  if (state.status === 'VALID') return `VALID:${state.message.eventId}`;
  if (state.status === 'INVALID') return `INVALID:${state.reason}`;
  return 'ABSENT';
}

function isMatchingStarted(
  state: AuthTransitionStorageState,
  expected: AuthTransitionMessage,
): state is { message: AuthTransitionMessage; status: 'VALID' } {
  return state.status === 'VALID'
    && state.message.phase === 'STARTED'
    && state.message.transitionId === expected.transitionId
    && state.message.ownerId === expected.ownerId;
}

function createAuthTransitionChannel(
  onState: (state: AuthTransitionStorageState) => void,
  onError: (error: unknown) => void,
): AuthTransitionChannel {
  const ownerId = globalThis.crypto.randomUUID();
  const pendingOwnerRequests = new Set<AbortController>();
  const ownedReleases = new Set<() => void>();
  const ownedStops = new Set<() => void>();
  let closed = false;
  let recoveryController: AbortController | null = null;
  let lastStateToken: string | null = null;
  let broadcast: BroadcastChannel | null = null;
  try {
    if (typeof globalThis.BroadcastChannel === 'function') {
      broadcast = new globalThis.BroadcastChannel(authTransitionBroadcastName);
    }
  } catch {
    broadcast = null;
  }

  const persist = (message: AuthTransitionMessage) => {
    try {
      globalThis.localStorage?.setItem(authTransitionStorageKey, JSON.stringify(message));
      if (globalThis.localStorage === undefined) throw new Error('localStorage unavailable');
    } catch (error) {
      throw new Error('浏览器无法持久化跨标签页认证租约', { cause: error });
    }
  };

  const cancelRecovery = () => {
    const controller = recoveryController;
    recoveryController = null;
    controller?.abort(abortError());
  };

  const recoverOrphan = async (started: AuthTransitionMessage, signal: AbortSignal) => {
    const lockManager = requireLockManager();
    await lockManager.request(
      authTransitionOwnerLockName,
      { mode: 'exclusive', signal },
      async (lock) => {
        if (!lock || closed) return;
        const current = readAuthTransitionState();
        if (!isMatchingStarted(current, started)) {
          acceptState(current);
          return;
        }
        // Web Lock 已证明 owner 不再存活；lease 只为已离开页面的网络栈保留
        // 收敛窗口。上限避免系统时钟回拨或损坏 marker 造成新的永久锁死。
        await waitUntil(Math.min(
          current.message.leaseExpiresAt,
          Date.now() + authTransitionLeaseDurationMs,
        ), signal);
        const expired = readAuthTransitionState();
        if (!isMatchingStarted(expired, started)) {
          acceptState(expired);
          return;
        }
        const settled: AuthTransitionMessage = {
          ...expired.message,
          eventId: globalThis.crypto.randomUUID(),
          phase: 'SETTLED',
        };
        persist(settled);
        try {
          broadcast?.postMessage(settled);
        } catch {
          // durable marker 已提交；当前页面仍会立即执行权威 reconciliation。
        }
        acceptState({ message: settled, status: 'VALID' }, true);
      },
    );
  };

  const scheduleRecovery = (message: AuthTransitionMessage) => {
    cancelRecovery();
    const controller = new AbortController();
    recoveryController = controller;
    void recoverOrphan(message, controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted || closed) return;
        onError(error);
      })
      .finally(() => {
        if (recoveryController === controller) recoveryController = null;
      });
  };

  function acceptState(state: AuthTransitionStorageState, force = false) {
    if (closed) return;
    const token = storageStateToken(state);
    if (!force && token === lastStateToken) return;
    lastStateToken = token;
    if (state.status === 'VALID' && state.message.phase === 'STARTED') {
      scheduleRecovery(state.message);
    } else {
      cancelRecovery();
    }
    onState(state);
  }

  const reconcileStoredState = (force = false) => {
    acceptState(readAuthTransitionState(), force);
  };
  const onBroadcast = () => reconcileStoredState();
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === authTransitionStorageKey
      || event.key === authTransitionLegacyStorageKey
      || event.key === null
    ) reconcileStoredState();
  };
  const focusListener = () => reconcileStoredState();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') reconcileStoredState();
  };

  broadcast?.addEventListener('message', onBroadcast);
  globalThis.addEventListener('storage', onStorage);
  globalThis.addEventListener('focus', focusListener);
  document.addEventListener('visibilitychange', onVisibilityChange);
  reconcileStoredState(true);

  return {
    acquire: async (transitionId) => {
      if (closed) throw new Error('认证跨标签页同步已经关闭');
      if (!uuidPattern.test(transitionId)) throw new Error('认证 transition id 无效');
      const lockManager = requireLockManager();
      const requestController = new AbortController();
      pendingOwnerRequests.add(requestController);
      let acquiredResolve!: () => void;
      let acquiredReject!: (error: unknown) => void;
      const acquired = new Promise<void>((resolve, reject) => {
        acquiredResolve = resolve;
        acquiredReject = reject;
      });
      let releaseResolve!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseResolve = resolve;
      });
      let releasedOnce = false;
      const release = () => {
        if (releasedOnce) return;
        releasedOnce = true;
        ownedReleases.delete(release);
        releaseResolve();
      };
      const lockPromise = lockManager.request(
        authTransitionOwnerLockName,
        { mode: 'exclusive', signal: requestController.signal },
        async (lock) => {
          if (!lock || closed) throw new Error('无法取得跨标签页认证 owner');
          ownedReleases.add(release);
          acquiredResolve();
          await released;
        },
      );
      lockPromise.catch(acquiredReject);
      try {
        await acquired;
      } finally {
        pendingOwnerRequests.delete(requestController);
      }

      let started: AuthTransitionMessage | null = null;
      let heartbeat: ReturnType<typeof globalThis.setInterval> | null = null;
      let finished = false;
      const stopHeartbeat = () => {
        if (heartbeat === null) return;
        globalThis.clearInterval(heartbeat);
        heartbeat = null;
        ownedStops.delete(stopHeartbeat);
      };
      const publishOwned = (message: AuthTransitionMessage) => {
        persist(message);
        lastStateToken = storageStateToken({ message, status: 'VALID' });
        try {
          broadcast?.postMessage(message);
        } catch {
          // durable localStorage marker 仍可通过 storage/focus/visibility 收敛。
        }
      };
      return {
        start: () => {
          if (started || finished || closed) throw new Error('认证 transition owner 状态无效');
          started = {
            eventId: globalThis.crypto.randomUUID(),
            leaseExpiresAt: Date.now() + authTransitionLeaseDurationMs,
            ownerId,
            phase: 'STARTED',
            transitionId,
            version: 2,
          };
          try {
            publishOwned(started);
          } catch (error) {
            finished = true;
            release();
            throw error;
          }
          heartbeat = globalThis.setInterval(() => {
            if (!started || finished || closed) return;
            const current = readAuthTransitionState();
            if (!isMatchingStarted(current, started)) {
              stopHeartbeat();
              onError(current.status === 'INVALID'
                ? current.error
                : new Error('跨标签页认证 owner marker 已漂移'));
              return;
            }
            started = {
              ...started,
              leaseExpiresAt: Date.now() + authTransitionLeaseDurationMs,
            };
            try {
              persist(started);
            } catch (error) {
              stopHeartbeat();
              onError(error);
            }
          }, authTransitionLeaseHeartbeatMs);
          ownedStops.add(stopHeartbeat);
          return started;
        },
        finish: async () => {
          if (finished) return null;
          finished = true;
          stopHeartbeat();
          let settled: AuthTransitionMessage | null = null;
          try {
            if (started && !closed) {
              settled = {
                ...started,
                eventId: globalThis.crypto.randomUUID(),
                phase: 'SETTLED',
              };
              publishOwned(settled);
            }
          } finally {
            release();
            await lockPromise;
          }
          return settled;
        },
      };
    },
    close: () => {
      if (closed) return;
      closed = true;
      cancelRecovery();
      for (const controller of pendingOwnerRequests) controller.abort(abortError());
      pendingOwnerRequests.clear();
      for (const stop of Array.from(ownedStops)) stop();
      for (const release of Array.from(ownedReleases)) release();
      broadcast?.removeEventListener('message', onBroadcast);
      broadcast?.close();
      globalThis.removeEventListener('storage', onStorage);
      globalThis.removeEventListener('focus', focusListener);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
    reconcile: () => reconcileStoredState(true),
  };
}

export {
  authTransitionLegacyStorageKey,
  authTransitionStorageKey,
  createAuthTransitionChannel,
  parseAuthTransitionMessage,
  readAuthTransitionState,
};
export type {
  AuthTransitionChannel,
  AuthTransitionMessage,
  AuthTransitionOwner,
  AuthTransitionPhase,
  AuthTransitionStorageState,
};
