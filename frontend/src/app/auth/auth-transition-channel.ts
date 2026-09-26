type AuthTransitionPhase = 'STARTED' | 'SETTLED';

type AuthTransitionMessage = {
  eventId: string;
  phase: AuthTransitionPhase;
  transitionId: string;
  version: 1;
};

type AuthTransitionChannel = {
  close: () => void;
  publish: (transitionId: string, phase: AuthTransitionPhase) => void;
};

const authTransitionBroadcastName = 'partsignal.auth-transition.v1';
const authTransitionStorageKey = 'partsignal.auth-transition.v1';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    record.version !== 1
    || (record.phase !== 'STARTED' && record.phase !== 'SETTLED')
    || typeof record.eventId !== 'string'
    || typeof record.transitionId !== 'string'
    || !uuidPattern.test(record.eventId)
    || !uuidPattern.test(record.transitionId)
  ) return null;
  return {
    eventId: record.eventId,
    phase: record.phase,
    transitionId: record.transitionId,
    version: 1,
  };
}

function readAuthTransitionMessage(): AuthTransitionMessage | null {
  try {
    return parseAuthTransitionMessage(globalThis.localStorage?.getItem(authTransitionStorageKey));
  } catch {
    return null;
  }
}

function createAuthTransitionChannel(
  onMessage: (message: AuthTransitionMessage) => void,
): AuthTransitionChannel {
  const seenEventIds = new Set<string>();
  const baseline = readAuthTransitionMessage();
  if (baseline) seenEventIds.add(baseline.eventId);

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
  const accept = (value: unknown) => {
    const message = parseAuthTransitionMessage(value);
    if (!message || seenEventIds.has(message.eventId)) return;
    remember(message.eventId);
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

  return {
    close: () => {
      broadcast?.removeEventListener('message', onBroadcast);
      broadcast?.close();
      globalThis.removeEventListener('storage', onStorage);
      globalThis.removeEventListener('focus', reconcileStoredMessage);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
    publish: (transitionId, phase) => {
      const message: AuthTransitionMessage = {
        eventId: globalThis.crypto.randomUUID(),
        phase,
        transitionId,
        version: 1,
      };
      remember(message.eventId);
      let published = false;
      try {
        broadcast?.postMessage(message);
        published = broadcast !== null;
      } catch {
        // localStorage 仍可作为同源降级 transport。
      }
      try {
        globalThis.localStorage?.setItem(authTransitionStorageKey, JSON.stringify(message));
        published = globalThis.localStorage !== undefined;
      } catch {
        // BroadcastChannel 已成功时不降低认证命令可用性。
      }
      if (!published) throw new Error('浏览器无法同步跨标签页认证状态');
    },
  };
}

export {
  authTransitionStorageKey,
  createAuthTransitionChannel,
  readAuthTransitionMessage,
};
export type { AuthTransitionChannel, AuthTransitionMessage, AuthTransitionPhase };
