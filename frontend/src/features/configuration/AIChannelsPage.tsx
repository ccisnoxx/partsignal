/** 管理 AI 渠道集合，并提供稳定详情路由入口。 */
import { DeleteOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { AIChannel, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';

export function AIChannelsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const channels = useQuery({
    queryKey: queryKeys.aiChannels.all,
    queryFn: async () => unwrap(await api.GET('/api/v1/ai-channels')),
    staleTime: QUERY_STALE_TIME.configuration,
  });
  const refresh = async () => queryClient.invalidateQueries({ queryKey: queryKeys.aiChannels.all });
  const create = useMutation({
    mutationFn: async (body: Schema<'AIChannelCreate'>) => unwrap(await api.POST('/api/v1/ai-channels', { params: { header: csrfHeader() }, body })),
    onSuccess: async () => { setCreateOpen(false); await refresh(); },
  });
  const toggle = useMutation({
    mutationFn: async (channel: AIChannel) => {
      const path = channel.is_enabled ? '/api/v1/ai-channels/{channel_id}/disable' as const : '/api/v1/ai-channels/{channel_id}/enable' as const;
      return unwrap(await api.POST(path, { params: { path: { channel_id: channel.id }, header: csrfHeader() }, body: { expected_revision: channel.revision } }));
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (channel: AIChannel) => ensureSuccess(await api.DELETE('/api/v1/ai-channels/{channel_id}', { params: { path: { channel_id: channel.id }, header: csrfHeader() } })),
    onSuccess: refresh,
  });
  const mutationError = create.error ?? toggle.error ?? remove.error;

  return <div className="page-stack">
    <PageHeader eyebrow="模型治理" title="AI 配置" description="管理 OpenAI-compatible 渠道、凭据、请求 Header 与模型。敏感凭据永不回显。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增渠道</Button>} />
    {mutationError && <Alert role="alert" type="error" showIcon message={errorMessage(mutationError)} />}
    {channels.isLoading ? <QueryLoading label="正在加载 AI 渠道" /> : channels.error ? <QueryFailure error={channels.error} onRetry={() => void channels.refetch()} /> : (channels.data?.items.length ?? 0) === 0 ? <NoData description="暂无 AI 渠道" /> : (
      <section className="configuration-channel-grid" aria-label="AI 渠道列表">
        {channels.data?.items.map((channel) => <ChannelCard key={channel.id} channel={channel} onToggle={() => toggle.mutate(channel)} onDelete={() => remove.mutate(channel)} toggling={toggle.isPending && toggle.variables?.id === channel.id} deleting={remove.isPending && remove.variables?.id === channel.id} />)}
      </section>
    )}
    <Modal title="新增 AI 渠道" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden>
      <Form<Schema<'AIChannelCreate'>> layout="vertical" initialValues={{ timeout_seconds: 60 }} onFinish={(body) => create.mutate(body)}>
        <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}><Input autoFocus /></Form.Item>
        <Form.Item name="base_url" label="API 根地址" rules={[{ required: true, type: 'url' }]}><Input placeholder="https://provider.example/v1" /></Form.Item>
        <Form.Item name="api_key" label="API Key" rules={[{ required: true }]}><Input.Password /></Form.Item>
        <Form.Item name="timeout_seconds" label="超时秒数" rules={[{ required: true }]}><InputNumber min={10} max={600} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={create.isPending}>创建</Button>
      </Form>
    </Modal>
  </div>;
}

function ChannelCard({ channel, onToggle, onDelete, toggling, deleting }: {
  channel: AIChannel;
  onToggle: () => void;
  onDelete: () => void;
  toggling: boolean;
  deleting: boolean;
}) {
  return <Card className="configuration-channel-card" actions={[
    <Button key="toggle" type="text" loading={toggling} onClick={onToggle}>{channel.is_enabled ? '停用' : '启用'}</Button>,
    <Popconfirm key="delete" title="删除此 AI 渠道？" description="渠道、Header 与模型配置将被删除，此操作不可撤销。" okText="删除" cancelText="取消" okButtonProps={{ danger: true, loading: deleting }} onConfirm={onDelete}><Button type="text" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>,
  ]}>
    <Link className="configuration-channel-link" to={`/configuration/ai/channels/${channel.id}`} aria-label={`查看 ${channel.name} 配置`}>
      <Space className="configuration-channel-title" align="start"><SettingOutlined /><span><Typography.Title level={3}>{channel.name}</Typography.Title><StatusTag status={channel.is_enabled ? 'ACTIVE' : 'RETIRED'} /></span></Space>
      <dl className="configuration-channel-facts">
        <div><dt>API 根地址</dt><dd className="data-code configuration-break-text" title={channel.base_url}>{channel.base_url}</dd></div>
        <div><dt>请求超时</dt><dd>{channel.timeout_seconds} 秒</dd></div>
        <div><dt>API Key</dt><dd>{channel.api_key_configured ? `已配置 · ${new Date(channel.api_key_updated_at).toLocaleString('zh-CN')}` : '未配置'}</dd></div>
        <div><dt>请求 Header</dt><dd>{channel.headers.length} 个</dd></div>
      </dl>
      <section className="configuration-channel-models" aria-label="已启用模型"><Typography.Text type="secondary">已启用模型</Typography.Text><div>{channel.enabled_models.length === 0 ? <span>暂无启用模型</span> : channel.enabled_models.map((model) => <Tag key={model.model_id} className="configuration-model-tag"><strong>{model.display_name}</strong><span className="data-code">{model.model_id}</span></Tag>)}</div></section>
      <span className="configuration-channel-cta">查看配置</span>
    </Link>
  </Card>;
}
