/** 管理员维护两类内部账号、启停状态和临时密码。 */
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Dropdown, Form, Input, Modal, Select, Space, Switch, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, ensureSuccess, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema, User } from '../../shared/api/types';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { useAuth } from '../auth/AuthProvider';

const accountTypes = [
  { value: 'ADMIN' as const, label: '管理员' },
  { value: 'ENGINEER' as const, label: '工程师' },
];

export function UserManagementPage() {
  const auth = useAuth();
  const { message } = App.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User>();
  const [resetting, setResetting] = useState<User>();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawInactive = searchParams.get('inactive');
  const showInactive = rawInactive === '1';
  const rawPage = searchParams.get('page');
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  const users = useQuery({ queryKey: queryKeys.users, queryFn: async () => unwrap(await api.GET('/api/v1/users')), staleTime: QUERY_STALE_TIME.businessList });
  const refresh = async () => queryClient.invalidateQueries({ queryKey: queryKeys.users });
  const create = useMutation({ mutationFn: async (body: Schema<'UserCreate'>) => unwrap(await api.POST('/api/v1/users', { params: { header: csrfHeader() }, body })), onSuccess: async () => { setCreateOpen(false); await refresh(); } });
  const update = useMutation({ mutationFn: async (body: Schema<'UserUpdate'>) => { if (!editing) throw new Error('未选择用户'); return unwrap(await api.PATCH('/api/v1/users/{user_id}', { params: { path: { user_id: editing.id }, header: csrfHeader() }, body })); }, onSuccess: async () => { setEditing(undefined); message.success('用户信息已保存'); await refresh(); } });
  const reset = useMutation({ mutationFn: async (body: Schema<'ResetPasswordRequest'>) => { if (!resetting) throw new Error('未选择用户'); return ensureSuccess(await api.POST('/api/v1/users/{user_id}/reset-password', { params: { path: { user_id: resetting.id }, header: csrfHeader() }, body })); }, onSuccess: async () => { setResetting(undefined); message.success('密码已重置并撤销会话'); await refresh(); } });
  const displayedUsers = users.data?.items.filter((user) => showInactive || user.is_active);
  useEffect(() => {
    if ((rawInactive !== null && rawInactive !== '1') || (rawPage !== null && !/^[1-9]\d*$/.test(rawPage)) || (displayedUsers && page > Math.max(1, Math.ceil(displayedUsers.length / 10)))) {
      const next = new URLSearchParams(searchParams);
      if (rawInactive !== null && rawInactive !== '1') next.delete('inactive');
      if ((rawPage !== null && !/^[1-9]\d*$/.test(rawPage)) || (displayedUsers && page > Math.max(1, Math.ceil(displayedUsers.length / 10)))) next.delete('page');
      setSearchParams(next, { replace: true });
    }
  }, [displayedUsers, page, rawInactive, rawPage, searchParams, setSearchParams]);
  const setView = (changes: { inactive?: boolean; page?: number }) => {
    const next = new URLSearchParams(searchParams);
    if (changes.inactive !== undefined) {
      if (changes.inactive) next.set('inactive', '1'); else next.delete('inactive');
    }
    if (changes.page !== undefined) {
      if (changes.page === 1) next.delete('page'); else next.set('page', String(changes.page));
    }
    setSearchParams(next);
  };
  if (!auth.isAdmin) return <Navigate to="/" replace />;
  const error = users.error ?? create.error ?? update.error ?? reset.error;
  return <div className="page-stack"><PageHeader eyebrow="身份管理" title="用户管理" description="停用和密码重置会立即撤销目标用户会话；系统始终保留有效管理员。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增用户</Button>} />
    {error && <Alert role="alert" type="error" showIcon message={errorMessage(error)} />}
    <Card className="collection-panel" extra={<Space><Typography.Text>显示停用账号</Typography.Text><Switch aria-label="显示停用账号" checked={showInactive} onChange={(checked) => setView({ inactive: checked, page: 1 })} /></Space>}><TableRegion label="用户列表"><Table<User> rowKey="id" loading={users.isLoading} dataSource={displayedUsers} pagination={{ current: page, pageSize: 10, showSizeChanger: false, onChange: (nextPage) => setView({ page: nextPage }) }} sticky={{ offsetHeader: 72 }} scroll={{ x: 760 }} columns={[{ title: '账号', dataIndex: 'username', render: (value) => <span className="data-code">{value}</span> }, { title: '姓名', dataIndex: 'display_name' }, { title: '类型', dataIndex: 'account_type', render: (value) => <StatusTag status={value} /> }, { title: '状态', dataIndex: 'is_active', render: (value) => <StatusTag status={value ? 'ACTIVE' : 'RETIRED'} /> }, { title: '强制改密', dataIndex: 'must_change_password', render: (value) => value ? '是' : '否' }, { title: '操作', render: (_, row) => <Space><Button size="small" onClick={() => setEditing(row)}>编辑</Button><Dropdown trigger={['click']} menu={{ items: [{ key: 'reset', label: '重置密码', disabled: row.id === auth.user?.id }], onClick: () => setResetting(row) }}><Button size="small" aria-label={`更多操作：${row.username}`}>更多 <DownOutlined /></Button></Dropdown></Space> }]} /></TableRegion></Card>
    <Modal title="新增用户" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden><Form<Schema<'UserCreate'>> layout="vertical" onFinish={(body) => create.mutate(body)}><Form.Item name="username" label="用户名" rules={[{ required: true, min: 3 }]}><Input /></Form.Item><Form.Item name="display_name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="password" label="初始密码" rules={[{ required: true, min: 12 }]}><Input.Password /></Form.Item><Form.Item name="account_type" label="账号类型" rules={[{ required: true }]}><Select options={accountTypes} /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建</Button></Form></Modal>
    <Modal title="编辑用户" open={!!editing} onCancel={() => setEditing(undefined)} footer={null} destroyOnHidden>{editing && <Form<Schema<'UserUpdate'>> layout="vertical" initialValues={{ expected_revision: editing.revision, display_name: editing.display_name, account_type: editing.account_type, is_active: editing.is_active }} onFinish={(body) => update.mutate(body)}><Form.Item name="expected_revision" hidden><Input /></Form.Item><Form.Item name="display_name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="account_type" label="账号类型"><Select options={accountTypes} /></Form.Item><Form.Item name="is_active" label="状态"><Select options={[{ value: true, label: '启用' }, { value: false, label: '停用' }]} /></Form.Item><Button type="primary" htmlType="submit" loading={update.isPending}>保存</Button></Form>}</Modal>
    <Modal title={`重置 ${resetting?.username ?? ''} 的密码`} open={!!resetting} onCancel={() => setResetting(undefined)} footer={null} destroyOnHidden><Form<Schema<'ResetPasswordRequest'>> layout="vertical" onFinish={(body) => reset.mutate(body)}><Form.Item name="temporary_password" label="临时密码" rules={[{ required: true, min: 12 }]}><Input.Password /></Form.Item><Button type="primary" htmlType="submit" loading={reset.isPending}>重置并撤销会话</Button></Form></Modal>
  </div>;
}
