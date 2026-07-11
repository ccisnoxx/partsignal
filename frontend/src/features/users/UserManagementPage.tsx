/** 管理员维护两类内部账号、启停状态和临时密码。 */
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Typography } from 'antd';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, ensureSuccess, unwrap } from '../../shared/api/client';
import type { Schema, User } from '../../shared/api/types';
import { StatusTag } from '../../shared/components/StatusTag';
import { useAuth } from '../auth/AuthProvider';

const accountTypes = [
  { value: 'ADMIN' as const, label: '管理员' },
  { value: 'ENGINEER' as const, label: '工程师' },
];

export function UserManagementPage() {
  const auth = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User>();
  const [resetting, setResetting] = useState<User>();
  const [showInactive, setShowInactive] = useState(false);
  const users = useQuery({ queryKey: ['users'], queryFn: async () => unwrap(await api.GET('/api/v1/users')) });
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({ mutationFn: async (body: Schema<'UserCreate'>) => unwrap(await api.POST('/api/v1/users', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setCreateOpen(false); await refresh(); } });
  const update = useMutation({ mutationFn: async (body: Schema<'UserUpdate'>) => { if (!editing) throw new Error('未选择用户'); return unwrap(await api.PATCH('/api/v1/users/{user_id}', { params: { path: { user_id: editing.id }, header: csrfHeader() }, body })); }, onSuccess: async () => { setEditing(undefined); await refresh(); } });
  const reset = useMutation({ mutationFn: async (body: Schema<'ResetPasswordRequest'>) => { if (!resetting) throw new Error('未选择用户'); return ensureSuccess(await api.POST('/api/v1/users/{user_id}/reset-password', { params: { path: { user_id: resetting.id }, header: csrfHeader() }, body })); }, onSuccess: async () => { setResetting(undefined); await refresh(); } });
  if (!auth.isAdmin) return <Navigate to="/" replace />;
  const error = users.error ?? create.error ?? update.error ?? reset.error;
  const displayedUsers = users.data?.items.filter((user) => showInactive || user.is_active);
  return <div className="page-stack"><header className="page-heading"><div><Typography.Text className="eyebrow">IDENTITY CONTROL</Typography.Text><Typography.Title>用户管理</Typography.Title><Typography.Paragraph>停用和密码重置会立即撤销目标用户会话；系统始终保留有效管理员。</Typography.Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增用户</Button></header>
    {error && <Alert type="error" message={errorMessage(error)} />}
    <Card extra={<Space><Typography.Text>显示停用账号</Typography.Text><Switch aria-label="显示停用账号" checked={showInactive} onChange={setShowInactive} /></Space>}><Table<User> rowKey="id" loading={users.isLoading} dataSource={displayedUsers} columns={[{ title: '账号', dataIndex: 'username' }, { title: '姓名', dataIndex: 'display_name' }, { title: '类型', dataIndex: 'account_type', render: (value) => <StatusTag status={value} /> }, { title: '状态', dataIndex: 'is_active', render: (value) => <StatusTag status={value ? 'ACTIVE' : 'RETIRED'} /> }, { title: '强制改密', dataIndex: 'must_change_password', render: (value) => value ? '是' : '否' }, { title: '操作', render: (_, row) => <Space><Button size="small" onClick={() => setEditing(row)}>编辑</Button><Button size="small" onClick={() => setResetting(row)} disabled={row.id === auth.user?.id}>重置密码</Button></Space> }]} /></Card>
    <Modal title="新增用户" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden><Form<Schema<'UserCreate'>> layout="vertical" onFinish={(body) => create.mutate(body)}><Form.Item name="username" label="用户名" rules={[{ required: true, min: 3 }]}><Input /></Form.Item><Form.Item name="display_name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="password" label="初始密码" rules={[{ required: true, min: 12 }]}><Input.Password /></Form.Item><Form.Item name="account_type" label="账号类型" rules={[{ required: true }]}><Select options={accountTypes} /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建</Button></Form></Modal>
    <Modal title="编辑用户" open={!!editing} onCancel={() => setEditing(undefined)} footer={null} destroyOnHidden>{editing && <Form<Schema<'UserUpdate'>> layout="vertical" initialValues={{ expected_revision: editing.revision, display_name: editing.display_name, account_type: editing.account_type, is_active: editing.is_active }} onFinish={(body) => update.mutate(body)}><Form.Item name="expected_revision" hidden><Input /></Form.Item><Form.Item name="display_name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="account_type" label="账号类型"><Select options={accountTypes} /></Form.Item><Form.Item name="is_active" label="状态"><Select options={[{ value: true, label: '启用' }, { value: false, label: '停用' }]} /></Form.Item><Button type="primary" htmlType="submit" loading={update.isPending}>保存</Button></Form>}</Modal>
    <Modal title={`重置 ${resetting?.username ?? ''} 的密码`} open={!!resetting} onCancel={() => setResetting(undefined)} footer={null} destroyOnHidden><Form<Schema<'ResetPasswordRequest'>> layout="vertical" onFinish={(body) => reset.mutate(body)}><Form.Item name="temporary_password" label="临时密码" rules={[{ required: true, min: 12 }]}><Input.Password /></Form.Item><Button type="primary" htmlType="submit" loading={reset.isPending}>重置并撤销会话</Button></Form></Modal>
  </div>;
}
