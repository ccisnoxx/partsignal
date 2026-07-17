/** 独立管理平台规则版本；平台当前规则仍由唯一 ACTIVE 版本推导。 */
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd';
import { useState } from 'react';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { platformProfilesQueryOptions, platformProfileVersionsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { PlatformProfile, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DeletionError } from '../../shared/components/DeletionError';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

type RuleVersion = Schema<'PlatformProfileVersion'>;

export function PlatformRulesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editVersion, setEditVersion] = useState<RuleVersion>();
  const [modal, modalContext] = Modal.useModal();
  const { message } = App.useApp();
  const profiles = useQuery(platformProfilesQueryOptions());
  const versions = useQuery(platformProfileVersionsQueryOptions());
  const invalidateRules = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.platformProfileVersions.all }),
  ]);
  const create = useMutation({
    mutationFn: async ({ platformProfileId, rules }: { platformProfileId: string; rules: Schema<'PlatformRules'> }) => unwrap(await api.POST('/api/v1/platform-profiles/{platform_profile_id}/versions', {
      params: { path: { platform_profile_id: platformProfileId }, header: csrfHeader() },
      body: { rules },
    })),
    onSuccess: async () => { setCreateOpen(false); await invalidateRules(); },
  });
  const update = useMutation({
    mutationFn: async (rules: Schema<'PlatformRules'>) => {
      if (!editVersion) throw new Error('未选择平台规则草稿');
      return unwrap(await api.PATCH('/api/v1/platform-profile-versions/{platform_profile_version_id}', {
        params: { path: { platform_profile_version_id: editVersion.id }, header: csrfHeader() },
        body: { expected_revision: editVersion.revision, rules },
      }));
    },
    onSuccess: async () => { setEditVersion(undefined); message.success('规则草稿已保存'); await invalidateRules(); },
  });
  const remove = useMutation({
    mutationFn: async (version: RuleVersion) => ensureSuccess(await api.DELETE('/api/v1/platform-profile-versions/{platform_profile_version_id}', {
      params: { path: { platform_profile_version_id: version.id }, header: csrfHeader() },
    })),
    onSuccess: async () => { message.success('规则版本已删除'); await invalidateRules(); },
  });
  const profileItems = profiles.data?.items ?? [];
  const versionItems = versions.data?.items ?? [];
  const profileById = new Map(profileItems.map((profile) => [profile.id, profile]));
  const queryError = profiles.error ?? versions.error;
  const mutationError = create.error ?? update.error;
  const confirmDelete = (version: RuleVersion) => modal.confirm({ title: `物理删除规则版本 V${version.version}？`, content: version.status === 'ACTIVE' ? '删除后所属平台将进入“无有效规则”状态；存在内容任务引用时服务端会拒绝。' : '存在内容任务引用时服务端会拒绝。此操作不可恢复。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => remove.mutate(version) });

  return <div className="page-stack">
    {modalContext}
    <PageHeader eyebrow="配置治理" title="平台规则" description="独立创建和维护规则草稿；激活后规则冻结，并由平台管理页选择为当前规则。" actions={<Button type="primary" icon={<PlusOutlined />} aria-haspopup="dialog" aria-expanded={createOpen} onClick={() => setCreateOpen(true)}>新增规则草稿</Button>} />
    {mutationError && <Alert role="alert" type="error" showIcon message={errorMessage(mutationError)} />}
    {remove.error && <DeletionError error={remove.error} />}
    <Card className="collection-panel">{profiles.isLoading || versions.isLoading ? <QueryLoading label="正在加载平台规则" /> : queryError ? <QueryFailure error={queryError} onRetry={() => { void profiles.refetch(); void versions.refetch(); }} /> : versionItems.length === 0 ? <NoData description="暂无平台规则版本" /> : <TableRegion label="平台规则版本列表"><Table<RuleVersion> rowKey="id" dataSource={versionItems} sticky={{ offsetHeader: 72 }} scroll={{ x: 820 }} columns={[
      { title: '所属平台', render: (_, version) => profileById.get(version.platform_profile_id)?.name ?? version.platform_profile_id },
      { title: '版本', dataIndex: 'version', render: (value) => `V${value}` },
      { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
      { title: '目标受众', render: (_, version) => version.rules.target_audience },
      { title: '正文范围', render: (_, version) => `${version.rules.body_min}–${version.rules.body_max}` },
      { title: '创建时间', dataIndex: 'created_at', render: (value) => new Date(value).toLocaleString('zh-CN') },
      { title: '操作', render: (_, version) => <Space wrap>{version.status === 'DRAFT' && <Button size="small" onClick={() => setEditVersion(version)}>编辑草稿</Button>}<Dropdown trigger={['click']} menu={{ items: [{ key: 'delete', label: '删除', danger: true }], onClick: () => confirmDelete(version) }}><Button size="small" aria-label={`更多操作：规则版本 V${version.version}`} loading={remove.isPending && remove.variables?.id === version.id}>更多 <DownOutlined /></Button></Dropdown></Space> },
    ]} /></TableRegion>}</Card>
    <Modal title="新增规则草稿" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} width={760} destroyOnHidden><RuleEditor profiles={profileItems} loading={create.isPending} submitLabel="创建草稿版本" onSubmit={(rules, platformProfileId) => platformProfileId && create.mutate({ platformProfileId, rules })} /></Modal>
    <Modal title={`编辑 ${profileById.get(editVersion?.platform_profile_id ?? '')?.name ?? ''} V${editVersion?.version ?? ''} 草稿`} open={!!editVersion} onCancel={() => setEditVersion(undefined)} footer={null} width={760} destroyOnHidden>{editVersion && <RuleEditor initial={editVersion.rules} loading={update.isPending} submitLabel="保存草稿" onSubmit={(rules) => update.mutate(rules)} />}</Modal>
  </div>;
}

function RuleEditor({ profiles, initial, loading, submitLabel, onSubmit }: { profiles?: PlatformProfile[]; initial?: Schema<'PlatformRules'>; loading: boolean; submitLabel: string; onSubmit: (rules: Schema<'PlatformRules'>, platformProfileId?: string) => void }) {
  return <Form<{ platform_profile_id?: string; rules: Schema<'PlatformRules'> }> layout="vertical" initialValues={{ rules: initial ?? { allow_external_links: false, allow_tables: false, allow_contact: false, prohibited_phrases: [], sections: [] } }} onFinish={({ rules, platform_profile_id: platformProfileId }) => onSubmit(rules, platformProfileId)}>
    {profiles && <Form.Item name="platform_profile_id" label="所属平台" rules={[{ required: true }]}><Select options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))} /></Form.Item>}
    <RulesFields />
    <Button type="primary" htmlType="submit" loading={loading}>{submitLabel}</Button>
  </Form>;
}

function RulesFields() {
  return <><Space align="start" wrap><Form.Item name={['rules', 'target_audience']} label="目标受众" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name={['rules', 'tone']} label="语气" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name={['rules', 'title_min']} label="标题最短" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name={['rules', 'title_max']} label="标题最长" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name={['rules', 'body_min']} label="正文最短" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name={['rules', 'body_max']} label="正文最长" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item></Space><Space wrap><Form.Item name={['rules', 'allow_external_links']} valuePropName="checked"><Checkbox>允许外链</Checkbox></Form.Item><Form.Item name={['rules', 'allow_tables']} valuePropName="checked"><Checkbox>允许表格</Checkbox></Form.Item><Form.Item name={['rules', 'allow_contact']} valuePropName="checked"><Checkbox>允许联系方式</Checkbox></Form.Item></Space><Form.Item name={['rules', 'prohibited_phrases']} label="禁用表达"><Select mode="tags" /></Form.Item><Form.List name={['rules', 'sections']}>{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <Space key={key} align="start"><Form.Item {...field} name={[name, 'name']} label="栏目名称"><Input /></Form.Item><Form.Item {...field} name={[name, 'url']} label="栏目 URL"><Input type="url" /></Form.Item><Button danger onClick={() => remove(name)}>删除</Button></Space>)}<Button onClick={() => add()} icon={<PlusOutlined />}>添加栏目</Button></>}</Form.List></>;
}
