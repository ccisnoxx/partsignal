import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  columnFilteringFeature,
  createColumnHelper,
  globalFilteringFeature,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  type PaginationState,
  useTable,
} from '@tanstack/react-table';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FormProvider, useFieldArray, useForm, type FieldPath } from 'react-hook-form';

import { ColumnHeader } from '@/design-system/data-table/column-header';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { FilterBar } from '@/design-system/data-table/filter-bar';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { TableToolbar } from '@/design-system/data-table/table-toolbar';
import type { ColumnRole, OverflowRowAction } from '@/design-system/data-table/types';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, FormActions, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { contentKeys } from '@/domains/content/content.api';
import {
  createQueryTopic,
  deleteQueryTopic,
  GeoRequestError,
  geoKeys,
  queryTopicListQueryOptions,
  queryTopicsQueryOptions,
  updateQueryTopic,
} from './geo.api';
import {
  intentLabels,
  intentValues,
  normalizeQueryTopicPageSize,
  queryTopicFormSchema,
  queryTopicFormValues,
  queryTopicObservationHref,
  queryTopicReferenceHrefs,
  queryTopicSortToSorting,
  sortingToQueryTopicSort,
  toQueryTopicCreate,
  toQueryTopicUpdate,
  type QueryTopicFormValues,
  type QueryTopicListItem,
  type QueryTopicSearch,
} from './query-topic-list.model';

type TopicColumnMeta = { role?: ColumnRole };
type EditorTarget = { topic?: QueryTopicListItem; focusReturn: HTMLElement | null };
type ReferenceTarget = { topic: QueryTopicListItem; focusReturn: HTMLElement | null };
type DeleteTarget = {
  id: string;
  question: string;
  revision: number;
  focusReturn: HTMLElement | null;
};

const topicTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  columnMeta: metaHelper<TopicColumnMeta>(),
});

type QueryTopicListPageProps = {
  csrfToken: string | null;
  onSearchChange: (search: QueryTopicSearch) => Promise<void> | void;
  search: QueryTopicSearch;
};

function QueryTopicListPage({
  csrfToken,
  onSearchChange,
  search,
}: QueryTopicListPageProps) {
  const queryClient = useQueryClient();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const topics = useQuery(queryTopicListQueryOptions(search));
  const [editor, setEditor] = useState<EditorTarget>();
  const [referenceTarget, setReferenceTarget] = useState<ReferenceTarget>();
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const rows = topics.data?.items ?? [];
  const total = topics.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);
  const pagination: PaginationState = { pageIndex: search.page - 1, pageSize: search.pageSize };
  const sorting = queryTopicSortToSorting(search.sort);

  function changeSearch(changes: Partial<QueryTopicSearch>, resetPage = true) {
    void onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  async function invalidateConsumers() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: geoKeys.topics() }),
      queryClient.invalidateQueries({ queryKey: geoKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: geoKeys.details() }),
      queryClient.invalidateQueries({ queryKey: geoKeys.correctionContexts() }),
      queryClient.invalidateQueries({ queryKey: contentKeys.details() }),
      queryClient.invalidateQueries({ queryKey: contentKeys.editorContexts() }),
    ]);
  }

  const handleCommand = useCallback((
    command: string,
    topic: QueryTopicListItem,
    focusReturn?: HTMLElement | null,
  ) => {
    if (command === 'edit-topic') {
      setEditor({ topic, focusReturn: focusReturn ?? null });
      return;
    }
    if (command === 'view-references') {
      setReferenceTarget({ topic, focusReturn: focusReturn ?? null });
      return;
    }
    if (command === 'delete-topic') {
      setDeleteTarget({
        id: topic.id,
        question: topic.canonical_question,
        revision: topic.revision,
        focusReturn: focusReturn ?? null,
      });
      return;
    }
    throw new Error(`Query Topics 收到未知页面命令：${command}`);
  }, []);

  const columns = useQueryTopicColumns(handleCommand);
  const table = useTable({
    features: topicTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.id,
    manualFiltering: true,
    manualSorting: true,
    manualPagination: true,
    rowCount: total,
    autoResetPageIndex: false,
    enableSortingRemoval: false,
    state: { globalFilter: search.q ?? '', pagination, sorting },
    onGlobalFilterChange: () => undefined,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater;
      changeSearch({
        page: next.pageIndex + 1,
        pageSize: normalizeQueryTopicPageSize(next.pageSize),
      }, false);
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      changeSearch({ sort: sortingToQueryTopicSort(next) });
    },
  });
  const columnRoles = table.getAllLeafColumns().map((column) => column.columnDef.meta?.role);

  return (
    <section aria-labelledby="query-topic-list-title" className="min-w-0 space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="type-page-title" id="query-topic-list-title">GEO 问题主题</h1>
          <p className="max-w-3xl text-text-secondary">
            管理标准问题与搜索变体，并从服务端权威动作开始一次 GEO 观测。
          </p>
        </div>
        <Button
          onClick={() => setEditor({ focusReturn: createButtonRef.current })}
          ref={createButtonRef}
          type="button"
        >
          创建 Query Topic
        </Button>
      </header>

      {topics.data && topics.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <span>刷新失败，已保留当前列表：{errorMessage(topics.error)}</span>
          <Button onClick={() => void topics.refetch()} size="sm" variant="outline">重试刷新</Button>
        </div>
      )}

      <TableToolbar>
        <QueryTopicFilters
          key={search.q ?? ''}
          onChange={(q) => changeSearch({ q })}
          query={search.q}
        />
      </TableToolbar>

      <TableShell regionLabel="GEO 问题主题列表">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <ColumnHeader
                  key={header.id}
                  onSort={header.column.getCanSort()
                    ? () => header.column.toggleSorting()
                    : undefined}
                  role={header.column.columnDef.meta?.role ?? 'metadata'}
                  sortDirection={header.column.getCanSort()
                    ? header.column.getIsSorted()
                    : false}
                >
                  <table.FlexRender header={header} />
                </ColumnHeader>
              ))}
            </tr>
          ))}
        </thead>
        {topics.isPending ? (
          <TableSkeleton columnRoles={columnRoles} />
        ) : topics.error && !topics.data ? (
          <EmptyTable
            action={<Button onClick={() => void topics.refetch()} variant="outline">重试</Button>}
            colSpan={columns.length}
            description={errorMessage(topics.error)}
            kind="error"
            title="Query Topic 列表加载失败"
          />
        ) : total === 0 ? (
          <EmptyTable
            action={search.q ? (
              <Button onClick={() => changeSearch({ q: undefined })} variant="outline">清除搜索</Button>
            ) : undefined}
            colSpan={columns.length}
            description={search.q ? '没有符合当前搜索条件的 Query Topic。' : '当前还没有 Query Topic。'}
            kind={search.q ? 'filtered-empty' : 'empty'}
            title={search.q ? '未找到匹配主题' : '暂无 Query Topic'}
          />
        ) : rows.length === 0 ? (
          <EmptyTable
            action={(
              <Button onClick={() => changeSearch({ page: pageCount }, false)} variant="outline">
                返回最后一页
              </Button>
            )}
            colSpan={columns.length}
            description="URL 指定的页码已超过当前结果范围。"
            kind="filtered-empty"
            title="当前页已超出范围"
          />
        ) : (
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getAllCells().map((cell) => (
                  <td data-column-role={cell.column.columnDef.meta?.role} key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </TableShell>

      {!topics.isPending && !(topics.error && !topics.data) && (
        <TablePagination
          onPageIndexChange={(pageIndex) => changeSearch({ page: pageIndex + 1 }, false)}
          onPageSizeChange={(pageSize) => changeSearch({
            pageSize: normalizeQueryTopicPageSize(pageSize),
          })}
          pageCount={pageCount}
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          totalItems={total}
        />
      )}

      {editor && (
        <QueryTopicEditorDialog
          csrfToken={csrfToken}
          finalFocus={editor.focusReturn}
          onClose={() => setEditor(undefined)}
          onSaved={async () => {
            setEditor(undefined);
            await invalidateConsumers();
          }}
          queryClient={queryClient}
          topic={editor.topic}
        />
      )}
      <QueryTopicReferencesDialog
        key={referenceTarget?.topic.id ?? 'closed'}
        onClose={() => setReferenceTarget(undefined)}
        target={referenceTarget}
      />
      <QueryTopicDeleteDialog
        csrfToken={csrfToken}
        key={deleteTarget?.id ?? 'closed'}
        onClose={() => setDeleteTarget(undefined)}
        onDeleted={async () => {
          setDeleteTarget(undefined);
          await invalidateConsumers();
          if (rows.length === 1 && search.page > 1) changeSearch({ page: search.page - 1 }, false);
        }}
        queryClient={queryClient}
        target={deleteTarget}
      />
    </section>
  );
}

function useQueryTopicColumns(
  onCommand: (
    command: string,
    topic: QueryTopicListItem,
    focusReturn?: HTMLElement | null,
  ) => void,
) {
  const columnHelper = useMemo(
    () => createColumnHelper<typeof topicTableFeatures, QueryTopicListItem>(),
    [],
  );
  return useMemo(() => columnHelper.columns([
    columnHelper.accessor('canonical_question', {
      header: '标准问题',
      meta: { role: 'primary' },
      cell: ({ getValue }) => <span className="block max-w-xl break-words font-medium">{getValue()}</span>,
    }),
    columnHelper.accessor('intent_type', {
      header: '意图',
      meta: { role: 'status' },
      cell: ({ getValue }) => <Badge variant="secondary">{intentLabels[getValue()]}</Badge>,
    }),
    columnHelper.accessor('variants', {
      header: '变体',
      meta: { role: 'status' },
      enableSorting: false,
      cell: ({ getValue }) => <CompactVariants variants={getValue()} />,
    }),
    columnHelper.accessor('references', {
      header: '业务引用',
      meta: { role: 'status' },
      enableSorting: false,
      cell: ({ getValue }) => <ReferenceSummary references={getValue()} />,
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      meta: { role: 'actions' },
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions
          objectLabel={row.original.canonical_question}
          onCommand={(command, focusReturn) => onCommand(command, row.original, focusReturn)}
          overflow={queryTopicOverflowActions(row.original)}
          primary={{
            key: 'start-observation',
            label: '开始观测',
            intent: 'primary',
            enabled: true,
            href: queryTopicObservationHref(row.original),
          }}
        />
      ),
    }),
  ]), [columnHelper, onCommand]);
}

function queryTopicOverflowActions(topic: QueryTopicListItem): OverflowRowAction[] {
  const actions: OverflowRowAction[] = [];
  if (topic.available_actions.includes('UPDATE')) {
    actions.push({
      key: 'edit',
      label: '编辑',
      intent: 'secondary',
      enabled: true,
      command: 'edit-topic',
      confirmation: 'custom',
    });
  }
  actions.push({
    key: 'references',
    label: '查看删除条件或引用情况',
    intent: 'secondary',
    enabled: true,
    command: 'view-references',
    confirmation: 'custom',
  });
  if (topic.available_actions.includes('DELETE')) {
    actions.push({
      key: 'delete',
      label: '删除',
      intent: 'danger',
      enabled: true,
      command: 'delete-topic',
      confirmation: 'custom',
    });
  }
  return actions;
}

function QueryTopicFilters({
  onChange,
  query,
}: {
  onChange: (query?: string) => void;
  query?: string;
}) {
  const [value, setValue] = useState(query ?? '');
  return (
    <FilterBar
      onQueryChange={setValue}
      onReset={() => {
        setValue('');
        onChange(undefined);
      }}
      onSubmit={() => onChange(value.trim() || undefined)}
      placeholder="搜索标准问题或变体"
      query={value}
      resetDisabled={!value && !query}
      searchLabel="搜索 Query Topic"
    />
  );
}

function CompactVariants({ variants }: { variants: string[] }) {
  const shown = variants.slice(0, 2);
  return (
    <div className="max-w-sm space-y-1 text-sm">
      {shown.map((variant) => <p className="break-words" key={variant}>{variant}</p>)}
      {variants.length > shown.length && (
        <span className="text-xs text-text-muted">+{variants.length - shown.length}</span>
      )}
    </div>
  );
}

function ReferenceSummary({ references }: { references: QueryTopicListItem['references'] }) {
  return (
    <div className="space-y-0.5 whitespace-nowrap text-xs">
      <p>Content Task {references.content_task_count}</p>
      <p>GEO Optimization {references.geo_optimization_count}</p>
      <p>Observation {references.observation_count}</p>
    </div>
  );
}

function QueryTopicEditorDialog({
  csrfToken,
  finalFocus,
  onClose,
  onSaved,
  queryClient,
  topic,
}: {
  csrfToken: string | null;
  finalFocus: HTMLElement | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  queryClient: ReturnType<typeof useQueryClient>;
  topic?: QueryTopicListItem;
}) {
  const [revision, setRevision] = useState(topic?.revision ?? 0);
  const [requestId, setRequestId] = useState<string>();
  const [reloadError, setReloadError] = useState<string>();
  const form = useForm<QueryTopicFormValues>({
    defaultValues: queryTopicFormValues(topic),
    resolver: zodResolver(queryTopicFormSchema),
  });
  const variants = useFieldArray({ control: form.control, name: 'variants' });
  const save = useMutation({
    mutationFn: (values: QueryTopicFormValues) => topic
      ? updateQueryTopic(topic.id, toQueryTopicUpdate(values, revision), csrfToken)
      : createQueryTopic(toQueryTopicCreate(values), csrfToken),
  });

  async function submit(values: QueryTopicFormValues) {
    form.clearErrors();
    setRequestId(undefined);
    save.reset();
    try {
      await save.mutateAsync(values);
      await onSaved();
    } catch (error) {
      const mapped = mapTopicMutationError(error);
      for (const [field, message] of Object.entries(mapped.fields)) {
        form.setError(field as FieldPath<QueryTopicFormValues>, { type: 'server', message });
      }
      if (mapped.formMessage) form.setError('root.server', { type: 'server', message: mapped.formMessage });
      setRequestId(mapped.requestId);
    }
  }

  async function reloadCanonical() {
    if (!topic) return;
    setReloadError(undefined);
    try {
      const full = await queryClient.fetchQuery(queryTopicsQueryOptions());
      const current = full.items.find((item) => item.id === topic.id);
      if (!current) throw new Error('该 Query Topic 已不存在');
      form.reset(queryTopicFormValues(current));
      setRevision(current.revision);
      form.clearErrors();
      save.reset();
      setRequestId(undefined);
    } catch (error) {
      setReloadError(errorMessage(error));
    }
  }

  const revisionConflict = save.error instanceof GeoRequestError && save.error.status === 409;
  const errors = topicFormSummary(form.formState.errors, requestId);
  return (
    <Dialog onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }} open>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" finalFocus={() => finalFocus} showCloseButton={!save.isPending}>
        <DialogHeader>
          <DialogTitle>{topic ? '编辑 Query Topic' : '创建 Query Topic'}</DialogTitle>
          <DialogDescription>
            标准问题、意图和变体由服务端统一规范化；更新使用当前 canonical revision。
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" id="query-topic-form" noValidate onSubmit={form.handleSubmit(submit)}>
            <ErrorSummary errors={errors} />
            {revisionConflict && topic && (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3" role="alert">
                <p>该 Query Topic 已被其他请求修改。当前输入已保留，不会自动重放。</p>
                <Button onClick={() => void reloadCanonical()} type="button" variant="outline">
                  重新读取规范版本
                </Button>
                {reloadError && <p className="text-sm text-destructive">{reloadError}</p>}
              </div>
            )}
            <FormField<QueryTopicFormValues, 'canonical_question'>
              id="query-topic-question"
              label="标准问题"
              name="canonical_question"
              required
              render={(context) => (
                <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={save.isPending} id={context.inputId} />
              )}
            />
            <FormField<QueryTopicFormValues, 'intent_type'>
              id="query-topic-intent"
              label="意图"
              name="intent_type"
              required
              render={(context) => (
                <Select disabled={save.isPending} items={intentValues.map((value) => ({ value, label: intentLabels[value] }))} onValueChange={(value) => value && context.field.onChange(value)} value={context.field.value}>
                  <SelectTrigger aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {intentValues.map((value) => <SelectItem key={value} value={value}>{intentLabels[value]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <fieldset className="space-y-2">
              <legend className="type-label">变体 <span aria-hidden="true">*</span></legend>
              {variants.fields.map((field, index) => (
                <div className="flex items-start gap-2" key={field.id}>
                  <FormField<QueryTopicFormValues, `variants.${number}.value`>
                    id={`query-topic-variant-${index}`}
                    label={`变体 ${index + 1}`}
                    name={`variants.${index}.value`}
                    render={(context) => (
                      <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={save.isPending} id={context.inputId} />
                    )}
                  />
                  <Button disabled={save.isPending || variants.fields.length === 1} onClick={() => variants.remove(index)} type="button" variant="outline">移除</Button>
                </div>
              ))}
              <Button disabled={save.isPending} onClick={() => variants.append({ value: '' })} type="button" variant="outline">添加变体</Button>
            </fieldset>
          </form>
        </FormProvider>
        <DialogFooter>
          <FormActions>
            <DialogClose disabled={save.isPending} render={<Button variant="outline" />}>取消</DialogClose>
            <Button disabled={save.isPending || revisionConflict} form="query-topic-form" type="submit">
              {save.isPending ? '保存中…' : topic ? '保存' : '创建'}
            </Button>
          </FormActions>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QueryTopicReferencesDialog({
  onClose,
  target,
}: {
  onClose: () => void;
  target?: ReferenceTarget;
}) {
  const [finalFocus] = useState(target?.focusReturn ?? null);
  const [open, setOpen] = useState(Boolean(target));
  const hrefs = target ? queryTopicReferenceHrefs(target.topic.id) : undefined;
  return (
    <Dialog
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => { if (!next) onClose(); }}
      open={open}
    >
      <DialogContent finalFocus={() => finalFocus}>
        <DialogHeader>
          <DialogTitle>业务引用与删除条件</DialogTitle>
          <DialogDescription>{target?.topic.canonical_question}</DialogDescription>
        </DialogHeader>
        {target && hrefs && (
          <ul className="space-y-2">
            <ReferenceLink count={target.topic.references.content_task_count} href={hrefs.contentTasks} label="Content Task" />
            <ReferenceLink count={target.topic.references.geo_optimization_count} href={hrefs.geoOptimization} label="GEO Optimization 来源" />
            <ReferenceLink count={target.topic.references.observation_count} href={hrefs.observations} label="Observation" />
          </ul>
        )}
        <p className="text-xs text-text-muted">
          {deletionGuidance(target?.topic)} 执行删除时服务端仍会重新校验。
        </p>
        <DialogFooter><DialogClose render={<Button variant="outline" />}>关闭</DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReferenceLink({ count, href, label }: { count: number; href: string; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-3">
      <span>{label}</span>
      <a className="font-medium text-link hover:underline" href={href}>{count} 条</a>
    </li>
  );
}

function deletionGuidance(topic?: QueryTopicListItem) {
  if (!topic?.deletion) return '服务端未向当前账号提供删除管理上下文。';
  return topic.deletion.blockers.length > 0
    ? '服务端投影当前存在直接引用阻断。'
    : '服务端投影当前没有直接引用阻断。';
}

function QueryTopicDeleteDialog({
  csrfToken,
  onClose,
  onDeleted,
  queryClient,
  target,
}: {
  csrfToken: string | null;
  onClose: () => void;
  onDeleted: () => Promise<void>;
  queryClient: ReturnType<typeof useQueryClient>;
  target?: DeleteTarget;
}) {
  const [finalFocus] = useState(target?.focusReturn ?? null);
  const [open, setOpen] = useState(Boolean(target));
  const [revision, setRevision] = useState(target?.revision ?? 0);
  const [reloadMessage, setReloadMessage] = useState<string>();
  const remove = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('缺少待删除 Query Topic');
      return deleteQueryTopic(target.id, revision, csrfToken);
    },
  });

  async function confirm() {
    try {
      await remove.mutateAsync();
      await onDeleted();
    } catch {
      // mutation.error 负责展示结构化错误，Dialog 保持打开。
    }
  }

  async function reloadCanonical() {
    if (!target) return;
    setReloadMessage(undefined);
    try {
      const full = await queryClient.fetchQuery(queryTopicsQueryOptions());
      const current = full.items.find((item) => item.id === target.id);
      if (!current) {
        setReloadMessage('该 Query Topic 已不存在。');
        return;
      }
      if (!current.available_actions.includes('DELETE')) {
        setReloadMessage('服务端当前不再允许删除；请关闭后查看最新引用条件。');
        await queryClient.invalidateQueries({ queryKey: geoKeys.topicLists() });
        return;
      }
      setRevision(current.revision);
      remove.reset();
      setReloadMessage(`已读取 revision ${current.revision}，请重新确认。`);
    } catch (error) {
      setReloadMessage(errorMessage(error));
    }
  }

  const conflict = remove.error instanceof GeoRequestError && remove.error.status === 409;
  const referenceLinks = queryTopicDeleteReferenceLinks(remove.error, target?.id);
  return (
    <Dialog
      onOpenChange={(next) => { if (!remove.isPending) setOpen(next); }}
      onOpenChangeComplete={(next) => { if (!next) onClose(); }}
      open={open}
    >
      <DialogContent finalFocus={() => finalFocus} showCloseButton={!remove.isPending}>
        <DialogHeader>
          <DialogTitle>删除 Query Topic？</DialogTitle>
          <DialogDescription>
            将删除“{target?.question}”。服务端会使用 expected_revision 重新校验权限与引用。
          </DialogDescription>
        </DialogHeader>
        {remove.error && <p className="text-sm text-destructive" role="alert">{errorMessage(remove.error)}</p>}
        {referenceLinks.length > 0 && (
          <ul className="space-y-2">
            {referenceLinks.map((reference) => (
              <ReferenceLink
                count={reference.count}
                href={reference.href}
                key={reference.type}
                label={reference.label}
              />
            ))}
          </ul>
        )}
        {conflict && (
          <Button onClick={() => void reloadCanonical()} type="button" variant="outline">重新读取规范版本</Button>
        )}
        {reloadMessage && <p className="text-sm text-text-secondary" role="status">{reloadMessage}</p>}
        <DialogFooter>
          <DialogClose disabled={remove.isPending} render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={remove.isPending || conflict} onClick={() => void confirm()} type="button" variant="destructive">
            {remove.isPending ? '删除中…' : '确认删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function queryTopicDeleteReferenceLinks(error: unknown, topicId?: string) {
  if (
    !topicId
    || !(error instanceof GeoRequestError)
    || error.detail?.code !== 'QUERY_TOPIC_IN_USE'
  ) return [];
  const references = error.detail.details.references;
  if (!Array.isArray(references)) return [];
  const hrefs = queryTopicReferenceHrefs(topicId);
  return references.flatMap((reference) => {
    if (!reference || typeof reference !== 'object') return [];
    const type = 'type' in reference ? reference.type : undefined;
    const count = 'count' in reference ? reference.count : undefined;
    if (!Number.isInteger(count) || Number(count) <= 0) return [];
    if (type === 'CONTENT_TASK') {
      return [{ type, count: Number(count), href: hrefs.contentTasks, label: 'Content Task' }];
    }
    if (type === 'GEO_OPTIMIZATION_SOURCE') {
      return [{ type, count: Number(count), href: hrefs.geoOptimization, label: 'GEO Optimization 来源' }];
    }
    if (type === 'GEO_OBSERVATION') {
      return [{ type, count: Number(count), href: hrefs.observations, label: 'Observation' }];
    }
    return [];
  });
}

function mapTopicMutationError(error: unknown) {
  if (!(error instanceof GeoRequestError) || !error.detail) {
    return { fields: {}, formMessage: errorMessage(error) };
  }
  const fields: Record<string, string> = {};
  const issues = error.detail.details.errors;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object' || !('loc' in issue) || !('msg' in issue)) continue;
      const loc = issue.loc;
      const message = issue.msg;
      if (!Array.isArray(loc) || loc[0] !== 'body' || typeof message !== 'string') continue;
      if (loc[1] === 'canonical_question' || loc[1] === 'intent_type') fields[loc[1]] ??= message;
      if (loc[1] === 'variants' && typeof loc[2] === 'number') fields[`variants.${loc[2]}.value`] ??= message;
    }
  }
  return {
    fields,
    formMessage: Object.keys(fields).length === 0 ? error.detail.message : undefined,
    requestId: error.detail.request_id,
  };
}

function topicFormSummary(
  errors: ReturnType<typeof useForm<QueryTopicFormValues>>['formState']['errors'],
  requestId?: string,
) {
  const summary: ErrorSummaryItem[] = [];
  if (errors.canonical_question?.message) summary.push({ id: 'question', fieldId: 'query-topic-question', message: errors.canonical_question.message });
  if (errors.intent_type?.message) summary.push({ id: 'intent', fieldId: 'query-topic-intent', message: errors.intent_type.message });
  if (Array.isArray(errors.variants)) {
    errors.variants.forEach((item, index) => {
      if (item?.value?.message) summary.push({ id: `variant-${index}`, fieldId: `query-topic-variant-${index}`, message: item.value.message });
    });
  }
  if (errors.root?.server?.message) summary.push({ id: 'form', message: errors.root.server.message });
  if (requestId) summary.push({ id: 'request-id', message: `请求 ID：${requestId}` });
  return summary;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { QueryTopicListPage };
export type { QueryTopicListPageProps };
