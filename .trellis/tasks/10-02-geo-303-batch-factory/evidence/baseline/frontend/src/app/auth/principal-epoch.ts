import type { QueryClient } from '@tanstack/react-query';

type PrincipalIdentity = string | null;

type PrincipalEpochState = {
  commandBarrier: symbol | null;
  epoch: number;
  identity: PrincipalIdentity;
  initialized: boolean;
};

type PrincipalContinuation = {
  assertCurrent: () => void;
  isCurrent: () => boolean;
};

type PrincipalCommandBarrier = {
  assertOwner: () => void;
  release: () => void;
};

const states = new WeakMap<QueryClient, PrincipalEpochState>();

class StalePrincipalContinuationError extends Error {
  constructor() {
    super('认证主体已经变化，已丢弃旧主体的客户端 continuation');
    this.name = 'StalePrincipalContinuationError';
  }
}

class ActivePrincipalCommandError extends Error {
  constructor() {
    super('认证主体正在切换，已阻止新的业务命令');
    this.name = 'ActivePrincipalCommandError';
  }
}

function stateFor(queryClient: QueryClient) {
  const existing = states.get(queryClient);
  if (existing) return existing;
  const created: PrincipalEpochState = {
    commandBarrier: null,
    epoch: 0,
    identity: null,
    initialized: false,
  };
  states.set(queryClient, created);
  return created;
}

function beginPrincipalCommandBarrier(queryClient: QueryClient): PrincipalCommandBarrier {
  const state = stateFor(queryClient);
  if (state.commandBarrier !== null) throw new ActivePrincipalCommandError();
  const token = Symbol('principal-command-barrier');
  state.commandBarrier = token;
  return {
    assertOwner: () => {
      if (stateFor(queryClient).commandBarrier !== token) {
        throw new ActivePrincipalCommandError();
      }
    },
    release: () => {
      const current = stateFor(queryClient);
      if (current.commandBarrier === token) current.commandBarrier = null;
    },
  };
}

function assertPrincipalCommandOpen(queryClient: QueryClient) {
  if (stateFor(queryClient).commandBarrier !== null) {
    throw new ActivePrincipalCommandError();
  }
}

function isPrincipalCommandBlocked(queryClient: QueryClient) {
  return stateFor(queryClient).commandBarrier !== null;
}

function initializePrincipalEpoch(queryClient: QueryClient, identity: PrincipalIdentity) {
  const state = stateFor(queryClient);
  if (state.initialized) return;
  state.identity = identity;
  state.initialized = true;
}

function advancePrincipalEpoch(queryClient: QueryClient, identity: PrincipalIdentity) {
  const state = stateFor(queryClient);
  if (!state.initialized) {
    state.identity = identity;
    state.initialized = true;
    return false;
  }
  if (state.identity === identity) return false;
  state.epoch += 1;
  state.identity = identity;
  return true;
}

function invalidatePrincipalEpoch(queryClient: QueryClient, identity: PrincipalIdentity = null) {
  const state = stateFor(queryClient);
  state.epoch += 1;
  state.identity = identity;
  state.initialized = true;
}

function capturePrincipalContinuation(queryClient: QueryClient): PrincipalContinuation {
  assertPrincipalCommandOpen(queryClient);
  const state = stateFor(queryClient);
  const capturedEpoch = state.epoch;
  const capturedIdentity = state.identity;
  const isCurrent = () => {
    const current = stateFor(queryClient);
    return current.epoch === capturedEpoch && current.identity === capturedIdentity;
  };
  return {
    assertCurrent: () => {
      if (!isCurrent()) throw new StalePrincipalContinuationError();
    },
    isCurrent,
  };
}

function isStalePrincipalContinuationError(error: unknown) {
  return error instanceof StalePrincipalContinuationError;
}

export {
  ActivePrincipalCommandError,
  advancePrincipalEpoch,
  assertPrincipalCommandOpen,
  beginPrincipalCommandBarrier,
  capturePrincipalContinuation,
  initializePrincipalEpoch,
  invalidatePrincipalEpoch,
  isPrincipalCommandBlocked,
  isStalePrincipalContinuationError,
};
export type { PrincipalCommandBarrier, PrincipalContinuation, PrincipalIdentity };
