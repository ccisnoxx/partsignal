/** 单个 AI 渠道的右侧详情面板，承载配置、模型、统计与同源审计投影。 */
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  KeyOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { AIModel, Schema, User } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { MetricTile } from '../../shared/components/MetricTile';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import {
  AIChannelFormModal,
  AIProviderMark,
  providerBrandLabels,
  type AIChannelFormValues,
} from './AIChannelFormModal';
import {
  AI_CHANNEL_DETAIL_TAB_KEYS,
  type AIChannelDetailTab,
  type AIChannelWorkspaceContext,
} from './AIChannelsPage';
import { ModelDiscoveryModal } from './ModelDiscoveryModal';

type Header = Schema<'AIChannelHeader'>;
type ModelFormValues = { display_name: string; model_id: string; request_parameters_json: string };

const detailTabs: Array<{ key: AIChannelDetailTab; label: string }> = [
  { key: 'basic', label: '基本信息' },
  { key: 'request', label: '请求配置' },
  { key: 'models', label: '模型管理' },
  { key: 'usage', label: '使用统计' },
  { key: 'logs', label: '操作日志' },
];

async function invalidateChannel(channelId: string, includeModels = false) {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.detail(channelId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.all }),
    queryClient.invalidateQueries({ queryKey: ['ai-channel-audit-logs', channelId] }),
  ];
  if (includeModels) invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.models(channelId) }));
  await Promise.all(invalidations);
}

function parseRequestParameters(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value || '{}');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('请求参数必须是 JSON 对象');
  return parsed as Record<string, unknown>;
}

function optionalMetric(value: number | null, suffix?: string) {
  return value === null ? '暂无数据' : `${value.toLocaleString('zh-CN')}${suffix ?? ''}`;
}

export function AIChannelDetailPage() {
  const { channelId = '' } = useParams();
  const workspace = useOutletContext<AIChannelWorkspaceContext | undefined>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message } = App.useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [editingHeader, setEditingHeader] = useState<Header>();
  const [editingModel, setEditingModel] = useState<AIModel>();
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [usagePeriod, setUsagePeriod] = useState<Schema<'AIUsagePeriod'>>('30d');
  const [logPage, setLogPage] = useState(1);
  const [modal, modalContext] = Modal.useModal();
  const tab = AI_CHANNEL_DETAIL_TAB_KEYS.includes(searchParams.get('tab') as AIChannelDetailTab)
    ? searchParams.get('tab') as AIChannelDetailTab
    : 'basic';

  const channel = useQuery({
    queryKey: queryKeys.aiChannels.detail(channelId),
    queryFn: async () => unwrap(await api.GET('/api/v1/ai-channels/{channel_id}', { params: { path: { channel_id: channelId } } })),
    staleTime: QUERY_STALE_TIME.configuration,
    enabled: !!channelId,
  });
  const models = useQuery({
    queryKey: queryKeys.aiChannels.models(channelId),
    queryFn: async () => unwrap(await api.GET('/api/v1/ai-channels/{channel_id}/models', { params: { path: { channel_id: channelId } } })),
    staleTime: QUERY_STALE_TIME.configuration,
    enabled: !!channelId,
  });
  const users = useQuery({
    queryKey: queryKeys.users.list({ page: 1, page_size: 100 }),
    queryFn: async () => unwrap(await api.GET('/api/v1/users', { params: { query: { page: 1, page_size: 100 } } })),
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const usage = useQuery({
    queryKey: queryKeys.aiChannels.usage(channelId, usagePeriod),
    queryFn: async () => unwrap(await api.GET('/api/v1/ai-channels/{channel_id}/usage-summary', {
      params: { path: { channel_id: channelId }, query: { period: usagePeriod } },
    })),
    enabled: !!channelId && tab === 'usage',
    staleTime: QUERY_STALE_TIME.workbench,
  });
  const logs = useQuery({
    queryKey: queryKeys.aiChannels.auditLogs(channelId, logPage, 20),
    queryFn: async () => unwrap(await api.GET('/api/v1/ai-channels/{channel_id}/audit-logs', {
      params: { path: { channel_id: channelId }, query: { page: logPage, page_size: 20 } },
    })),
    enabled: !!channelId && tab === 'logs',
    staleTime: QUERY_STALE_TIME.configuration,
  });
  const userNames = new Map((users.data?.items ?? []).map((user: User) => [user.id, user.display_name]));

  const updateChannel = useMutation({
    mutationFn: async (values: AIChannelFormValues) => {
      if (!channel.data) throw new Error('渠道未加载');
      const body = {
        name: values.name,
        description: values.description,
        protocol_type: values.protocol_type,
        provider_brand: values.provider_brand,
        base_url: values.base_url,
        timeout_seconds: values.timeout_seconds,
      };
      return unwrap(await api.PATCH('/api/v1/ai-channels/{channel_id}', {
        params: { path: { channel_id: channelId }, header: csrfHeader() },
        body: { ...body, expected_revision: channel.data.revision },
      }));
    },
    onSuccess: async () => {
      setEditOpen(false);
      message.success('渠道信息已保存');
      await invalidateChannel(channelId, true);
    },
  });
  const replaceKey = useMutation({
    // 密钥只能短暂存在于本次提交中，reset 后不进入 MutationCache 的常驻窗口。
    gcTime: 0,
    mutationFn: async (body: { api_key: string }) => {
      if (!channel.data) throw new Error('渠道未加载');
      return unwrap(await api.PUT('/api/v1/ai-channels/{channel_id}/api-key', {
        params: { path: { channel_id: channelId }, header: csrfHeader() },
        body: { ...body, expected_revision: channel.data.revision },
      }));
    },
    onSuccess: async () => {
      setKeyOpen(false);
      message.success('API Key 已重新配置，渠道与模型测试状态已重置');
      await invalidateChannel(channelId, true);
    },
  });
  const toggleChannel = useMutation({
    mutationFn: async () => {
      if (!channel.data) throw new Error('渠道未加载');
      const path = channel.data.is_enabled
        ? '/api/v1/ai-channels/{channel_id}/disable' as const
        : '/api/v1/ai-channels/{channel_id}/enable' as const;
      return unwrap(await api.POST(path, {
        params: { path: { channel_id: channelId }, header: csrfHeader() },
        body: { expected_revision: channel.data.revision },
      }));
    },
    onSuccess: async () => {
      message.success(channel.data?.is_enabled ? '渠道已停用' : '渠道已启用');
      await invalidateChannel(channelId);
    },
  });
  const deleteChannel = useMutation({
    mutationFn: async () => ensureSuccess(await api.DELETE('/api/v1/ai-channels/{channel_id}', {
      params: { path: { channel_id: channelId }, header: csrfHeader() },
    })),
    onSuccess: async () => {
      message.success('AI 渠道已删除');
      queryClient.removeQueries({ queryKey: queryKeys.aiChannels.detail(channelId) });
      queryClient.removeQueries({ queryKey: queryKeys.aiChannels.models(channelId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.all });
      navigate({ pathname: '/configuration/ai', search: searchParams.toString() }, { replace: true });
    },
  });
  const addHeader = useMutation({
    // Header 值可能敏感，弹窗关闭后立即回收 mutation 状态。
    gcTime: 0,
    mutationFn: async (body: Omit<Schema<'AIChannelHeaderCreate'>, 'expected_channel_revision'>) => {
      if (!channel.data) throw new Error('渠道未加载');
      return unwrap(await api.POST('/api/v1/ai-channels/{channel_id}/headers', {
        params: { path: { channel_id: channelId }, header: csrfHeader() },
        body: { ...body, expected_channel_revision: channel.data.revision },
      }));
    },
    onSuccess: async () => { setHeaderOpen(false); await invalidateChannel(channelId, true); },
  });
  const updateHeader = useMutation({
    gcTime: 0,
    mutationFn: async (body: Omit<Schema<'AIChannelHeaderUpdate'>, 'expected_channel_revision'>) => {
      if (!channel.data || !editingHeader) throw new Error('Header 未加载');
      return unwrap(await api.PATCH('/api/v1/ai-channel-headers/{header_id}', {
        params: { path: { header_id: editingHeader.id }, header: csrfHeader() },
        body: { ...body, expected_channel_revision: channel.data.revision },
      }));
    },
    onSuccess: async () => { setEditingHeader(undefined); message.success('Header 已保存'); await invalidateChannel(channelId, true); },
  });
  const deleteHeader = useMutation({
    mutationFn: async (headerId: string) => ensureSuccess(await api.DELETE('/api/v1/ai-channel-headers/{header_id}', {
      params: { path: { header_id: headerId }, header: csrfHeader() },
    })),
    onSuccess: async () => { message.success('Header 已删除'); await invalidateChannel(channelId, true); },
  });
  const discover = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/ai-channels/{channel_id}/discover-models', {
      params: { path: { channel_id: channelId }, header: csrfHeader() },
    })),
    onSuccess: (data) => setDiscovered(data.items.map((item) => item.model_id)),
    onSettled: async () => queryClient.invalidateQueries({ queryKey: ['ai-channel-audit-logs', channelId] }),
  });
  const createDiscoveredModel = useMutation({
    mutationFn: async (modelId: string) => unwrap(await api.POST('/api/v1/ai-channels/{channel_id}/models', {
      params: { path: { channel_id: channelId }, header: csrfHeader() },
      body: { display_name: modelId, model_id: modelId, request_parameters: {} },
    })),
    onSuccess: async () => invalidateChannel(channelId, true),
  });
  const createModel = useMutation({
    mutationFn: async (values: ModelFormValues) => unwrap(await api.POST('/api/v1/ai-channels/{channel_id}/models', {
      params: { path: { channel_id: channelId }, header: csrfHeader() },
      body: {
        display_name: values.display_name,
        model_id: values.model_id,
        request_parameters: parseRequestParameters(values.request_parameters_json),
      },
    })),
    onSuccess: async () => { setModelOpen(false); await invalidateChannel(channelId, true); },
  });
  const updateModel = useMutation({
    mutationFn: async (values: ModelFormValues) => {
      if (!editingModel) throw new Error('模型未加载');
      return unwrap(await api.PATCH('/api/v1/ai-models/{model_id}', {
        params: { path: { model_id: editingModel.id }, header: csrfHeader() },
        body: {
          expected_revision: editingModel.revision,
          display_name: values.display_name,
          model_id: values.model_id,
          request_parameters: parseRequestParameters(values.request_parameters_json),
        },
      }));
    },
    onSuccess: async () => { setEditingModel(undefined); message.success('模型配置已保存'); await invalidateChannel(channelId, true); },
  });
  const testModel = useMutation({
    mutationFn: async (model: AIModel) => unwrap(await api.POST('/api/v1/ai-models/{model_id}/test', {
      params: { path: { model_id: model.id }, header: csrfHeader() },
    })),
    onSuccess: async (tested) => {
      if (tested.test_status === 'PASSED') message.success('连接测试成功，模型已保持停用');
      else message.error(tested.last_test_error_summary || '连接测试失败');
      await invalidateChannel(channelId, true);
    },
  });
  const toggleModel = useMutation({
    mutationFn: async (model: AIModel) => {
      const path = model.is_enabled
        ? '/api/v1/ai-models/{model_id}/disable' as const
        : '/api/v1/ai-models/{model_id}/enable' as const;
      return unwrap(await api.POST(path, {
        params: { path: { model_id: model.id }, header: csrfHeader() },
        body: { expected_revision: model.revision },
      }));
    },
    onSuccess: async (_, model) => { message.success(model.is_enabled ? '模型已停用' : '模型已启用'); await invalidateChannel(channelId, true); },
  });
  const deleteModel = useMutation({
    mutationFn: async (model: AIModel) => ensureSuccess(await api.DELETE('/api/v1/ai-models/{model_id}', {
      params: { path: { model_id: model.id }, header: csrfHeader() },
    })),
    onSuccess: async () => { message.success('模型已删除'); await invalidateChannel(channelId, true); },
  });

  useEffect(() => {
    if (!keyOpen && !replaceKey.isPending && replaceKey.variables !== undefined) {
      replaceKey.reset();
    }
  }, [keyOpen, replaceKey]);
  useEffect(() => {
    if (!headerOpen && !editingHeader && !addHeader.isPending && !updateHeader.isPending) {
      if (addHeader.variables !== undefined) addHeader.reset();
      if (updateHeader.variables !== undefined) updateHeader.reset();
    }
  }, [addHeader, editingHeader, headerOpen, updateHeader]);

  if (!channelId) return <Empty description="缺少渠道 ID" />;
  if (channel.isLoading) return <QueryLoading label="正在加载渠道详情" />;
  if (channel.error) return <QueryFailure error={channel.error} onRetry={() => void channel.refetch()} />;
  if (!channel.data) return null;
  const data = channel.data;
  const channelError = toggleChannel.error ?? deleteChannel.error;
  const requestError = replaceKey.error ?? addHeader.error ?? updateHeader.error ?? deleteHeader.error;
  const modelError = discover.error ?? createDiscoveredModel.error ?? createModel.error ?? updateModel.error ?? testModel.error ?? toggleModel.error ?? deleteModel.error;

  const changeTab = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (key === 'basic') next.delete('tab'); else next.set('tab', key);
    setSearchParams(next);
  };
  const confirmTestModel = (model: AIModel) => modal.confirm({
    title: `测试模型“${model.display_name}”？`,
    content: '服务端会使用当前渠道真实配置发送“hi”。测试完成后模型将停用，通过后需手动重新启用。',
    okText: '开始测试',
    cancelText: '取消',
    onOk: () => testModel.mutateAsync(model),
  });
  const copyConfiguration = async () => {
    if (!models.data) {
      message.error('模型配置尚未加载完成');
      return;
    }
    const copied = {
      name: data.name,
      description: data.description,
      protocol_type: data.protocol_type,
      provider_brand: data.provider_brand,
      base_url: data.base_url,
      timeout_seconds: data.timeout_seconds,
      headers: data.headers.map((header) => header.is_sensitive
        ? { name: header.name, is_sensitive: true, is_configured: header.is_configured }
        : { name: header.name, is_sensitive: false, value: header.value }),
      models: models.data.items.map((model) => ({
        display_name: model.display_name,
        model_id: model.model_id,
        request_parameters: model.request_parameters,
      })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(copied, null, 2));
      message.success('已复制非敏感配置');
    } catch {
      message.error('浏览器拒绝写入剪贴板');
    }
  };

  const basicContent = <div className="ai-detail-section">
    {channelError && <Alert role="alert" type="error" showIcon title={errorMessage(channelError)} />}
    <section className="ai-basic-card">
      <div className="ai-section-heading"><strong>基本信息</strong><Button size="small" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>编辑</Button></div>
      <Descriptions column={1} size="small" colon={false} className="ai-basic-descriptions" items={[
        { key: 'name', label: '渠道名称', children: data.name },
        { key: 'description', label: '描述', children: data.description || '—' },
        { key: 'url', label: 'API 根地址', children: <Typography.Link href={data.base_url} target="_blank" rel="noreferrer" className="ai-detail-url">{data.base_url}</Typography.Link> },
        { key: 'state', label: '状态', children: <StatusTag status={data.is_enabled ? 'ENABLED' : 'DISABLED'} /> },
        { key: 'key', label: 'API Key', children: data.api_key_configured ? <Space size={4} wrap><span className="ai-configured">✓ 已配置（••••••）</span><Button type="link" size="small" onClick={() => setKeyOpen(true)}>重新配置</Button></Space> : <Button type="link" size="small" onClick={() => setKeyOpen(true)}>未配置，立即配置</Button> },
        { key: 'headers', label: '请求 Header', children: `${data.headers.length} 个` },
        { key: 'timeout', label: '超时时间', children: `${data.timeout_seconds} 秒` },
        { key: 'retry', label: '重试策略', children: '仅手动重试' },
        { key: 'created', label: '创建时间', children: new Date(data.created_at).toLocaleString('zh-CN') },
        { key: 'updated', label: '更新时间', children: new Date(data.updated_at).toLocaleString('zh-CN') },
        { key: 'creator', label: '创建人', children: userNames.get(data.created_by) ?? data.created_by },
      ]} />
    </section>
    <section className="ai-quick-actions">
      <strong>快捷操作</strong>
      <div>
        <Button icon={<ThunderboltOutlined />} disabled={!workspace} onClick={() => workspace?.openConnectionTest(data)}>测试连接</Button>
        <Button danger={data.is_enabled} loading={toggleChannel.isPending} onClick={() => toggleChannel.mutate()}>{data.is_enabled ? '停用渠道' : '启用渠道'}</Button>
        <Button icon={<CopyOutlined />} onClick={() => void copyConfiguration()}>复制配置</Button>
        <Popconfirm
          title="删除此 AI 渠道？"
          description="当前 Header 与模型会删除；未执行作业将明确失败，历史快照保留。"
          okText="删除渠道"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => deleteChannel.mutate()}
        ><Button danger icon={<DeleteOutlined />} loading={deleteChannel.isPending}>删除渠道</Button></Popconfirm>
      </div>
    </section>
  </div>;

  const requestContent = <div className="ai-detail-section">
    {requestError && <Alert role="alert" type="error" showIcon title={errorMessage(requestError)} />}
    <div className="ai-request-key-card"><span><KeyOutlined /><span><strong>API Key</strong><small>{data.api_key_configured ? '已安全配置（••••••）' : '尚未配置'}</small></span></span><Button onClick={() => setKeyOpen(true)}>重新配置</Button></div>
    <div className="ai-section-heading"><strong>请求 Header</strong><Button size="small" icon={<PlusOutlined />} onClick={() => setHeaderOpen(true)}>新增</Button></div>
    {data.headers.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置请求 Header" /> : <TableRegion label="请求 Header 列表"><Table<Header>
      size="small" rowKey="id" dataSource={data.headers} pagination={false} scroll={{ x: 360 }} columns={[
        { title: '名称', dataIndex: 'name', ellipsis: true, render: (value) => <span className="data-code">{value}</span> },
        { title: '类型', dataIndex: 'is_sensitive', width: 64, render: (value) => <Tag>{value ? '敏感' : '普通'}</Tag> },
        { title: '值', width: 100, render: (_, row) => row.is_sensitive ? '••••••' : (row.value ?? '—') },
        { title: '操作', fixed: 'right', width: 86, render: (_, row) => <Dropdown trigger={['click']} menu={{
          items: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除', danger: true }],
          onClick: ({ key }) => key === 'edit' ? setEditingHeader(row) : modal.confirm({ title: `删除 Header“${row.name}”？`, okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => deleteHeader.mutateAsync(row.id) }),
        }}><Button size="small" type="text" icon={<DownOutlined />} aria-label={`更多操作：Header ${row.name}`} /></Dropdown> },
      ]}
    /></TableRegion>}
  </div>;

  const modelContent = <div className="ai-detail-section">
    {modelError && <Alert role="alert" type="error" showIcon title={errorMessage(modelError)} />}
    <div className="ai-section-heading"><strong>模型管理</strong><Space size={4}><Button size="small" onClick={() => { setDiscoveryOpen(true); setDiscovered([]); discover.reset(); discover.mutate(); }}>获取模型</Button><Button size="small" type="primary" onClick={() => setModelOpen(true)}>添加</Button></Space></div>
    {models.isLoading ? <QueryLoading label="正在加载模型" /> : models.error || !models.data ? <QueryFailure error={models.error ?? new Error('模型列表不存在')} onRetry={() => void models.refetch()} /> : models.data.items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置模型" /> : <TableRegion label="模型列表"><Table<AIModel>
      size="small" rowKey="id" dataSource={models.data.items} pagination={false} scroll={{ x: 520 }} columns={[
        { title: '模型', width: 150, render: (_, row) => <span className="ai-model-name"><strong>{row.display_name}</strong><small>{row.model_id}</small></span> },
        { title: '测试', dataIndex: 'test_status', width: 76, render: (value) => <StatusTag compact status={value} /> },
        { title: '启用', dataIndex: 'is_enabled', width: 64, render: (value) => <StatusTag compact status={value ? 'ENABLED' : 'DISABLED'} /> },
        { title: '操作', fixed: 'right', width: 126, render: (_, row) => <Space size={2}>
          <Button size="small" type="text" icon={<ThunderboltOutlined />} aria-label={`测试模型：${row.display_name}`} loading={testModel.isPending && testModel.variables?.id === row.id} onClick={() => confirmTestModel(row)} />
          <Dropdown trigger={['click']} menu={{
            items: [
              { key: 'toggle', label: row.is_enabled ? '停用' : '启用' },
              { key: 'edit', label: '编辑' },
              { key: 'delete', label: '删除', danger: true },
            ],
            onClick: ({ key }) => key === 'toggle' ? toggleModel.mutate(row) : key === 'edit' ? setEditingModel(row) : modal.confirm({ title: `删除模型“${row.display_name}”？`, content: '历史作业快照会保留，但未执行的关联作业将因配置缺失而失败。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => deleteModel.mutateAsync(row) }),
          }}><Button size="small" type="text" icon={<DownOutlined />} aria-label={`更多模型操作：${row.display_name}`} /></Dropdown>
        </Space> },
      ]}
    /></TableRegion>}
  </div>;

  const usageContent = <div className="ai-detail-section">
    <div className="ai-section-heading"><strong>使用统计</strong><Select size="small" aria-label="统计时间范围" value={usagePeriod} onChange={setUsagePeriod} options={[
      { value: '7d', label: '最近 7 天' }, { value: '30d', label: '最近 30 天' }, { value: '90d', label: '最近 90 天' }, { value: 'all', label: '全部时间' },
    ]} /></div>
    {usage.isLoading ? <QueryLoading label="正在加载使用统计" /> : usage.error || !usage.data ? <QueryFailure error={usage.error ?? new Error('统计不存在')} onRetry={() => void usage.refetch()} /> : <>
      <div className="ai-usage-grid">
        <MetricTile label="业务作业" value={usage.data.total_jobs} tone="data" />
        <MetricTile label="成功 / 失败" value={`${usage.data.succeeded_jobs} / ${usage.data.failed_jobs}`} tone="warning" />
        <MetricTile label="成功率" value={usage.data.success_rate === null ? '暂无数据' : `${(usage.data.success_rate * 100).toFixed(1)}%`} tone="success" />
        <MetricTile label="平均响应" value={optionalMetric(usage.data.average_response_duration_ms, ' ms')} />
      </div>
      <Descriptions column={1} size="small" colon={false} items={[
        { key: 'prompt', label: '已报告输入 Token', children: optionalMetric(usage.data.prompt_tokens) },
        { key: 'completion', label: '已报告输出 Token', children: optionalMetric(usage.data.completion_tokens) },
        { key: 'total', label: '已报告 Token 合计', children: optionalMetric(usage.data.total_tokens) },
        { key: 'last', label: '最近使用', children: usage.data.last_used_at ? new Date(usage.data.last_used_at).toLocaleString('zh-CN') : '暂无数据' },
      ]} />
    </>}
  </div>;

  const logsContent = <div className="ai-detail-section">
    <div className="ai-section-heading"><strong>操作日志</strong></div>
    {logs.isLoading ? <QueryLoading label="正在加载操作日志" /> : logs.error || !logs.data ? <QueryFailure error={logs.error ?? new Error('操作日志不存在')} onRetry={() => void logs.refetch()} /> : logs.data.items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无渠道操作日志" /> : <TableRegion label="渠道操作日志"><Table<Schema<'AuditLog'>>
      size="small" rowKey="id" dataSource={logs.data.items} pagination={{ current: logPage, pageSize: 20, total: logs.data.total, showSizeChanger: false, onChange: setLogPage }} scroll={{ x: 600 }} columns={[
        { title: '时间', dataIndex: 'created_at', width: 142, render: (value) => new Date(value).toLocaleString('zh-CN') },
        { title: '动作', dataIndex: 'action', width: 160 },
        { title: '操作者', dataIndex: 'actor_id', width: 110, render: (value) => userNames.get(value) ?? value },
        { title: '执行结果', dataIndex: 'outcome', width: 82, render: (value) => <StatusTag compact status={value} /> },
        { title: '对象', width: 155, render: (_, row) => `${row.target_type} / ${row.target_id}` },
        { title: '请求 ID', dataIndex: 'request_id', width: 190 },
      ]}
    /></TableRegion>}
  </div>;

  const tabContents: Record<AIChannelDetailTab, ReactNode> = {
    basic: basicContent,
    request: requestContent,
    models: modelContent,
    usage: usageContent,
    logs: logsContent,
  };

  return <div className="ai-detail-panel">
    {modalContext}
    <header className="ai-detail-header">
      <AIProviderMark brand={data.provider_brand} />
      <div><Typography.Title level={5}>{data.name}</Typography.Title><Typography.Text type="secondary">{providerBrandLabels[data.provider_brand]} · {data.protocol_type}</Typography.Text></div>
      <StatusTag status={data.is_enabled ? 'ENABLED' : 'DISABLED'} />
    </header>
    <Tabs
      className="ai-detail-tabs"
      activeKey={tab}
      onChange={changeTab}
      items={detailTabs.map((item) => ({ key: item.key, label: item.label }))}
    />
    <div className="ai-detail-scroll">{tabContents[tab]}</div>
    <AIChannelFormModal open={editOpen} channel={data} loading={updateChannel.isPending} error={updateChannel.error} onCancel={() => { setEditOpen(false); updateChannel.reset(); }} onSubmit={(values) => updateChannel.mutate(values)} />
    <Modal title="重新配置 API Key" open={keyOpen} footer={null} destroyOnHidden onCancel={() => { setKeyOpen(false); replaceKey.reset(); }}>
      <Alert type="warning" showIcon title="保存后渠道会停用，所有模型测试状态将重置。原密钥不会回显。" />
      {replaceKey.error && <Alert role="alert" type="error" showIcon title={errorMessage(replaceKey.error)} />}
      <Form<{ api_key: string }> layout="vertical" onFinish={(body) => replaceKey.mutate(body)}>
        <Form.Item name="api_key" label="新的 API Key" rules={[{ required: true }]}><Input.Password autoComplete="new-password" autoFocus /></Form.Item>
        <Button type="primary" htmlType="submit" loading={replaceKey.isPending}>保存并重置连接状态</Button>
      </Form>
    </Modal>
    <HeaderModal open={headerOpen || !!editingHeader} editing={editingHeader} loading={addHeader.isPending || updateHeader.isPending} onCancel={() => { setHeaderOpen(false); setEditingHeader(undefined); }} onSubmit={(body) => editingHeader ? updateHeader.mutate(body) : addHeader.mutate(body)} />
    <ModelModal open={modelOpen || !!editingModel} editing={editingModel} loading={createModel.isPending || updateModel.isPending} onCancel={() => { setModelOpen(false); setEditingModel(undefined); }} onSubmit={(body) => editingModel ? updateModel.mutate(body) : createModel.mutate(body)} />
    <ModelDiscoveryModal open={discoveryOpen} modelIds={discovered} configuredModelIds={models.data?.items.map((item) => item.model_id) ?? []} loading={discover.isPending} addingModelId={createDiscoveredModel.isPending ? createDiscoveredModel.variables : undefined} fetchError={discover.error ? errorMessage(discover.error) : undefined} addError={createDiscoveredModel.error ? errorMessage(createDiscoveredModel.error) : undefined} onCancel={() => setDiscoveryOpen(false)} onRefresh={() => { setDiscovered([]); discover.reset(); discover.mutate(); }} onAdd={(modelId) => createDiscoveredModel.mutate(modelId)} />
  </div>;
}

function HeaderModal({ open, editing, loading, onCancel, onSubmit }: { open: boolean; editing?: Header; loading: boolean; onCancel: () => void; onSubmit: (body: Omit<Schema<'AIChannelHeaderCreate'>, 'expected_channel_revision'>) => void }) {
  return <Modal title={editing ? '编辑 Header' : '新增 Header'} open={open} onCancel={onCancel} footer={null} destroyOnHidden><Form key={editing?.id ?? 'new'} layout="vertical" initialValues={{ name: editing?.name, value: editing?.value ?? '', is_sensitive: editing?.is_sensitive ?? false }} onFinish={onSubmit}><Form.Item name="name" label="Header 名" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="value" label="值" rules={[{ required: true }]}><Input.Password placeholder={editing?.is_sensitive ? '敏感值不会回显，请输入替换值' : undefined} /></Form.Item><Form.Item name="is_sensitive" label="类型"><Select options={[{ value: false, label: '普通' }, { value: true, label: '敏感且永不回显' }]} /></Form.Item><Button type="primary" htmlType="submit" loading={loading}>保存</Button></Form></Modal>;
}

function ModelModal({ open, editing, loading, onCancel, onSubmit }: { open: boolean; editing?: AIModel; loading: boolean; onCancel: () => void; onSubmit: (body: ModelFormValues) => void }) {
  return <Modal title={editing ? '编辑模型' : '添加模型'} open={open} onCancel={onCancel} footer={null} destroyOnHidden><Form<ModelFormValues> key={editing?.id ?? 'new'} layout="vertical" initialValues={{ display_name: editing?.display_name, model_id: editing?.model_id, request_parameters_json: JSON.stringify(editing?.request_parameters ?? {}, null, 2) }} onFinish={onSubmit}><Form.Item name="display_name" label="显示名" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="model_id" label="model_id" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="request_parameters_json" label="自定义请求参数 JSON"><Input.TextArea rows={6} className="markdown-source" /></Form.Item><Button type="primary" htmlType="submit" loading={loading}>保存</Button></Form></Modal>;
}
