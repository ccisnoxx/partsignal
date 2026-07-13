/** 管理平台类型以及对应的 Markdown system Prompt。 */
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Space, Table } from 'antd';
import { useState } from 'react';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { platformTypesQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { PlatformType, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { TableRegion } from '../../shared/components/TableRegion';

export function PlatformTypesPage() {
  const [open, setOpen] = useState(false);
  const [editingType, setEditingType] = useState<PlatformType>();
  const [selected, setSelected] = useState<PlatformType>();
  const types = useQuery(platformTypesQueryOptions());
  const prompt = useQuery({ queryKey: queryKeys.platformTypes.prompt(selected?.id), queryFn: async () => unwrap(await api.GET('/api/v1/platform-types/{platform_type_id}/prompt', { params: { path: { platform_type_id: selected?.id ?? '' } } })), enabled: !!selected, staleTime: QUERY_STALE_TIME.configuration, retry: false });
  const refresh = async () => queryClient.invalidateQueries({ queryKey: queryKeys.platformTypes.all });
  const create = useMutation({ mutationFn: async (body: Schema<'PlatformTypeCreate'>) => unwrap(await api.POST('/api/v1/platform-types', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setOpen(false); await refresh(); } });
  const update = useMutation({ mutationFn: async (body: Schema<'PlatformTypeCreate'>) => { if (!editingType) throw new Error('未选择平台类型'); return unwrap(await api.PATCH('/api/v1/platform-types/{platform_type_id}', { params: { path: { platform_type_id: editingType.id }, header: csrfHeader() }, body: { ...body, expected_revision: editingType.revision } })); }, onSuccess: async () => { setEditingType(undefined); await refresh(); } });
  const savePrompt = useMutation({ mutationFn: async (body: { template_markdown: string }) => { if (!selected) throw new Error('未选择平台类型'); return unwrap(await api.PUT('/api/v1/platform-types/{platform_type_id}/prompt', { params: { path: { platform_type_id: selected.id }, header: csrfHeader() }, body: { template_markdown: body.template_markdown, expected_revision: prompt.data?.revision ?? null } })); }, onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.platformTypes.prompt(selected?.id) }) });
  const deletePrompt = useMutation({ mutationFn: async () => { if (!selected) throw new Error('未选择平台类型'); return ensureSuccess(await api.DELETE('/api/v1/platform-types/{platform_type_id}/prompt', { params: { path: { platform_type_id: selected.id }, header: csrfHeader() } })); }, onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.platformTypes.prompt(selected?.id) }) });
  const remove = useMutation({ mutationFn: async (row: PlatformType) => ensureSuccess(await api.DELETE('/api/v1/platform-types/{platform_type_id}', { params: { path: { platform_type_id: row.id }, header: csrfHeader() } })), onSuccess: refresh });
  const error = create.error ?? update.error ?? savePrompt.error ?? deletePrompt.error ?? remove.error;
  const typeItems = types.data?.items ?? [];

  return <div className="page-stack"><PageHeader eyebrow="MODEL GOVERNANCE" title="平台类型与 Prompt" description="维护平台类型以及用于后续内容生成的 Markdown system Prompt。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增类型</Button>} />
    {error && <Alert role="alert" type="error" showIcon message={errorMessage(error)} />}
    <Card>{types.isLoading ? <QueryLoading label="正在加载平台类型" /> : types.error ? <QueryFailure error={types.error} onRetry={() => void types.refetch()} /> : typeItems.length === 0 ? <NoData description="暂无平台类型" /> : <TableRegion label="平台类型列表"><Table<PlatformType> rowKey="id" dataSource={typeItems} scroll={{ x: 680 }} columns={[{ title: '名称', dataIndex: 'name' }, { title: 'Slug', dataIndex: 'slug', render: (value) => <span className="data-code">{value}</span> }, { title: '操作', render: (_, row) => <Space><Button size="small" onClick={() => setEditingType(row)}>编辑类型</Button><Button size="small" onClick={() => setSelected(row)}>编辑 Prompt</Button><Popconfirm title={`删除平台类型“${row.name}”？`} okText="删除" cancelText="取消" onConfirm={() => remove.mutate(row)}><Button size="small" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space> }]} /></TableRegion>}</Card>
    <Modal title={editingType ? '编辑平台类型' : '新增平台类型'} open={open || !!editingType} onCancel={() => { setOpen(false); setEditingType(undefined); }} footer={null} destroyOnHidden><Form<Schema<'PlatformTypeCreate'>> key={editingType?.id ?? 'new'} layout="vertical" initialValues={{ name: editingType?.name, slug: editingType?.slug }} onFinish={(body) => editingType ? update.mutate(body) : create.mutate(body)}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="slug" label="Slug" rules={[{ required: true, pattern: /^[a-z0-9-]+$/ }]}><Input /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending || update.isPending}>保存</Button></Form></Modal>
    <Modal title={`${selected?.name ?? ''} Prompt`} open={!!selected} onCancel={() => setSelected(undefined)} footer={null} width={820} destroyOnHidden>{selected && (prompt.isLoading ? <QueryLoading label="正在加载 Prompt" /> : <Form<{ template_markdown: string }> key={`${selected.id}-${prompt.data?.revision ?? 'new'}`} layout="vertical" initialValues={{ template_markdown: prompt.data?.template_markdown ?? '' }} onFinish={(body) => savePrompt.mutate(body)}><Alert type="info" showIcon message="这是普通 Markdown system Prompt，不解析变量、循环或条件。" /><Form.Item name="template_markdown" label="Prompt Markdown" rules={[{ required: true }]}><Input.TextArea rows={20} className="markdown-source" /></Form.Item><Space><Button type="primary" htmlType="submit" loading={savePrompt.isPending}>保存</Button>{prompt.data && <Popconfirm title="删除当前 Prompt？" okText="删除" cancelText="取消" onConfirm={() => deletePrompt.mutate()}><Button danger loading={deletePrompt.isPending}>删除当前 Prompt</Button></Popconfirm>}</Space></Form>)}</Modal>
  </div>;
}
