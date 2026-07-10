/** 系统配置集中管理内部账号、问题库、平台规则版本和审计轨迹。 */
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Typography } from 'antd';
import { useState } from 'react';
import { queryClient } from '../../app/queryClient';
import { useAuth } from '../auth/AuthProvider';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import type { PlatformProfile, QueryTopic, Schema, User } from '../../shared/api/types';
import { StatusTag } from '../../shared/components/StatusTag';

const roleOptions: Array<{ value: Schema<'Role'>; label: string }> = [
  { value: 'SYSTEM_ADMIN', label: '系统管理员' }, { value: 'PRODUCT_EDITOR', label: '产品维护者' },
  { value: 'PRODUCT_REVIEWER', label: '产品审核者' }, { value: 'CONTENT_EDITOR', label: '内容运营' },
  { value: 'CONTENT_REVIEWER', label: '内容审核者' }, { value: 'ANALYST', label: '数据分析者' },
];

export function SettingsPage() {
  const auth = useAuth();
  return <div className="page-stack"><header className="page-heading"><div><Typography.Text className="eyebrow">GOVERNANCE</Typography.Text><Typography.Title>系统配置</Typography.Title><Typography.Paragraph>角色只决定操作入口，服务端仍会校验权限和禁止自审规则。</Typography.Paragraph></div></header>
    <Tabs items={[
      ...(auth.hasRole('SYSTEM_ADMIN') ? [{ key: 'users', label: '用户与角色', children: <UsersPanel /> }] : []),
      ...(auth.hasRole('CONTENT_EDITOR') ? [{ key: 'topics', label: '目标问题', children: <TopicsPanel /> }] : []),
      ...(auth.hasRole('SYSTEM_ADMIN') ? [{ key: 'platforms', label: '平台规则', children: <PlatformsPanel /> }] : []),
      ...(auth.hasRole('CONTENT_EDITOR') ? [{ key: 'accounts', label: '平台账号标识', children: <PlatformAccountsPanel /> }] : []),
      ...(auth.hasRole('SYSTEM_ADMIN') ? [{ key: 'audit', label: '审计日志', children: <AuditPanel /> }] : []),
    ]} />
  </div>;
}

function UsersPanel() {
  const [open, setOpen] = useState(false);
  const users = useQuery({ queryKey: ['users'], queryFn: async () => unwrap(await api.GET('/api/v1/users')) });
  const create = useMutation({ mutationFn: async (body: Schema<'UserCreate'>) => unwrap(await api.POST('/api/v1/users', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setOpen(false); await queryClient.invalidateQueries({ queryKey: ['users'] }); } });
  return <Card extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增用户</Button>}>
    {users.error && <Alert type="error" message={errorMessage(users.error)} />}
    <Table<User> rowKey="id" loading={users.isLoading} dataSource={users.data?.items} columns={[
      { title: '用户名', dataIndex: 'username' }, { title: '姓名', dataIndex: 'display_name' },
      { title: '角色', dataIndex: 'roles', render: (roles: Schema<'Role'>[]) => roles.map((role) => <StatusTag key={role} status={role} />) },
      { title: '状态', dataIndex: 'is_active', render: (active) => <StatusTag status={active ? 'ACTIVE' : 'RETIRED'} /> },
    ]} />
    <Modal title="新增内部用户" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>{create.error && <Alert className="form-alert" type="error" message={errorMessage(create.error)} />}<Form<Schema<'UserCreate'>> layout="vertical" onFinish={(body) => create.mutate(body)}><Form.Item name="username" label="用户名" rules={[{ required: true, min: 3 }]}><Input /></Form.Item><Form.Item name="display_name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="password" label="初始密码" rules={[{ required: true, min: 12 }]}><Input.Password /></Form.Item><Form.Item name="roles" label="角色" rules={[{ required: true }]}><Select mode="multiple" options={roleOptions} /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建</Button></Form></Modal>
  </Card>;
}

function TopicsPanel() {
  const [open, setOpen] = useState(false);
  const topics = useQuery({ queryKey: ['query-topics'], queryFn: async () => unwrap(await api.GET('/api/v1/query-topics')) });
  const create = useMutation({ mutationFn: async (body: Schema<'QueryTopicCreate'>) => unwrap(await api.POST('/api/v1/query-topics', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setOpen(false); await queryClient.invalidateQueries({ queryKey: ['query-topics'] }); } });
  return <Card extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增问题</Button>}>
    {topics.error && <Alert type="error" message={errorMessage(topics.error)} />}
    <Table<QueryTopic> rowKey="id" loading={topics.isLoading} dataSource={topics.data?.items} columns={[{ title: '标准问题', dataIndex: 'canonical_question' }, { title: '意图', dataIndex: 'intent_type' }, { title: '变体', dataIndex: 'variants', render: (items: string[]) => items.join(' / ') }]} />
    <Modal title="新增目标问题" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden><Form<Schema<'QueryTopicCreate'>> layout="vertical" onFinish={(body) => create.mutate(body)}><Form.Item name="canonical_question" label="标准问题" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="intent_type" label="意图" rules={[{ required: true }]}><Select options={['BRAND','PRODUCT','REPLACEMENT','COMPARISON','APPLICATION','TROUBLESHOOTING'].map((value) => ({ value }))} /></Form.Item><Form.Item name="variants" label="问题变体" rules={[{ required: true }]}><Select mode="tags" tokenSeparators={[',']} /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建</Button></Form></Modal>
  </Card>;
}

function PlatformsPanel() {
  const [open, setOpen] = useState(false);
  const [versionProfile, setVersionProfile] = useState<PlatformProfile | null>(null);
  const [manageProfile, setManageProfile] = useState<PlatformProfile | null>(null);
  const [pendingVersion, setPendingVersion] = useState<Schema<'PlatformProfileVersion'>>();
  const platforms = useQuery({ queryKey: ['platform-profiles'], queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles')) });
  const versions = useQuery({ queryKey: ['platform-profile-versions', manageProfile?.id], queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles/{platform_profile_id}/versions', { params: { path: { platform_profile_id: manageProfile?.id ?? '' } } })), enabled: !!manageProfile });
  const create = useMutation({ mutationFn: async (body: Schema<'PlatformProfileCreate'>) => unwrap(await api.POST('/api/v1/platform-profiles', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setOpen(false); await queryClient.invalidateQueries({ queryKey: ['platform-profiles'] }); } });
  const createVersion = useMutation({ mutationFn: async (body: Schema<'PlatformProfileVersionCreate'>) => { if (!versionProfile) throw new Error('未选择平台'); return unwrap(await api.POST('/api/v1/platform-profiles/{platform_profile_id}/versions', { params: { path: { platform_profile_id: versionProfile.id }, header: csrfHeader() }, body })); }, onSuccess: async (created) => { setVersionProfile(null); setPendingVersion(created); await queryClient.invalidateQueries({ queryKey: ['platform-profiles'] }); } });
  const versionCommand = useMutation({ mutationFn: async ({ version, command }: { version: Schema<'PlatformProfileVersion'>; command: 'activate' | 'retire' }) => { const path = command === 'activate' ? '/api/v1/platform-profile-versions/{platform_profile_version_id}/activate' as const : '/api/v1/platform-profile-versions/{platform_profile_version_id}/retire' as const; return unwrap(await api.POST(path, { params: { path: { platform_profile_version_id: version.id }, header: csrfHeader() }, body: { expected_revision: version.revision, comment: command === 'activate' ? '激活平台规则版本' : '停用平台规则版本' } })); }, onSuccess: async () => { setPendingVersion(undefined); await Promise.all([queryClient.invalidateQueries({ queryKey: ['platform-profiles'] }), queryClient.invalidateQueries({ queryKey: ['platform-profile-versions', manageProfile?.id] })]); } });
  return <Card extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增平台</Button>}>
    {(platforms.error || versions.error || create.error || createVersion.error || versionCommand.error) && <Alert type="error" message={errorMessage(platforms.error ?? versions.error ?? create.error ?? createVersion.error ?? versionCommand.error)} />}
    <Table<PlatformProfile> rowKey="id" loading={platforms.isLoading} dataSource={platforms.data?.items} columns={[
      { title: '平台', dataIndex: 'name' }, { title: 'Slug', dataIndex: 'slug' }, { title: '允许域名', dataIndex: 'allowed_domains', render: (items: string[]) => items.join(', ') },
      { title: '当前版本', render: (_, item) => <Space><span>V{item.active_version.version}</span><StatusTag status={item.active_version.status} /></Space> },
      { title: '操作', render: (_, item) => <Space><Button size="small" onClick={() => setVersionProfile(item)}>创建后续版本</Button><Button size="small" onClick={() => setManageProfile(item)}>管理版本</Button></Space> },
    ]} />
    <Modal title="新增平台配置" open={open} onCancel={() => setOpen(false)} footer={null} width={760} destroyOnHidden><PlatformForm loading={create.isPending} onSubmit={(values) => create.mutate(values)} /></Modal>
    <Modal title={`创建 ${versionProfile?.name ?? ''} 的规则版本`} open={!!versionProfile} onCancel={() => setVersionProfile(null)} footer={null} width={760} destroyOnHidden>{versionProfile && <RulesForm initial={versionProfile.active_version.rules} loading={createVersion.isPending} onSubmit={(rules) => createVersion.mutate({ rules })} />}</Modal>
    <Modal title={`${manageProfile?.name ?? ''} 规则版本`} open={!!manageProfile} onCancel={() => setManageProfile(null)} footer={null} width={760}><Table<Schema<'PlatformProfileVersion'>> rowKey="id" loading={versions.isLoading} dataSource={versions.data?.items} columns={[{ title: '版本', dataIndex: 'version', render: (value) => `V${value}` }, { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> }, { title: '创建时间', dataIndex: 'created_at', render: (value) => new Date(value).toLocaleString('zh-CN') }, { title: '操作', render: (_, version) => version.status === 'DRAFT' ? <Space><Button size="small" type="primary" onClick={() => versionCommand.mutate({ version, command: 'activate' })}>激活</Button><Button size="small" danger onClick={() => versionCommand.mutate({ version, command: 'retire' })}>停用草稿</Button></Space> : '—' }]} /></Modal>
    <Modal title="平台规则草稿已创建" open={!!pendingVersion} onCancel={() => setPendingVersion(undefined)} footer={null}><Typography.Paragraph>V{pendingVersion?.version} 当前为草稿。确认规则无误后再激活，原活动版本由服务端按契约处理。</Typography.Paragraph><Button type="primary" loading={versionCommand.isPending} onClick={() => pendingVersion && versionCommand.mutate({ version: pendingVersion, command: 'activate' })}>激活此版本</Button></Modal>
  </Card>;
}

function PlatformAccountsPanel() {
  const [open, setOpen] = useState(false);
  const accounts = useQuery({ queryKey: ['platform-accounts'], queryFn: async () => unwrap(await api.GET('/api/v1/platform-accounts')) });
  const platforms = useQuery({ queryKey: ['platform-profiles'], queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles')) });
  const create = useMutation({ mutationFn: async (body: Schema<'PlatformAccountCreate'>) => unwrap(await api.POST('/api/v1/platform-accounts', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setOpen(false); await queryClient.invalidateQueries({ queryKey: ['platform-accounts'] }); } });
  return <Card extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增账号标识</Button>}><Alert type="info" showIcon message="这里只保存业务标签和公开账号标识，不保存密码、Cookie 或令牌。" /><Table<Schema<'PlatformAccount'>> rowKey="id" loading={accounts.isLoading} dataSource={accounts.data?.items} columns={[{ title: '标签', dataIndex: 'label' }, { title: '账号标识', dataIndex: 'account_identifier' }, { title: '状态', dataIndex: 'is_active', render: (active) => <StatusTag status={active ? 'ACTIVE' : 'RETIRED'} /> }]} /><Modal title="新增平台账号标识" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden><Form<Schema<'PlatformAccountCreate'>> layout="vertical" onFinish={(body) => create.mutate(body)}><Form.Item name="platform_profile_id" label="平台" rules={[{ required: true }]}><Select options={platforms.data?.items.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="label" label="业务标签" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="account_identifier" label="公开账号标识" rules={[{ required: true }]}><Input /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建</Button></Form></Modal></Card>;
}

function PlatformForm({ loading, onSubmit }: { loading: boolean; onSubmit: (value: Schema<'PlatformProfileCreate'>) => void }) {
  return <Form<Schema<'PlatformProfileCreate'>> layout="vertical" onFinish={onSubmit}><Space align="start" wrap><Form.Item name="name" label="平台名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="slug" label="Slug" rules={[{ required: true, pattern: /^[a-z0-9-]+$/ }]}><Input /></Form.Item><Form.Item name="allowed_domains" label="允许域名" rules={[{ required: true }]}><Select mode="tags" /></Form.Item></Space><RulesFields prefix="rules" /><Button type="primary" htmlType="submit" loading={loading}>创建并激活首版</Button></Form>;
}

function RulesForm({ initial, loading, onSubmit }: { initial: Schema<'PlatformRules'>; loading: boolean; onSubmit: (value: Schema<'PlatformRules'>) => void }) {
  return <Form<{ rules: Schema<'PlatformRules'> }> layout="vertical" initialValues={{ rules: initial }} onFinish={({ rules }) => onSubmit(rules)}><RulesFields prefix="rules" /><Button type="primary" htmlType="submit" loading={loading}>创建草稿版本</Button></Form>;
}

function RulesFields({ prefix }: { prefix: 'rules' }) {
  return <><Space align="start" wrap><Form.Item name={[prefix, 'target_audience']} label="目标受众" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name={[prefix, 'tone']} label="语气" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name={[prefix, 'title_min']} label="标题最短" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name={[prefix, 'title_max']} label="标题最长" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name={[prefix, 'body_min']} label="正文最短" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name={[prefix, 'body_max']} label="正文最长" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item></Space><Space wrap><Form.Item name={[prefix, 'allow_external_links']} valuePropName="checked"><Checkbox>允许外链</Checkbox></Form.Item><Form.Item name={[prefix, 'allow_tables']} valuePropName="checked"><Checkbox>允许表格</Checkbox></Form.Item><Form.Item name={[prefix, 'allow_contact']} valuePropName="checked"><Checkbox>允许联系方式</Checkbox></Form.Item></Space><Form.Item name={[prefix, 'prohibited_phrases']} label="禁用表达"><Select mode="tags" /></Form.Item><Form.List name={[prefix, 'sections']}>{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <Space key={key} align="start"><Form.Item {...field} name={[name, 'name']} label="栏目名称"><Input /></Form.Item><Form.Item {...field} name={[name, 'url']} label="栏目 URL"><Input type="url" /></Form.Item><Button danger onClick={() => remove(name)}>删除</Button></Space>)}<Button onClick={() => add()} icon={<PlusOutlined />}>添加栏目</Button></>}</Form.List></>;
}

function AuditPanel() {
  const audit = useQuery({ queryKey: ['audit-logs'], queryFn: async () => unwrap(await api.GET('/api/v1/audit-logs', { params: { query: { page: 1, page_size: 100 } } })) });
  return <Card>{audit.error && <Alert type="error" message={errorMessage(audit.error)} />}<Table<Schema<'AuditLog'>> rowKey="id" loading={audit.isLoading} dataSource={audit.data?.items} columns={[{ title: '时间', dataIndex: 'created_at', render: (value) => new Date(value).toLocaleString('zh-CN') }, { title: '动作', dataIndex: 'action' }, { title: '对象', render: (_, row) => `${row.target_type} / ${row.target_id}` }, { title: '请求 ID', dataIndex: 'request_id' }]} /></Card>;
}
