import {
  Mutation,
  MutationCache,
  Query,
  QueryCache,
  QueryClient,
  type DefaultError,
  type MutationOptions,
  type MutationState,
  type QueryKey,
  type QueryOptions,
  type QueryState,
  type WithRequired,
} from '@tanstack/react-query';

import {
  assertPrincipalCommandOpen,
  capturePrincipalContinuation,
  type PrincipalContinuation,
} from './auth/principal-epoch';

type AnyMutation = Parameters<MutationCache['canRun']>[0];

const mutationContinuations = new WeakMap<AnyMutation, PrincipalContinuation>();
const installedMutationFns = new WeakMap<AnyMutation, unknown>();
const installedQueryFns = new WeakMap<object, unknown>();

class PrincipalQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> extends Query<TQueryFnData, TError, TData, TQueryKey> {
  override setOptions(options?: QueryOptions<TQueryFnData, TError, TData, TQueryKey>) {
    const queryFn = options?.queryFn;
    if (
      typeof queryFn !== 'function'
      || installedQueryFns.get(this) === queryFn
      || options?.meta?.authSessionReconciliation === true
    ) {
      super.setOptions(options);
      return;
    }
    const guardedQueryFn: typeof queryFn = (context) => {
      assertPrincipalCommandOpen(context.client);
      return queryFn(context);
    };
    installedQueryFns.set(this, guardedQueryFn);
    super.setOptions({ ...options, queryFn: guardedQueryFn });
  }
}

class PrincipalQueryCache extends QueryCache {
  override build<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    client: QueryClient,
    options: WithRequired<QueryOptions<TQueryFnData, TError, TData, TQueryKey>, 'queryKey'>,
    state?: QueryState<TData, TError>,
  ): Query<TQueryFnData, TError, TData, TQueryKey> {
    const defaulted = client.defaultQueryOptions(options);
    const queryHash = defaulted.queryHash;
    let query = this.get<TQueryFnData, TError, TData, TQueryKey>(queryHash);
    if (!query) {
      query = new PrincipalQuery({
        client,
        defaultOptions: client.getQueryDefaults(options.queryKey),
        options: defaulted,
        queryHash,
        queryKey: options.queryKey,
        state,
      });
      this.add(query);
    }
    return query;
  }
}

class PrincipalMutation<
  TData = unknown,
  TError = DefaultError,
  TVariables = unknown,
  TOnMutateResult = unknown,
> extends Mutation<TData, TError, TVariables, TOnMutateResult> {
  override setOptions(options: MutationOptions<TData, TError, TVariables, TOnMutateResult>) {
    const mutationFn = options.mutationFn;
    if (!mutationFn || installedMutationFns.get(this) === mutationFn) {
      super.setOptions(options);
      return;
    }

    // MutationObserver 会在 pending render、离线恢复和 retry 期间反复覆盖
    // Mutation.options。由 Mutation 自身同步包装每一次 options 写入，确保
    // canRun 与 retryer 动态读取 mutationFn 之间也不存在原函数窗口。
    const guardedMutationFn: typeof mutationFn = (variables, context) => {
      // 页面命令的 continuation 在 MutationCache.onMutate 中、进入
      // retryer/offline pause 之前绑定。MutationObserver 后续覆盖 options 时，
      // 每一次实际执行仍必须使用同一个发起主体 fence。
      assertPrincipalCommandOpen(context.client);
      mutationContinuations.get(this)?.assertCurrent();
      return mutationFn(variables, context);
    };
    installedMutationFns.set(this, guardedMutationFn);
    super.setOptions({ ...options, mutationFn: guardedMutationFn });
  }
}

function discardStaleMutationCallbacks(mutation: AnyMutation) {
  const continuation = mutationContinuations.get(mutation);
  if (!continuation || continuation.isCurrent()) return false;
  // TanStack Query 会把全局 onSuccess 抛出的 stale 错误继续交给 mutation 自身的
  // onError/onSettled；先移除这些旧主体 callback，避免它们转而刷新新主体缓存。
  mutation.setOptions({
    ...mutation.options,
    onError: undefined,
    onSettled: undefined,
    onSuccess: undefined,
  });
  return true;
}

class PrincipalMutationCache extends MutationCache {
  private mutationId = 0;

  override build<TData, TError, TVariables, TOnMutateResult>(
    client: QueryClient,
    options: MutationOptions<TData, TError, TVariables, TOnMutateResult>,
    state?: MutationState<TData, TError, TVariables, TOnMutateResult>,
  ): Mutation<TData, TError, TVariables, TOnMutateResult> {
    const mutation: Mutation<TData, TError, TVariables, TOnMutateResult> = new PrincipalMutation({
      client,
      mutationCache: this,
      mutationId: ++this.mutationId,
      options: client.defaultMutationOptions(options),
      state,
    });
    this.add(mutation);
    return mutation;
  }

  override canRun(mutation: AnyMutation) {
    if (!super.canRun(mutation)) return false;
    mutation.setOptions(mutation.options);
    return true;
  }
}

function createAppQueryClient() {
  const mutationCache = new PrincipalMutationCache({
    onMutate: (_variables, mutation, context) => {
      // 仅 AuthProvider 内部 terminal/canonical reconciliation owner 可以
      // 跨越自己提交的 principal epoch。页面权限命令不得使用此豁免。
      if (mutation.meta?.authProviderReconciliationOwner === true) return;
      const continuation = capturePrincipalContinuation(context.client);
      mutationContinuations.set(mutation, continuation);
      mutation.setOptions(mutation.options);
    },
    onSuccess: (_data, _variables, _onMutateResult, mutation) => {
      // principal command 可能由 AuthProvider 合法提交新 epoch；它们的
      // 成功 continuation 由页面使用 Provider 返回的 canonical 结果守卫。
      // 这不影响 mutationFn 前的全局发起 continuation fence。
      if (mutation.meta?.authPrincipalCommand === true) return;
      discardStaleMutationCallbacks(mutation);
      mutationContinuations.get(mutation)?.assertCurrent();
    },
    onError: (_error, _variables, _onMutateResult, mutation) => {
      discardStaleMutationCallbacks(mutation);
    },
    onSettled: (_data, error, _variables, _onMutateResult, mutation) => {
      if (!error && mutation.meta?.authPrincipalCommand !== true) {
        mutationContinuations.get(mutation)?.assertCurrent();
      }
    },
  });
  return new QueryClient({ mutationCache, queryCache: new PrincipalQueryCache() });
}

export const queryClient = createAppQueryClient();
export { createAppQueryClient };
