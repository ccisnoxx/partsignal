import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import { PlanRequestError, planDetailOptions, planListOptions } from '@/domains/geo-plans/plans.api';
import { RunRequestError, runKeys, runPlanNow } from './runs.api';

type Plan = components['schemas']['GeoMonitoringPlanDetail'];
function BatchCreate({
  csrfToken,
  planId,
  onPlanChange,
  onCreated,
  onClose,
}: {
  csrfToken: string | null;
  planId?: string;
  onPlanChange: (id: string | undefined) => void;
  onCreated: (id: string, planId: string) => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const plans = useQuery(planListOptions({ schedule_kind: 'MANUAL_ONLY', q: filter || undefined, page: page > 1 ? page : undefined }));
  const plan = useQuery({
    ...planDetailOptions(planId ?? '', Boolean(planId)),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [held, setHeld] = useState(false);
  const [request, setRequest] = useState<{ plan: Plan; key: string; owner: PrincipalContinuation }>();
  // 未确认的写请求保留当时的矩阵与修订；Query刷新不能改写其幂等身份。
  const selected = request?.plan ?? plan.data;
  const unsupported = Boolean(selected && selected.schedule_kind !== 'MANUAL_ONLY');
  const readBlocked = plan.isFetching || plan.isError;
  const inaccessible = plan.error instanceof PlanRequestError && [401, 403, 404].includes(plan.error.status ?? 0);
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function create() {
    if (working.current || !selected || inaccessible || unsupported || held || (!request && readBlocked) || !csrfToken) return;
    const continuation = capturePrincipalContinuation(client);
    working.current = true;
    setPending(true);
    setError(undefined);
    const attempt = request ?? {
      plan: selected,
      key: crypto.randomUUID(),
      owner: continuation,
    };
    setRequest(attempt);
    try {
      attempt.owner.assertCurrent();
      continuation.assertCurrent();
      const result = await runPlanNow(attempt.plan.id, attempt.plan.revision, attempt.key, csrfToken);
      if (!mounted.current || !continuation.isCurrent()) return;
      setRequest(undefined);
      await client.cancelQueries({ queryKey: runKeys.root() });
      continuation.assertCurrent();
      if (!mounted.current) return;
      void client.invalidateQueries({ queryKey: runKeys.root() });
      onCreated(result.batch_id, attempt.plan.id);
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
    if (!planId || working.current) return;
    const continuation = capturePrincipalContinuation(client);
    working.current = true;
    setPending(true);
    try {
      await client.fetchQuery({ ...planDetailOptions(planId), staleTime: 0 });
      if (!mounted.current || !continuation.isCurrent()) return;
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
          (current.search as { create?: number }).create !== (next.search as { create?: number }).create ||
          (current.search as { plan_id?: string }).plan_id !== (next.search as { plan_id?: string }).plan_id
        }
        when={Boolean(request) || pending}
      />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="type-section-title">从现有计划创建批次</h2>
        <Button disabled={pending} onClick={onClose} type="button" variant="outline">
          关闭批次创建
        </Button>
      </header>
      <p className="text-sm text-text-secondary">
        此入口从现有人工计划创建批次；CRON 调度请在监测计划页面查看。创建时冻结当前计划和全部运行输入。人工模式等待录入；API 模式由 Worker 执行，服务端会重新检查开关、批准、预算和当前配置资格。
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
              aria-pressed={planId === plan.id}
              className="h-auto w-full justify-start whitespace-normal text-left"
              disabled={pending || Boolean(request) || plan.workflow_stage === 'UNSUPPORTED_SCHEDULE'}
              onClick={() => {
                onPlanChange(plan.id);
              }}
              type="button"
              variant={selected?.id === plan.id ? 'secondary' : 'outline'}
            >
              {plan.name} · Revision {plan.revision} · {plan.preview.run_count} 次运行
              {plan.workflow_stage === 'UNSUPPORTED_SCHEDULE' && ' · 历史只读，V1.0 不支持调度'}
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
      {planId && plan.isFetching && <p role="status">正在读取所选计划及当前矩阵…</p>}
      {planId && plan.error && (
        <div className="space-y-2 text-sm" role="alert">
          <p>无法读取所选计划 {planId}：{message(plan.error)}。不会自动改选其他计划。</p>
          {!inaccessible && <Button disabled={pending} onClick={() => void plan.refetch()} type="button" variant="outline">重新读取所选计划</Button>}
          <Button disabled={pending || Boolean(request)} onClick={() => onPlanChange(undefined)} type="button" variant="outline">清除计划并重新选择</Button>
        </div>
      )}
      {selected && !inaccessible && (
        <div className="space-y-2 text-sm">
          <p>
            已选择：{selected.name} · Revision {selected.revision}。
          </p>
          <p>
            服务端矩阵：{selected.preview.prompt_count} × {selected.preview.profile_count} × {selected.preview.repeat_count} = {selected.preview.run_count} 次；人工 {selected.preview.manual_run_count} 次，API {selected.preview.api_run_count} 次。
          </p>
          {selected.preview.blockers.map((blocker, index) => (
            <p className="text-danger" key={index}>
              当前配置阻断：{blocker.code}
            </p>
          ))}
        </div>
      )}
      {unsupported && !inaccessible && <p role="status">此入口仅支持人工计划；CRON 计划请返回监测计划查看调度信息。</p>}
      {Boolean(error) && (
        <p className="text-sm text-danger" role="alert">
          {message(error)}
          {inaccessible
            ? ' 当前计划不可访问，已停止确认操作；原请求仍在本页保留。'
            : request
            ? ' 结果尚未确认；再次点击会使用原请求和同一幂等键确认，不会自动重发。'
            : ' 输入已保留，请重新读取计划再确认。'}
        </p>
      )}
      {held && !inaccessible && (
        <Button disabled={pending} onClick={() => void reload()} type="button" variant="outline">
          重新读取计划并确认
        </Button>
      )}
      {!inaccessible && (
        <Button disabled={!selected || unsupported || pending || held || (!request && readBlocked) || !csrfToken} onClick={() => void create()} type="button">
          {pending ? '创建中…' : request ? '确认原批次创建结果' : '确认创建批次'}
        </Button>
      )}
    </section>
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : '读取或操作失败';
}
export { BatchCreate };
