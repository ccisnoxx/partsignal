/** AI 渠道三栏工作区：服务端集合查询、稳定详情路由和显式模型连接测试。 */
import {
  ApiOutlined,
  CheckCircleFilled,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type {
  AIChannelListQuery,
  AIChannelSummary,
  AIModel,
  Schema,
} from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import {
  AIChannelFormModal,
  AIProviderMark,
  providerBrandLabels,
  type AIChannelFormValues,
} from './AIChannelFormModal';

const statusOptions = ['all', 'enabled', 'disabled'] as const;
const sortOptions: Array<{ value: Schema<'AIChannelSort'>; label: string }> = [
  { value: 'CREATED_DESC', label: '默认排序' },
  { value: 'NAME_ASC', label: '名称升序' },
  { value: 'NAME_DESC', label: '名称降序' },
  { value: 'UPDATED_DESC', label: '最近更新' },
  { value: 'LAST_TESTED_DESC', label: '最近测试' },
];
const pageSizes = [10, 20, 50] as const;
const relativeTimeFormatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
export const AI_CHANNEL_DETAIL_TAB_KEYS = ['basic', 'request', 'models', 'usage', 'logs'] as const;
export type AIChannelDetailTab = typeof AI_CHANNEL_DETAIL_TAB_KEYS[number];

export type AIChannelWorkspaceContext = {
  openConnectionTest: (channel: Pick<AIChannelSummary, 'id' | 'name'>) => void;
};

function oneOf<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback;
}

function positiveInteger(value: string | null, fallback: number) {
  if (value === null || !/^[1-9]\d*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function testStatus(status: Schema<'AIModelTestStatus'>, testedAt: string | null) {
  if (!testedAt || status === 'UNTESTED') return <StatusTag compact status="UNTESTED" />;
  const ageSeconds = (new Date(testedAt).getTime() - Date.now()) / 1000;
  const testedTime = Math.abs(ageSeconds) < 60
    ? '刚刚'
    : Math.abs(ageSeconds) < 3600
      ? relativeTimeFormatter.format(Math.round(ageSeconds / 60), 'minute')
      : Math.abs(ageSeconds) < 86400
        ? relativeTimeFormatter.format(Math.round(ageSeconds / 3600), 'hour')
        : new Date(testedAt).toLocaleDateString('zh-CN');
  return (
    <span className="ai-test-status">
      <StatusTag compact status={status} />
      <small>{testedTime}</small>
    </span>
  );
}

export function AIChannelsPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [testChannel, setTestChannel] = useState<Pick<AIChannelSummary, 'id' | 'name'>>();
  const [testModelId, setTestModelId] = useState<string>();
  const [modal, modalContext] = Modal.useModal();
  const { message } = App.useApp();

  const statusFilter = oneOf(searchParams.get('status'), statusOptions, 'all');
  const sort = oneOf(
    searchParams.get('sort'),
    sortOptions.map((item) => item.value),
    'CREATED_DESC',
  );
  const rawProviderBrand = searchParams.get('provider_brand');
  const providerBrand = rawProviderBrand && Object.hasOwn(providerBrandLabels, rawProviderBrand)
    ? rawProviderBrand as Schema<'AIProviderBrand'>
    : null;
  const page = positiveInteger(searchParams.get('page'), 1);
  const pageSize = oneOf(
    searchParams.get('page_size'),
    pageSizes.map(String),
    '20',
  );
  const hasInvalidViewParams = (
    (searchParams.has('status') && !statusOptions.includes(searchParams.get('status') as typeof statusOptions[number]))
    || (rawProviderBrand !== null && providerBrand === null)
    || (searchParams.has('sort') && !sortOptions.some((item) => item.value === searchParams.get('sort')))
    || (searchParams.has('page') && positiveInteger(searchParams.get('page'), 0) === 0)
    || (searchParams.has('page_size') && !pageSizes.map(String).includes(searchParams.get('page_size')!))
    || (searchParams.has('tab') && !AI_CHANNEL_DETAIL_TAB_KEYS.includes(searchParams.get('tab') as AIChannelDetailTab))
  );
  useEffect(() => {
    if (!hasInvalidViewParams) return;
    const next = new URLSearchParams(searchParams);
    if (!statusOptions.includes(next.get('status') as typeof statusOptions[number])) next.delete('status');
    if (rawProviderBrand !== null && providerBrand === null) next.delete('provider_brand');
    if (!sortOptions.some((item) => item.value === next.get('sort'))) next.delete('sort');
    if (next.has('page') && positiveInteger(next.get('page'), 0) === 0) next.delete('page');
    if (next.has('page_size') && !pageSizes.map(String).includes(next.get('page_size')!)) next.delete('page_size');
    if (next.has('tab') && !AI_CHANNEL_DETAIL_TAB_KEYS.includes(next.get('tab') as AIChannelDetailTab)) next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [hasInvalidViewParams, providerBrand, rawProviderBrand, searchParams, setSearchParams]);
  const listQuery = useMemo<AIChannelListQuery>(() => ({
    page,
    page_size: Number(pageSize) as 10 | 20 | 50,
    sort,
    ...(searchParams.get('q') ? { q: searchParams.get('q')! } : {}),
    ...(statusFilter === 'enabled' ? { status: 'ENABLED' as const } : {}),
    ...(statusFilter === 'disabled' ? { status: 'DISABLED' as const } : {}),
    ...(providerBrand && Object.hasOwn(providerBrandLabels, providerBrand)
      ? { provider_brand: providerBrand }
      : {}),
  }), [page, pageSize, providerBrand, searchParams, sort, statusFilter]);

  const channels = useQuery({
    queryKey: queryKeys.aiChannels.list(listQuery),
    queryFn: async () => unwrap(await api.GET('/api/v1/ai-channels', { params: { query: listQuery } })),
    staleTime: QUERY_STALE_TIME.configuration,
  });
  useEffect(() => {
    if (hasInvalidViewParams || channelId || !channels.data?.items.length) return;
    navigate({
      pathname: `/configuration/ai/channels/${channels.data.items[0]!.id}`,
      search: searchParams.toString(),
    }, { replace: true });
  }, [channelId, channels.data?.items, hasInvalidViewParams, navigate, searchParams]);

  const updateParams = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === '' || value === 'all') next.delete(key);
      else next.set(key, value);
    }
    navigate({ pathname: '/configuration/ai', search: next.toString() });
  };
  const selectChannel = (id: string) => navigate({
    pathname: `/configuration/ai/channels/${id}`,
    search: searchParams.toString(),
  });
  const invalidateChannels = async (id?: string) => {
    const invalidations = [queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.all })];
    if (id) invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.detail(id) }));
    await Promise.all(invalidations);
  };
  const create = useMutation({
    // 创建载荷可能包含 API Key；弹窗关闭并 reset 后必须立即从 MutationCache 移除。
    gcTime: 0,
    mutationFn: async (values: AIChannelFormValues) => unwrap(await api.POST('/api/v1/ai-channels', {
      params: { header: csrfHeader() },
      body: values as Schema<'AIChannelCreate'>,
    })),
    onSuccess: async (created) => {
      setCreateOpen(false);
      message.success('渠道已创建');
      await invalidateChannels();
      selectChannel(created.id);
    },
  });
  useEffect(() => {
    if (!createOpen && !create.isPending && create.variables !== undefined) create.reset();
  }, [create, createOpen]);
  const toggle = useMutation({
    mutationFn: async (channel: AIChannelSummary) => {
      const path = channel.is_enabled
        ? '/api/v1/ai-channels/{channel_id}/disable' as const
        : '/api/v1/ai-channels/{channel_id}/enable' as const;
      return unwrap(await api.POST(path, {
        params: { path: { channel_id: channel.id }, header: csrfHeader() },
        body: { expected_revision: channel.revision },
      }));
    },
    onSuccess: async (_, channel) => {
      message.success(channel.is_enabled ? '渠道已停用' : '渠道已启用');
      await invalidateChannels(channel.id);
    },
  });
  const remove = useMutation({
    mutationFn: async (channel: AIChannelSummary) => ensureSuccess(await api.DELETE(
      '/api/v1/ai-channels/{channel_id}',
      { params: { path: { channel_id: channel.id }, header: csrfHeader() } },
    )),
    onSuccess: async (_, channel) => {
      message.success('渠道已删除');
      queryClient.removeQueries({ queryKey: queryKeys.aiChannels.detail(channel.id) });
      if (channelId === channel.id) navigate({ pathname: '/configuration/ai', search: searchParams.toString() }, { replace: true });
      await invalidateChannels();
    },
  });
  const testModels = useQuery({
    queryKey: queryKeys.aiChannels.models(testChannel?.id ?? ''),
    queryFn: async () => unwrap(await api.GET('/api/v1/ai-channels/{channel_id}/models', {
      params: { path: { channel_id: testChannel!.id } },
    })),
    enabled: !!testChannel,
    staleTime: QUERY_STALE_TIME.configuration,
  });
  const testConnection = useMutation({
    mutationFn: async (model: AIModel) => unwrap(await api.POST('/api/v1/ai-models/{model_id}/test', {
      params: { path: { model_id: model.id }, header: csrfHeader() },
    })),
    onSuccess: async (tested) => {
      if (tested.test_status === 'PASSED') message.success('连接测试成功，模型当前保持停用');
      else message.error(tested.last_test_error_summary || '连接测试失败');
      const testedChannelId = testChannel?.id;
      setTestChannel(undefined);
      setTestModelId(undefined);
      if (testedChannelId) {
        await Promise.all([
          invalidateChannels(testedChannelId),
          queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.models(testedChannelId) }),
          queryClient.invalidateQueries({ queryKey: ['ai-channel-usage', testedChannelId] }),
          queryClient.invalidateQueries({ queryKey: ['ai-channel-audit-logs', testedChannelId] }),
        ]);
      }
    },
  });
  const openConnectionTest = (channel: Pick<AIChannelSummary, 'id' | 'name'>) => {
    setTestModelId(undefined);
    testConnection.reset();
    setTestChannel(channel);
  };

  const confirmDelete = (channel: AIChannelSummary) => modal.confirm({
    title: `删除渠道“${channel.name}”？`,
    content: '渠道、Header 与当前模型会被删除；尚未执行的关联作业将因配置缺失而失败，历史快照继续保留。',
    okText: '删除渠道',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk: () => remove.mutateAsync(channel),
  });
  const columns: TableColumnsType<AIChannelSummary> = [
    {
      title: '渠道名称', dataIndex: 'name', width: 124,
      render: (_, item) => <div className="ai-channel-name-cell"><AIProviderMark brand={item.provider_brand} /><span><strong>{item.name}</strong><small>{item.description || providerBrandLabels[item.provider_brand]}</small></span></div>,
    },
    {
      title: '状态', dataIndex: 'is_enabled', width: 50,
      render: (enabled: boolean) => <StatusTag compact status={enabled ? 'ENABLED' : 'DISABLED'} />,
    },
    {
      title: 'API 根地址', dataIndex: 'base_url', ellipsis: true, width: 167,
      render: (value: string) => <Typography.Text className="ai-url-cell" title={value}>{value}</Typography.Text>,
    },
    {
      title: 'API Key', dataIndex: 'api_key_configured', width: 72,
      render: (configured: boolean) => configured
        ? <span className="ai-configured"><CheckCircleFilled /> 已配置</span>
        : <span className="ai-not-configured">未配置</span>,
    },
    { title: 'Header 数量', dataIndex: 'header_count', width: 66, align: 'center' },
    { title: '已启用模型', dataIndex: 'enabled_model_count', width: 68, align: 'center' },
    {
      title: '测试状态', key: 'test', width: 82,
      render: (_, item) => testStatus(item.latest_test_status, item.last_tested_at),
    },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 84,
      render: (_, item) => <Space size={4} onClick={(event) => event.stopPropagation()}>
        <Button size="small" type="text" icon={<SettingOutlined />} aria-label={`配置：${item.name}`} onClick={() => selectChannel(item.id)} />
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'test', label: '测试连接' },
              { key: 'toggle', label: item.is_enabled ? '停用渠道' : '启用渠道' },
              { key: 'delete', label: '删除渠道', danger: true },
            ],
            onClick: ({ key }) => {
              if (key === 'test') openConnectionTest(item);
              else if (key === 'toggle') toggle.mutate(item);
              else confirmDelete(item);
            },
          }}
        >
          <Button
            size="small"
            type="text"
            icon={<MoreOutlined />}
            loading={toggle.isPending && toggle.variables?.id === item.id}
            aria-label={`更多操作：${item.name}`}
          />
        </Dropdown>
      </Space>,
    },
  ];
  const activeCounts = channels.data?.counts ?? { all: 0, enabled: 0, disabled: 0 };
  const listError = channels.error ?? toggle.error ?? remove.error;

  return (
    <div className="ai-config-page">
      {modalContext}
      <PageHeader
        eyebrow="AI 配置"
        title="AI 渠道与模型"
        description="统一管理协议、凭据、Header 与真实模型连接。"
        actions={<Space>
          <Button icon={<ThunderboltOutlined />} disabled={!channelId} onClick={() => {
            if (!channelId) return;
            const selected = channels.data?.items.find((item) => item.id === channelId);
            openConnectionTest(selected ?? { id: channelId, name: '' });
          }}>测试连接</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增渠道</Button>
        </Space>}
      />
      <section className="ai-workspace" aria-label="AI 渠道管理工作区">
        <aside className="ai-status-rail" aria-label="渠道状态分类">
          <div className="ai-rail-title"><span>AI 渠道</span><Tag>{activeCounts.all}</Tag></div>
          {statusOptions.map((item) => (
            <button
              key={item}
              type="button"
              className={statusFilter === item ? 'is-active' : ''}
              onClick={() => updateParams({ status: item, page: undefined })}
            >
              <span>{item === 'all' ? '全部渠道' : item === 'enabled' ? '已启用' : '已停用'}</span>
              <strong>{item === 'all' ? activeCounts.all : item === 'enabled' ? activeCounts.enabled : activeCounts.disabled}</strong>
            </button>
          ))}
        </aside>
        <main className="ai-channel-list-pane">
          <div className="ai-list-toolbar" role="search" aria-label="AI 渠道筛选">
            <label className="ai-list-filter">
              <span>关键词</span>
              <Input
                key={searchParams.get('q') ?? ''}
                type="search"
                aria-label="搜索渠道名称、描述或地址"
                defaultValue={searchParams.get('q') ?? ''}
                allowClear
                prefix={<SearchOutlined />}
                placeholder="搜索渠道名称、描述、地址…"
                onChange={(event) => {
                  if (!event.target.value) updateParams({ q: undefined, page: undefined });
                }}
                onPressEnter={(event) => updateParams({ q: event.currentTarget.value.trim() || undefined, page: undefined })}
              />
            </label>
            <label className="ai-list-filter">
              <span>启用状态</span>
              <Select
                aria-label="筛选渠道状态"
                value={statusFilter}
                onChange={(value) => updateParams({ status: value, page: undefined })}
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'enabled', label: '已启用' },
                  { value: 'disabled', label: '已停用' },
                ]}
              />
            </label>
            <label className="ai-list-filter">
              <span>供应商品牌</span>
              <Select
                aria-label="筛选供应商品牌"
                value={providerBrand ?? 'all'}
                onChange={(value) => updateParams({ provider_brand: value, page: undefined })}
                options={[
                  { value: 'all', label: '全部类型' },
                  ...Object.entries(providerBrandLabels).map(([value, label]) => ({ value, label })),
                ]}
              />
            </label>
            <label className="ai-list-filter">
              <span>排序</span>
              <Select aria-label="渠道排序" value={sort} onChange={(value) => updateParams({ sort: value, page: undefined })} options={sortOptions} />
            </label>
          </div>
          {listError && <Alert role="alert" type="error" showIcon title={errorMessage(listError)} />}
          <div className="ai-list-table-wrap">
            {channels.isLoading ? <QueryLoading label="正在加载 AI 渠道" /> : channels.error ? <QueryFailure error={channels.error} onRetry={() => void channels.refetch()} /> : channels.data?.items.length ? (
              <TableRegion label="AI 渠道列表">
                <Table<AIChannelSummary>
                  className="ai-channel-table"
                  rowKey="id"
                  size="small"
                  dataSource={channels.data.items}
                  columns={columns}
                  pagination={false}
                  scroll={{ x: 710 }}
                  rowClassName={(item) => item.id === channelId ? 'ai-channel-row-selected' : ''}
                />
              </TableRegion>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的渠道" />}
          </div>
          <footer className="ai-list-pagination">
            <span>共 {channels.data?.total ?? 0} 条</span>
            <Pagination
              current={page}
              pageSize={Number(pageSize)}
              total={channels.data?.total ?? 0}
              showSizeChanger
              pageSizeOptions={pageSizes.map(String)}
              showQuickJumper={false}
              onChange={(nextPage, nextPageSize) => updateParams({
                page: nextPage > 1 ? String(nextPage) : undefined,
                page_size: nextPageSize === 20 ? undefined : String(nextPageSize),
              })}
            />
          </footer>
        </main>
        <aside className="ai-detail-pane" aria-label="渠道详情面板">
          {channelId ? <Outlet context={{ openConnectionTest } satisfies AIChannelWorkspaceContext} /> : <div className="ai-detail-empty"><ApiOutlined /><span>选择一个渠道查看详情</span></div>}
        </aside>
      </section>
      <AIChannelFormModal
        open={createOpen}
        loading={create.isPending}
        error={create.error}
        onCancel={() => { setCreateOpen(false); create.reset(); }}
        onSubmit={(values) => create.mutate(values)}
      />
      <Modal
        title={`测试连接${testChannel?.name ? ` · ${testChannel.name}` : ''}`}
        open={!!testChannel}
        okText="开始测试"
        cancelText="取消"
        confirmLoading={testConnection.isPending}
        okButtonProps={{ disabled: !testModelId || testModels.isLoading }}
        destroyOnHidden
        onCancel={() => { setTestChannel(undefined); setTestModelId(undefined); }}
        onOk={() => {
          const model = testModels.data?.items.find((item) => item.id === testModelId);
          if (model) testConnection.mutate(model);
        }}
      >
        <Alert type="warning" showIcon title="测试会真实调用所选模型；完成后模型将停用，通过后也需手动重新启用。" />
        {testConnection.error && <Alert role="alert" type="error" showIcon title={errorMessage(testConnection.error)} />}
        <div className="ai-test-model-field">
          <Typography.Text strong>选择测试模型</Typography.Text>
          <Select
            aria-label="选择测试模型"
            value={testModelId}
            loading={testModels.isLoading}
            placeholder="必须明确选择一个已配置模型"
            onChange={setTestModelId}
            options={testModels.data?.items.map((item) => ({
              value: item.id,
              label: `${item.display_name} · ${item.model_id}`,
            }))}
          />
          {testModels.error && <Typography.Text type="danger">{errorMessage(testModels.error)}</Typography.Text>}
        </div>
      </Modal>
    </div>
  );
}
