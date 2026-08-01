/** GEO 观测记录工作台：服务端筛选、统计、分页与 URL 驱动详情均共享同一查询口径。 */
import {
  CheckCircleOutlined, DeleteOutlined, DownOutlined, EyeOutlined, FileSearchOutlined, PlusOutlined, ReloadOutlined,
  SearchOutlined, SettingOutlined, SortAscendingOutlined, SortDescendingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Checkbox, Dropdown, Input, Select, Space, Switch, Table, Tag, Tooltip,
  type TableColumnsType,
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  geoMetricsQueryOptions,
  geoObservationsQueryOptions,
  productsQueryOptions,
  queryTopicsQueryOptions,
} from '../../shared/api/queryOptions';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { GeoMetricsQuery, GeoObservation, GeoObservationListQuery, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableCellText } from '../../shared/components/TableCellText';
import { TableRegion } from '../../shared/components/TableRegion';
import { useFocusReturn } from '../../shared/hooks/useFocusReturn';
import { GeoObservationDrawer } from './GeoObservationDrawer';
import { GeoObservationForm } from './GeoObservationForm';

const observationKinds = ['LEGACY_MODEL_RESULT', 'MANUAL_ARTICLE_SEARCH'] as const;
const accuracies = ['ACCURATE', 'PARTIAL', 'INCORRECT', 'UNJUDGEABLE'] as const;
const pageSizes = [20, 50, 100] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const optionalColumnKeys = ['discovered', 'mentioned', 'accuracy', 'publication', 'evidence', 'recorder'] as const;
type OptionalColumnKey = typeof optionalColumnKeys[number];

const columnLabels: Record<OptionalColumnKey, string> = {
  discovered: '是否发现', mentioned: '是否提及', accuracy: '准确性',
  publication: '关联发布内容', evidence: '证据', recorder: '记录人',
};

function dateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultDates() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { date_from: dateString(start), date_to: dateString(end) };
}

function positiveInteger(value: string | null, fallback: number) {
  return value && /^[1-9]\d*$/.test(value) ? Number(value) : fallback;
}

function enumValue<T extends string>(value: string | null, values: readonly T[]): T | undefined {
  return value && values.includes(value as T) ? value as T : undefined;
}

function boolValue(value: string | null): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function percent(value: number | null | undefined) {
  return value == null ? null : Math.round(value * 100);
}

function manualFactSummary(
  items: Schema<'GeoArticleResult'>[],
  isKnown: (item: Schema<'GeoArticleResult'>) => boolean,
  isPositive: (item: Schema<'GeoArticleResult'>) => boolean,
  label: string,
) {
  const known = items.filter(isKnown);
  if (!known.length) return '历史未采集';
  const missing = items.length - known.length;
  return `${known.filter(isPositive).length}/${known.length} 篇${label}${missing ? ` · ${missing} 篇未采集` : ''}`;
}

function metricFilters(query: GeoObservationListQuery): GeoMetricsQuery {
  const { page, page_size: pageSize, sort_order: sortOrder, ...filters } = query;
  void page;
  void pageSize;
  void sortOrder;
  return filters;
}

export function GeoObservationsPage() {
  const { message, modal } = App.useApp();
  const { focusReturnTargetProps, restoreFocus } = useFocusReturn();
  const [createOpen, setCreateOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<OptionalColumnKey[]>([...optionalColumnKeys]);
  const [productSearch, setProductSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const { observationId: correctionId } = useParams<{ observationId: string }>();
  const navigate = useNavigate();
  const defaults = useMemo(() => defaultDates(), []);
  const allTime = searchParams.get('all_time') === 'true';
  const rawPage = positiveInteger(searchParams.get('page'), 1);
  const rawPageSize = positiveInteger(searchParams.get('page_size'), 20);
  const pageSize = pageSizes.includes(rawPageSize as typeof pageSizes[number]) ? rawPageSize : 20;
  const dateFrom = allTime ? undefined : (datePattern.test(searchParams.get('date_from') ?? '') ? searchParams.get('date_from')! : defaults.date_from);
  const dateTo = allTime ? undefined : (datePattern.test(searchParams.get('date_to') ?? '') ? searchParams.get('date_to')! : defaults.date_to);
  const sortOrder = searchParams.get('sort_order') === 'ASC' ? 'ASC' : 'DESC';

  const listQuery: GeoObservationListQuery = {
    page: rawPage,
    page_size: pageSize,
    sort_order: sortOrder,
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
    ...(enumValue(searchParams.get('observation_kind'), observationKinds) ? { observation_kind: enumValue(searchParams.get('observation_kind'), observationKinds) } : {}),
    ...(searchParams.get('product_id') ? { product_id: searchParams.get('product_id')! } : {}),
    ...(searchParams.get('search') ? { search: searchParams.get('search')! } : {}),
    ...(searchParams.get('query_topic_id') ? { query_topic_id: searchParams.get('query_topic_id')! } : {}),
    ...(searchParams.get('model_name') ? { model_name: searchParams.get('model_name')! } : {}),
    ...(searchParams.get('search_platform') ? { search_platform: searchParams.get('search_platform')! } : {}),
    ...(searchParams.get('publication_search') ? { publication_search: searchParams.get('publication_search')! } : {}),
    ...(boolValue(searchParams.get('discovered')) !== undefined ? { discovered: boolValue(searchParams.get('discovered')) } : {}),
    ...(boolValue(searchParams.get('mentioned')) !== undefined ? { mentioned: boolValue(searchParams.get('mentioned')) } : {}),
    ...(enumValue(searchParams.get('accuracy'), accuracies) ? { accuracy: enumValue(searchParams.get('accuracy'), accuracies) } : {}),
    ...(searchParams.get('recorder_search') ? { recorder_search: searchParams.get('recorder_search')! } : {}),
    ...(searchParams.get('only_mine') === 'true' ? { only_mine: true } : {}),
    ...(searchParams.get('include_history') === 'true' ? { include_history: true } : {}),
  };
  const metricsQuery = metricFilters(listQuery);
  const observations = useQuery(geoObservationsQueryOptions(listQuery));
  const metrics = useQuery(geoMetricsQueryOptions(metricsQuery));
  const products = useQuery(productsQueryOptions(productSearch));
  const topics = useQuery(queryTopicsQueryOptions());
  const recordId = correctionId ? undefined : searchParams.get('record') ?? undefined;

  const updateParams = useCallback((changes: Record<string, string | number | boolean | undefined>, replace = false) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === undefined || value === '' || value === false) next.delete(key);
      else next.set(key, String(value));
    });
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);
  const updateFilter = (key: string, value: string | boolean | undefined) => updateParams({ [key]: value, page: undefined });

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    const remove = (key: string) => { next.delete(key); changed = true; };
    const normalizeEnum = (key: string, values: readonly string[]) => {
      const value = next.get(key);
      if (value !== null && !values.includes(value)) remove(key);
    };
    if (next.has('page') && !/^[1-9]\d*$/.test(next.get('page')!)) remove('page');
    if (next.has('page_size') && !pageSizes.map(String).includes(next.get('page_size')!)) remove('page_size');
    normalizeEnum('sort_order', ['ASC', 'DESC']);
    normalizeEnum('observation_kind', observationKinds);
    normalizeEnum('accuracy', accuracies);
    for (const key of ['article_recommendation', 'recommendation', 'has_citation']) {
      if (next.has(key)) remove(key);
    }
    for (const key of ['discovered', 'mentioned', 'only_mine', 'include_history', 'all_time']) {
      normalizeEnum(key, ['true', 'false']);
    }
    if (next.has('date_from') && !datePattern.test(next.get('date_from')!)) {
      next.set('date_from', defaults.date_from);
      changed = true;
    }
    if (next.has('date_to') && !datePattern.test(next.get('date_to')!)) {
      next.set('date_to', defaults.date_to);
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [defaults.date_from, defaults.date_to, searchParams, setSearchParams]);

  useEffect(() => {
    if (!observations.data) return;
    const maxPage = Math.max(1, Math.ceil(observations.data.total / pageSize));
    if (rawPage > maxPage || rawPageSize !== pageSize) updateParams({ page: rawPage > maxPage ? undefined : rawPage, page_size: pageSize === 20 ? undefined : pageSize }, true);
  }, [observations.data, pageSize, rawPage, rawPageSize, updateParams]);

  const resetFilters = () => {
    const next = new URLSearchParams();
    next.set('date_from', defaults.date_from);
    next.set('date_to', defaults.date_to);
    if (recordId) next.set('record', recordId);
    setSearchParams(next);
  };
  const clearFilters = () => {
    const next = new URLSearchParams();
    next.set('all_time', 'true');
    if (recordId) next.set('record', recordId);
    setSearchParams(next);
  };
  const openRecord = (id: string) => updateParams({ record: id });
  const closeRecord = () => updateParams({ record: undefined }, true);
  const openCorrection = (id: string) => navigate(`/observations/${id}/correct?${searchParams.toString()}`);
  const closeForm = () => {
    if (correctionId) navigate(`/observations${searchParams.toString() ? `?${searchParams.toString()}` : ''}`, { replace: true });
    else setCreateOpen(false);
  };
  const discoveryRate = percent(metrics.data?.article_discovery_rate);
  const mentionRate = percent(metrics.data?.article_mention_rate);
  const accuracyRate = percent(metrics.data?.article_accuracy_rate);
  const deleteObservation = useMutation({
    mutationFn: async (record: GeoObservation) => ensureSuccess(await api.DELETE('/api/v1/geo-observations/{observation_id}', {
      params: { path: { observation_id: record.id }, header: csrfHeader() },
    })),
    onSuccess: async (_, record) => {
      if (recordId === record.id) closeRecord();
      queryClient.removeQueries({ queryKey: queryKeys.geo.observation(record.id) });
      message.success('人工观测完整更正链已删除');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.geo.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: ['file'] }),
        queryClient.invalidateQueries({ queryKey: ['file-download'] }),
      ]);
    },
  });

  const baseColumns: TableColumnsType<GeoObservation> = [
    {
      title: '观测平台', width: 180, render: (_, row) => {
        const platformName = row.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? row.search_platform : row.model_name;
        return (
          <Tooltip title={platformName} trigger={['hover', 'focus']}>
            <div className="geo-platform-cell" tabIndex={0} aria-label={`观测平台：${platformName}`}>
              <span className="geo-platform-mark">{row.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? '人' : 'AI'}</span>
              <span className="table-cell-ellipsis">{platformName}</span>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: '搜索词 / 问题', key: 'question', ellipsis: true, render: (_, row) => {
        const question = row.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? row.search_query : row.actual_prompt;
        return (
          <Tooltip title={question} trigger={['hover', 'focus']}>
            <Button type="link" className="geo-question-link table-cell-ellipsis" aria-label={question} onClick={() => openRecord(row.id)}>
              {question}
            </Button>
          </Tooltip>
        );
      },
    },
    { title: '观测时间', dataIndex: 'tested_at', width: 118, render: (value) => <span className="data-code">{formatDateTime(value)}</span> },
    {
      title: '是否发现', key: 'discovered', width: 100, render: (_, row) => row.observation_kind === 'LEGACY_MODEL_RESULT'
        ? <Tag>不适用</Tag>
        : <Tag>{manualFactSummary(row.article_results, (item) => item.discovered !== null, (item) => item.discovered === true, '发现')}</Tag>,
    },
    {
      title: '是否提及', key: 'mentioned', width: 100, render: (_, row) => row.observation_kind === 'LEGACY_MODEL_RESULT'
        ? <StatusTag status={row.mentioned ? 'MENTIONED' : 'NOT_MENTIONED'} />
        : <Tag>{manualFactSummary(row.article_results, (item) => item.mentioned !== null, (item) => item.mentioned === true, '提及')}</Tag>,
    },
    {
      title: '准确性', key: 'accuracy', width: 104, render: (_, row) => row.observation_kind === 'LEGACY_MODEL_RESULT'
        ? <StatusTag status={row.accuracy} />
        : <Tag>{manualFactSummary(row.article_results, (item) => item.accuracy !== null, (item) => item.accuracy === 'ACCURATE', '准确')}</Tag>,
    },
    {
      title: '关联发布内容', key: 'publication', width: 150, ellipsis: true, render: (_, row) => {
        const count = row.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? row.article_results.length : row.publication_record_ids.length;
        return count ? <Button type="link" className="geo-cell-link" onClick={() => openRecord(row.id)}>{count} 条关联内容</Button> : '—';
      },
    },
    { title: '证据', key: 'evidence', width: 88, render: (_, row) => row.attachment_file_ids.length ? <StatusTag status="UPLOADED" /> : <Tag>未上传</Tag> },
    { title: '记录人', key: 'recorder', dataIndex: ['recorder', 'display_name'], width: 130, ellipsis: true, render: (value: string) => <TableCellText text={value} /> },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 96, render: (_, row) => (
        <Space size={4}>
          <Button size="small" aria-label={`查看观测：${row.id}`} icon={<EyeOutlined />} onClick={() => openRecord(row.id)} />
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'correct', label: '更正记录', disabled: !row.available_actions.includes('CORRECT') },
                ...(row.observation_kind === 'MANUAL_ARTICLE_SEARCH' && row.available_actions.includes('DELETE') ? [{
                  key: 'delete',
                  label: '删除完整更正链',
                  danger: true,
                  icon: <DeleteOutlined />,
                  disabled: deleteObservation.isPending,
                }] : []),
              ],
              onClick: ({ key }) => {
                if (key === 'correct') openCorrection(row.id);
                if (key === 'delete') {
                  modal.confirm({
                    title: '删除完整更正链？',
                    content: '当前人工观测及其全部历史更正会一并删除；失去全部引用的证据文件将进入清理。此操作不可恢复。',
                    okText: '删除完整更正链',
                    cancelText: '取消',
                    okButtonProps: { danger: true },
                    onOk: () => deleteObservation.mutateAsync(row),
                    afterClose: restoreFocus,
                  });
                }
              },
            }}
          >
            <Button {...focusReturnTargetProps} size="small" aria-label={`更多操作：${row.id}`} icon={<DownOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ];
  const columns = baseColumns.filter((column) => !column.key || !optionalColumnKeys.includes(column.key as OptionalColumnKey) || visibleColumns.includes(column.key as OptionalColumnKey));

  return (
    <div className="page-stack geo-observation-page">
      <PageHeader
        title="GEO 观测"
        description="记录真实搜索结果、逐篇观测结论与证据，支持按产品、平台和结论追溯历史。"
        actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建观测</Button>}
      />
      <nav className="geo-subnav" aria-label="GEO 观测页面">
        <NavLink end to="/observations">观测记录</NavLink>
        <NavLink to="/observations/insights">分析洞察</NavLink>
      </nav>

      {metrics.isLoading ? (
        <section className="geo-metric-state" aria-label="GEO 观测统计">
          <Card><QueryLoading label="正在加载 GEO 观测统计" /></Card>
        </section>
      ) : metrics.error ? (
        <section className="geo-metric-state" aria-label="GEO 观测统计">
          <Card><QueryFailure error={metrics.error} onRetry={() => { void metrics.refetch(); }} /></Card>
        </section>
      ) : (
        <section className="geo-metric-grid" aria-label="GEO 观测统计">
          <MetricTile icon={<FileSearchOutlined />} label="观测记录" value={observations.data?.total ?? '—'} meta={observations.error ? '记录查询失败' : '当前筛选口径'} />
          <MetricTile icon={<UserOutlined />} label="人工观测" value={metrics.data?.manual_observation_count ?? '—'} meta={`${metrics.data?.article_result_count ?? 0} 条逐篇结果`} tone="data" />
          <MetricTile icon={<SearchOutlined />} label="文章发现率" value={discoveryRate ?? '—'} unit={discoveryRate == null ? undefined : '%'} percent={discoveryRate} meta="已发现 / 文章结果" tone="data" />
          <MetricTile icon={<EyeOutlined />} label="文章提及率" value={mentionRate ?? '—'} unit={mentionRate == null ? undefined : '%'} percent={mentionRate} meta="已提及 / 文章结果" tone="data" />
          <MetricTile icon={<CheckCircleOutlined />} label="文章准确率" value={accuracyRate ?? '—'} unit={accuracyRate == null ? undefined : '%'} percent={accuracyRate} meta="准确 / 可判断结果" tone="data" />
        </section>
      )}
      {deleteObservation.error && <Alert role="alert" type="error" showIcon title={errorMessage(deleteObservation.error)} />}

      <Card className="geo-filter-card" size="small">
        <div className="geo-filter-grid" role="search" aria-label="观测记录筛选">
          <label><span>开始日期</span><Input type="date" value={dateFrom ?? ''} onChange={(event) => { updateParams({ date_from: event.target.value || undefined, all_time: undefined, page: undefined }); }} /></label>
          <label><span>结束日期</span><Input type="date" value={dateTo ?? ''} onChange={(event) => { updateParams({ date_to: event.target.value || undefined, all_time: undefined, page: undefined }); }} /></label>
          <label><span>观测类型</span><Select allowClear value={listQuery.observation_kind} onChange={(value) => updateFilter('observation_kind', value)} options={[{ value: 'LEGACY_MODEL_RESULT', label: '历史模型观测' }, { value: 'MANUAL_ARTICLE_SEARCH', label: '人工文章搜索' }]} /></label>
          <label><span>产品</span><Select allowClear showSearch filterOption={false} onSearch={setProductSearch} loading={products.isLoading} value={listQuery.product_id} onChange={(value) => updateFilter('product_id', value)} options={products.data?.items.map((item) => ({ value: item.id, label: `${item.brand} ${item.part_number}` }))} /></label>
          <label><span>搜索词 / 问题</span><Input allowClear value={listQuery.search ?? ''} placeholder="搜索完整问题关键词" onChange={(event) => updateFilter('search', event.target.value)} /></label>
          <label><span>问题主题</span><Select allowClear showSearch optionFilterProp="label" loading={topics.isLoading} value={listQuery.query_topic_id} onChange={(value) => updateFilter('query_topic_id', value)} options={topics.data?.items.map((item) => ({ value: item.id, label: item.canonical_question }))} /></label>
          <label><span>搜索平台</span><Input allowClear value={listQuery.search_platform ?? ''} placeholder="人工搜索平台" onChange={(event) => updateFilter('search_platform', event.target.value)} /></label>
          <label><span>模型名称</span><Input allowClear value={listQuery.model_name ?? ''} placeholder="历史观测模型" onChange={(event) => updateFilter('model_name', event.target.value)} /></label>
          <label><span>关联发布内容</span><Input allowClear value={listQuery.publication_search ?? ''} placeholder="标题或链接" onChange={(event) => updateFilter('publication_search', event.target.value)} /></label>
          <label><span>是否发现</span><Select allowClear value={listQuery.discovered === undefined ? undefined : String(listQuery.discovered)} onChange={(value) => updateFilter('discovered', value)} options={[{ value: 'true', label: '已发现' }, { value: 'false', label: '未发现' }]} /></label>
          <label><span>是否提及</span><Select allowClear value={listQuery.mentioned === undefined ? undefined : String(listQuery.mentioned)} onChange={(value) => updateFilter('mentioned', value)} options={[{ value: 'true', label: '已提及' }, { value: 'false', label: '未提及' }]} /></label>
          <label><span>准确性</span><Select allowClear value={listQuery.accuracy} onChange={(value) => updateFilter('accuracy', value)} options={accuracies.map((value) => ({ value, label: <StatusTag status={value} /> }))} /></label>
          <label><span>记录人</span><Input allowClear value={listQuery.recorder_search ?? ''} placeholder="姓名或用户名" onChange={(event) => updateFilter('recorder_search', event.target.value)} /></label>
        </div>
        {(products.error || topics.error) && <Alert className="geo-filter-error" type="error" showIcon title="筛选选项加载失败" description={String(products.error ?? topics.error)} />}
        <div className="geo-filter-actions">
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={resetFilters}>重置</Button>
            <Button onClick={clearFilters}>清除筛选</Button>
          </Space>
          <Space wrap>
            <label className="geo-switch-label"><span>包含历史更正记录</span><Switch size="small" checked={listQuery.include_history === true} onChange={(checked) => updateFilter('include_history', checked)} /></label>
            <label className="geo-switch-label"><span>仅看我的记录</span><Switch size="small" checked={listQuery.only_mine === true} onChange={(checked) => updateFilter('only_mine', checked)} /></label>
          </Space>
        </div>
      </Card>

      <Card
        className="geo-record-card"
        title={<span>共 {observations.data?.total ?? 0} 条记录</span>}
        extra={(
          <Space>
            <Button icon={sortOrder === 'DESC' ? <SortDescendingOutlined /> : <SortAscendingOutlined />} onClick={() => updateParams({ sort_order: sortOrder === 'DESC' ? 'ASC' : undefined, page: undefined })}>观测时间</Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: optionalColumnKeys.map((key) => ({ key, label: <Checkbox checked={visibleColumns.includes(key)}>{columnLabels[key]}</Checkbox> })),
                onClick: ({ key, domEvent }) => {
                  domEvent.preventDefault();
                  const column = key as OptionalColumnKey;
                  setVisibleColumns((current) => current.includes(column) ? current.filter((item) => item !== column) : [...current, column]);
                },
              }}
            >
              <Button icon={<SettingOutlined />}>列设置</Button>
            </Dropdown>
          </Space>
        )}
      >
        {observations.error
          ? <QueryFailure error={observations.error} onRetry={() => { void observations.refetch(); }} />
          : <TableRegion label="观测记录列表">
            <Table<GeoObservation>
              rowKey="id"
              loading={observations.isLoading}
              dataSource={observations.data?.items}
              columns={columns}
              locale={{ emptyText: <NoData description="当前筛选范围暂无观测记录" /> }}
              onRow={(row) => ({
                onClick: (event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest('button, a, input, [role="menuitem"], [role="checkbox"]')) return;
                  openRecord(row.id);
                },
              })}
              sticky={{ offsetHeader: 72 }}
              scroll={{ x: 1110 }}
              pagination={{
                current: rawPage,
                pageSize,
                total: observations.data?.total,
                showSizeChanger: true,
                pageSizeOptions: pageSizes.map(String),
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, size) => updateParams({ page: size !== pageSize || page === 1 ? undefined : page, page_size: size === 20 ? undefined : size }),
              }}
            />
          </TableRegion>}
      </Card>

      <GeoObservationDrawer recordId={recordId} onClose={closeRecord} onCorrect={openCorrection} />
      <GeoObservationForm
        open={createOpen || !!correctionId}
        correctionId={correctionId}
        onClose={closeForm}
        onCreated={(record) => {
          setCreateOpen(false);
          const next = new URLSearchParams(searchParams);
          next.set('record', record.id);
          navigate(`/observations?${next.toString()}`, { replace: true });
        }}
      />
    </div>
  );
}
