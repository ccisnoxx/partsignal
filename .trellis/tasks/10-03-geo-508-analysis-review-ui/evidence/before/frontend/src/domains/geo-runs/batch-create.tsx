import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import { planDetailOptions, planListOptions } from '@/domains/geo-plans/plans.api';
import { RunRequestError, runKeys, runPlanNow } from './runs.api';

type Plan = components['schemas']['GeoMonitoringPlanDetail'];
function BatchCreate({
  csrfToken,
  onCreated,
  onClose,
}: {
  csrfToken: string | null;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const plans = useQuery(planListOptions({ q: filter || undefined, page: page > 1 ? page : undefined }));
  const [selected, setSelected] = useState<Plan>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [held, setHeld] = useState(false);
  const [request, setRequest] = useState<{ id: string; revision: number; key: string; owner: PrincipalContinuation }>();
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function create() {
    if (working.current || !selected || held || !csrfToken) return;
    const continuation = capturePrincipalContinuation(client);
    working.current = true;
    setPending(true);
    setError(undefined);
    const attempt = request ?? {
      id: selected.id,
      revision: selected.revision,
      key: crypto.randomUUID(),
      owner: continuation,
    };
    setRequest(attempt);
    try {
      attempt.owner.assertCurrent();
      continuation.assertCurrent();
      const result = await runPlanNow(attempt.id, attempt.revision, attempt.key, csrfToken);
      if (!mounted.current || !continuation.isCurrent()) return;
      setRequest(undefined);
      setSelected(undefined);
      await client.cancelQueries({ queryKey: runKeys.root() });
      continuation.assertCurrent();
      void client.invalidateQueries({ queryKey: runKeys.root() });
      onCreated(result.batch_id);
    } catch (failure) {
      if (!mounted.current || !continuation.isCurrent()) return;
      setError(failure);
      if (failure instanceof RunRequestError && failure.status && failure.status < 500 && failure.detail) {
        setHeld(true);
        setRequest(undefined);
      }
    } finally {
      if (mounted.current && continuation.isCurrent()) {
        working.current = false;
        setPending(false);
      }
    }
  }
  async function reload() {
    if (!selected || working.current) return;
    const continuation = capturePrincipalContinuation(client);
    working.current = true;
    setPending(true);
    try {
      const result = await client.fetchQuery({ ...planDetailOptions(selected.id), staleTime: 0 });
      if (!mounted.current || !continuation.isCurrent()) return;
      setSelected(result);
      setHeld(false);
      setError(undefined);
    } catch (failure) {
      if (mounted.current && continuation.isCurrent()) setError(failure);
    } finally {
      if (mounted.current && continuation.isCurrent()) {
        working.current = false;
        setPending(false);
      }
    }
  }
  return (
    <section
      aria-label="创建运行批次"
      className="min-w-0 space-y-4 rounded-xl border border-border-default bg-surface-panel p-4"
    >
      <DirtyGuard
        shouldBlockNavigation={({ current, next }) =>
          current.pathname !== next.pathname ||
          (current.search as { create?: number }).create !== (next.search as { create?: number }).create
        }
        when={Boolean(selected) || pending}
      />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="type-section-title">从现有计划创建批次</h2>
        <Button disabled={pending} onClick={onClose} type="button" variant="outline">
          关闭批次创建
        </Button>
      </header>
      <p className="text-sm text-text-secondary">
        创建时冻结当前计划和全部运行输入。人工模式等待录入；API 模式由 Worker 执行，服务端会重新检查开关、批准、预算和当前配置资格。
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter(q.trim());
          setPage(1);
        }}
      >
        <label className="min-w-0 flex-1 space-y-1 text-sm">
          搜索可选计划
          <Input maxLength={200} onChange={(event) => setQ(event.target.value)} value={q} />
        </label>
        <Button type="submit" variant="outline">
          搜索计划
        </Button>
      </form>
      {plans.isPending && <p role="status">读取计划…</p>}
      {plans.error && (
        <p className="text-sm text-danger" role="alert">
          {message(plans.error)}
          <Button onClick={() => void plans.refetch()} type="button" variant="outline">
            重试计划列表
          </Button>
        </p>
      )}
      <ul className="space-y-2">
        {plans.data?.items.map((plan) => (
          <li key={plan.id}>
            <Button
              aria-pressed={selected?.id === plan.id}
              className="h-auto w-full justify-start whitespace-normal text-left"
              disabled={pending || Boolean(request)}
              onClick={() => {
                setSelected(plan);
                setRequest(undefined);
                setHeld(false);
                setError(undefined);
              }}
              type="button"
              variant={selected?.id === plan.id ? 'secondary' : 'outline'}
            >
              {plan.name} · Revision {plan.revision} · {plan.preview.run_count} 次运行
            </Button>
          </li>
        ))}
      </ul>
      {plans.data && !plans.data.items.length && (
        <p className="text-sm">未找到计划，请调整搜索或在监测计划页面创建配置。</p>
      )}
      {plans.data && (
        <TablePagination
          onPageIndexChange={(index) => setPage(index + 1)}
          onPageSizeChange={() => {}}
          pageCount={Math.ceil(plans.data.total / 20)}
          pageIndex={page - 1}
          pageSize={20}
          pageSizeOptions={[20]}
          totalItems={plans.data.total}
        />
      )}
      {selected && (
        <div className="space-y-2 text-sm">
          <p>
            已选择：{selected.name} · Revision {selected.revision}。服务端预览：{selected.preview.run_count} 次，人工{' '}
            {selected.preview.manual_run_count} 次。
          </p>
          {selected.preview.blockers.map((blocker, index) => (
            <p className="text-danger" key={index}>
              当前配置阻断：{blocker.code}
            </p>
          ))}
        </div>
      )}
      {Boolean(error) && (
        <p className="text-sm text-danger" role="alert">
          {message(error)}
          {request
            ? ' 结果尚未确认；再次点击会使用原请求和同一幂等键确认，不会自动重发。'
            : ' 输入已保留，请重新读取计划再确认。'}
        </p>
      )}
      {held && (
        <Button disabled={pending} onClick={() => void reload()} type="button" variant="outline">
          重新读取计划并确认
        </Button>
      )}
      <Button disabled={!selected || pending || held || !csrfToken} onClick={() => void create()} type="button">
        {pending ? '创建中…' : request ? '确认原批次创建结果' : '确认创建批次'}
      </Button>
    </section>
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : '读取或操作失败';
}
export { BatchCreate };
