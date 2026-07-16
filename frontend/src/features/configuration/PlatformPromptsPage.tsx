/** 按具体平台维护当前唯一的 Markdown Prompt。 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag } from 'antd';
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
  const [selected, setSelected] = useState<PlatformProfile>();
  const platforms = useQuery(platformProfilesQueryOptions());
  const types = useQuery(platformTypesQueryOptions());
  const prompt = useQuery({ queryKey: queryKeys.platformProfiles.prompt(selected?.id), queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles/{platform_profile_id}/prompt', { params: { path: { platform_profile_id: selected?.id ?? '' } } })), enabled: !!selected, staleTime: QUERY_STALE_TIME.configuration, retry: false });
  const refresh = async () => Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.prompt(selected?.id) }), queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all })]);
  const save = useMutation({ mutationFn: async (body: { template_markdown: string }) => { if (!selected) throw new Error('未选择平台'); return unwrap(await api.PUT('/api/v1/platform-profiles/{platform_profile_id}/prompt', { params: { path: { platform_profile_id: selected.id }, header: csrfHeader() }, body: { template_markdown: body.template_markdown, expected_revision: prompt.data?.revision ?? null } })); }, onSuccess: refresh });
  const remove = useMutation({ mutationFn: async () => { if (!selected) throw new Error('未选择平台'); return ensureSuccess(await api.DELETE('/api/v1/platform-profiles/{platform_profile_id}/prompt', { params: { path: { platform_profile_id: selected.id }, header: csrfHeader() } })); }, onSuccess: refresh });
  const typeNames = new Map(types.data?.items.map((item) => [item.id, item.name]));
  const items = platforms.data?.items ?? [];
  const error = save.error ?? remove.error;

  return <div className="page-stack"><PageHeader eyebrow="配置治理" title="Prompt 管理" description="每个具体平台维护一份当前 Markdown Prompt；修改只影响后续生成作业。" />
    {error && <Alert role="alert" type="error" showIcon message={errorMessage(error)} />}
    <Card>{platforms.isLoading ? <QueryLoading label="正在加载平台" /> : platforms.error ? <QueryFailure error={platforms.error} onRetry={() => void platforms.refetch()} /> : items.length === 0 ? <NoData description="暂无平台" /> : <TableRegion label="平台 Prompt 列表"><Table<PlatformProfile> rowKey="id" dataSource={items} columns={[{ title: '平台', dataIndex: 'name' }, { title: '平台类型', render: (_, row) => typeNames.get(row.platform_type_id ?? '') ?? '未归类' }, { title: '配置状态', render: (_, row) => row.prompt_configured ? <Tag color="success">已配置</Tag> : <Tag>未配置 Prompt</Tag> }, { title: '操作', render: (_, row) => <Button size="small" onClick={() => setSelected(row)}>维护 Prompt</Button> }]} /></TableRegion>}</Card>
    <Modal title={`${selected?.name ?? ''} Prompt`} open={!!selected} onCancel={() => setSelected(undefined)} footer={null} width={820} destroyOnHidden>{selected && (prompt.isLoading ? <QueryLoading label="正在加载 Prompt" /> : <Form<{ template_markdown: string }> key={`${selected.id}-${prompt.data?.revision ?? 'new'}`} layout="vertical" initialValues={{ template_markdown: prompt.data?.template_markdown ?? '' }} onFinish={(body) => save.mutate(body)}><Alert type="info" showIcon message="这是普通 Markdown system Prompt，不解析变量、循环或条件。" /><Form.Item name="template_markdown" label="Prompt Markdown" rules={[{ required: true }]}><Input.TextArea rows={20} className="markdown-source" /></Form.Item><Space><Button type="primary" htmlType="submit" loading={save.isPending}>覆盖保存</Button>{prompt.data && <Popconfirm title="删除当前 Prompt？" description="平台会保留，但在重新配置 Prompt 前不能创建内容任务。" okText="删除" cancelText="取消" onConfirm={() => remove.mutate()}><Button danger loading={remove.isPending}>删除当前 Prompt</Button></Popconfirm>}</Space></Form>)}</Modal>
  </div>;
}
