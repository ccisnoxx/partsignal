import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { EmptyTable } from '@/design-system/data-table/empty-table';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { TableToolbar } from '@/design-system/data-table/table-toolbar';
import type { ColumnRole } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import type { components } from '@/shared/api/generated/schema';
import { publishedArticleListQueryOptions } from './publication.api';
import {
  formatPublicationTime,
  formatRelativePublicationTime,
  normalizePublishedArticlePageSize,
  publishedArticleSortLabels,
  publishedArticleSortValues,
  publishedArticleStageRegistry,
  publishedArticleUrlDomain,
  type PublishedArticleListItem,
  type PublishedArticleSearch,
  type PublishedArticleSort,
} from './published-article.model';

type PublishedArticleListPageProps = {
  onSearchChange: (search: PublishedArticleSearch) => Promise<void> | void;
  search: PublishedArticleSearch;
};

type ArticleListQuery = UseQueryResult<components['schemas']['PublishedArticleList']>;

const articleColumnRoles: ColumnRole[] = ['primary', 'metadata', 'date', 'date', 'status'];

function PublishedArticleListPage({ onSearchChange, search }: PublishedArticleListPageProps) {
  const articles = useQuery(publishedArticleListQueryOptions(search));
  const total = articles.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);

  function changeSearch(changes: Partial<PublishedArticleSearch>, resetPage = true) {
    return onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  return (
    <section aria-labelledby="published-articles-title" className="space-y-6">
      <header className="space-y-1">
        <h1 className="type-page-title" id="published-articles-title">发布成果</h1>
        <p className="max-w-3xl text-text-secondary">
          查看首次核验通过后形成的只读发布成果、公开地址与内容健康状态。
        </p>
      </header>

      <PublishedArticleToolbar
        key={search.q ?? ''}
        onChange={changeSearch}
        search={search}
      />

      {articles.data && articles.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4" role="alert">
          <p className="text-sm text-danger">刷新失败，已保留当前发布成果列表：{errorMessage(articles.error)}</p>
          <Button onClick={() => void articles.refetch()} size="sm" variant="outline">重试刷新</Button>
        </div>
      )}

      <PublishedArticleTable
        onClearSearch={() => {
          void changeSearch({ q: undefined });
        }}
        query={articles}
        search={search}
      />

      {!articles.isPending && !articles.error && (
        <TablePagination
          onPageIndexChange={(pageIndex) => changeSearch({ page: pageIndex + 1 }, false)}
          onPageSizeChange={(pageSize) => changeSearch({
            pageSize: normalizePublishedArticlePageSize(pageSize),
          })}
          pageCount={pageCount}
          pageIndex={search.page - 1}
          pageSize={search.pageSize}
          totalItems={total}
        />
      )}
    </section>
  );
}

function PublishedArticleToolbar({
  onChange,
  search,
}: {
  onChange: (changes: Partial<PublishedArticleSearch>) => Promise<void> | void;
  search: PublishedArticleSearch;
}) {
  const [query, setQuery] = useState(search.q ?? '');

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    void onChange({ q: normalized || undefined });
  }

  return (
    <TableToolbar>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <form className="flex min-w-0 flex-1 items-end gap-2" onSubmit={submitSearch}>
          <label className="min-w-0 flex-1 text-sm font-medium" htmlFor="published-article-search">
            搜索发布成果
            <Input
              id="published-article-search"
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="标题、公开 URL、平台或账号"
              value={query}
            />
          </label>
          <Button type="submit">搜索</Button>
          {search.q && (
            <Button onClick={() => void onChange({ q: undefined })} type="button" variant="ghost">
              清除
            </Button>
          )}
        </form>
        <label className="text-sm font-medium" htmlFor="published-article-sort">
          排序
          <Select
            items={publishedArticleSortValues.map((value) => ({
              label: publishedArticleSortLabels[value],
              value,
            }))}
            onValueChange={(value) => value && onChange({
              sort: value === 'VERIFIED_DESC' ? undefined : value as PublishedArticleSort,
            })}
            value={search.sort ?? 'VERIFIED_DESC'}
          >
            <SelectTrigger id="published-article-sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              {publishedArticleSortValues.map((value) => (
                <SelectItem key={value} value={value}>{publishedArticleSortLabels[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </TableToolbar>
  );
}

function PublishedArticleTable({
  onClearSearch,
  query,
  search,
}: {
  onClearSearch: () => void;
  query: ArticleListQuery;
  search: PublishedArticleSearch;
}) {
  return (
    <TableShell regionLabel="发布成果列表">
      <thead>
        <tr>
          <th data-column-role="primary" scope="col">发布内容</th>
          <th data-column-role="metadata" scope="col">平台 / 账号</th>
          <th data-column-role="date" scope="col">发布时间</th>
          <th data-column-role="date" scope="col">首次核验</th>
          <th data-column-role="status" scope="col">内容健康</th>
        </tr>
      </thead>
      {query.isPending ? (
        <TableSkeleton columnRoles={articleColumnRoles} />
      ) : query.error && !query.data ? (
        <EmptyTable
          action={<Button onClick={() => void query.refetch()} variant="outline">重试</Button>}
          colSpan={5}
          description={errorMessage(query.error)}
          kind="error"
          title="发布成果列表加载失败"
        />
      ) : query.data?.total === 0 ? (
        <EmptyTable
          action={search.q ? <Button onClick={onClearSearch} variant="outline">清除搜索</Button> : undefined}
          colSpan={5}
          description={search.q ? '没有符合当前搜索条件的发布成果。' : '首次核验通过后，发布成果会显示在这里。'}
          kind={search.q ? 'filtered-empty' : 'empty'}
          title={search.q ? '未找到匹配成果' : '暂无发布成果'}
        />
      ) : (
        <tbody>{query.data?.items.map((article) => (
          <PublishedArticleRow article={article} key={article.id} />
        ))}</tbody>
      )}
    </TableShell>
  );
}

function PublishedArticleRow({ article }: { article: PublishedArticleListItem }) {
  const stage = publishedArticleStageRegistry[article.workflow_stage];
  return (
    <tr>
      <td data-column-role="primary">
        <div className="min-w-60 max-w-xl space-y-1">
          <a className="block break-words font-medium hover:underline" href={`/publishing/articles/${article.id}`}>
            {article.actual_title}
          </a>
          <a
            className="block truncate text-xs text-link hover:underline"
            href={article.final_url}
            rel="noreferrer"
            target="_blank"
          >
            {publishedArticleUrlDomain(article.final_url)}
          </a>
        </div>
      </td>
      <td data-column-role="metadata">
        <div className="min-w-44 space-y-1">
          <p>{article.platform_profile_name}</p>
          <p className="break-words text-xs text-text-secondary">
            {article.platform_account_label} · {article.account_identifier}
          </p>
        </div>
      </td>
      <td data-column-role="date">
        <time dateTime={article.published_at} title={formatPublicationTime(article.published_at)}>
          {formatRelativePublicationTime(article.published_at)}
        </time>
      </td>
      <td data-column-role="date">
        <div className="space-y-1">
          <Badge variant="success">Passed</Badge>
          <time className="block whitespace-nowrap text-xs" dateTime={article.verified_at}>
            {formatPublicationTime(article.verified_at)}
          </time>
        </div>
      </td>
      <td data-column-role="status"><Badge variant={stage.tone}>{stage.label}</Badge></td>
    </tr>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { PublishedArticleListPage };
export type { PublishedArticleListPageProps };
