import { useQuery } from '@tanstack/react-query';
import { createColumnHelper, metaHelper, rowPaginationFeature, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { ColumnHeader } from '@/design-system/data-table/column-header';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import type { ColumnRole } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { queryTopicsQueryOptions } from '@/domains/geo/geo.api';
import { questionListOptions } from './questions.api';
import { intentLabels, mentionLabels, priorityLabels, questionSearchSchema, stageLabels, type PromptVariant, type QuestionSearch } from './questions.model';
import { parseQuestionCommand, questionOverflow, questionPrimary, type QuestionCommand } from './question-actions';
import { QuestionNotice, QuestionSelect, questionErrorMessage } from './question-controls';

const features = tableFeatures({ rowPaginationFeature, columnMeta: metaHelper<{ role: ColumnRole }>() });
function QuestionList({ search, onChange, onOpen }: {
  search: QuestionSearch; onChange: (next: QuestionSearch) => void;
  onOpen: (variant: PromptVariant, command?: QuestionCommand, focus?: HTMLElement | null) => void;
}) {
  const query = useQuery(questionListOptions(search));
  const columns = useMemo(() => {
    const helper = createColumnHelper<typeof features, PromptVariant>();
    return helper.columns([
      helper.accessor('prompt_text', { header: '问题变体 / 主题', meta: { role: 'primary' }, cell: ({ row }) => <div className="min-w-0 max-w-lg space-y-1"><Button className="h-auto w-full min-w-0 justify-start p-0 text-left" onClick={(event) => onOpen(row.original, undefined, event.currentTarget)} type="button" variant="link"><span className="table-cell-ellipsis">{row.original.prompt_text}</span></Button><p className="table-cell-ellipsis text-xs text-text-muted">{row.original.query_topic.canonical_question} · {intentLabels[row.original.query_topic.intent_type]}</p></div> }),
      helper.display({ id: 'dimensions', header: '提问维度', meta: { role: 'metadata' }, cell: ({ row }) => <div className="text-sm"><p>{mentionLabels[row.original.mention_mode]} · {priorityLabels[row.original.priority]}</p><p>{row.original.language_code} · {row.original.region_code}</p></div> }),
      helper.accessor('workflow_stage', { header: '状态', meta: { role: 'status' }, cell: ({ row, getValue }) => <div className="space-y-1"><Badge variant={getValue() === 'ACTIVE' ? 'success' : 'secondary'}>{stageLabels[getValue()]}</Badge><p className="text-xs">{row.original.is_active ? '启用' : '停用'} · Revision {row.original.revision}</p></div> }),
      helper.accessor('updated_at', { header: '更新时间', meta: { role: 'date' }, cell: ({ getValue }) => <time dateTime={getValue()}>{new Date(getValue()).toLocaleString('zh-CN')}</time> }),
      helper.display({ id: 'actions', header: '操作', meta: { role: 'actions' }, cell: ({ row }) => <RowActions objectLabel={row.original.prompt_text} onCommand={(command, focus) => onOpen(row.original, command === 'VIEW_DELETION_CONDITIONS' ? undefined : parseQuestionCommand(command), focus)} overflow={questionOverflow(row.original)} primary={questionPrimary(row.original)} /> }),
    ]);
  }, [onOpen]);
  const page = search.page ?? 1;
  const size = search.page_size ?? 20;
  const table = useTable({ features, columns, data: query.data?.items ?? [], getRowId: (row) => row.id, rowCount: query.data?.total, manualPagination: true, state: { pagination: { pageIndex: page - 1, pageSize: size } } });
  const filtered = Object.keys(search).some((key) => !['selected', 'new', 'copy', 'page', 'page_size', 'sort'].includes(key));
  return <section aria-label="问题库列表工作区" className="min-w-0 space-y-3">
    <QuestionFilters key={JSON.stringify([search.q, search.query_topic_id, search.language_code, search.region_code])} onChange={onChange} search={search} />
    {query.isFetching && !query.isPending && <p role="status">正在刷新变体列表…</p>}
    {query.error && query.data && <QuestionNotice error>列表刷新失败，保留上次读取结果：{questionErrorMessage(query.error)}<Button onClick={() => void query.refetch()} type="button" variant="outline">重试列表</Button></QuestionNotice>}
    <TableShell regionLabel="问题变体列表">
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <ColumnHeader key={header.id} role={header.column.columnDef.meta?.role ?? 'metadata'}><table.FlexRender header={header} /></ColumnHeader>)}</tr>)}</thead>
      {query.isPending ? <TableSkeleton columnRoles={['primary', 'metadata', 'status', 'date', 'actions']} /> : !query.data ? <EmptyTable action={<Button onClick={() => void query.refetch()} type="button" variant="outline">重试列表</Button>} colSpan={5} description={questionErrorMessage(query.error)} kind="error" title="问题库加载失败" /> : query.data.items.length === 0 ? <EmptyTable action={filtered ? <Button onClick={() => onChange(questionSearchSchema.parse({ selected: search.selected, new: search.new, copy: search.copy }))} type="button" variant="outline">清除筛选</Button> : undefined} colSpan={5} description={filtered ? '请调整筛选条件。' : '请选择问题主题，创建实际提问的文本变体。'} kind={filtered ? 'filtered-empty' : 'empty'} title={filtered ? '未找到匹配变体' : '暂无问题变体'} /> : <tbody>{table.getRowModel().rows.map((row) => <tr aria-selected={search.selected === row.id} key={row.id}>{row.getAllCells().map((cell) => <td className="break-words" data-column-role={cell.column.columnDef.meta?.role} key={cell.id}><table.FlexRender cell={cell} /></td>)}</tr>)}</tbody>}
    </TableShell>
    {query.data && <TablePagination onPageIndexChange={(index) => onChange(questionSearchSchema.parse({ ...search, page: index + 1 }))} onPageSizeChange={(size) => onChange(questionSearchSchema.parse({ ...search, page_size: size, page: 1 }))} pageCount={Math.ceil(query.data.total / size)} pageIndex={page - 1} pageSize={size} totalItems={query.data.total} />}
  </section>;
}
function QuestionFilters({ search, onChange }: { search: QuestionSearch; onChange: (next: QuestionSearch) => void }) {
  const [q, setQ] = useState(search.q ?? '');
  const [topic, setTopic] = useState(search.query_topic_id ?? '');
  const [language, setLanguage] = useState(search.language_code ?? '');
  const [region, setRegion] = useState(search.region_code ?? '');
  const [error, setError] = useState('');
  const topics = useQuery(queryTopicsQueryOptions());
  function change(patch: Partial<QuestionSearch>) { onChange(questionSearchSchema.parse({ ...search, ...patch, page: 1 })); }
  return <div className="space-y-3 rounded-xl border border-border-default bg-surface-panel p-3">
    <form aria-label="筛选问题变体" className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if (language && !/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(language) || region && !/^[a-zA-Z]{2}$/.test(region)) { setError('请填写合法语言标签和两位地区代码，或留空。'); return; }
      setError(''); change({ q, query_topic_id: topic, language_code: language, region_code: region });
    }}>
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 space-y-1 text-sm">搜索完整问题文本<Input maxLength={240} onChange={(event) => setQ(event.target.value)} value={q} /></label><Button type="submit">应用筛选</Button></div>
      <details><summary className="cursor-pointer text-sm text-text-secondary">主题、语言和地区筛选</summary><div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-3"><QuestionSelect choices={[{ value: '', label: '全部主题' }, ...(topics.data?.items.map((item) => ({ value: item.id, label: item.canonical_question })) ?? [])]} label="筛选问题主题" onChange={setTopic} value={topic} /><label className="space-y-1 text-sm">筛选语言<Input maxLength={16} onChange={(event) => setLanguage(event.target.value)} value={language} /></label><label className="space-y-1 text-sm">筛选地区<Input maxLength={2} onChange={(event) => setRegion(event.target.value)} value={region} /></label></div>{topics.isPending && <p role="status">正在读取主题筛选…</p>}{topics.error && <QuestionNotice error>{questionErrorMessage(topics.error)}<Button onClick={() => void topics.refetch()} type="button" variant="outline">重试主题筛选</Button></QuestionNotice>}</details>
      {error && <QuestionNotice error>{error}</QuestionNotice>}
    </form>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <QuestionSelect choices={[{ value: '', label: '全部意图' }, ...Object.entries(intentLabels).map(([value, label]) => ({ value, label }))]} label="筛选意图" onChange={(value) => change({ intent_type: value as QuestionSearch['intent_type'] })} value={search.intent_type ?? ''} />
      <QuestionSelect choices={[{ value: '', label: '全部点名属性' }, ...Object.entries(mentionLabels).map(([value, label]) => ({ value, label }))]} label="筛选点名属性" onChange={(value) => change({ mention_mode: value as QuestionSearch['mention_mode'] })} value={search.mention_mode ?? ''} />
      <QuestionSelect choices={[{ value: '', label: '全部优先级' }, ...Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))]} label="筛选优先级" onChange={(value) => change({ priority: value as QuestionSearch['priority'] })} value={search.priority ?? ''} />
      <QuestionSelect choices={[{ value: '', label: '全部启用状态' }, { value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }]} label="筛选启用状态" onChange={(value) => change({ is_active: value === '' ? undefined : value === 'true' })} value={search.is_active === undefined ? '' : String(search.is_active)} />
      <QuestionSelect choices={[{ value: 'UPDATED_DESC', label: '最近更新' }, { value: 'TEXT_ASC', label: '文本升序' }]} label="列表排序" onChange={(value) => change({ sort: value as QuestionSearch['sort'] })} value={search.sort ?? 'UPDATED_DESC'} />
    </div>
  </div>;
}
export { QuestionList };
