import { useQuery, type UseQueryResult } from '@tanstack/react-query';

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
import type { components } from '@/shared/api/generated/schema';
import { publishedContentIssueListQueryOptions } from './publication.api';
import {
  issueKindLabels,
  issueStageRegistry,
  issueStatusLabels,
  issueStatusValues,
  normalizeIssuePageSize,
  resolveIssueOverflowActions,
  resolveIssuePrimaryAction,
  type PublishedContentIssueListItem,
  type PublishedContentIssueSearch,
  type PublishedContentIssueStatusFilter,
} from './published-content-issue.model';
import { formatPublicationTime, formatRelativePublicationTime } from './publication-work.model';

type PublishedContentIssueListPageProps = {
  onSearchChange: (search: PublishedContentIssueSearch) => Promise<void> | void;
  search: PublishedContentIssueSearch;
};

type IssueListQuery = UseQueryResult<components['schemas']['PublishedContentIssueList']>;

const issueColumnRoles: ColumnRole[] = [
  'primary', 'metadata', 'status', 'date', 'metadata', 'actions',
];

function PublishedContentIssueListPage({
  onSearchChange,
  search,
}: PublishedContentIssueListPageProps) {
  const issues = useQuery(publishedContentIssueListQueryOptions(search));
  const total = issues.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);

  function changeSearch(changes: Partial<PublishedContentIssueSearch>, resetPage = true) {
    return onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  return (
    <section aria-labelledby="published-content-issues-title" className="space-y-6">
      <header className="space-y-1">
        <h1 className="type-page-title" id="published-content-issues-title">发布内容问题</h1>
        <p className="max-w-3xl text-text-secondary">
          处理公开页面异常、跟进修复任务，并查看不可变的解决历史。
        </p>
      </header>

      <TableToolbar>
        <label className="text-sm font-medium" htmlFor="published-content-issue-status">
          问题状态
          <Select
            items={issueStatusValues.map((value) => ({ value, label: issueStatusLabels[value] }))}
            onValueChange={(value) => value && changeSearch({
              status: value as PublishedContentIssueStatusFilter,
            })}
            value={search.status}
          >
            <SelectTrigger id="published-content-issue-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {issueStatusValues.map((value) => (
                <SelectItem key={value} value={value}>{issueStatusLabels[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </TableToolbar>

      {issues.data && issues.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4" role="alert">
          <p className="text-sm text-danger">刷新失败，已保留当前内容问题列表：{errorMessage(issues.error)}</p>
          <Button onClick={() => void issues.refetch()} size="sm" variant="outline">重试刷新</Button>
        </div>
      )}

      <PublishedContentIssueTable query={issues} search={search} />

      {!issues.isPending && issues.data && (
        <TablePagination
          onPageIndexChange={(pageIndex) => changeSearch({ page: pageIndex + 1 }, false)}
          onPageSizeChange={(pageSize) => changeSearch({ pageSize: normalizeIssuePageSize(pageSize) })}
          pageCount={pageCount}
          pageIndex={search.page - 1}
          pageSize={search.pageSize}
          totalItems={total}
        />
      )}
    </section>
  );
}

function PublishedContentIssueTable({ query, search }: {
  query: IssueListQuery;
  search: PublishedContentIssueSearch;
}) {
  return (
    <TableShell regionLabel="发布内容问题列表">
      <thead>
        <tr>
          <th data-column-role="primary" scope="col">问题</th>
          <th data-column-role="metadata" scope="col">平台</th>
          <th data-column-role="status" scope="col">状态</th>
          <th data-column-role="date" scope="col">打开时间</th>
          <th data-column-role="metadata" scope="col">修复任务</th>
          <th data-column-role="actions" scope="col">操作</th>
        </tr>
      </thead>
      {query.isPending ? (
        <TableSkeleton columnRoles={issueColumnRoles} />
      ) : query.error && !query.data ? (
        <EmptyTable
          action={<Button onClick={() => void query.refetch()} variant="outline">重试</Button>}
          colSpan={6}
          description={errorMessage(query.error)}
          kind="error"
          title="内容问题列表加载失败"
        />
      ) : query.data?.total === 0 ? (
        <EmptyTable
          colSpan={6}
          description={search.status === 'OPEN'
            ? '当前没有待处理的发布内容问题。'
            : `没有${issueStatusLabels[search.status]}记录。`}
          kind={search.status === 'ALL' ? 'empty' : 'filtered-empty'}
          title={search.status === 'OPEN' ? '暂无待处理问题' : '未找到问题'}
        />
      ) : (
        <tbody>{query.data?.items.map((issue) => (
          <PublishedContentIssueRow issue={issue} key={issue.id} />
        ))}</tbody>
      )}
    </TableShell>
  );
}

function PublishedContentIssueRow({ issue }: { issue: PublishedContentIssueListItem }) {
  const stage = issueStageRegistry[issue.workflow_stage];
  return (
    <tr>
      <td data-column-role="primary">
        <div className="min-w-60 max-w-xl space-y-1">
          <a className="block break-words font-medium hover:underline" href={`/publishing/issues/${issue.id}#issue`}>
            {issue.actual_title}
          </a>
          <p className="text-xs text-text-secondary">{issueKindLabels[issue.kind]} · {issue.content_title}</p>
        </div>
      </td>
      <td data-column-role="metadata"><span className="min-w-36">{issue.platform_profile_name}</span></td>
      <td data-column-role="status"><Badge variant={stage.tone}>{stage.label}</Badge></td>
      <td data-column-role="date">
        <time dateTime={issue.opened_at} title={formatPublicationTime(issue.opened_at)}>
          {formatRelativePublicationTime(issue.opened_at)}
        </time>
      </td>
      <td data-column-role="metadata">
        {issue.repair_task_id ? (
          <a className="break-all text-link hover:underline" href={`/content/tasks/${issue.repair_task_id}`}>
            查看修复任务
          </a>
        ) : <span className="text-text-muted">尚未创建</span>}
      </td>
      <td data-column-role="actions">
        <RowActions
          objectLabel={issue.actual_title}
          onCommand={(command) => {
            throw new Error(`内容问题列表收到未实现的命令动作：${command}`);
          }}
          overflow={resolveIssueOverflowActions(issue)}
          primary={resolveIssuePrimaryAction(issue)}
        />
      </td>
    </tr>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { PublishedContentIssueListPage };
export type { PublishedContentIssueListPageProps };
