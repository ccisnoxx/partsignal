/** 业务设置仅维护目标问题和公开平台账号标识。 */
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Dropdown, Form, Input, Modal, Select, Table, Tabs } from 'antd';
import { useState } from 'react';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { platformProfilesQueryOptions, queryTopicsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { QueryTopic, Schema } from '../../shared/api/types';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { useAuth } from '../auth/AuthProvider';
import { DeletionError } from '../../shared/components/DeletionError';

const intentOptions: Array<{ label: string; value: Schema<'IntentType'> }> = [
  { label: '品牌', value: 'BRAND' }, { label: '产品', value: 'PRODUCT' },
  { label: '替代选型', value: 'REPLACEMENT' }, { label: '对比', value: 'COMPARISON' },
  { label: '应用', value: 'APPLICATION' }, { label: '故障排查', value: 'TROUBLESHOOTING' },
];
const intentLabels = new Map(intentOptions.map((item) => [item.value, item.label]));

export function SettingsPage() {
  return <div className="page-stack"><PageHeader eyebrow="业务工作区" title="业务设置" description="维护目标问题和公开平台账号标识；用户与 AI 配置由管理员在独立入口管理。" /><Tabs items={[{ key: 'topics', label: '目标问题', children: <TopicsPanel /> }, { key: 'accounts', label: '平台账号标识', children: <PlatformAccountsPanel /> }]} /></div>;
}

function TopicsPanel() {
  const [open, setOpen] = useState(false);
  const topics = useQuery(queryTopicsQueryOptions());
  const create = useMutation({ mutationFn: async (body: Schema<'QueryTopicCreate'>) => unwrap(await api.POST('/api/v1/query-topics', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setOpen(false); await queryClient.invalidateQueries({ queryKey: queryKeys.queryTopics }); } });
  return <Card className="collection-panel" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增问题</Button>}>{(topics.error || create.error) && <Alert role="alert" type="error" showIcon message={errorMessage(topics.error ?? create.error)} />}<TableRegion label="目标问题列表"><Table<QueryTopic> rowKey="id" loading={topics.isLoading} dataSource={topics.data?.items} scroll={{ x: 720 }} columns={[{ title: '标准问题', dataIndex: 'canonical_question' }, { title: '意图', dataIndex: 'intent_type', render: (value: Schema<'IntentType'>) => intentLabels.get(value) ?? value }, { title: '变体', dataIndex: 'variants', render: (items: string[]) => items.join(' / ') }]} /></TableRegion><Modal title="新增目标问题" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden><Form<Schema<'QueryTopicCreate'>> layout="vertical" onFinish={(body) => create.mutate(body)}><Form.Item name="canonical_question" label="标准问题" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="intent_type" label="意图" rules={[{ required: true }]}><Select options={intentOptions} /></Form.Item><Form.Item name="variants" label="问题变体" rules={[{ required: true }]}><Select mode="tags" tokenSeparators={[',']} /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建</Button></Form></Modal></Card>;
}

function PlatformAccountsPanel() {
  const [open, setOpen] = useState(false);
  const [modal, modalContext] = Modal.useModal();
  const { message } = App.useApp();
  const auth = useAuth();
  const accounts = useQuery({ queryKey: queryKeys.platformAccounts, queryFn: async () => unwrap(await api.GET('/api/v1/platform-accounts')), staleTime: QUERY_STALE_TIME.configuration });
  const platforms = useQuery(platformProfilesQueryOptions());
  const create = useMutation({ mutationFn: async (body: Schema<'PlatformAccountCreate'>) => unwrap(await api.POST('/api/v1/platform-accounts', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setOpen(false); await queryClient.invalidateQueries({ queryKey: queryKeys.platformAccounts }); } });
  const remove = useMutation({ mutationFn: async (id: string) => ensureSuccess(await api.DELETE('/api/v1/platform-accounts/{platform_account_id}', { params: { path: { platform_account_id: id }, header: csrfHeader() } })), onSuccess: async () => { message.success('平台账号标识已删除'); await queryClient.invalidateQueries({ queryKey: queryKeys.platformAccounts }); } });
  const confirmDelete = (account: Schema<'PlatformAccount'>) => modal.confirm({ title: `物理删除账号标识“${account.label}”？`, content: '存在发布记录引用时服务端会拒绝。此操作不可恢复。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => remove.mutate(account.id) });
  return <Card className="collection-panel" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增账号标识</Button>}>{modalContext}<Alert type="info" showIcon message="这里只保存业务标签和公开账号标识，不保存密码、Cookie 或令牌。" />{(accounts.error || platforms.error || create.error) && <Alert role="alert" type="error" showIcon message={errorMessage(accounts.error ?? platforms.error ?? create.error)} />}{remove.error && <DeletionError error={remove.error} />}<TableRegion label="平台账号标识列表"><Table<Schema<'PlatformAccount'>> rowKey="id" loading={accounts.isLoading} dataSource={accounts.data?.items} scroll={{ x: 620 }} columns={[{ title: '标签', dataIndex: 'label' }, { title: '账号标识', dataIndex: 'account_identifier', render: (value) => <span className="data-code">{value}</span> }, { title: '状态', dataIndex: 'is_active', render: (active) => <StatusTag status={active ? 'ACTIVE' : 'RETIRED'} /> }, { title: '操作', render: (_, account) => auth.isAdmin ? <Dropdown trigger={['click']} menu={{ items: [{ key: 'delete', label: '删除', danger: true }], onClick: () => confirmDelete(account) }}><Button size="small" aria-label={`更多操作：${account.label}`} loading={remove.isPending && remove.variables === account.id}>更多 <DownOutlined /></Button></Dropdown> : '—' }]} /></TableRegion><Modal title="新增平台账号标识" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden><Form<Schema<'PlatformAccountCreate'>> layout="vertical" onFinish={(body) => create.mutate(body)}><Form.Item name="platform_profile_id" label="平台" rules={[{ required: true }]}><Select options={platforms.data?.items.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="label" label="业务标签" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="account_identifier" label="公开账号标识" rules={[{ required: true }]}><Input /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建</Button></Form></Modal></Card>;
}
