/** 管理具体平台身份、内容规则与不可变版本状态。 */
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import { platformProfilesQueryOptions, platformTypesQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { PlatformProfile, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

export function PlatformsPage() {
  const [open, setOpen] = useState(false);
  const [versionProfile, setVersionProfile] = useState<PlatformProfile | null>(null);
  const [manageProfile, setManageProfile] = useState<PlatformProfile | null>(null);
  const [editProfile, setEditProfile] = useState<PlatformProfile | null>(null);
  const [pendingVersion, setPendingVersion] = useState<Schema<'PlatformProfileVersion'>>();
  const platforms = useQuery(platformProfilesQueryOptions());
  const versions = useQuery({ queryKey: queryKeys.platformProfiles.versions(manageProfile?.id), queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles/{platform_profile_id}/versions', { params: { path: { platform_profile_id: manageProfile?.id ?? '' } } })), enabled: !!manageProfile, staleTime: QUERY_STALE_TIME.configuration });
  const create = useMutation({ mutationFn: async (body: Schema<'PlatformProfileCreate'>) => unwrap(await api.POST('/api/v1/platform-profiles', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setOpen(false); await queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }); } });
  const updateProfile = useMutation({ mutationFn: async (body: Schema<'PlatformProfileUpdate'>) => { if (!editProfile) throw new Error('未选择平台'); return unwrap(await api.PATCH('/api/v1/platform-profiles/{platform_profile_id}', { params: { path: { platform_profile_id: editProfile.id }, header: csrfHeader() }, body })); }, onSuccess: async () => { setEditProfile(null); await queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }); } });
  const createVersion = useMutation({ mutationFn: async (body: Schema<'PlatformProfileVersionCreate'>) => { if (!versionProfile) throw new Error('未选择平台'); return unwrap(await api.POST('/api/v1/platform-profiles/{platform_profile_id}/versions', { params: { path: { platform_profile_id: versionProfile.id }, header: csrfHeader() }, body })); }, onSuccess: async (created) => { setVersionProfile(null); setPendingVersion(created); await queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }); } });
  const versionCommand = useMutation({ mutationFn: async ({ version, command }: { version: Schema<'PlatformProfileVersion'>; command: 'activate' | 'retire' }) => { const path = command === 'activate' ? '/api/v1/platform-profile-versions/{platform_profile_version_id}/activate' as const : '/api/v1/platform-profile-versions/{platform_profile_version_id}/retire' as const; return unwrap(await api.POST(path, { params: { path: { platform_profile_version_id: version.id }, header: csrfHeader() }, body: { expected_revision: version.revision, comment: command === 'activate' ? '激活平台规则版本' : '停用平台规则版本' } })); }, onSuccess: async () => { setPendingVersion(undefined); await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }), queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.versions(manageProfile?.id) })]); } });
  const error = versions.error ?? create.error ?? updateProfile.error ?? createVersion.error ?? versionCommand.error;
  const platformItems = platforms.data?.items ?? [];

  return <div className="page-stack"><PageHeader eyebrow="CONTENT GOVERNANCE" title="具体平台规则" description="维护具体平台归类、允许域名和版本化内容规则。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增平台</Button>} />
    {error && <Alert role="alert" type="error" showIcon message={errorMessage(error)} />}
    <Card>{platforms.isLoading ? <QueryLoading label="正在加载平台规则" /> : platforms.error ? <QueryFailure error={platforms.error} onRetry={() => void platforms.refetch()} /> : platformItems.length === 0 ? <NoData description="暂无具体平台规则" /> : <TableRegion label="平台规则列表"><Table<PlatformProfile> rowKey="id" dataSource={platformItems} scroll={{ x: 980 }} columns={[
      { title: '平台', dataIndex: 'name' }, { title: 'Slug', dataIndex: 'slug', render: (value) => <span className="data-code">{value}</span> }, { title: '允许域名', dataIndex: 'allowed_domains', render: (items: string[]) => items.join(', ') },
      { title: '当前版本', render: (_, item) => <Space><span>V{item.active_version.version}</span><StatusTag status={item.active_version.status} /></Space> },
      { title: '操作', render: (_, item) => <Space><Button size="small" onClick={() => setEditProfile(item)}>编辑归类</Button><Button size="small" onClick={() => setVersionProfile(item)}>创建后续版本</Button><Button size="small" onClick={() => setManageProfile(item)}>管理版本</Button></Space> },
    ]} /></TableRegion>}</Card>
    <Modal title="新增平台配置" open={open} onCancel={() => setOpen(false)} footer={null} width={760} destroyOnHidden><PlatformForm loading={create.isPending} onSubmit={(values) => create.mutate(values)} /></Modal>
    <Modal title={`编辑 ${editProfile?.name ?? ''} 的身份与归类`} open={!!editProfile} onCancel={() => setEditProfile(null)} footer={null} destroyOnHidden>{editProfile && <PlatformIdentityForm profile={editProfile} loading={updateProfile.isPending} onSubmit={(values) => updateProfile.mutate(values)} />}</Modal>
    <Modal title={`创建 ${versionProfile?.name ?? ''} 的规则版本`} open={!!versionProfile} onCancel={() => setVersionProfile(null)} footer={null} width={760} destroyOnHidden>{versionProfile && <RulesForm initial={versionProfile.active_version.rules} loading={createVersion.isPending} onSubmit={(rules) => createVersion.mutate({ rules })} />}</Modal>
    <Modal title={`${manageProfile?.name ?? ''} 规则版本`} open={!!manageProfile} onCancel={() => setManageProfile(null)} footer={null} width={760}>{versions.error ? <QueryFailure error={versions.error} onRetry={() => void versions.refetch()} /> : <Table<Schema<'PlatformProfileVersion'>> rowKey="id" loading={versions.isLoading} dataSource={versions.data?.items} columns={[{ title: '版本', dataIndex: 'version', render: (value) => `V${value}` }, { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> }, { title: '创建时间', dataIndex: 'created_at', render: (value) => new Date(value).toLocaleString('zh-CN') }, { title: '操作', render: (_, version) => version.status === 'DRAFT' ? <Space><Button size="small" type="primary" onClick={() => versionCommand.mutate({ version, command: 'activate' })}>激活</Button><Button size="small" danger onClick={() => versionCommand.mutate({ version, command: 'retire' })}>停用草稿</Button></Space> : '—' }]} />}</Modal>
    <Modal title="平台规则草稿已创建" open={!!pendingVersion} onCancel={() => setPendingVersion(undefined)} footer={null}><Typography.Paragraph>V{pendingVersion?.version} 当前为草稿。确认规则无误后再激活，原活动版本由服务端按契约处理。</Typography.Paragraph><Button type="primary" loading={versionCommand.isPending} onClick={() => pendingVersion && versionCommand.mutate({ version: pendingVersion, command: 'activate' })}>激活此版本</Button></Modal>
  </div>;
}

function PlatformForm({ loading, onSubmit }: { loading: boolean; onSubmit: (value: Schema<'PlatformProfileCreate'>) => void }) {
  const types = useQuery(platformTypesQueryOptions());
  return <Form<Schema<'PlatformProfileCreate'>> layout="vertical" onFinish={onSubmit}><Space align="start" wrap><Form.Item name="name" label="平台名称" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="slug" label="Slug" rules={[{ required: true, pattern: /^[a-z0-9-]+$/ }]}><Input /></Form.Item><Form.Item name="platform_type_id" label="平台类型" rules={[{ required: true }]}><Select options={types.data?.items.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="allowed_domains" label="允许域名" rules={[{ required: true }]}><Select mode="tags" /></Form.Item></Space><RulesFields prefix="rules" /><Button type="primary" htmlType="submit" loading={loading}>创建并激活首版</Button></Form>;
}

function PlatformIdentityForm({ profile, loading, onSubmit }: { profile: PlatformProfile; loading: boolean; onSubmit: (value: Schema<'PlatformProfileUpdate'>) => void }) {
  const types = useQuery(platformTypesQueryOptions());
  return <Form<Schema<'PlatformProfileUpdate'>> layout="vertical" initialValues={{ expected_revision: profile.revision, name: profile.name, allowed_domains: profile.allowed_domains, platform_type_id: profile.platform_type_id ?? undefined }} onFinish={onSubmit}><Form.Item name="expected_revision" hidden><InputNumber /></Form.Item><Form.Item name="name" label="平台名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="platform_type_id" label="平台类型" rules={[{ required: true }]}><Select options={types.data?.items.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="allowed_domains" label="允许域名" rules={[{ required: true }]}><Select mode="tags" /></Form.Item><Button type="primary" htmlType="submit" loading={loading}>保存归类</Button></Form>;
}

function RulesForm({ initial, loading, onSubmit }: { initial: Schema<'PlatformRules'>; loading: boolean; onSubmit: (value: Schema<'PlatformRules'>) => void }) {
  return <Form<{ rules: Schema<'PlatformRules'> }> layout="vertical" initialValues={{ rules: initial }} onFinish={({ rules }) => onSubmit(rules)}><RulesFields prefix="rules" /><Button type="primary" htmlType="submit" loading={loading}>创建草稿版本</Button></Form>;
}

function RulesFields({ prefix }: { prefix: 'rules' }) {
  return <><Space align="start" wrap><Form.Item name={[prefix, 'target_audience']} label="目标受众" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name={[prefix, 'tone']} label="语气" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name={[prefix, 'title_min']} label="标题最短" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name={[prefix, 'title_max']} label="标题最长" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name={[prefix, 'body_min']} label="正文最短" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name={[prefix, 'body_max']} label="正文最长" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item></Space><Space wrap><Form.Item name={[prefix, 'allow_external_links']} valuePropName="checked"><Checkbox>允许外链</Checkbox></Form.Item><Form.Item name={[prefix, 'allow_tables']} valuePropName="checked"><Checkbox>允许表格</Checkbox></Form.Item><Form.Item name={[prefix, 'allow_contact']} valuePropName="checked"><Checkbox>允许联系方式</Checkbox></Form.Item></Space><Form.Item name={[prefix, 'prohibited_phrases']} label="禁用表达"><Select mode="tags" /></Form.Item><Form.List name={[prefix, 'sections']}>{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <Space key={key} align="start"><Form.Item {...field} name={[name, 'name']} label="栏目名称"><Input /></Form.Item><Form.Item {...field} name={[name, 'url']} label="栏目 URL"><Input type="url" /></Form.Item><Button danger onClick={() => remove(name)}>删除</Button></Space>)}<Button onClick={() => add()} icon={<PlusOutlined />}>添加栏目</Button></>}</Form.List></>;
}
