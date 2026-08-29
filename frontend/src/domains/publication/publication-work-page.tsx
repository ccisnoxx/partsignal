import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';

import { EmptyTable } from '@/design-system/data-table/empty-table';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { TableToolbar } from '@/design-system/data-table/table-toolbar';
import type { ColumnRole } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Skeleton } from '@/design-system/primitives/skeleton';
import type { components } from '@/shared/api/generated/schema';
import {
  publicationKeys,
  publicationReadyItemsQueryOptions,
  publicationSummaryQueryOptions,
  publicationWorkListQueryOptions,
} from './publication.api';
import {
  publicationWorkStatusValues,
  formatPublicationTime,
  formatRelativePublicationTime,
  normalizePublicationWorkPageSize,
  publicationEventRegistry,
  publicationStageRegistry,
  resolvePublicationOverflowActions,
  resolvePublicationPrimaryAction,
  type PublicationReadyItem,
  type PublicationWork,
  type PublicationWorkListItem,
  type PublicationWorkSearch,
} from './publication-work.model';
import { StartPublicationDialog } from './start-publication-dialog';

type PublicationWorkPageProps = {
  csrfToken: string | null;
  onContentProjectionChange: (taskId: string) => Promise<void>;
  onSearchChange: (search: PublicationWorkSearch) => Promise<void> | void;
  search: PublicationWorkSearch;
};

const workColumnRoles: ColumnRole[] = [
  'primary',
  'metadata',
  'status',
  'metadata',
  'date',
  'actions',
];

function PublicationWorkPage({
  csrfToken,
  onContentProjectionChange,
  onSearchChange,
  search,
}: PublicationWorkPageProps) {
  const queryClient = useQueryClient();
  const summary = useQuery(publicationSummaryQueryOptions());
  const ready = useQuery(publicationReadyItemsQueryOptions());
  const works = useQuery(publicationWorkListQueryOptions(search));
  const [createdWorkId, setCreatedWorkId] = useState<string>();
  const total = works.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);

  function changeSearch(changes: Partial<PublicationWorkSearch>, resetPage = true) {
    return onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  async function refreshProjections(taskId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: publicationKeys.summary() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.readyItems() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.workLists() }),
      onContentProjectionChange(taskId),
    ]);
  }

  async function handleCreated(work: PublicationWork) {
    setCreatedWorkId(work.id);
    await changeSearch({ page: 1, status: undefined }, false);
    await refreshProjections(work.task_id);
  }

  async function handleConflict(taskId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: publicationKeys.summary() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.readyItems(), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.workLists() }),
      onContentProjectionChange(taskId),
    ]);
  }

  return (
    <section className="space-y-8" aria-labelledby="publication-work-title">
      <header className="space-y-1">
        <h1 className="type-page-title" id="publication-work-title">发布工作</h1>
        <p className="max-w-3xl text-text-secondary">
          从已批准内容开始发布，并查看进行中或已关闭的发布工作与服务端任务。
        </p>
      </header>

      {createdWorkId && (
        <div
          className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
          role="status"
        >
          已创建发布工作：<span className="font-mono">{createdWorkId}</span>
        </div>
      )}

      <PublicationSummary query={summary} />
      <ReadyQueue
        csrfToken={csrfToken}
        onConflict={handleConflict}
        onCreated={handleCreated}
        query={ready}
      />
      <section className="space-y-4" aria-labelledby="active-publication-work-title">
        <div className="space-y-1">
          <h2 className="type-section-title" id="active-publication-work-title">发布工作列表</h2>
          <p className="text-sm text-text-secondary">默认显示非终态工作，也可按阶段查看已关闭工作。</p>
        </div>
        <PublicationWorkFilters onChange={(status) => changeSearch({ status })} search={search} />
        <PublicationWorkTable
          createdWorkId={createdWorkId}
          onClearFilter={() => changeSearch({ status: undefined })}
          query={works}
          search={search}
        />
        {!works.isPending && !works.error && (
          <TablePagination
            onPageIndexChange={(pageIndex) => changeSearch({ page: pageIndex + 1 }, false)}
            onPageSizeChange={(pageSize) => changeSearch({
              pageSize: normalizePublicationWorkPageSize(pageSize),
            })}
            pageCount={pageCount}
            pageIndex={search.page - 1}
            pageSize={search.pageSize}
            totalItems={total}
          />
        )}
      </section>
    </section>
  );
}

type SummaryQuery = UseQueryResult<components['schemas']['PublicationWorkbenchSummary']>;

function PublicationSummary({ query }: { query: SummaryQuery }) {
  const metrics = query.data ? [
    ['待开始', query.data.ready_count],
    ['进行中', query.data.active_count],
    ['待核验', query.data.awaiting_verification_count],
    ['需处理', query.data.action_required_count],
  ] as const : [];
  return (
    <section className="space-y-3" aria-labelledby="publication-summary-title">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-section-title" id="publication-summary-title">运营摘要</h2>
        {query.error && <Button onClick={() => void query.refetch()} size="sm" variant="outline">重试</Button>}
      </div>
      {query.isPending ? (
        <div aria-busy="true" aria-label="正在读取发布运营摘要" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <Skeleton className="h-24 rounded-xl" key={item} />)}
        </div>
      ) : query.error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          {errorMessage(query.error)}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {metrics.map(([label, value]) => (
            <div className="rounded-xl border border-border-subtle bg-surface-panel p-4" key={label}>
              <dt className="text-sm text-text-secondary">{label}</dt>
              <dd className="mt-2 font-heading text-3xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

type ReadyQuery = UseQueryResult<components['schemas']['PublicationReadyItemList']>;

function ReadyQueue({
  csrfToken,
  onConflict,
  onCreated,
  query,
}: {
  csrfToken: string | null;
  onConflict: (taskId: string) => Promise<void>;
  onCreated: (work: PublicationWork) => Promise<void>;
  query: ReadyQuery;
}) {
  return (
    <section className="space-y-3" aria-labelledby="ready-queue-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="type-section-title" id="ready-queue-title">Ready Queue</h2>
          <p className="mt-1 text-sm text-text-secondary">等待创建发布工作的已批准内容。</p>
        </div>
        {query.error && <Button onClick={() => void query.refetch()} size="sm" variant="outline">重试</Button>}
      </div>
      {query.isPending ? (
        <div aria-busy="true" aria-label="正在读取待开始内容" className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : query.error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          {errorMessage(query.error)}
        </p>
      ) : query.data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center" role="status">
          <h3 className="font-medium">暂无待开始内容</h3>
          <p className="mt-1 text-sm text-text-secondary">当前没有尚未创建发布工作的批准内容。</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {query.data.items.map((item) => (
            <ReadyQueueItem
              csrfToken={csrfToken}
              item={item}
              key={item.content_version.id}
              onConflict={onConflict}
              onCreated={onCreated}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ReadyQueueItem({
  csrfToken,
  item,
  onConflict,
  onCreated,
}: {
  csrfToken: string | null;
  item: PublicationReadyItem;
  onConflict: (taskId: string) => Promise<void>;
  onCreated: (work: PublicationWork) => Promise<void>;
}) {
  const canStart = item.available_actions.includes('START');
  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-xl border border-border-subtle bg-surface-panel p-4">
      <div className="min-w-0 space-y-1">
        <a
          className="block truncate font-heading font-semibold text-text-primary hover:underline"
          href={`/content/versions/${item.content_version.id}`}
        >
          {item.content_version.title}
        </a>
        <p className="text-sm text-text-secondary">
          {item.platform_profile_name} · Approved Content v{item.content_version.version}
        </p>
      </div>
      <div className="text-sm">
        <p className="font-medium">可用账号</p>
        {item.matching_accounts.length > 0 ? (
          <ul className="mt-1 space-y-1 text-text-secondary">
            {item.matching_accounts.map((account) => (
              <li key={account.id}>{account.label} · {account.account_identifier}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-warning" role="status">当前平台暂无可用账号。</p>
        )}
      </div>
      <div className="mt-auto flex justify-end">
        {canStart ? (
          <StartPublicationDialog
            csrfToken={csrfToken}
            item={item}
            onConflict={onConflict}
            onCreated={onCreated}
          />
        ) : (
          <span className="text-sm text-text-muted">当前不可开始</span>
        )}
      </div>
    </article>
  );
}

function PublicationWorkFilters({
  onChange,
  search,
}: {
  onChange: (status: PublicationWorkSearch['status']) => void;
  search: PublicationWorkSearch;
}) {
  const items = [
    { value: 'ALL', label: '全部活动阶段' },
    ...publicationWorkStatusValues.map((value) => ({
      value,
      label: publicationStageRegistry[value].label,
    })),
  ];
  return (
    <TableToolbar>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium" htmlFor="publication-status-filter">当前阶段</label>
        <Select
          items={items}
          onValueChange={(value) => onChange(
            value === 'ALL' || !value ? undefined : value as PublicationWorkSearch['status'],
          )}
          value={search.status ?? 'ALL'}
        >
          <SelectTrigger id="publication-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {search.status && (
          <Button onClick={() => onChange(undefined)} size="sm" type="button" variant="ghost">清除筛选</Button>
        )}
      </div>
    </TableToolbar>
  );
}

type WorkListQuery = UseQueryResult<components['schemas']['PublicationWorkList']>;

function PublicationWorkTable({
  createdWorkId,
  onClearFilter,
  query,
  search,
}: {
  createdWorkId?: string;
  onClearFilter: () => void;
  query: WorkListQuery;
  search: PublicationWorkSearch;
}) {
  const rows = query.data?.items ?? [];
  return (
    <TableShell regionLabel="发布工作列表">
      <thead>
        <tr>
          <th data-column-role="primary" scope="col">内容</th>
          <th data-column-role="metadata" scope="col">平台 / 账号</th>
          <th data-column-role="status" scope="col">当前阶段</th>
          <th data-column-role="metadata" scope="col">最近情况</th>
          <th data-column-role="date" scope="col">更新时间</th>
          <th data-column-role="actions" scope="col">操作</th>
        </tr>
      </thead>
      {query.isPending ? (
        <TableSkeleton columnRoles={workColumnRoles} />
      ) : query.error ? (
        <EmptyTable
          action={<Button onClick={() => void query.refetch()} variant="outline">重试</Button>}
          colSpan={6}
          description={errorMessage(query.error)}
          kind="error"
          title="发布工作列表加载失败"
        />
      ) : query.data.total === 0 ? (
        <EmptyTable
          action={search.status ? <Button onClick={onClearFilter} variant="outline">清除筛选</Button> : undefined}
          colSpan={6}
          description={search.status ? '没有符合当前阶段筛选的发布工作。' : '当前没有活动发布工作。'}
          kind={search.status ? 'filtered-empty' : 'empty'}
          title={search.status ? '未找到匹配工作' : '暂无活动发布工作'}
        />
      ) : (
        <tbody>
          {rows.map((work) => (
            <PublicationWorkRow
              created={work.id === createdWorkId}
              key={work.id}
              work={work}
            />
          ))}
        </tbody>
      )}
    </TableShell>
  );
}

function PublicationWorkRow({ created, work }: { created: boolean; work: PublicationWorkListItem }) {
  const stage = publicationStageRegistry[work.workflow_stage];
  const event = work.latest_event;
  return (
    <tr className={created ? 'bg-success/5' : undefined} data-canonical-work={created || undefined}>
      <td data-column-role="primary">
        <div className="min-w-56 space-y-1">
          <a className="block font-medium hover:underline" href={`/content/versions/${work.content_version_id}`}>
            {work.content_title}
          </a>
          <a className="block text-xs text-text-secondary hover:underline" href={`/products/${work.product.id}`}>
            {work.product.brand} · {work.product.part_number}
          </a>
        </div>
      </td>
      <td data-column-role="metadata">
        <div className="min-w-44 space-y-1">
          <p>{work.platform_profile_name}</p>
          <p className="text-xs text-text-secondary">{work.platform_account_label} · {work.account_identifier}</p>
        </div>
      </td>
      <td data-column-role="status">
        <Badge variant={stage.tone}>{stage.label}</Badge>
      </td>
      <td data-column-role="metadata">
        <div className="min-w-48 space-y-1">
          <p>{publicationEventRegistry[event.action]}</p>
          {event.comment && <p className="line-clamp-2 text-xs text-text-secondary">{event.comment}</p>}
          <time className="block text-xs text-text-muted" dateTime={event.created_at}>
            {formatRelativePublicationTime(event.created_at)}
          </time>
        </div>
      </td>
      <td data-column-role="date">
        <time className="whitespace-nowrap" dateTime={work.updated_at} title={formatPublicationTime(work.updated_at)}>
          {formatRelativePublicationTime(work.updated_at)}
        </time>
      </td>
      <td data-column-role="actions">
        <RowActions
          objectLabel={work.content_title}
          onCommand={(command) => {
            throw new Error(`发布工作列表收到未实现的命令动作：${command}`);
          }}
          overflow={resolvePublicationOverflowActions(work)}
          primary={resolvePublicationPrimaryAction(work)}
        />
      </td>
    </tr>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { PublicationWorkPage };
