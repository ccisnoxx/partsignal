import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { Button } from '@/design-system/primitives/button';
import { BatchCreate } from './batch-create';
import { ManualEditor } from './manual-editor';
import {
  batchDetailOptions,
  batchListOptions,
  runDetailOptions,
  runKeys,
  runListOptions,
  RunRequestError,
} from './runs.api';
import { batchStatusLabels, runSearchSchema, type Batch, type Run, type RunSearch } from './runs.model';
import { BatchSummary, RunDetail } from './run-detail';
import { RunRetry } from './run-retry';
import { RunReview } from './run-review';
import { RunFilters } from './run-filters';
import { BatchTable, RunTable } from './run-list';

type Props = {
  search: RunSearch;
  csrfToken: string | null;
  onSearchChange: (next: RunSearch, replace?: boolean, ignoreBlocker?: boolean) => void;
};
function RunsPage({ search, csrfToken, onSearchChange }: Props) {
  const client = useQueryClient();
  const runs = search.view === 'runs';
  const batches = useQuery(batchListOptions(search, !runs));
  const runList = useQuery(runListOptions(search, runs));
  const batch = useQuery(batchDetailOptions(search.batch_id ?? '', Boolean(search.batch_id)));
  const detail = useQuery(runDetailOptions(search.run_id ?? '', Boolean(search.run_id && !search.edit)));
  const [message, setMessage] = useState('');
  const focusReturn = useRef<HTMLElement | null>(null);
  const change = useCallback(
    (patch: Record<string, unknown>) => onSearchChange(runSearchSchema.parse({ ...search, ...patch })),
    [search, onSearchChange],
  );
  const openBatch = useCallback(
    (item: Batch) => {
      if (document.activeElement instanceof HTMLElement) focusReturn.current = document.activeElement;
      change({
        view: 'runs',
        batch_id: item.id,
        run_id: undefined,
        edit: undefined,
        page: 1,
        q: undefined,
        status: undefined,
      });
    },
    [change],
  );
  const openRun = useCallback(
    (item: Run, edit?: boolean) => {
      if (document.activeElement instanceof HTMLElement) focusReturn.current = document.activeElement;
      change({ run_id: item.id, edit: edit ? 1 : undefined, create: undefined });
    },
    [change],
  );
  function closeRun() {
    change({ run_id: undefined, edit: undefined });
    queueMicrotask(() => {
      if (focusReturn.current?.isConnected) focusReturn.current.focus({ preventScroll: true });
    });
  }
  const currentNavigation = useRef({ search, onSearchChange });
  useLayoutEffect(() => {
    currentNavigation.current = { search, onSearchChange };
  }, [search, onSearchChange]);
  const submitted = useCallback(
    (id: string) => {
      setMessage('原始回答和证据已冻结；采集完成，分析与复核进度以服务端投影为准。');
      void client.invalidateQueries({
        queryKey: runKeys.root(),
        refetchType: 'active',
        predicate: (query) => query.queryKey[2] !== 'manual',
      });
      const current = currentNavigation.current;
      current.onSearchChange(runSearchSchema.parse({ ...current.search, run_id: id, edit: undefined }), true, true);
    },
    [client],
  );
  const list = runs ? runList : batches;
  const total = list.data?.total;
  const size = search.page_size ?? 20;
  const blocked =
    detail.error instanceof RunRequestError &&
    (detail.error.status === 401 || detail.error.status === 403 || detail.error.status === 404);
  return (
    <section aria-labelledby="runs-title" className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="type-page-title" id="runs-title">
            运行中心
          </h1>
          <p className="text-text-secondary">回答级批次、API 自动采集、人工录入与不可变采集证据。</p>
        </div>
        <Button onClick={() => change({ create: 1, run_id: undefined, edit: undefined })} type="button">
          创建运行批次
        </Button>
      </header>
      {message && (
        <p className="text-sm" role="status">
          {message}
        </p>
      )}
      {search.create && (
        <BatchCreate
          csrfToken={csrfToken}
          onClose={() => change({ create: undefined })}
          onCreated={(id) => {
            setMessage('批次已创建；采集方式与执行状态以服务端投影为准。');
            onSearchChange(runSearchSchema.parse({ view: 'runs', batch_id: id }), true, true);
          }}
        />
      )}
      <div aria-label="运行中心视图" className="flex flex-wrap gap-2" role="group">
        <Button
          aria-pressed={!runs}
          onClick={() => change({ view: undefined, batch_id: undefined, page: 1 })}
          type="button"
          variant={!runs ? 'secondary' : 'outline'}
        >
          批次视图
        </Button>
        <Button
          aria-pressed={runs}
          onClick={() => change({ view: 'runs', page: 1 })}
          type="button"
          variant={runs ? 'secondary' : 'outline'}
        >
          运行视图
        </Button>
        <Button onClick={() => void list.refetch()} type="button" variant="outline">
          刷新列表
        </Button>
      </div>
      <RunFilters key={`${search.view ?? 'batches'}:${search.q ?? ''}`} onChange={onSearchChange} search={search} />
      {search.batch_id && (
        <section aria-label="选中批次" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="type-section-title break-all">批次 {search.batch_id}</h2>
            <Button onClick={() => change({ batch_id: undefined, page: 1 })} type="button" variant="outline">
              查看全部运行
            </Button>
          </div>
          {batch.isPending && <p role="status">读取批次摘要…</p>}
          {batch.error && <ReadFailure error={batch.error} onRetry={() => void batch.refetch()} />}
          {batch.data && (
            <>
              <p className="text-sm">
                {batch.data.batch.plan_snapshot.name} · {batchStatusLabels[batch.data.workflow.status]}
              </p>
              <BatchSummary summary={batch.data.summary} />
            </>
          )}
        </section>
      )}
      {list.isFetching && (
        <p className="text-sm" role="status">
          {list.data ? '正在刷新列表…' : '正在读取列表…'}
        </p>
      )}
      {list.error && (
        <ReadFailure error={list.error} onRetry={() => void list.refetch()} retained={Boolean(list.data)} />
      )}
      {runs
        ? runList.data && <RunTable items={runList.data.items} onOpen={openRun} selected={search.run_id} />
        : batches.data && <BatchTable items={batches.data.items} onOpen={openBatch} selected={search.batch_id} />}
      {total !== undefined && (
        <TablePagination
          onPageIndexChange={(index) => change({ page: index + 1 })}
          onPageSizeChange={(size) => change({ page_size: size, page: 1 })}
          pageCount={Math.ceil(total / size)}
          pageIndex={(search.page ?? 1) - 1}
          pageSize={size}
          totalItems={total}
        />
      )}
      {search.run_id && (
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={closeRun} type="button" variant="outline">
              关闭运行详情
            </Button>
          </div>
          {search.edit ? (
            <ManualEditor
              csrfToken={csrfToken}
              key={search.run_id}
              onClose={() => change({ edit: undefined })}
              onSubmitted={submitted}
              runId={search.run_id}
            />
          ) : (
            <>
              {detail.isPending && <p role="status">读取运行详情…</p>}
              {detail.error && (
                <ReadFailure
                  error={detail.error}
                  onRetry={() => void detail.refetch()}
                  retained={Boolean(detail.data)}
                />
              )}
              {detail.data && (
                <RunDetail
                  blocked={blocked}
                  reviewControl={<RunReview blocked={Boolean(detail.error) || detail.isFetching} csrfToken={csrfToken} detail={detail.data} readError={detail.error} />}
                  retryControl={<RunRetry
                    blocked={Boolean(detail.error) || detail.isFetching}
                    csrfToken={csrfToken}
                    detail={detail.data}
                    onCreated={(id) => {
                      setMessage('已显式创建新尝试，原尝试保留。');
                      const current = currentNavigation.current;
                      if (current.search.run_id === detail.data.run.id)
                        current.onSearchChange(runSearchSchema.parse({ ...current.search, run_id: id, edit: undefined }), true);
                    }}
                  />}
                  detail={detail.data}
                  key={detail.data.run.id}
                  onEdit={() => change({ edit: 1 })}
                  onRefreshEvidence={() => void detail.refetch()}
                  onSelectAttempt={(id) => change({ run_id: id, edit: undefined })}
                />
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
function ReadFailure({
  error,
  onRetry,
  retained = false,
}: {
  error: unknown;
  onRetry: () => void;
  retained?: boolean;
}) {
  const unrecoverable =
    error instanceof RunRequestError && (error.status === 401 || error.status === 403 || error.status === 404);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-default p-3 text-sm" role="alert">
      <span>
        {retained ? '刷新失败，保留上次读取结果：' : '读取失败：'}
        {error instanceof Error ? error.message : '未知错误'}
      </span>
      {unrecoverable ? (
        <span>当前资源不可访问，请返回列表或关闭详情。</span>
      ) : (
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          重试读取
        </Button>
      )}
    </div>
  );
}
export { RunsPage };
