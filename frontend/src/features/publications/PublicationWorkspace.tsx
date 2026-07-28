/** 发布管理工作台只展示真实候选、发布记录、关注事项和服务端聚合统计。 */
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  LinkOutlined,
  MoreOutlined,
  SearchOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  Progress,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { publicationRecordsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema } from '../../shared/api/types';
import { QueryFailure } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { PublicationDrawer } from './PublicationDrawer';
import {
  actionLabels,
  type PublicationCommandAction,
  type PublicationDeleteTarget,
} from './publicationTypes';

type PublicationCandidate = Schema<'PublicationCandidate'>;
type PublicationAttention = Schema<'PublicationAttentionListItem'>;
type PublicationRecord = Schema<'PublicationRecordListItem'>;
type PublicationStatus = Schema<'PublicationStatus'>;
type PublicationStatusCounts = Schema<'PublicationStatusCounts'>;
type AttentionTrigger = PublicationAttention['trigger_status'];

const PAGE_SIZE = 10;
const publicationTabs = new Set(['candidates', 'records', 'attentions']);

function pageParam(params: URLSearchParams, key: string) {
  const raw = params.get(key);
  return raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : 1;
}

function includesString<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((item) => item === value);
}

export function PublicationWorkspace() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCommand, setSelectedCommand] = useState<{
    publicationId: string;
    action: PublicationCommandAction;
  }>();
  const rawTab = searchParams.get('tab');
  const activeTab = rawTab && publicationTabs.has(rawTab) ? rawTab : 'candidates';
  const rawWindow = searchParams.get('window_days');
  const windowDays: 7 | 30 = rawWindow === '30' ? 30 : 7;
  const candidatesPage = pageParam(searchParams, 'candidates_page');
  const attentionsPage = pageParam(searchParams, 'attentions_page');
  const recordsPage = pageParam(searchParams, 'records_page');
  const rawRecordStatus = searchParams.get('record_status');
  const rawAttentionTrigger = searchParams.get('attention_trigger');
  const candidatePlatform = searchParams.get('candidate_platform') ?? undefined;
  const candidateSearch = searchParams.get('candidate_search')?.trim() ?? '';
  const selectedCandidateId = searchParams.get('candidate') ?? undefined;
  const selectedPublicationId = searchParams.get('record') ?? undefined;

  const candidates = useQuery({
    queryKey: queryKeys.publications.candidates,
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-candidates')),
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const attentions = useQuery({
    queryKey: queryKeys.publications.attentionList('OPEN'),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-attentions', {
          params: { query: { status: 'OPEN' } },
        }),
      ),
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const summary = useQuery({
    queryKey: queryKeys.publications.summary(windowDays),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-workbench-summary', {
          params: { query: { window_days: windowDays } },
        }),
      ),
    staleTime: QUERY_STALE_TIME.workbench,
  });
  const publicationStatuses = useMemo(
    () => summary.data
      ? Object.keys(summary.data.current_status_counts) as Array<keyof PublicationStatusCounts>
      : [],
    [summary.data],
  );
  const recordStatus = rawRecordStatus && includesString(publicationStatuses, rawRecordStatus)
    ? rawRecordStatus
    : undefined;
  const attentionTriggers = useMemo(
    () => [...new Set((attentions.data?.items ?? []).map((item) => item.trigger_status))],
    [attentions.data],
  );
  const attentionTrigger = rawAttentionTrigger && includesString(attentionTriggers, rawAttentionTrigger)
    ? rawAttentionTrigger
    : undefined;
  const records = useQuery({
    ...publicationRecordsQueryOptions(recordsPage, PAGE_SIZE, recordStatus),
    enabled: rawRecordStatus === null || recordStatus !== undefined,
  });

  const platformOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of candidates.data?.items ?? []) names.set(item.platform_profile_id, item.platform_profile_name);
    return [...names].map(([value, label]) => ({ value, label }));
  }, [candidates.data]);
  const filteredCandidates = useMemo(
    () => (candidates.data?.items ?? []).filter((item) =>
      (!candidatePlatform || item.platform_profile_id === candidatePlatform)
      && (!candidateSearch || item.content_version.title.toLocaleLowerCase('zh-CN').includes(candidateSearch.toLocaleLowerCase('zh-CN')))),
    [candidatePlatform, candidateSearch, candidates.data],
  );
  const filteredAttentions = useMemo(
    () => (attentions.data?.items ?? []).filter((item) => !attentionTrigger || item.trigger_status === attentionTrigger),
    [attentionTrigger, attentions.data],
  );
  const selectedCandidate = candidates.data?.items.find((item) => item.content_version.id === selectedCandidateId);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    const remove = (key: string) => { next.delete(key); changed = true; };
    if (rawTab !== null && !publicationTabs.has(rawTab)) remove('tab');
    if (rawWindow !== null && rawWindow !== '7' && rawWindow !== '30') remove('window_days');
    if (summary.isSuccess && rawRecordStatus !== null && !recordStatus) remove('record_status');
    if (attentions.isSuccess && rawAttentionTrigger !== null && !attentionTrigger) remove('attention_trigger');
    for (const key of ['candidates_page', 'records_page', 'attentions_page']) {
      const value = searchParams.get(key);
      if (value !== null && !/^[1-9]\d*$/.test(value)) remove(key);
    }
    if (selectedCandidateId && selectedPublicationId) remove('candidate');
    if (candidates.isSuccess && selectedCandidateId && !selectedCandidate) remove('candidate');
    if (candidates.isSuccess && candidatePlatform && !platformOptions.some((item) => item.value === candidatePlatform)) remove('candidate_platform');
    const maxCandidatePage = Math.max(1, Math.ceil(filteredCandidates.length / PAGE_SIZE));
    const maxAttentionPage = Math.max(1, Math.ceil(filteredAttentions.length / PAGE_SIZE));
    if (searchParams.has('candidates_page') && candidatesPage > maxCandidatePage) remove('candidates_page');
    if (searchParams.has('attentions_page') && attentionsPage > maxAttentionPage) remove('attentions_page');
    if (searchParams.has('records_page') && records.data && recordsPage > Math.max(1, Math.ceil(records.data.total / PAGE_SIZE))) remove('records_page');
    if (changed) setSearchParams(next, { replace: true });
  }, [
    activeTab,
    attentionTrigger,
    attentions.isSuccess,
    attentionsPage,
    candidatePlatform,
    candidates.isSuccess,
    candidatesPage,
    filteredAttentions.length,
    filteredCandidates.length,
    platformOptions,
    rawAttentionTrigger,
    rawRecordStatus,
    rawTab,
    rawWindow,
    recordStatus,
    records.data,
    recordsPage,
    searchParams,
    selectedCandidate,
    selectedCandidateId,
    selectedPublicationId,
    setSearchParams,
    summary.isSuccess,
  ]);

  const setView = (values: Record<string, string | number | undefined>, replace = false) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === '' || (typeof value === 'number' && value === 1)) next.delete(key);
      else next.set(key, String(value));
    }
    setSearchParams(next, { replace });
  };
  const openCandidate = (item: PublicationCandidate) => setView({ candidate: item.content_version.id, record: undefined });
  const openRecord = (publicationId: string) => {
    setSelectedCommand(undefined);
    setView({ record: publicationId, candidate: undefined });
  };
  const openRecordAction = (publicationId: string, action: PublicationCommandAction) => {
    setSelectedCommand({ publicationId, action });
    setView({ record: publicationId, candidate: undefined });
  };
  const closeDrawer = () => {
    setSelectedCommand(undefined);
    setView({ record: undefined, candidate: undefined });
  };
  const deletePublication = useMutation({
    mutationFn: async (record: PublicationDeleteTarget) =>
      ensureSuccess(
        await api.DELETE('/api/v1/publication-records/{publication_id}', {
          params: { path: { publication_id: record.id }, header: csrfHeader() },
        }),
      ),
    onSuccess: async (_, record) => {
      if (selectedPublicationId === record.id) closeDrawer();
      queryClient.removeQueries({ queryKey: queryKeys.publications.record(record.id) });
      message.success('未公开发布记录已删除');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.records }),
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.candidates }),
        queryClient.invalidateQueries({ queryKey: ['publication-workbench-summary'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: ['file'] }),
        queryClient.invalidateQueries({ queryKey: ['file-download'] }),
      ]);
    },
    onError: (error) => message.error(errorMessage(error)),
  });
  const confirmDeletePublication = (record: PublicationDeleteTarget) => {
    modal.confirm({
      title: '删除未公开发布记录？',
      content: (
        <>
          <Typography.Paragraph>
            将永久删除“{record.content_title}”的未公开发布记录、状态事件和附件关系。
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            此操作不会标记为已移除，也不可撤销；没有其他引用的附件会进入统一清理流程。
          </Typography.Paragraph>
        </>
      ),
      okText: '删除记录',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => deletePublication.mutateAsync(record),
    });
  };
  const showRecordStatus = (status: PublicationStatus) => setView({ tab: 'records', record_status: status, records_page: undefined });
  const showAttention = (trigger?: AttentionTrigger) => setView({ tab: 'attentions', attention_trigger: trigger, attentions_page: undefined });
  const error = candidates.error ?? records.error ?? attentions.error ?? summary.error;

  return (
    <div className="page-stack publication-workbench">
      <PageHeader
        eyebrow="发布管理工作台"
        title="发布管理"
        description="复制已批准内容到锁定平台人工发布，登记结果、验证页面，并显式处理发布异常。"
      />
      {error && (
        <QueryFailure
          error={error}
          onRetry={() => {
            void candidates.refetch();
            void records.refetch();
            void attentions.refetch();
            void summary.refetch();
          }}
        />
      )}
      <PublicationFlow
        loading={summary.isLoading}
        summary={summary.data}
        onRecordStatus={showRecordStatus}
        onAttention={() => showAttention()}
      />
      <Card className="publication-glass-panel publication-list-panel">
        <Tabs
          className="publication-tabs"
          activeKey={activeTab}
          onChange={(tab) => setView({ tab })}
          items={[
            {
              key: 'candidates',
              label: <TabLabel label="待发布候选" count={candidates.data?.items.length} />,
              children: (
                <CandidateList
                  items={filteredCandidates}
                  loading={candidates.isLoading}
                  page={candidatesPage}
                  platform={candidatePlatform}
                  platformOptions={platformOptions}
                  search={candidateSearch}
                  onView={setView}
                  onOpen={openCandidate}
                />
              ),
            },
            {
              key: 'records',
              label: <TabLabel label="发布记录" count={records.data?.total} />,
              children: (
                <RecordList
                  items={records.data?.items ?? []}
                  loading={records.isLoading}
                  page={recordsPage}
                  total={records.data?.total ?? 0}
                  status={recordStatus}
                  statusOptions={publicationStatuses}
                  onView={setView}
                  onOpen={openRecord}
                  onAction={openRecordAction}
                  onDelete={confirmDeletePublication}
                  deletePending={deletePublication.isPending}
                />
              ),
            },
            {
              key: 'attentions',
              label: <TabLabel label="发布需关注" count={summary.data?.open_attention_count} danger />,
              children: (
                <AttentionList
                  items={filteredAttentions}
                  loading={attentions.isLoading}
                  page={attentionsPage}
                  trigger={attentionTrigger}
                  triggerOptions={attentionTriggers}
                  onView={setView}
                  onOpen={(attentionId) => navigate(`/publication-attentions/${attentionId}`)}
                />
              ),
            },
          ]}
        />
      </Card>
      <PublicationInsights
        summary={summary.data}
        loading={summary.isLoading}
        windowDays={windowDays}
        onWindowChange={(days) => setView({ window_days: days === 7 ? undefined : days }, true)}
        onRecordStatus={showRecordStatus}
        onAttention={showAttention}
        onOpenRecord={openRecord}
      />
      <PublicationDrawer
        key={`${selectedCandidateId ?? selectedPublicationId ?? 'closed'}:${selectedCommand?.action ?? 'view'}`}
        candidate={selectedCandidate}
        publicationId={selectedPublicationId}
        initialAction={selectedCommand?.publicationId === selectedPublicationId ? selectedCommand?.action : undefined}
        deletePending={deletePublication.isPending}
        onClose={closeDrawer}
        onCreated={(publicationId) => setView({ tab: 'records', record: publicationId, candidate: undefined })}
        onDelete={confirmDeletePublication}
      />
    </div>
  );
}

function PublicationFlow({
  loading,
  summary,
  onRecordStatus,
  onAttention,
}: {
  loading: boolean;
  summary?: Schema<'PublicationWorkbenchSummary'>;
  onRecordStatus: (status: PublicationStatus) => void;
  onAttention: () => void;
}) {
  const items: Array<{ label: string; status?: PublicationStatus; count: number; icon: React.ReactNode; attention?: boolean }> = [
    { label: '待人工发布', status: 'PENDING_MANUAL_PUBLISH', count: summary?.current_status_counts.PENDING_MANUAL_PUBLISH ?? 0, icon: <SendOutlined /> },
    { label: '平台审核中', status: 'PLATFORM_REVIEW', count: summary?.current_status_counts.PLATFORM_REVIEW ?? 0, icon: <ClockCircleOutlined /> },
    { label: '已发布', status: 'PUBLISHED', count: summary?.current_status_counts.PUBLISHED ?? 0, icon: <LinkOutlined /> },
    { label: '已验证', status: 'VERIFIED', count: summary?.current_status_counts.VERIFIED ?? 0, icon: <CheckCircleOutlined /> },
    { label: '发布需关注', count: summary?.open_attention_count ?? 0, icon: <ExclamationCircleOutlined />, attention: true },
  ];
  return (
    <section className="publication-flow publication-glass-panel" aria-label="发布流程概览" aria-busy={loading}>
      <header><Typography.Title level={5}>发布流程概览</Typography.Title><Typography.Text type="secondary">全量当前状态</Typography.Text></header>
      <div className="publication-flow-grid">
        {items.map((item, index) => (
          <div className={`publication-flow-step${item.attention ? ' is-attention' : ''}`} key={item.label}>
            <button type="button" onClick={() => item.attention ? onAttention() : onRecordStatus(item.status!)}>
              <span className="publication-flow-icon">{item.icon}</span>
              <span><small>{item.label}</small><strong>{item.count}</strong></span>
            </button>
            {index < items.length - 1 && <ArrowRightOutlined className="publication-flow-arrow" aria-hidden />}
          </div>
        ))}
      </div>
    </section>
  );
}

function CandidateList({
  items,
  loading,
  page,
  platform,
  platformOptions,
  search,
  onView,
  onOpen,
}: {
  items: PublicationCandidate[];
  loading: boolean;
  page: number;
  platform?: string;
  platformOptions: Array<{ value: string; label: string }>;
  search: string;
  onView: (values: Record<string, string | number | undefined>, replace?: boolean) => void;
  onOpen: (item: PublicationCandidate) => void;
}) {
  return (
    <>
      <div className="publication-filter-bar">
        <Input.Search
          key={search}
          aria-label="搜索候选标题"
          allowClear
          defaultValue={search}
          prefix={<SearchOutlined />}
          placeholder="搜索内容标题"
          onSearch={(value) => onView({ candidate_search: value.trim(), candidates_page: undefined })}
        />
        <Select
          aria-label="筛选候选平台"
          allowClear
          value={platform}
          placeholder="全部目标平台"
          options={platformOptions}
          onChange={(value) => onView({ candidate_platform: value, candidates_page: undefined })}
        />
      </div>
      <TableRegion label="待发布候选列表">
        <Table<PublicationCandidate>
          rowKey={(row) => row.content_version.id}
          loading={loading}
          dataSource={items}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: items.length, showSizeChanger: false, showTotal: (total) => `共 ${total} 条`, onChange: (next) => onView({ candidates_page: next }) }}
          sticky={{ offsetHeader: 72 }}
          scroll={{ x: 820 }}
          columns={[
            { title: '内容标题', render: (_, row) => <div className="publication-title-cell"><strong>{row.content_version.title}</strong><small className="data-code">{row.content_version.id.slice(0, 8)}</small></div> },
            { title: '版本', width: 80, render: (_, row) => `V${row.content_version.version}` },
            { title: '目标平台', dataIndex: 'platform_profile_name', width: 170 },
            {
              title: '发布账号',
              width: 190,
              render: (_, row) => row.matching_accounts.length
                ? row.matching_accounts.map((account) => account.label).join('、')
                : <div className="publication-title-cell"><Typography.Text type="danger">无匹配账号</Typography.Text><Link to={`/settings?tab=accounts&platform_profile_id=${row.platform_profile_id}`}>前往业务设置</Link></div>,
            },
            { title: '内容状态', width: 120, render: (_, row) => <StatusTag status={row.content_version.status} /> },
            { title: '操作', fixed: 'right', width: 150, render: (_, row) => <Button type="primary" disabled={row.matching_accounts.length === 0} onClick={() => onOpen(row)}>准备人工发布</Button> },
          ]}
        />
      </TableRegion>
    </>
  );
}

function RecordList({
  items,
  loading,
  page,
  total,
  status,
  statusOptions,
  onView,
  onOpen,
  onAction,
  onDelete,
  deletePending,
}: {
  items: PublicationRecord[];
  loading: boolean;
  page: number;
  total: number;
  status?: PublicationStatus;
  statusOptions: PublicationStatus[];
  onView: (values: Record<string, string | number | undefined>, replace?: boolean) => void;
  onOpen: (publicationId: string) => void;
  onAction: (publicationId: string, action: PublicationCommandAction) => void;
  onDelete: (record: PublicationDeleteTarget) => void;
  deletePending: boolean;
}) {
  return (
    <>
      <div className="publication-filter-bar is-compact">
        <Select
          aria-label="筛选发布状态"
          allowClear
          value={status}
          placeholder="全部发布状态"
          options={statusOptions.map((value) => ({ value, label: <StatusTag status={value} /> }))}
          onChange={(value) => onView({ record_status: value, records_page: undefined })}
        />
      </div>
      <TableRegion label="发布记录列表">
        <Table<PublicationRecord>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (count) => `共 ${count} 条`, onChange: (next) => onView({ records_page: next }) }}
          sticky={{ offsetHeader: 72 }}
          scroll={{ x: 1470 }}
          columns={[
            {
              title: '内容标题',
              ellipsis: { showTitle: false },
              render: (_, row) => <div className="publication-title-cell">
                <Tooltip title={row.content_title} trigger={['hover', 'focus']}><strong tabIndex={0}>{row.content_title}</strong></Tooltip>
                <small>V{row.content_version}</small>
              </div>,
            },
            {
              title: '实际标题',
              dataIndex: 'actual_title',
              width: 210,
              ellipsis: { showTitle: false },
              render: (value: string | null) => value
                ? <Tooltip title={value} trigger={['hover', 'focus']}><span className="publication-actual-title" tabIndex={0}>{value}</span></Tooltip>
                : '—',
            },
            { title: '状态', dataIndex: 'status', width: 120, render: (value) => <StatusTag status={value} /> },
            { title: '发布时间', dataIndex: 'published_at', width: 160, render: (value: string | null) => value ? formatDateTime(value) : '—' },
            { title: '目标平台', dataIndex: 'platform_profile_name', width: 140 },
            { title: '发布账号', width: 150, render: (_, row) => <div className="publication-title-cell"><span>{row.platform_account_label}</span><small>{row.account_identifier}</small></div> },
            { title: '最终 URL', dataIndex: 'final_url', width: 100, render: (url: string | null) => url ? <a href={url} target="_blank" rel="noreferrer">打开 <LinkOutlined /></a> : '—' },
            { title: '最后验证', dataIndex: 'last_verification_at', width: 160, render: (value: string | null) => value ? formatDateTime(value) : '—' },
            {
              title: '操作',
              fixed: 'right',
              width: 190,
              render: (_, row) => {
                const canMarkPublished = row.available_actions.includes('mark-published');
                const secondaryActions = row.available_actions.filter((action) => action !== 'mark-published');
                return (
                  <Space size={4}>
                    <Button
                      type={canMarkPublished ? 'primary' : 'default'}
                      onClick={() => canMarkPublished ? onAction(row.id, 'mark-published') : onOpen(row.id)}
                    >
                      {canMarkPublished ? '登记发布结果' : '查看记录'}
                    </Button>
                    {secondaryActions.length > 0 && (
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items: secondaryActions.map((action) => ({
                            key: action,
                            label: actionLabels[action],
                            danger: action === 'delete',
                            onClick: () => action === 'delete' ? onDelete(row) : onAction(row.id, action),
                          })),
                        }}
                      >
                        <Button
                          type="text"
                          aria-label={`更多操作：${row.content_title}`}
                          icon={<MoreOutlined />}
                          disabled={deletePending}
                        />
                      </Dropdown>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      </TableRegion>
    </>
  );
}

function AttentionList({
  items,
  loading,
  page,
  trigger,
  triggerOptions,
  onView,
  onOpen,
}: {
  items: PublicationAttention[];
  loading: boolean;
  page: number;
  trigger?: AttentionTrigger;
  triggerOptions: AttentionTrigger[];
  onView: (values: Record<string, string | number | undefined>, replace?: boolean) => void;
  onOpen: (attentionId: string) => void;
}) {
  return (
    <>
      <Alert
        type="info"
        showIcon
        title="已移除或验证失败的记录会进入此处"
        description="先查看原发布上下文，按需创建修复任务，并在写明处理结果后显式解决。"
      />
      <div className="publication-filter-bar is-compact">
        <Select
          aria-label="筛选异常类型"
          allowClear
          value={trigger}
          placeholder="全部异常类型"
          options={triggerOptions.map((value) => ({ value, label: <StatusTag status={value} /> }))}
          onChange={(value) => onView({ attention_trigger: value, attentions_page: undefined })}
        />
      </div>
      <TableRegion label="发布需关注列表">
        <Table<PublicationAttention>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: items.length, showSizeChanger: false, showTotal: (total) => `共 ${total} 条`, onChange: (next) => onView({ attentions_page: next }) }}
          sticky={{ offsetHeader: 72 }}
          scroll={{ x: 920 }}
          columns={[
            { title: '内容标题', render: (_, row) => <div className="publication-title-cell"><strong>{row.content_title}</strong><small>V{row.content_version}</small></div> },
            { title: '目标平台', dataIndex: 'platform_profile_name', width: 150 },
            { title: '发布账号', dataIndex: 'platform_account_label', width: 150 },
            { title: '异常类型', dataIndex: 'trigger_status', width: 150, render: (value) => <StatusTag status={value} /> },
            { title: '打开时间', dataIndex: 'opened_at', width: 180, render: formatDateTime },
            { title: '修复任务', dataIndex: 'repair_task_id', width: 120, render: (value: string | null) => value ? '已创建' : '未创建' },
            { title: '操作', fixed: 'right', width: 110, render: (_, row) => <Button onClick={() => onOpen(row.id)}>{row.available_actions.length ? '处理异常' : '查看'}</Button> },
          ]}
        />
      </TableRegion>
    </>
  );
}

function PublicationInsights({
  summary,
  loading,
  windowDays,
  onWindowChange,
  onRecordStatus,
  onAttention,
  onOpenRecord,
}: {
  summary?: Schema<'PublicationWorkbenchSummary'>;
  loading: boolean;
  windowDays: 7 | 30;
  onWindowChange: (days: 7 | 30) => void;
  onRecordStatus: (status: PublicationStatus) => void;
  onAttention: (trigger?: AttentionTrigger) => void;
  onOpenRecord: (publicationId: string) => void;
}) {
  const period = summary?.period;
  const rate = period?.verification_rate == null ? null : Math.round(period.verification_rate * 1000) / 10;
  return (
    <section className="publication-insights" aria-label="发布辅助信息">
      <Card title="发布指引" className="publication-glass-panel publication-guide-card">
        <ol>
          <li><span>1</span><div><strong>复制已批准内容</strong><small>始终使用候选抽屉里的锁定版本。</small></div></li>
          <li><span>2</span><div><strong>在目标平台人工发布</strong><small>使用锁定平台下的匹配账号。</small></div></li>
          <li><span>3</span><div><strong>登记最终结果与证据</strong><small>填写最终 URL、发布时间和真实平台状态。</small></div></li>
          <li><span>4</span><div><strong>完成人工页面验证</strong><small>确认页面可访问，且正文与锁定版本一致。</small></div></li>
          <li><span>5</span><div><strong>显式处理发布异常</strong><small>验证失败或下线后进入关注和修复流程。</small></div></li>
        </ol>
      </Card>
      <Card title="最近发布动态" className="publication-glass-panel publication-activity-card" loading={loading}>
        {summary?.recent_activity.length ? (
          <ul>
            {summary.recent_activity.map((item) => (
              <li key={`${item.publication_id}-${item.status}-${item.occurred_at}`}>
                <button type="button" onClick={() => onOpenRecord(item.publication_id)}>
                  <span><strong>{item.content_title}</strong><small>{item.platform_profile_name} · V{item.content_version}</small></span>
                  <span><StatusTag status={item.status} /><time>{formatDateTime(item.occurred_at)}</time></span>
                </button>
              </li>
            ))}
          </ul>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无权威发布动态" />}
      </Card>
      <Card title="常见异常类型" className="publication-glass-panel publication-exception-card" loading={loading}>
        <button type="button" onClick={() => onRecordStatus('REJECTED')}><span>平台拒绝</span><strong>{summary?.exception_counts.rejected ?? 0}</strong></button>
        <button type="button" onClick={() => onAttention('VERIFICATION_FAILED')}><span>页面验证失败</span><strong>{summary?.exception_counts.verification_failed_open ?? 0}</strong></button>
        <button type="button" onClick={() => onAttention('REMOVED')}><span>页面已下线</span><strong>{summary?.exception_counts.removed_open ?? 0}</strong></button>
        <Typography.Paragraph type="secondary">异常类型来自发布状态与开放的 PublicationAttention，不解析错误文案。</Typography.Paragraph>
      </Card>
      <Card
        title="发布数据概览"
        extra={<Segmented<7 | 30> aria-label="统计周期" value={windowDays} options={[{ value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }]} onChange={onWindowChange} />}
        className="publication-glass-panel publication-metrics-card"
        loading={loading}
      >
        <div className="publication-metric-grid">
          <Metric label="登记发布数" value={period?.registered_published_count ?? 0} />
          <Metric label="验证通过数" value={period?.verified_count ?? 0} />
          <Metric label="验证通过率" value={rate == null ? '—' : `${rate}%`} progress={rate ?? undefined} />
          <Metric label="新增异常数" value={period?.new_exception_count ?? 0} />
          <Metric label="当前未解决异常" value={period?.current_unresolved_attention_count ?? 0} />
        </div>
        {summary && <Typography.Text type="secondary">窗口：{formatDateTime(summary.window_start)} 至 {formatDateTime(summary.as_of)}</Typography.Text>}
      </Card>
    </section>
  );
}

function Metric({ label, value, progress }: { label: string; value: string | number; progress?: number }) {
  return <div className="publication-metric"><span>{label}</span><strong>{value}</strong>{progress !== undefined && <Progress percent={progress} showInfo={false} size="small" />}</div>;
}

function TabLabel({ label, count, danger = false }: { label: string; count?: number; danger?: boolean }) {
  return <span>{label}<b className={danger ? 'is-danger' : undefined}>{count ?? 0}</b></span>;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}
