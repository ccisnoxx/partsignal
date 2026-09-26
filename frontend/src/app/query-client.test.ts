import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  advancePrincipalEpoch,
  beginPrincipalCommandBarrier,
  initializePrincipalEpoch,
  isStalePrincipalContinuationError,
} from './auth/principal-epoch';
import { createAppQueryClient } from './query-client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('principal-aware QueryClient', () => {
  it('active principal command barrier 在网络函数前拒绝后来 mutation', async () => {
    const queryClient = createAppQueryClient();
    initializePrincipalEpoch(queryClient, 'admin-1');
    const barrier = beginPrincipalCommandBarrier(queryClient);
    const mutationFn = vi.fn(async () => ({ revision: 2 }));
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn });

    await expect(mutation.execute(undefined)).rejects.toMatchObject({
      name: 'ActivePrincipalCommandError',
    });
    expect(mutationFn).not.toHaveBeenCalled();

    barrier.release();
    await expect(mutation.execute(undefined)).resolves.toEqual({ revision: 2 });
    expect(mutationFn).toHaveBeenCalledOnce();
  });

  it('active principal command barrier 在网络函数前拒绝后来 query，只允许认证收敛读取', async () => {
    const queryClient = createAppQueryClient();
    initializePrincipalEpoch(queryClient, 'admin-1');
    const barrier = beginPrincipalCommandBarrier(queryClient);
    const businessQuery = vi.fn(async () => ({ total: 1 }));
    const authQuery = vi.fn(async () => ({ user: null }));

    await expect(queryClient.fetchQuery({
      queryFn: businessQuery,
      queryKey: ['identity', 'users'],
      retry: false,
    })).rejects.toMatchObject({ name: 'ActivePrincipalCommandError' });
    expect(businessQuery).not.toHaveBeenCalled();

    await expect(queryClient.fetchQuery({
      meta: { authPrincipalBoundary: true },
      queryFn: authQuery,
      queryKey: ['auth', 'session'],
    })).resolves.toEqual({ user: null });
    expect(authQuery).toHaveBeenCalledOnce();

    barrier.release();
    await expect(queryClient.fetchQuery({
      queryFn: businessQuery,
      queryKey: ['identity', 'users'],
    })).resolves.toEqual({ total: 1 });
    expect(businessQuery).toHaveBeenCalledOnce();
  });

  it('主体变化后在 mutation onSuccess 之前拒绝旧 continuation', async () => {
    const queryClient = createAppQueryClient();
    initializePrincipalEpoch(queryClient, 'admin-1');
    const response = deferred<{ revision: number }>();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();
    const mutationFn = vi.fn(() => response.promise);
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn,
      onError,
      onSettled,
      onSuccess,
    });
    const result = mutation.execute(undefined);

    await vi.waitFor(() => expect(mutationFn).toHaveBeenCalledOnce());
    advancePrincipalEpoch(queryClient, 'engineer-1');
    response.resolve({ revision: 2 });

    await expect(result).rejects.toSatisfy(isStalePrincipalContinuationError);
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('主体变化后丢弃旧 mutation 的错误和 settled callback', async () => {
    const queryClient = createAppQueryClient();
    initializePrincipalEpoch(queryClient, 'admin-1');
    const response = deferred<never>();
    const onError = vi.fn();
    const onSettled = vi.fn();
    const mutationFn = vi.fn(() => response.promise);
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn,
      onError,
      onSettled,
    });
    const result = mutation.execute(undefined);

    await vi.waitFor(() => expect(mutationFn).toHaveBeenCalledOnce());
    advancePrincipalEpoch(queryClient, 'engineer-1');
    response.reject(new Error('旧主体请求失败'));

    await expect(result).rejects.toThrow('旧主体请求失败');
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('onMutate 期间主体变化时不向新主体发出旧命令', async () => {
    const queryClient = createAppQueryClient();
    initializePrincipalEpoch(queryClient, 'admin-1');
    const mutationFn = vi.fn(async () => ({ revision: 2 }));
    const onError = vi.fn();
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn,
      onMutate: async () => {
        advancePrincipalEpoch(queryClient, 'engineer-1');
      },
      onError,
    });

    await expect(mutation.execute(undefined)).rejects.toSatisfy(isStalePrincipalContinuationError);
    expect(mutationFn).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('MutationObserver 覆盖 options 且离线恢复后仍不发出旧命令', async () => {
    onlineManager.setOnline(false);
    const queryClient = createAppQueryClient();
    initializePrincipalEpoch(queryClient, 'admin-1');
    const mutationFn = vi.fn(async () => ({ revision: 2 }));
    const onError = vi.fn();
    const onSettled = vi.fn();
    const onSuccess = vi.fn();
    const observer = new MutationObserver(queryClient, {
      mutationFn,
      onError,
      onSettled,
      onSuccess,
    });
    const result = observer.mutate(undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().isPaused).toBe(true));

    advancePrincipalEpoch(queryClient, 'engineer-1');
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'continue') {
        // 精确命中 canRun 已放行、retryer 下一微任务尚未读取 mutationFn 的窗口。
        observer.setOptions({ mutationFn, onError, onSettled, onSuccess });
      }
    });
    onlineManager.setOnline(true);
    await queryClient.resumePausedMutations();
    unsubscribe();

    await expect(result).rejects.toSatisfy(isStalePrincipalContinuationError);
    expect(mutationFn).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('首次失败后主体变化会在 retry 发请求前拒绝旧命令', async () => {
    const queryClient = createAppQueryClient();
    initializePrincipalEpoch(queryClient, 'admin-1');
    const mutationFn = vi.fn(async () => {
      advancePrincipalEpoch(queryClient, 'engineer-1');
      throw new Error('首次请求失败');
    });
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn,
      retry: 1,
      retryDelay: 0,
    });

    await expect(mutation.execute(undefined)).rejects.toSatisfy(isStalePrincipalContinuationError);
    expect(mutationFn).toHaveBeenCalledOnce();
  });

  it('retry pause 的 continue 更新覆盖 options 后仍不发出旧命令', async () => {
    const queryClient = createAppQueryClient();
    initializePrincipalEpoch(queryClient, 'admin-1');
    const mutationFn = vi.fn(async () => {
      onlineManager.setOnline(false);
      throw new Error('首次请求失败');
    });
    const options = { mutationFn, retry: 1, retryDelay: 0 } as const;
    const observer = new MutationObserver(queryClient, options);
    const result = observer.mutate(undefined);
    await vi.waitFor(() => {
      expect(mutationFn).toHaveBeenCalledOnce();
      expect(observer.getCurrentResult().isPaused).toBe(true);
    });

    advancePrincipalEpoch(queryClient, 'engineer-1');
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'continue') {
        observer.setOptions(options);
      }
    });
    onlineManager.setOnline(true);
    await queryClient.resumePausedMutations();
    unsubscribe();

    await expect(result).rejects.toSatisfy(isStalePrincipalContinuationError);
    expect(mutationFn).toHaveBeenCalledOnce();
  });

  it('同一主体 refresh 不影响合法 mutation success', async () => {
    const queryClient = createAppQueryClient();
    initializePrincipalEpoch(queryClient, 'admin-1');
    const onSuccess = vi.fn();
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => ({ revision: 2 }),
      onSuccess,
    });

    expect(advancePrincipalEpoch(queryClient, 'admin-1')).toBe(false);
    await expect(mutation.execute(undefined)).resolves.toEqual({ revision: 2 });
    expect(onSuccess).toHaveBeenCalledWith(
      { revision: 2 },
      undefined,
      undefined,
      expect.objectContaining({ client: queryClient }),
    );
  });
});
