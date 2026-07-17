/** 按具体平台维护当前唯一的 Markdown Prompt。 */
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table } from 'antd';
import { useState } from 'react';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { platformProfilesQueryOptions, platformTypesQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { PlatformProfile } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { TableRegion } from '../../shared/components/TableRegion';

export function PlatformPromptsPage() {
  const { message } = App.useApp();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<PlatformProfile>();
  const platforms = useQuery(platformProfilesQueryOptions());
  const types = useQuery(platformTypesQueryOptions());
  const prompt = useQuery({ queryKey: queryKeys.platformProfiles.prompt(selected?.id), queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles/{platform_profile_id}/prompt', { params: { path: { platform_profile_id: selected?.id ?? '' } } })), enabled: !!selected, staleTime: QUERY_STALE_TIME.configuration, retry: false });
  const refresh = async (platformId: string) => Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.prompt(platformId) }), queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all })]);
  const create = useMutation({ mutationFn: async (body: { platform_profile_id: string; template_markdown: string }) => unwrap(await api.PUT('/api/v1/platform-profiles/{platform_profile_id}/prompt', { params: { path: { platform_profile_id: body.platform_profile_id }, header: csrfHeader() }, body: { template_markdown: body.template_markdown, expected_revision: null } })), onSuccess: async (_, body) => { setCreating(false); await refresh(body.platform_profile_id); } });
  const save = useMutation({ mutationFn: async (body: { template_markdown: string }) => { if (!selected) throw new Error('未选择平台'); return unwrap(await api.PUT('/api/v1/platform-profiles/{platform_profile_id}/prompt', { params: { path: { platform_profile_id: selected.id }, header: csrfHeader() }, body: { template_markdown: body.template_markdown, expected_revision: prompt.data?.revision ?? null } })); }, onSuccess: async () => { message.success('Prompt 已保存'); if (selected) await refresh(selected.id); } });
  const remove = useMutation({ mutationFn: async () => { if (!selected) throw new Error('未选择平台'); return ensureSuccess(await api.DELETE('/api/v1/platform-profiles/{platform_profile_id}/prompt', { params: { path: { platform_profile_id: selected.id }, header: csrfHeader() } })); }, onSuccess: async () => { const platformId = selected?.id; setSelected(undefined); message.success('Prompt 已删除'); if (platformId) await refresh(platformId); } });
  const typeNames = new Map(types.data?.items.map((item) => [item.id, item.name]));
  const items = platforms.data?.items ?? [];
  const configuredItems = items.filter((item) => item.prompt_configured);
  const unconfiguredItems = items.filter((item) => !item.prompt_configured);
  const error = create.error ?? save.error ?? remove.error;

  return <div className="page-stack"><PageHeader eyebrow="配置治理" title="Prompt 管理" description="每个具体平台维护一份当前 Markdown Prompt；修改只影响后续生成作业。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新增 Prompt</Button>} />
    {error && <Alert role="alert" type="error" showIcon message={errorMessage(error)} />}
    <Card className="collection-panel">{platforms.isLoading ? <QueryLoading label="正在加载平台" /> : platforms.error ? <QueryFailure error={platforms.error} onRetry={() => void platforms.refetch()} /> : configuredItems.length === 0 ? <NoData description="暂无 Prompt" /> : <TableRegion label="平台 Prompt 列表"><Table<PlatformProfile> rowKey="id" dataSource={configuredItems} columns={[{ title: '平台', dataIndex: 'name' }, { title: '平台类型', render: (_, row) => typeNames.get(row.platform_type_id ?? '') ?? '未归类' }, { title: '操作', render: (_, row) => <Button size="small" onClick={() => setSelected(row)}>编辑 Prompt</Button> }]} /></TableRegion>}</Card>
    <Modal title="新增 Prompt" open={creating} onCancel={() => setCreating(false)} footer={null} width={820} destroyOnHidden><Form<{ platform_profile_id: string; template_markdown: string }> layout="vertical" onFinish={(body) => create.mutate(body)}><Alert type="info" showIcon title="这是普通 Markdown system Prompt，不解析变量、循环或条件。" /><Form.Item name="platform_profile_id" label="所属平台" rules={[{ required: true }]}><Select placeholder="选择尚未配置 Prompt 的平台" options={unconfiguredItems.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="template_markdown" label="Prompt Markdown" rules={[{ required: true }]}><Input.TextArea rows={20} className="markdown-source" /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建 Prompt</Button></Form></Modal>
    <Modal title={`${selected?.name ?? ''} Prompt`} open={!!selected} onCancel={() => setSelected(undefined)} footer={null} width={820} destroyOnHidden>{selected && (prompt.isLoading ? <QueryLoading label="正在加载 Prompt" /> : <Form<{ template_markdown: string }> key={`${selected.id}-${prompt.data?.revision ?? 'new'}`} layout="vertical" initialValues={{ template_markdown: prompt.data?.template_markdown ?? '' }} onFinish={(body) => save.mutate(body)}><Alert type="info" showIcon title="这是普通 Markdown system Prompt，不解析变量、循环或条件。" /><Form.Item name="template_markdown" label="Prompt Markdown" rules={[{ required: true }]}><Input.TextArea rows={20} className="markdown-source" /></Form.Item><Space><Button type="primary" htmlType="submit" loading={save.isPending}>覆盖保存</Button>{prompt.data && <Popconfirm title="删除当前 Prompt？" description="平台会保留，但在重新配置 Prompt 前不能创建内容任务。" okText="删除" cancelText="取消" onConfirm={() => remove.mutate()}><Button danger loading={remove.isPending}>删除当前 Prompt</Button></Popconfirm>}</Space></Form>)}</Modal>
  </div>;
}
