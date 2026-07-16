/** 管理平台分类，不承载具体平台的 Prompt 配置。 */
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Space, Table } from 'antd';
import { useState } from 'react';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { platformTypesQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { PlatformType, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { TableRegion } from '../../shared/components/TableRegion';
import { DeletionError } from '../../shared/components/DeletionError';

export function PlatformTypesPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformType>();
  const types = useQuery(platformTypesQueryOptions());
  const refresh = async () => queryClient.invalidateQueries({ queryKey: queryKeys.platformTypes.all });
  const create = useMutation({ mutationFn: async (body: Schema<'PlatformTypeCreate'>) => unwrap(await api.POST('/api/v1/platform-types', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setOpen(false); await refresh(); } });
  const update = useMutation({ mutationFn: async (body: Schema<'PlatformTypeCreate'>) => { if (!editing) throw new Error('未选择平台类型'); return unwrap(await api.PATCH('/api/v1/platform-types/{platform_type_id}', { params: { path: { platform_type_id: editing.id }, header: csrfHeader() }, body: { ...body, expected_revision: editing.revision } })); }, onSuccess: async () => { setEditing(undefined); await refresh(); } });
  const remove = useMutation({ mutationFn: async (row: PlatformType) => ensureSuccess(await api.DELETE('/api/v1/platform-types/{platform_type_id}', { params: { path: { platform_type_id: row.id }, header: csrfHeader() } })), onSuccess: refresh });
  const error = create.error ?? update.error ?? remove.error;
  const items = types.data?.items ?? [];

  return <div className="page-stack"><PageHeader eyebrow="配置治理" title="平台类型" description="维护具体平台使用的业务分类。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增类型</Button>} />
    {error && (remove.error ? <DeletionError error={remove.error} /> : <Alert role="alert" type="error" showIcon message={errorMessage(error)} />)}
    <Card className="collection-panel">{types.isLoading ? <QueryLoading label="正在加载平台类型" /> : types.error ? <QueryFailure error={types.error} onRetry={() => void types.refetch()} /> : items.length === 0 ? <NoData description="暂无平台类型" /> : <TableRegion label="平台类型列表"><Table<PlatformType> rowKey="id" dataSource={items} scroll={{ x: 620 }} columns={[{ title: '名称', dataIndex: 'name' }, { title: '唯一标识（slug）', dataIndex: 'slug', render: (value) => <span className="data-code">{value}</span> }, { title: '操作', render: (_, row) => <Space><Button size="small" onClick={() => setEditing(row)}>编辑</Button><Popconfirm title={`删除平台类型“${row.name}”？`} description="仅未被具体平台使用的类型可以删除。" okText="删除" cancelText="取消" onConfirm={() => remove.mutate(row)}><Button size="small" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space> }]} /></TableRegion>}</Card>
    <Modal title={editing ? '编辑平台类型' : '新增平台类型'} open={open || !!editing} onCancel={() => { setOpen(false); setEditing(undefined); }} footer={null} destroyOnHidden><Form<Schema<'PlatformTypeCreate'>> key={editing?.id ?? 'new'} layout="vertical" initialValues={{ name: editing?.name, slug: editing?.slug }} onFinish={(body) => editing ? update.mutate(body) : create.mutate(body)}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="slug" label="唯一标识（slug）" rules={[{ required: true, pattern: /^[a-z0-9-]+$/ }]}><Input /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending || update.isPending}>保存</Button></Form></Modal>
  </div>;
}
