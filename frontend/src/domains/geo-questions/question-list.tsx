import { useQuery } from '@tanstack/react-query';
import { createColumnHelper, metaHelper, rowPaginationFeature, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { ColumnHeader } from '@/design-system/data-table/column-header';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { FilterChipsBar, type FilterChipItem } from '@/design-system/data-table/filter-chips';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { TableToolbar } from '@/design-system/data-table/table-toolbar';
import type { ColumnRole } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { MetadataDisclosure } from '@/design-system/primitives/metadata-disclosure';
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
  const chips: FilterChipItem[] = [
    ...(search.q ? [{ key: 'q', label: `搜索：${search.q}`, onRemove: () => change({ q: undefined }) }] : []),
    ...(search.query_topic_id ? [{ key: 'topic', label: `主题：${topics.data?.items.find((item) => item.id === search.query_topic_id)?.canonical_question ?? search.query_topic_id.slice(0, 8)}`, onRemove: () => change({ query_topic_id: undefined }) }] : []),
    ...(search.language_code ? [{ key: 'language_code', label: `语言：${search.language_code}`, onRemove: () => change({ language_code: undefined }) }] : []),
    ...(search.region_code ? [{ key: 'region_code', label: `地区：${search.region_code}`, onRemove: () => change({ region_code: undefined }) }] : []),
    ...(search.intent_type ? [{ key: 'intent_type', label: `意图：${intentLabels[search.intent_type]}`, onRemove: () => change({ intent_type: undefined }) }] : []),
    ...(search.mention_mode ? [{ key: 'mention_mode', label: `点名：${mentionLabels[search.mention_mode]}`, onRemove: () => change({ mention_mode: undefined }) }] : []),
    ...(search.priority ? [{ key: 'priority', label: `优先级：${priorityLabels[search.priority]}`, onRemove: () => change({ priority: undefined }) }] : []),
    ...(search.is_active !== undefined ? [{ key: 'is_active', label: `状态：${search.is_active ? '已启用' : '已停用'}`, onRemove: () => change({ is_active: undefined }) }] : []),
  ];
  return (
    <TableToolbar
      chips={chips.length ? <FilterChipsBar items={chips} onClearAll={() => onChange(questionSearchSchema.parse({ selected: search.selected, new: search.new, copy: search.copy }))} /> : undefined}
    >
      <div className="space-y-3">
        <form aria-label="筛选问题变体" className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (language && !/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(language) || region && !/^[a-zA-Z]{2}$/.test(region)) { setError('请填写合法语言标签和两位地区代码，或留空。'); return; }
          setError(''); change({ q, query_topic_id: topic, language_code: language, region_code: region });
        }}>
          <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 space-y-1 text-sm">搜索完整问题文本<Input maxLength={240} onChange={(event) => setQ(event.target.value)} value={q} /></label><Button type="submit">应用筛选</Button></div>
          <MetadataDisclosure summary="主题、语言和地区筛选">
            <div className="mt-1 grid min-w-0 gap-3 sm:grid-cols-3"><QuestionSelect choices={[{ value: '', label: '全部主题' }, ...(topics.data?.items.map((item) => ({ value: item.id, label: item.canonical_question })) ?? [])]} label="筛选问题主题" onChange={setTopic} value={topic} /><label className="space-y-1 text-sm">筛选语言<Input maxLength={16} onChange={(event) => setLanguage(event.target.value)} value={language} /></label><label className="space-y-1 text-sm">筛选地区<Input maxLength={2} onChange={(event) => setRegion(event.target.value)} value={region} /></label></div>
            {topics.isPending && <p className="mt-2" role="status">正在读取主题筛选…</p>}
            {topics.error && <QuestionNotice error>{questionErrorMessage(topics.error)}<Button onClick={() => void topics.refetch()} type="button" variant="outline">重试主题筛选</Button></QuestionNotice>}
          </MetadataDisclosure>
          {error && <QuestionNotice error>{error}</QuestionNotice>}
        </form>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <QuestionSelect choices={[{ value: '', label: '全部意图' }, ...Object.entries(intentLabels).map(([value, label]) => ({ value, label }))]} label="筛选意图" onChange={(value) => change({ intent_type: value as QuestionSearch['intent_type'] })} value={search.intent_type ?? ''} />
          <QuestionSelect choices={[{ value: '', label: '全部点名属性' }, ...Object.entries(mentionLabels).map(([value, label]) => ({ value, label }))]} label="筛选点名属性" onChange={(value) => change({ mention_mode: value as QuestionSearch['mention_mode'] })} value={search.mention_mode ?? ''} />
          <QuestionSelect choices={[{ value: '', label: '全部优先级' }, ...Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))]} label="筛选优先级" onChange={(value) => change({ priority: value as QuestionSearch['priority'] })} value={search.priority ?? ''} />
          <QuestionSelect choices={[{ value: '', label: '全部启用状态' }, { value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }]} label="筛选启用状态" onChange={(value) => change({ is_active: value === '' ? undefined : value === 'true' })} value={search.is_active === undefined ? '' : String(search.is_active)} />
          <QuestionSelect choices={[{ value: 'UPDATED_DESC', label: '最近更新' }, { value: 'TEXT_ASC', label: '文本升序' }]} label="列表排序" onChange={(value) => change({ sort: value as QuestionSearch['sort'] })} value={search.sort ?? 'UPDATED_DESC'} />
        </div>
      </div>
    </TableToolbar>
  );
}
export { QuestionList };
