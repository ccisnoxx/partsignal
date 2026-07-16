/** 在稳定路由中管理单个 AI 渠道的连接、Header 与模型。 */
import { DeleteOutlined, DownOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Dropdown, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { AIModel, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { ModelDiscoveryModal } from './ModelDiscoveryModal';

type Header = Schema<'AIChannelHeader'>;
type ModelFormValues = { display_name: string; model_id: string; request_parameters_json: string };

async function invalidateChannel(channelId: string, includeModels: boolean) {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.detail(channelId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.all }),
  ];
  if (includeModels) invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.models(channelId) }));
  await Promise.all(invalidations);
}

function parseRequestParameters(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value || '{}');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('请求参数必须是 JSON 对象');
  return parsed as Record<string, unknown>;
}

export function AIChannelDetailPage() {
  const { channelId = '' } = useParams();
  const navigate = useNavigate();
  const [headerOpen, setHeaderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [editingHeader, setEditingHeader] = useState<Header>();
  const [editingModel, setEditingModel] = useState<AIModel>();
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [modal, modalContext] = Modal.useModal();
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
  const updateChannel = useMutation({
    mutationFn: async (body: { name: string; base_url: string; timeout_seconds: number }) => {
      if (!channel.data) throw new Error('渠道未加载');
      return unwrap(await api.PATCH('/api/v1/ai-channels/{channel_id}', { params: { path: { channel_id: channelId }, header: csrfHeader() }, body: { ...body, expected_revision: channel.data.revision } }));
    },
    onSuccess: async () => invalidateChannel(channelId, true),
  });
  const replaceKey = useMutation({
    mutationFn: async (body: { api_key: string }) => {
      if (!channel.data) throw new Error('渠道未加载');
      return unwrap(await api.PUT('/api/v1/ai-channels/{channel_id}/api-key', { params: { path: { channel_id: channelId }, header: csrfHeader() }, body: { ...body, expected_revision: channel.data.revision } }));
    },
    onSuccess: async () => invalidateChannel(channelId, true),
  });
  const toggleChannel = useMutation({
    mutationFn: async () => {
      if (!channel.data) throw new Error('渠道未加载');
      const path = channel.data.is_enabled ? '/api/v1/ai-channels/{channel_id}/disable' as const : '/api/v1/ai-channels/{channel_id}/enable' as const;
      return unwrap(await api.POST(path, { params: { path: { channel_id: channelId }, header: csrfHeader() }, body: { expected_revision: channel.data.revision } }));
    },
    onSuccess: async () => invalidateChannel(channelId, false),
  });
  const deleteChannel = useMutation({
    mutationFn: async () => ensureSuccess(await api.DELETE('/api/v1/ai-channels/{channel_id}', { params: { path: { channel_id: channelId }, header: csrfHeader() } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: queryKeys.aiChannels.detail(channelId) });
      queryClient.removeQueries({ queryKey: queryKeys.aiChannels.models(channelId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.all });
      navigate('/configuration/ai', { replace: true });
    },
  });
  const addHeader = useMutation({
    mutationFn: async (body: Omit<Schema<'AIChannelHeaderCreate'>, 'expected_channel_revision'>) => {
      if (!channel.data) throw new Error('渠道未加载');
      return unwrap(await api.POST('/api/v1/ai-channels/{channel_id}/headers', { params: { path: { channel_id: channelId }, header: csrfHeader() }, body: { ...body, expected_channel_revision: channel.data.revision } }));
    },
    onSuccess: async () => { setHeaderOpen(false); await invalidateChannel(channelId, true); },
  });
  const updateHeader = useMutation({
    mutationFn: async (body: Omit<Schema<'AIChannelHeaderUpdate'>, 'expected_channel_revision'>) => {
      if (!channel.data || !editingHeader) throw new Error('Header 未加载');
      return unwrap(await api.PATCH('/api/v1/ai-channel-headers/{header_id}', { params: { path: { header_id: editingHeader.id }, header: csrfHeader() }, body: { ...body, expected_channel_revision: channel.data.revision } }));
    },
    onSuccess: async () => { setEditingHeader(undefined); await invalidateChannel(channelId, true); },
  });
  const deleteHeader = useMutation({
    mutationFn: async (headerId: string) => ensureSuccess(await api.DELETE('/api/v1/ai-channel-headers/{header_id}', { params: { path: { header_id: headerId }, header: csrfHeader() } })),
    onSuccess: async () => invalidateChannel(channelId, true),
  });
  const discover = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/ai-channels/{channel_id}/discover-models', { params: { path: { channel_id: channelId }, header: csrfHeader() } })),
    onSuccess: (data) => setDiscovered(data.items.map((item) => item.model_id)),
  });
  const createDiscoveredModel = useMutation({
    mutationFn: async (modelId: string) => unwrap(await api.POST('/api/v1/ai-channels/{channel_id}/models', { params: { path: { channel_id: channelId }, header: csrfHeader() }, body: { display_name: modelId, model_id: modelId, request_parameters: {} } })),
    onSuccess: async () => invalidateChannel(channelId, true),
  });
  const createModel = useMutation({
    mutationFn: async (values: ModelFormValues) => unwrap(await api.POST('/api/v1/ai-channels/{channel_id}/models', { params: { path: { channel_id: channelId }, header: csrfHeader() }, body: { display_name: values.display_name, model_id: values.model_id, request_parameters: parseRequestParameters(values.request_parameters_json) } })),
    onSuccess: async () => { setModelOpen(false); await invalidateChannel(channelId, true); },
  });
  const updateModel = useMutation({
    mutationFn: async (values: ModelFormValues) => {
      if (!editingModel) throw new Error('模型未加载');
      return unwrap(await api.PATCH('/api/v1/ai-models/{model_id}', { params: { path: { model_id: editingModel.id }, header: csrfHeader() }, body: { expected_revision: editingModel.revision, display_name: values.display_name, model_id: values.model_id, request_parameters: parseRequestParameters(values.request_parameters_json) } }));
    },
    onSuccess: async () => { setEditingModel(undefined); await invalidateChannel(channelId, true); },
  });
  const testModel = useMutation({ mutationFn: async (model: AIModel) => unwrap(await api.POST('/api/v1/ai-models/{model_id}/test', { params: { path: { model_id: model.id }, header: csrfHeader() } })), onSuccess: async () => invalidateChannel(channelId, true) });
  const toggleModel = useMutation({
    mutationFn: async (model: AIModel) => {
      const path = model.is_enabled ? '/api/v1/ai-models/{model_id}/disable' as const : '/api/v1/ai-models/{model_id}/enable' as const;
      return unwrap(await api.POST(path, { params: { path: { model_id: model.id }, header: csrfHeader() }, body: { expected_revision: model.revision } }));
    },
    onSuccess: async () => invalidateChannel(channelId, true),
  });
  const deleteModel = useMutation({ mutationFn: async (model: AIModel) => ensureSuccess(await api.DELETE('/api/v1/ai-models/{model_id}', { params: { path: { model_id: model.id }, header: csrfHeader() } })), onSuccess: async () => invalidateChannel(channelId, true) });

  if (!channelId) return <div className="page-stack"><QueryFailure error={new Error('缺少渠道 ID')} /></div>;
  if (channel.isLoading) return <div className="page-stack"><QueryLoading label="正在加载 AI 渠道详情" /></div>;
  if (channel.error) return <div className="page-stack"><PageHeader title="AI 渠道" breadcrumbs={[{ title: <Link to="/configuration/ai">AI 配置</Link> }, { title: '渠道详情' }]} /><QueryFailure error={channel.error} onRetry={() => void channel.refetch()} /></div>;
  if (!channel.data) return null;
  const connectionError = updateChannel.error ?? replaceKey.error ?? toggleChannel.error ?? deleteChannel.error;
  const headerError = addHeader.error ?? updateHeader.error ?? deleteHeader.error;
  const modelError = models.error ?? createModel.error ?? updateModel.error ?? testModel.error ?? toggleModel.error ?? deleteModel.error;

  const confirmDeleteModel = (model: AIModel) => modal.confirm({
    title: `删除模型“${model.display_name}”？`,
    content: '此操作不可撤销。',
    okText: '删除',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk: () => deleteModel.mutateAsync(model),
  });

  return <div className="page-stack">
    {modalContext}
    <PageHeader eyebrow="模型治理" title={channel.data.name} description="渠道凭据和敏感 Header 永不回显；连接变更会重置模型测试状态。" breadcrumbs={[{ title: <Link to="/configuration/ai">AI 配置</Link> }, { title: channel.data.name }]} actions={<Space wrap><StatusTag status={channel.data.is_enabled ? 'ACTIVE' : 'RETIRED'} /><Button loading={toggleChannel.isPending} onClick={() => toggleChannel.mutate()}>{channel.data.is_enabled ? '停用渠道' : '启用渠道'}</Button><Popconfirm title="删除此 AI 渠道？" description="渠道、Header 与模型配置将被删除，此操作不可撤销。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteChannel.mutate()}><Button danger icon={<DeleteOutlined />} loading={deleteChannel.isPending}>删除渠道</Button></Popconfirm></Space>} />
    <Card title="连接与凭据" className="configuration-section-card">
      {connectionError && <Alert role="alert" type="error" showIcon message={errorMessage(connectionError)} />}
      <Form key={channel.data.revision} layout="vertical" className="configuration-connection-form" initialValues={{ name: channel.data.name, base_url: channel.data.base_url, timeout_seconds: channel.data.timeout_seconds }} onFinish={(body) => updateChannel.mutate(body)}>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="base_url" label="API 根地址" rules={[{ required: true, type: 'url' }]}><Input /></Form.Item>
        <Form.Item name="timeout_seconds" label="超时秒数" rules={[{ required: true }]}><InputNumber min={10} max={600} /></Form.Item>
        <Button htmlType="submit" loading={updateChannel.isPending}>更新连接</Button>
      </Form>
      <div className="configuration-credential-panel"><div><Typography.Text strong>API Key</Typography.Text><Typography.Paragraph type="secondary">{channel.data.api_key_configured ? `已配置，最近更新于 ${new Date(channel.data.api_key_updated_at).toLocaleString('zh-CN')}` : '未配置'}。原值不会回显。</Typography.Paragraph></div><Form<{ api_key: string }> layout="inline" onFinish={(body) => replaceKey.mutate(body)}><Form.Item name="api_key" rules={[{ required: true, message: '请输入新的 API Key' }]}><Input.Password aria-label="新的 API Key" placeholder="输入新的 API Key" /></Form.Item><Button htmlType="submit" loading={replaceKey.isPending}>替换并重置测试</Button></Form></div>
    </Card>
    <Card title="请求 Header" className="configuration-section-card" extra={<Button icon={<PlusOutlined />} onClick={() => setHeaderOpen(true)}>新增 Header</Button>}>
      {headerError && <Alert role="alert" type="error" showIcon message={errorMessage(headerError)} />}
      {channel.data.headers.length === 0 ? <NoData description="尚未配置请求 Header" /> : <TableRegion label="请求 Header 列表"><Table<Header> rowKey="id" dataSource={channel.data.headers} pagination={false} scroll={{ x: 680 }} columns={[
        { title: '名称', dataIndex: 'name', render: (value) => <span className="data-code configuration-break-text">{value}</span> },
        { title: '敏感性', dataIndex: 'is_sensitive', render: (value) => value ? '敏感' : '普通' },
        { title: '配置状态', dataIndex: 'is_configured', render: (value) => value ? '已配置' : '未配置' },
        { title: '可见值', dataIndex: 'value', render: (value, row) => row.is_sensitive ? '已配置且不回显' : (value ?? '—') },
        { title: '操作', render: (_, row) => <Space><Button size="small" onClick={() => setEditingHeader(row)}>编辑</Button><Popconfirm title={`删除 Header“${row.name}”？`} okText="删除" cancelText="取消" onConfirm={() => deleteHeader.mutate(row.id)}><Button size="small" danger>删除</Button></Popconfirm></Space> },
      ]} /></TableRegion>}
    </Card>
    <Card title="模型" className="configuration-section-card" extra={<Space><Button onClick={() => { setDiscoveryOpen(true); setDiscovered([]); discover.reset(); createDiscoveredModel.reset(); discover.mutate(); }}>获取模型</Button><Button type="primary" onClick={() => setModelOpen(true)}>手动添加</Button></Space>}>
      {modelError && <Alert role="alert" type="error" showIcon message={errorMessage(modelError)} />}
      {models.isLoading ? <QueryLoading label="正在加载模型" /> : models.data?.items.length === 0 ? <NoData description="尚未配置模型" /> : <TableRegion label="模型列表"><Table<AIModel> rowKey="id" dataSource={models.data?.items} scroll={{ x: 1120 }} columns={[
        { title: '显示名', dataIndex: 'display_name' },
        { title: 'model_id', dataIndex: 'model_id', render: (value) => <span className="data-code configuration-break-text">{value}</span> },
        { title: '测试状态', dataIndex: 'test_status', render: (value) => <StatusTag status={value} /> },
        { title: '启停状态', dataIndex: 'is_enabled', render: (value) => <StatusTag status={value ? 'ACTIVE' : 'RETIRED'} /> },
        { title: '最近测试', render: (_, row) => row.last_tested_at ? <Space direction="vertical" size={0}><span>{new Date(row.last_tested_at).toLocaleString('zh-CN')}</span>{row.last_test_error_summary && <Typography.Text type="danger">{row.last_test_error_summary}</Typography.Text>}</Space> : '尚未测试' },
        { title: '请求参数', dataIndex: 'request_parameters', render: (value: Record<string, unknown>) => Object.keys(value).length ? `${Object.keys(value).slice(0, 3).join('、')}${Object.keys(value).length > 3 ? ` 等 ${Object.keys(value).length} 项` : ''}` : '无自定义参数' },
        { title: '操作', fixed: 'right', width: 290, render: (_, row) => <Space><Button size="small" loading={testModel.isPending && testModel.variables?.id === row.id} onClick={() => testModel.mutate(row)}>测试连接</Button><Button size="small" loading={toggleModel.isPending && toggleModel.variables?.id === row.id} onClick={() => toggleModel.mutate(row)}>{row.is_enabled ? '停用' : '启用'}</Button><Dropdown menu={{ items: [{ key: 'edit', label: '编辑' }, { key: 'delete', label: '删除', danger: true }], onClick: ({ key }) => key === 'edit' ? setEditingModel(row) : confirmDeleteModel(row) }}><Button size="small">更多 <DownOutlined /></Button></Dropdown></Space> },
      ]} /></TableRegion>}
    </Card>
    <ModelDiscoveryModal open={discoveryOpen} modelIds={discovered} configuredModelIds={models.data?.items.map((item) => item.model_id) ?? []} loading={discover.isPending} addingModelId={createDiscoveredModel.isPending ? createDiscoveredModel.variables : undefined} fetchError={discover.error ? errorMessage(discover.error) : undefined} addError={createDiscoveredModel.error ? errorMessage(createDiscoveredModel.error) : undefined} onCancel={() => setDiscoveryOpen(false)} onRefresh={() => { setDiscovered([]); discover.reset(); discover.mutate(); }} onAdd={(modelId) => createDiscoveredModel.mutate(modelId)} />
    <HeaderModal open={headerOpen || !!editingHeader} editing={editingHeader} loading={addHeader.isPending || updateHeader.isPending} onCancel={() => { setHeaderOpen(false); setEditingHeader(undefined); }} onSubmit={(body) => editingHeader ? updateHeader.mutate(body) : addHeader.mutate(body)} />
    <ModelModal open={modelOpen || !!editingModel} editing={editingModel} loading={createModel.isPending || updateModel.isPending} onCancel={() => { setModelOpen(false); setEditingModel(undefined); }} onSubmit={(body) => editingModel ? updateModel.mutate(body) : createModel.mutate(body)} />
  </div>;
}

function HeaderModal({ open, editing, loading, onCancel, onSubmit }: { open: boolean; editing?: Header; loading: boolean; onCancel: () => void; onSubmit: (body: Omit<Schema<'AIChannelHeaderCreate'>, 'expected_channel_revision'>) => void }) {
  return <Modal title={editing ? '编辑 Header' : '新增 Header'} open={open} onCancel={onCancel} footer={null} destroyOnHidden><Form key={editing?.id ?? 'new'} layout="vertical" initialValues={{ name: editing?.name, value: editing?.value ?? '', is_sensitive: editing?.is_sensitive ?? false }} onFinish={onSubmit}><Form.Item name="name" label="Header 名" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="value" label="值" rules={[{ required: true }]}><Input.Password placeholder={editing?.is_sensitive ? '敏感值不会回显，请输入替换值' : undefined} /></Form.Item><Form.Item name="is_sensitive" label="类型"><Select options={[{ value: false, label: '普通' }, { value: true, label: '敏感且永不回显' }]} /></Form.Item><Button type="primary" htmlType="submit" loading={loading}>保存</Button></Form></Modal>;
}

function ModelModal({ open, editing, loading, onCancel, onSubmit }: { open: boolean; editing?: AIModel; loading: boolean; onCancel: () => void; onSubmit: (body: ModelFormValues) => void }) {
  return <Modal title={editing ? '编辑模型' : '添加模型'} open={open} onCancel={onCancel} footer={null} destroyOnHidden><Form<ModelFormValues> key={editing?.id ?? 'new'} layout="vertical" initialValues={{ display_name: editing?.display_name, model_id: editing?.model_id, request_parameters_json: JSON.stringify(editing?.request_parameters ?? {}, null, 2) }} onFinish={onSubmit}><Form.Item name="display_name" label="显示名" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="model_id" label="model_id" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="request_parameters_json" label="自定义请求参数 JSON"><Input.TextArea rows={6} className="markdown-source" /></Form.Item><Button type="primary" htmlType="submit" loading={loading}>保存</Button></Form></Modal>;
}
