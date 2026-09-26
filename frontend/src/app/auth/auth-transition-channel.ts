type AuthTransitionPhase = 'STARTED' | 'SETTLED';

type AuthTransitionMessage = {
  eventId: string;
  leaseExpiresAt: number;
  ownerId: string;
  phase: AuthTransitionPhase;
  transitionId: string;
  version: 2;
};

type AuthTransitionOwner = {
  finish: () => Promise<void>;
  start: () => void;
};

type AuthTransitionChannel = {
  acquire: (transitionId: string) => Promise<AuthTransitionOwner>;
  close: () => void;
};

const authTransitionBroadcastName = 'partsignal.auth-transition.v2';
const authTransitionStorageKey = 'partsignal.auth-transition.v2';
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

function readAuthTransitionMessage(): AuthTransitionMessage | null {
  try {
    return parseAuthTransitionMessage(globalThis.localStorage?.getItem(authTransitionStorageKey));
  } catch {
    return null;
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

function createAuthTransitionChannel(
  onMessage: (message: AuthTransitionMessage) => void,
  onError: (error: unknown) => void,
): AuthTransitionChannel {
  const ownerId = globalThis.crypto.randomUUID();
  const seenEventIds = new Set<string>();
  const recoveryControllers = new Map<string, AbortController>();
  const pendingOwnerRequests = new Set<AbortController>();
  const ownedReleases = new Set<() => void>();
  const ownedStops = new Set<() => void>();
  let closed = false;
  let broadcast: BroadcastChannel | null = null;
  try {
    if (typeof globalThis.BroadcastChannel === 'function') {
      broadcast = new globalThis.BroadcastChannel(authTransitionBroadcastName);
    }
  } catch {
    broadcast = null;
  }

  const remember = (eventId: string) => {
    seenEventIds.add(eventId);
    if (seenEventIds.size <= 64) return;
    const oldest = seenEventIds.values().next().value as string | undefined;
    if (oldest) seenEventIds.delete(oldest);
  };
  const persist = (message: AuthTransitionMessage) => {
    try {
      globalThis.localStorage?.setItem(authTransitionStorageKey, JSON.stringify(message));
      if (globalThis.localStorage === undefined) throw new Error('localStorage unavailable');
    } catch (error) {
      throw new Error('浏览器无法持久化跨标签页认证租约', { cause: error });
    }
  };
  const publish = (message: AuthTransitionMessage, deliverLocally: boolean) => {
    persist(message);
    remember(message.eventId);
    try {
      broadcast?.postMessage(message);
    } catch {
      // durable localStorage marker 仍可通过 storage/focus/visibility 收敛。
    }
    if (deliverLocally) onMessage(message);
  };

  const cancelRecovery = (transitionId: string) => {
    const controller = recoveryControllers.get(transitionId);
    if (!controller) return;
    recoveryControllers.delete(transitionId);
    controller.abort(abortError());
  };

  const recoverOrphan = async (started: AuthTransitionMessage, signal: AbortSignal) => {
    const lockManager = requireLockManager();
    await lockManager.request(
      authTransitionOwnerLockName,
      { mode: 'exclusive', signal },
      async (lock) => {
        if (!lock || closed) return;
        const current = readAuthTransitionMessage();
        if (
          current?.phase !== 'STARTED'
          || current.transitionId !== started.transitionId
          || current.ownerId !== started.ownerId
        ) return;
        // Web Lock 已证明 owner 不再存活；lease 只为已离开页面的网络栈保留
        // 收敛窗口。上限避免系统时钟回拨或损坏 marker 造成新的永久锁死。
        await waitUntil(Math.min(
          current.leaseExpiresAt,
          Date.now() + authTransitionLeaseDurationMs,
        ), signal);
        const expired = readAuthTransitionMessage();
        if (
          expired?.phase !== 'STARTED'
          || expired.transitionId !== started.transitionId
          || expired.ownerId !== started.ownerId
        ) return;
        publish({
          ...expired,
          eventId: globalThis.crypto.randomUUID(),
          phase: 'SETTLED',
        }, true);
      },
    );
  };

  const scheduleRecovery = (message: AuthTransitionMessage) => {
    cancelRecovery(message.transitionId);
    const controller = new AbortController();
    recoveryControllers.set(message.transitionId, controller);
    void recoverOrphan(message, controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted || closed) return;
        onError(error);
      })
      .finally(() => {
        if (recoveryControllers.get(message.transitionId) === controller) {
          recoveryControllers.delete(message.transitionId);
        }
      });
  };

  const accept = (value: unknown) => {
    const message = parseAuthTransitionMessage(value);
    if (!message || seenEventIds.has(message.eventId)) return;
    remember(message.eventId);
    if (message.phase === 'STARTED') scheduleRecovery(message);
    else cancelRecovery(message.transitionId);
    onMessage(message);
  };
  const onBroadcast = (event: MessageEvent<unknown>) => accept(event.data);
  const onStorage = (event: StorageEvent) => {
    if (event.key === authTransitionStorageKey) accept(event.newValue);
  };
  const reconcileStoredMessage = () => accept(readAuthTransitionMessage());
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') reconcileStoredMessage();
  };

  broadcast?.addEventListener('message', onBroadcast);
  globalThis.addEventListener('storage', onStorage);
  globalThis.addEventListener('focus', reconcileStoredMessage);
  document.addEventListener('visibilitychange', onVisibilityChange);
  const baseline = readAuthTransitionMessage();
  if (baseline?.phase === 'STARTED') accept(baseline);
  else if (baseline) remember(baseline.eventId);

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
            publish(started, false);
          } catch (error) {
            finished = true;
            release();
            throw error;
          }
          heartbeat = globalThis.setInterval(() => {
            if (!started || finished || closed) return;
            const current = readAuthTransitionMessage();
            if (
              current?.phase !== 'STARTED'
              || current.eventId !== started.eventId
              || current.ownerId !== ownerId
              || current.transitionId !== transitionId
            ) return;
            started = {
              ...started,
              leaseExpiresAt: Date.now() + authTransitionLeaseDurationMs,
            };
            try {
              persist(started);
            } catch (error) {
              onError(error);
            }
          }, authTransitionLeaseHeartbeatMs);
          ownedStops.add(stopHeartbeat);
        },
        finish: async () => {
          if (finished) return;
          finished = true;
          stopHeartbeat();
          try {
            if (started && !closed) {
              publish({
                ...started,
                eventId: globalThis.crypto.randomUUID(),
                phase: 'SETTLED',
              }, false);
            }
          } finally {
            release();
            await lockPromise;
          }
        },
      };
    },
    close: () => {
      if (closed) return;
      closed = true;
      for (const controller of recoveryControllers.values()) controller.abort(abortError());
      recoveryControllers.clear();
      for (const controller of pendingOwnerRequests) controller.abort(abortError());
      pendingOwnerRequests.clear();
      for (const stop of Array.from(ownedStops)) stop();
      for (const release of Array.from(ownedReleases)) release();
      broadcast?.removeEventListener('message', onBroadcast);
      broadcast?.close();
      globalThis.removeEventListener('storage', onStorage);
      globalThis.removeEventListener('focus', reconcileStoredMessage);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}

export {
  authTransitionStorageKey,
  createAuthTransitionChannel,
  parseAuthTransitionMessage,
  readAuthTransitionMessage,
};
export type {
  AuthTransitionChannel,
  AuthTransitionMessage,
  AuthTransitionOwner,
  AuthTransitionPhase,
};
