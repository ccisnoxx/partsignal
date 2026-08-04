/** 管理员审计工作台：URL 持有组合筛选，服务端持有日志、总数和安全详情。 */
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Grid,
  Input,
  Pagination,
  Select,
  Space,
  Switch,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME } from '../../app/queryClient';
import { api, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import {
  auditLogDetailQueryOptions,
  auditLogFilterOptionsQueryOptions,
  auditLogListQueryOptions,
} from '../../shared/api/queryOptions';
import type { AuditLogListQuery, Schema, UserListQuery } from '../../shared/api/types';
import { NoData, QueryFailure } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableCellText } from '../../shared/components/TableCellText';
import { TableRegion } from '../../shared/components/TableRegion';
import { useFocusReturn } from '../../shared/hooks/useFocusReturn';
import {
  actionLabel,
  AuditLogDetailPanel,
  auditModuleLabels,
  formatBeijingTime,
  moduleLabel,
  targetTypeLabel,
} from './AuditLogDetailPanel';

dayjs.extend(utc);
dayjs.extend(timezone);

type AuditModule = Schema<'AuditModule'>;
type AuditOutcome = Schema<'AuditOutcome'>;

const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const AUTO_REFRESH_INTERVAL = 30_000;
const pageSizes = [10, 20, 50, 100] as const;
const auditModules = Object.keys(auditModuleLabels) as AuditModule[];
const auditOutcomes: AuditOutcome[] = ['SUCCESS', 'FAILED', 'DENIED'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuditView = {
  createdFrom?: string;
  createdTo?: string;
  actorId?: string;
  businessModule?: AuditModule;
  action?: string;
  targetType?: string;
  outcome?: AuditOutcome;
  requestId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
  canonical: URLSearchParams;
};

function defaultDateRange(): { createdFrom: string; createdTo: string } {
  const end = dayjs().tz(BEIJING_TIME_ZONE);
  return {
    createdFrom: end.subtract(3, 'day').utc().toISOString(),
    createdTo: end.utc().toISOString(),
  };
}

function positiveInteger(value: string | null): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function boundedText(params: URLSearchParams, key: string, maxLength: number): string | undefined {
  const value = params.get(key)?.trim();
  return value && value.length <= maxLength ? value : undefined;
}

function parseAuditView(
  searchParams: URLSearchParams,
  defaults: { createdFrom: string; createdTo: string },
): AuditView {
  const allTime = searchParams.get('all_time') === 'true';
  const rawFrom = searchParams.get('created_from');
  const rawTo = searchParams.get('created_to');
  const validRange = !!rawFrom
    && !!rawTo
    && dayjs(rawFrom).isValid()
    && dayjs(rawTo).isValid()
    && dayjs(rawFrom).isBefore(dayjs(rawTo));
  const createdFrom = allTime ? undefined : validRange ? dayjs(rawFrom).toISOString() : defaults.createdFrom;
  const createdTo = allTime ? undefined : validRange ? dayjs(rawTo).toISOString() : defaults.createdTo;
  const rawActorId = searchParams.get('actor_id');
  const actorId = rawActorId && uuidPattern.test(rawActorId) ? rawActorId : undefined;
  const rawModule = searchParams.get('business_module');
  const businessModule = auditModules.includes(rawModule as AuditModule) ? rawModule as AuditModule : undefined;
  const rawOutcome = searchParams.get('outcome');
  const outcome = auditOutcomes.includes(rawOutcome as AuditOutcome) ? rawOutcome as AuditOutcome : undefined;
  const action = boundedText(searchParams, 'action', 120);
  const targetType = boundedText(searchParams, 'target_type', 100);
  const requestId = boundedText(searchParams, 'request_id', 100);
  const keyword = boundedText(searchParams, 'keyword', 100);
  const page = positiveInteger(searchParams.get('page')) ?? 1;
  const rawPageSize = positiveInteger(searchParams.get('page_size'));
  const pageSize = pageSizes.find((size) => size === rawPageSize) ?? 20;
  const canonical = new URLSearchParams();

  if (allTime) canonical.set('all_time', 'true');
  else {
    canonical.set('created_from', createdFrom!);
    canonical.set('created_to', createdTo!);
  }
  if (actorId) canonical.set('actor_id', actorId);
  if (businessModule) canonical.set('business_module', businessModule);
  if (action) canonical.set('action', action);
  if (targetType) canonical.set('target_type', targetType);
  if (outcome) canonical.set('outcome', outcome);
  if (requestId) canonical.set('request_id', requestId);
  if (keyword) canonical.set('keyword', keyword);
  if (page !== 1) canonical.set('page', String(page));
  if (pageSize !== 20) canonical.set('page_size', String(pageSize));

  return {
    createdFrom,
    createdTo,
    actorId,
    businessModule,
    action,
    targetType,
    outcome,
    requestId,
    keyword,
    page,
    pageSize,
    canonical,
  };
}

function AuditKeywordField({ value, onSearch }: { value: string | undefined; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  return (
    <Input.Search
      aria-label="关键字搜索"
      allowClear
      maxLength={100}
      prefix={<SearchOutlined />}
      placeholder="搜索对象标识、变更内容关键词"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onSearch={() => onSearch(draft.trim())}
    />
  );
}

function AuditRequestIdField({ value, onCommit }: { value: string | undefined; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  const commit = () => onCommit(draft.trim());
  return (
    <Input
      aria-label="请求 ID"
      allowClear
      maxLength={100}
      placeholder="请输入请求 ID"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
}

export function AuditLogPage() {
  const screens = Grid.useBreakpoint();
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const [selectedId, setSelectedId] = useState<string>();
  const [actorSearch, setActorSearch] = useState('');
  // 只在真实关闭移动 Drawer 后恢复，避免断点切换抢走详情焦点。
  const restoreAfterDrawerClose = useRef(false);
  const { rememberFocusTarget, restoreFocus } = useFocusReturn();
  const defaults = useMemo(() => defaultDateRange(), []);
  const sourceSearch = searchParams.toString();
  const view = useMemo(() => parseAuditView(searchParams, defaults), [defaults, searchParams]);
  const canonicalSearch = view.canonical.toString();

  const listQuery = useMemo<AuditLogListQuery>(() => ({
    page: view.page,
    page_size: view.pageSize,
    ...(view.createdFrom ? { created_from: view.createdFrom } : {}),
    ...(view.createdTo ? { created_to: view.createdTo } : {}),
    ...(view.actorId ? { actor_id: view.actorId } : {}),
    ...(view.businessModule ? { business_module: view.businessModule } : {}),
    ...(view.action ? { action: view.action } : {}),
    ...(view.targetType ? { target_type: view.targetType } : {}),
    ...(view.outcome ? { outcome: view.outcome } : {}),
    ...(view.requestId ? { request_id: view.requestId } : {}),
    ...(view.keyword ? { keyword: view.keyword } : {}),
  }), [view.action, view.actorId, view.businessModule, view.createdFrom, view.createdTo, view.keyword, view.outcome, view.page, view.pageSize, view.requestId, view.targetType]);
  const actorQuery = useMemo<UserListQuery>(() => ({
    page: 1,
    page_size: 50,
    ...(actorSearch.trim() ? { q: actorSearch.trim() } : {}),
  }), [actorSearch]);

  const audit = useQuery({
    ...auditLogListQueryOptions(listQuery),
    refetchInterval: autoRefresh && pageVisible ? AUTO_REFRESH_INTERVAL : false,
  });
  const filterOptions = useQuery(auditLogFilterOptionsQueryOptions());
  const actors = useQuery({
    queryKey: queryKeys.users.list(actorQuery),
    queryFn: async () => unwrap(await api.GET('/api/v1/users', { params: { query: actorQuery } })),
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const detail = useQuery({
    ...auditLogDetailQueryOptions(selectedId),
    enabled: !!selectedId,
  });

  useEffect(() => {
    if (sourceSearch !== canonicalSearch) setSearchParams(canonicalSearch, { replace: true });
  }, [canonicalSearch, setSearchParams, sourceSearch]);
  useEffect(() => {
    if (!audit.data) return;
    const lastPage = Math.max(1, Math.ceil(audit.data.total / view.pageSize));
    if (view.page <= lastPage) return;
    const next = new URLSearchParams(view.canonical);
    if (lastPage === 1) next.delete('page');
    else next.set('page', String(lastPage));
    setSearchParams(next, { replace: true });
  }, [audit.data, setSearchParams, view.canonical, view.page, view.pageSize]);
  useEffect(() => {
    const handleVisibility = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const setView = (changes: Partial<Omit<AuditView, 'canonical'>>) => {
    const next = new URLSearchParams(view.canonical);
    const setOptional = (key: string, value: string | undefined) => {
      if (value) next.set(key, value);
      else next.delete(key);
    };
    if ('createdFrom' in changes || 'createdTo' in changes) {
      if (changes.createdFrom && changes.createdTo) {
        next.set('created_from', changes.createdFrom);
        next.set('created_to', changes.createdTo);
        next.delete('all_time');
      } else {
        next.delete('created_from');
        next.delete('created_to');
        next.set('all_time', 'true');
      }
    }
    if ('actorId' in changes) setOptional('actor_id', changes.actorId);
    if ('businessModule' in changes) setOptional('business_module', changes.businessModule);
    if ('action' in changes) setOptional('action', changes.action);
    if ('targetType' in changes) setOptional('target_type', changes.targetType);
    if ('outcome' in changes) setOptional('outcome', changes.outcome);
    if ('requestId' in changes) setOptional('request_id', changes.requestId);
    if ('keyword' in changes) setOptional('keyword', changes.keyword);
    if ('page' in changes) setOptional('page', changes.page && changes.page !== 1 ? String(changes.page) : undefined);
    if ('pageSize' in changes) setOptional('page_size', changes.pageSize && changes.pageSize !== 20 ? String(changes.pageSize) : undefined);
    setSearchParams(next);
  };

  const items = audit.data?.items ?? [];
  const hasFilters = !!(
    view.actorId
    || view.businessModule
    || view.action
    || view.targetType
    || view.outcome
    || view.requestId
    || view.keyword
    || view.createdFrom !== defaults.createdFrom
    || view.createdTo !== defaults.createdTo
  );
  const rangeValue: [Dayjs, Dayjs] | null = view.createdFrom && view.createdTo
    ? [dayjs.utc(view.createdFrom).tz(BEIJING_TIME_ZONE), dayjs.utc(view.createdTo).tz(BEIJING_TIME_ZONE)]
    : null;
  const selectedActorInOptions = actors.data?.items.some((actor) => actor.id === view.actorId);
  const actorOptions = [
    ...(view.actorId && !selectedActorInOptions ? [{ value: view.actorId, label: view.actorId }] : []),
    ...(actors.data?.items.map((actor) => ({ value: actor.id, label: actor.display_name })) ?? []),
  ];
  const selectedActionInOptions = filterOptions.data?.actions.includes(view.action ?? '');
  const actionOptions = [
    ...(view.action && !selectedActionInOptions ? [{ value: view.action, label: actionLabel(view.action) }] : []),
    ...(filterOptions.data?.actions.map((value) => ({ value, label: actionLabel(value) })) ?? []),
  ];
  const desktopDetail = !!screens.xl;
  const openDetail = (id: string, trigger: HTMLElement) => {
    rememberFocusTarget(trigger);
    setSelectedId(id);
  };
  const closeDetail = () => {
    setSelectedId(undefined);
    if (desktopDetail) requestAnimationFrame(restoreFocus);
    else restoreAfterDrawerClose.current = true;
  };
  const refresh = async () => {
    await Promise.all([
      audit.refetch(),
      selectedId ? detail.refetch() : Promise.resolve(),
    ]);
  };
  const resetFilters = () => setSearchParams(new URLSearchParams());
  const optionsError = filterOptions.error ?? actors.error;

  const detailPanel = selectedId ? (
    <AuditLogDetailPanel
      detail={detail.data}
      error={detail.error}
      loading={detail.isLoading}
      onClose={closeDetail}
      onRetry={() => void detail.refetch()}
    />
  ) : null;

  return (
    <div className="page-stack audit-log-page">
      <PageHeader
        title="审计日志"
        description="追溯关键业务操作、状态转换和配置变更。审计记录不可修改或删除。"
      />

      <div className={`audit-workspace${selectedId && desktopDetail ? ' audit-workspace-with-detail' : ''}`}>
        <div className="audit-main-column">
        <section className="audit-filter-panel" aria-label="审计日志筛选">
        <div className="audit-filter-grid">
          <label className="audit-filter-time">
            <span>时间范围</span>
            <DatePicker.RangePicker
              aria-label="时间范围"
              allowClear
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              value={rangeValue}
              onChange={(range) => setView({
                createdFrom: range?.[0]?.utc().toISOString(),
                createdTo: range?.[1]?.utc().toISOString(),
                page: 1,
              })}
            />
          </label>
          <label>
            <span>操作者</span>
            <Select
              aria-label="操作者"
              allowClear
              showSearch
              filterOption={false}
              loading={actors.isLoading}
              placeholder="选择操作者"
              value={view.actorId}
              options={actorOptions}
              onSearch={setActorSearch}
              onChange={(actorId) => setView({ actorId, page: 1 })}
            />
          </label>
          <label>
            <span>业务模块</span>
            <Select<AuditModule>
              aria-label="业务模块"
              allowClear
              placeholder="全部模块"
              value={view.businessModule}
              options={auditModules.map((value) => ({ value, label: auditModuleLabels[value] }))}
              onChange={(businessModule) => setView({ businessModule, page: 1 })}
            />
          </label>
          <label>
            <span>动作类型</span>
            <Select
              aria-label="动作类型"
              allowClear
              showSearch
              optionFilterProp="label"
              loading={filterOptions.isLoading}
              placeholder="全部动作"
              value={view.action}
              options={actionOptions}
              onChange={(action) => setView({ action, page: 1 })}
            />
          </label>
          <label>
            <span>对象类型</span>
            <Select
              aria-label="对象类型"
              allowClear
              showSearch
              optionFilterProp="label"
              loading={filterOptions.isLoading}
              placeholder="全部对象类型"
              value={view.targetType}
              options={filterOptions.data?.target_types.map((value) => ({ value, label: targetTypeLabel(value) }))}
              onChange={(targetType) => setView({ targetType, page: 1 })}
            />
          </label>
          <label>
            <span>执行结果</span>
            <Select<AuditOutcome>
              aria-label="执行结果"
              allowClear
              placeholder="全部结果"
              value={view.outcome}
              options={auditOutcomes.map((value) => ({ value, label: <StatusTag compact status={value} /> }))}
              onChange={(outcome) => setView({ outcome, page: 1 })}
            />
          </label>
          <label>
            <span>请求 ID</span>
            <AuditRequestIdField key={view.requestId ?? 'empty-request-id'} value={view.requestId} onCommit={(requestId) => setView({ requestId, page: 1 })} />
          </label>
        </div>
        <div className="audit-filter-search-row">
          <AuditKeywordField key={view.keyword ?? 'empty-keyword'} value={view.keyword} onSearch={(keyword) => setView({ keyword, page: 1 })} />
          <Button aria-label="重置筛选" icon={<ReloadOutlined />} onClick={resetFilters}>重置筛选</Button>
        </div>
        {optionsError ? (
          <QueryFailure
            error={optionsError}
            onRetry={() => void Promise.all([filterOptions.refetch(), actors.refetch()])}
          />
        ) : null}
        </section>

        <section className="audit-list-panel" aria-label="审计日志列表">
          <div className="audit-list-toolbar">
            <Typography.Text>共 <strong>{audit.data?.total ?? '—'}</strong> 条记录</Typography.Text>
            <Space size="small">
              <label className="audit-auto-refresh"><span>自动刷新</span><Switch aria-label="自动刷新" checked={autoRefresh} onChange={setAutoRefresh} /></label>
              <Tooltip title="刷新当前列表和详情">
                <Button aria-label="手动刷新" icon={<ReloadOutlined />} loading={audit.isFetching || detail.isFetching} onClick={() => void refresh()} />
              </Tooltip>
            </Space>
          </div>

          {audit.error ? (
            <div className="audit-list-error">
              {audit.data ? <Alert role="alert" type="error" showIcon title="刷新失败，当前显示上次成功加载的数据。" /> : null}
              <QueryFailure error={audit.error} onRetry={() => void audit.refetch()} />
            </div>
          ) : null}

          {audit.error && !audit.data ? null : (
            <>
              <TableRegion label="审计日志">
                <Table<Schema<'AuditLog'>>
                  rowKey="id"
                  loading={audit.isLoading}
                  dataSource={items}
                  pagination={false}
                  scroll={{ x: 1030, y: 'calc(100dvh - 545px)' }}
                  rowClassName={(row) => row.id === selectedId ? 'audit-row-selected' : ''}
                  locale={{
                    emptyText: (
                      <NoData
                        description="当前筛选没有审计记录"
                        action={hasFilters ? <Button onClick={resetFilters}>清除筛选</Button> : undefined}
                      />
                    ),
                  }}
                  columns={[
                    { title: '时间', dataIndex: 'created_at', width: 144, render: (value: string) => <time className="audit-time" dateTime={value}>{formatBeijingTime(value)}</time> },
                    { title: '操作者', width: 76, ellipsis: true, render: (_, row) => <TableCellText text={row.actor?.display_name ?? '已删除用户'} /> },
                    { title: '账号类型', width: 82, render: (_, row) => row.actor ? <StatusTag compact status={row.actor.account_type} /> : '未记录' },
                    { title: '业务模块', dataIndex: 'business_module', width: 94, render: moduleLabel },
                    { title: '动作', dataIndex: 'action', width: 160, ellipsis: true, render: (value: string) => <TableCellText text={actionLabel(value)} /> },
                    { title: '对象类型', dataIndex: 'target_type', width: 94, render: targetTypeLabel },
                    { title: '对象标识', dataIndex: 'target_id', width: 126, ellipsis: true, render: (value: string | null) => <TableCellText text={value ?? '未创建'} mono /> },
                    { title: '执行结果', dataIndex: 'outcome', width: 76, render: (value: string) => <StatusTag compact status={value} /> },
                    { title: '请求 ID', dataIndex: 'request_id', width: 144, ellipsis: true, render: (value: string) => <TableCellText text={value} mono /> },
                    { title: '操作', fixed: 'right', width: 130, render: (_, row) => <Button type="primary" aria-label={`查看日志详情：${row.id}`} size="small" onClick={(event) => openDetail(row.id, event.currentTarget)}>查看日志详情</Button> },
                  ]}
                />
              </TableRegion>
              <div className="audit-pagination">
                <Select<number>
                  aria-label="每页数量"
                  value={view.pageSize}
                  options={pageSizes.map((size) => ({ value: size, label: `${size} 条/页` }))}
                  onChange={(pageSize) => setView({ pageSize, page: 1 })}
                />
                <Pagination
                  current={view.page}
                  pageSize={view.pageSize}
                  total={audit.data?.total ?? 0}
                  showSizeChanger={false}
                  showQuickJumper
                  onChange={(page) => setView({ page })}
                />
              </div>
            </>
          )}
        </section>
        </div>

        {selectedId && desktopDetail ? <aside className="audit-detail-aside" aria-label="日志详情">{detailPanel}</aside> : null}
      </div>

      <Drawer
        className="audit-detail-drawer"
        size="min(420px, 100vw)"
        open={!!selectedId && !desktopDetail}
        closable={false}
        onClose={closeDetail}
        afterOpenChange={(open) => {
          if (open || !restoreAfterDrawerClose.current) return;
          restoreAfterDrawerClose.current = false;
          restoreFocus();
        }}
        styles={{ body: { padding: 0 } }}
      >
        {detailPanel}
      </Drawer>
    </div>
  );
}
