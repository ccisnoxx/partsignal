type PendingLock = {
  callback: LockGrantedCallback<unknown>;
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
  signal?: AbortSignal;
};

/** jsdom 尚未实现 Web Locks；此替身只实现应用实际使用的同名 exclusive FIFO 锁。 */
function createTestLockManager(): LockManager {
  const held = new Set<string>();
  const queues = new Map<string, PendingLock[]>();

  const runNext = (name: string) => {
    if (held.has(name)) return;
    const queue = queues.get(name);
    const next = queue?.shift();
    if (!next) {
      queues.delete(name);
      return;
    }
    if (next.signal?.aborted) {
      next.reject(next.signal.reason);
      runNext(name);
      return;
    }
    held.add(name);
    Promise.resolve(next.callback({ mode: 'exclusive', name } as Lock))
      .then(next.resolve, next.reject)
      .finally(() => {
        held.delete(name);
        runNext(name);
      });
  };

  const request = <T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    maybeCallback?: LockGrantedCallback<T>,
  ): Promise<T> => {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (!callback || options.mode === 'shared' || options.ifAvailable || options.steal) {
      return Promise.reject(new Error('测试 Web Locks 仅支持排他的等待式 request'));
    }
    return new Promise<T>((resolve, reject) => {
      const pending: PendingLock = {
        callback: callback as LockGrantedCallback<unknown>,
        reject,
        resolve: resolve as (value: unknown) => void,
        signal: options.signal,
      };
      const queue = queues.get(name) ?? [];
      queue.push(pending);
      queues.set(name, queue);
      options.signal?.addEventListener('abort', () => {
        const index = queue.indexOf(pending);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(options.signal?.reason);
      }, { once: true });
      runNext(name);
    });
  };

  return {
    query: async () => ({
      held: Array.from(held, (name) => ({ mode: 'exclusive' as const, name })),
      pending: Array.from(queues.entries()).flatMap(([name, queue]) => (
        queue.map(() => ({ mode: 'exclusive' as const, name }))
      )),
    }),
    request,
  };
}

export { createTestLockManager };
