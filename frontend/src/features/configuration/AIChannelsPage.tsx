/** 管理 AI 渠道集合，并提供稳定详情路由入口。 */
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Dropdown, Form, Input, InputNumber, Modal, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { AIChannel, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

export function AIChannelsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [modal, modalContext] = Modal.useModal();
  const { message } = App.useApp();
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
    onSuccess: async (_, channel) => { message.success(channel.is_enabled ? '渠道已停用' : '渠道已启用'); await refresh(); },
  });
  const remove = useMutation({
    mutationFn: async (channel: AIChannel) => ensureSuccess(await api.DELETE('/api/v1/ai-channels/{channel_id}', { params: { path: { channel_id: channel.id }, header: csrfHeader() } })),
    onSuccess: async () => { message.success('AI 渠道已删除'); await refresh(); },
  });
  const mutationError = create.error ?? toggle.error ?? remove.error;
  const confirmDelete = (channel: AIChannel) => modal.confirm({ title: '删除此 AI 渠道？', content: '渠道、Header 与模型配置将被删除，此操作不可撤销。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => remove.mutate(channel) });

  return <div className="page-stack">
    {modalContext}
    <PageHeader eyebrow="模型治理" title="AI 配置" description="管理 OpenAI-compatible 渠道、凭据、请求 Header 与模型。敏感凭据永不回显。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增渠道</Button>} />
    {mutationError && <Alert role="alert" type="error" showIcon message={errorMessage(mutationError)} />}
    <Card className="collection-panel">
      {channels.isLoading ? <QueryLoading label="正在加载 AI 渠道" /> : channels.error ? <QueryFailure error={channels.error} onRetry={() => void channels.refetch()} /> : (channels.data?.items.length ?? 0) === 0 ? <NoData description="暂无 AI 渠道" /> : <TableRegion label="AI 渠道列表">
        <Table<AIChannel>
          className="configuration-channel-table"
          rowKey="id"
          dataSource={channels.data?.items}
          pagination={false}
          sticky={{ offsetHeader: 72 }}
          scroll={{ x: 1480 }}
          columns={[
            {
              title: '渠道名称',
              dataIndex: 'name',
              width: 170,
              render: (_, channel) => <Link to={`/configuration/ai/channels/${channel.id}`} aria-label={`查看 ${channel.name} 配置`}>{channel.name}</Link>,
            },
            {
              title: '状态',
              dataIndex: 'is_enabled',
              width: 90,
              render: (enabled: boolean) => <StatusTag status={enabled ? 'ACTIVE' : 'RETIRED'} />,
            },
            {
              title: 'API 根地址',
              dataIndex: 'base_url',
              width: 260,
              render: (baseUrl: string) => <Typography.Text className="data-code configuration-break-text" title={baseUrl}>{baseUrl}</Typography.Text>,
            },
            {
              title: '请求超时',
              dataIndex: 'timeout_seconds',
              width: 100,
              render: (seconds: number) => `${seconds} 秒`,
            },
            {
              title: 'API Key',
              dataIndex: 'api_key_configured',
              width: 190,
              render: (configured: boolean, channel) => configured ? `已配置 · ${new Date(channel.api_key_updated_at).toLocaleString('zh-CN')}` : '未配置',
            },
            {
              title: '请求 Header',
              dataIndex: 'headers',
              width: 110,
              render: (headers: AIChannel['headers']) => `${headers.length} 个`,
            },
            {
              title: '已启用模型',
              dataIndex: 'enabled_models',
              width: 300,
              render: (models: AIChannel['enabled_models'], channel) => <div className="configuration-channel-models-cell" role="region" aria-label={`${channel.name} 已启用模型`}>
                {models.length === 0 ? <span>暂无启用模型</span> : models.map((model) => <Tag key={model.model_id} className="configuration-model-tag"><strong>{model.display_name}</strong><span className="data-code">{model.model_id}</span></Tag>)}
              </div>,
            },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              render: (_, channel) => <Dropdown trigger={['click']} menu={{ items: [{ key: 'toggle', label: channel.is_enabled ? '停用' : '启用' }, { key: 'delete', label: '删除', danger: true }], onClick: ({ key }) => key === 'toggle' ? toggle.mutate(channel) : confirmDelete(channel) }}><Button size="small" aria-label={`更多操作：${channel.name}`} loading={(toggle.isPending && toggle.variables?.id === channel.id) || (remove.isPending && remove.variables?.id === channel.id)}>更多 <DownOutlined /></Button></Dropdown>,
            },
          ]}
        />
      </TableRegion>}
    </Card>
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
