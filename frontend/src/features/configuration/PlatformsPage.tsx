/** 管理具体平台身份、归类和当前生效规则。 */
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { platformProfilesQueryOptions, platformProfileVersionsQueryOptions, platformTypesQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { PlatformProfile, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DeletionError } from '../../shared/components/DeletionError';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

type RuleVersion = Schema<'PlatformProfileVersion'>;

export function PlatformsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<PlatformProfile | null>(null);
  const [modal, modalContext] = Modal.useModal();
  const { message } = App.useApp();
  const platforms = useQuery(platformProfilesQueryOptions());
  const versions = useQuery(platformProfileVersionsQueryOptions());
  const platformTypes = useQuery(platformTypesQueryOptions());
  const create = useMutation({
    mutationFn: async (body: Schema<'PlatformProfileCreate'>) => unwrap(await api.POST('/api/v1/platform-profiles', { params: { header: csrfHeader() }, body })),
    onSuccess: async () => { setCreateOpen(false); await queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }); },
  });
  const updateProfile = useMutation({
    mutationFn: async (body: Schema<'PlatformProfileUpdate'>) => {
      if (!editProfile) throw new Error('未选择平台');
      return unwrap(await api.PATCH('/api/v1/platform-profiles/{platform_profile_id}', { params: { path: { platform_profile_id: editProfile.id }, header: csrfHeader() }, body }));
    },
    onSuccess: async () => { setEditProfile(null); message.success('平台身份与归类已保存'); await queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }); },
  });
  const activate = useMutation({
    mutationFn: async (version: RuleVersion) => unwrap(await api.POST('/api/v1/platform-profile-versions/{platform_profile_version_id}/activate', {
      params: { path: { platform_profile_version_id: version.id }, header: csrfHeader() },
      body: { expected_revision: version.revision, comment: '选择为平台当前规则' },
    })),
    onSuccess: async () => { message.success('平台当前规则已更新'); await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.platformProfileVersions.all }),
    ]); },
  });
  const removeProfile = useMutation({
    mutationFn: async (profile: PlatformProfile) => ensureSuccess(await api.DELETE('/api/v1/platform-profiles/{platform_profile_id}', { params: { path: { platform_profile_id: profile.id }, header: csrfHeader() } })),
    onSuccess: async () => { message.success('平台已删除'); await queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }); },
  });
  const error = create.error ?? updateProfile.error ?? activate.error;
  const queryError = platforms.error ?? versions.error;
  const platformItems = platforms.data?.items ?? [];
  const versionItems = versions.data?.items ?? [];
  const platformTypeOptions = platformTypes.data?.items.map((item) => ({ value: item.id, label: item.name })) ?? [];
  const confirmDelete = (profile: PlatformProfile) => modal.confirm({ title: `物理删除平台“${profile.name}”？`, content: '必须先清理全部规则版本和平台账号；当前 Prompt 会一并删除，历史作业不受影响。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => removeProfile.mutate(profile) });

  return <div className="page-stack">
    {modalContext}
    <PageHeader eyebrow="配置治理" title="平台管理" description="维护具体平台身份、归类、允许域名和当前生效规则。" actions={<Button type="primary" icon={<PlusOutlined />} aria-haspopup="dialog" aria-expanded={createOpen} onClick={() => setCreateOpen(true)}>新增平台</Button>} />
    {error && <Alert role="alert" type="error" showIcon message={errorMessage(error)} />}
    {removeProfile.error && <DeletionError error={removeProfile.error} />}
    <Card className="collection-panel">{platforms.isLoading || versions.isLoading ? <QueryLoading label="正在加载平台" /> : queryError ? <QueryFailure error={queryError} onRetry={() => { void platforms.refetch(); void versions.refetch(); }} /> : platformItems.length === 0 ? <NoData description="暂无具体平台" /> : <TableRegion label="平台列表"><Table<PlatformProfile> rowKey="id" dataSource={platformItems} sticky={{ offsetHeader: 72 }} scroll={{ x: 980 }} columns={[
      { title: '平台', dataIndex: 'name' },
      { title: '唯一标识（slug）', dataIndex: 'slug', render: (value) => <span className="data-code">{value}</span> },
      { title: '允许域名', dataIndex: 'allowed_domains', render: (items: string[]) => items.join(', ') },
      { title: '当前规则', render: (_, profile) => {
        const drafts = versionItems.filter((version) => version.platform_profile_id === profile.id && version.status === 'DRAFT');
        const options = [
          ...(profile.active_version ? [{ value: profile.active_version.id, label: `V${profile.active_version.version} · 当前 ACTIVE`, disabled: true }] : []),
          ...drafts.map((version) => ({ value: version.id, label: `V${version.version} · DRAFT` })),
        ];
        if (drafts.length === 0) return <Space wrap>{profile.active_version ? <Space><span>V{profile.active_version.version}</span><StatusTag status={profile.active_version.status} /></Space> : <Tag color="warning">无有效规则</Tag>}<Link to="/configuration/platform-rules">管理规则</Link></Space>;
        return <Space wrap><Select aria-label={`选择 ${profile.name} 当前规则`} value={profile.active_version?.id} placeholder="选择规则草稿" options={options} loading={activate.isPending} onChange={(versionId) => { const version = drafts.find((item) => item.id === versionId); if (version) activate.mutate(version); }} style={{ minWidth: 190 }} /><Link to="/configuration/platform-rules">管理规则</Link></Space>;
      } },
      { title: 'Prompt', render: (_, profile) => profile.prompt_configured ? <Tag color="success">已配置</Tag> : <Tag>未配置 Prompt</Tag> },
      { title: '操作', render: (_, profile) => <Space><Button size="small" onClick={() => setEditProfile(profile)}>编辑归类</Button><Dropdown trigger={['click']} menu={{ items: [{ key: 'delete', label: '删除平台', danger: true }], onClick: () => confirmDelete(profile) }}><Button size="small" aria-label={`更多操作：${profile.name}`} loading={removeProfile.isPending && removeProfile.variables?.id === profile.id}>更多 <DownOutlined /></Button></Dropdown></Space> },
    ]} /></TableRegion>}</Card>
    <Modal title="新增平台" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden><PlatformForm typeOptions={platformTypeOptions} loading={create.isPending} onSubmit={(values) => create.mutate(values)} /></Modal>
    <Modal title={`编辑 ${editProfile?.name ?? ''} 的身份与归类`} open={!!editProfile} onCancel={() => setEditProfile(null)} footer={null} destroyOnHidden>{editProfile && <PlatformIdentityForm profile={editProfile} typeOptions={platformTypeOptions} loading={updateProfile.isPending} onSubmit={(values) => updateProfile.mutate(values)} />}</Modal>
  </div>;
}

function PlatformForm({ typeOptions, loading, onSubmit }: { typeOptions: Array<{ value: string; label: string }>; loading: boolean; onSubmit: (value: Schema<'PlatformProfileCreate'>) => void }) {
  return <Form<Schema<'PlatformProfileCreate'>> layout="vertical" onFinish={onSubmit}><Form.Item name="name" label="平台名称" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="slug" label="唯一标识（slug）" rules={[{ required: true, pattern: /^[a-z0-9-]+$/ }]}><Input /></Form.Item><Form.Item name="platform_type_id" label="平台类型" rules={[{ required: true }]}><Select options={typeOptions} /></Form.Item><Form.Item name="allowed_domains" label="允许域名" rules={[{ required: true }]}><Select mode="tags" /></Form.Item><Button type="primary" htmlType="submit" loading={loading}>创建平台</Button></Form>;
}

function PlatformIdentityForm({ profile, typeOptions, loading, onSubmit }: { profile: PlatformProfile; typeOptions: Array<{ value: string; label: string }>; loading: boolean; onSubmit: (value: Schema<'PlatformProfileUpdate'>) => void }) {
  return <Form<Schema<'PlatformProfileUpdate'>> layout="vertical" initialValues={{ expected_revision: profile.revision, name: profile.name, allowed_domains: profile.allowed_domains, platform_type_id: profile.platform_type_id ?? undefined }} onFinish={onSubmit}><Form.Item name="expected_revision" hidden><InputNumber /></Form.Item><Form.Item name="name" label="平台名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="platform_type_id" label="平台类型" rules={[{ required: true }]}><Select options={typeOptions} /></Form.Item><Form.Item name="allowed_domains" label="允许域名" rules={[{ required: true }]}><Select mode="tags" /></Form.Item><Button type="primary" htmlType="submit" loading={loading}>保存归类</Button></Form>;
}
