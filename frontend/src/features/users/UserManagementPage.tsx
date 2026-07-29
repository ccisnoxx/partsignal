/** 管理员用户工作台：URL 持有查询视图，服务端持有账号状态、统计与权限。 */
import {
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Dropdown,
  Form,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { ApiError, api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema, User, UserExportQuery, UserListQuery } from '../../shared/api/types';
import { NoData, QueryFailure } from '../../shared/components/AsyncState';
import { DeletionError } from '../../shared/components/DeletionError';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { useAuth } from '../auth/AuthProvider';

type AccountType = Schema<'AccountType'>;
type UserStatus = Schema<'UserStatus'>;
type UserViewStatus = UserStatus | 'ALL';

const accountTypes: Array<{ value: AccountType; label: string }> = [
  { value: 'ADMIN', label: '管理员' },
  { value: 'ENGINEER', label: '工程师' },
];

const pageSizes = [10, 20, 50] as const;
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseUserView(searchParams: URLSearchParams) {
  const rawQuery = searchParams.get('q')?.trim() ?? '';
  const q = rawQuery.length <= 200 ? rawQuery : '';
  const rawAccountType = searchParams.get('account_type');
  const accountType: AccountType | undefined = rawAccountType === 'ADMIN' || rawAccountType === 'ENGINEER' ? rawAccountType : undefined;
  const rawStatus = searchParams.get('status');
  const status: UserViewStatus = rawStatus === 'DISABLED' || rawStatus === 'ALL' ? rawStatus : 'ENABLED';
  const page = parsePositiveInteger(searchParams.get('page')) ?? 1;
  const rawPageSize = parsePositiveInteger(searchParams.get('page_size'));
  const pageSize = pageSizes.find((size) => size === rawPageSize) ?? 20;
  const canonical = new URLSearchParams();
  if (q) canonical.set('q', q);
  if (accountType) canonical.set('account_type', accountType);
  if (status !== 'ENABLED') canonical.set('status', status);
  if (page !== 1) canonical.set('page', String(page));
  if (pageSize !== 20) canonical.set('page_size', String(pageSize));
  return { q, accountType, status, page, pageSize, canonical };
}

function OperationFailure({ error, title = '操作失败' }: { error: unknown; title?: string }) {
  const apiError = error instanceof ApiError ? error : undefined;
  return (
    <Alert
      role="alert"
      type="error"
      showIcon
      title={title}
      description={<Space orientation="vertical" size={2}><span>{errorMessage(error)}</span>{apiError && <Typography.Text className="data-code" type="secondary">错误码：{apiError.code}{apiError.requestId ? ` · 请求 ID：${apiError.requestId}` : ''}</Typography.Text>}</Space>}
    />
  );
}

function UserSearchField({ initialValue, onSearch }: { initialValue: string; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(initialValue);
  return (
    <Input.Search
      aria-label="搜索用户名或显示名称"
      allowClear
      maxLength={200}
      placeholder="搜索用户名或显示名称"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onSearch={() => onSearch(draft)}
    />
  );
}

export function UserManagementPage() {
  const auth = useAuth();
  const { message, modal } = App.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User>();
  const [resetting, setResetting] = useState<User>();
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] });
  const [searchResetVersion, setSearchResetVersion] = useState(0);
  const [batchFeedback, setBatchFeedback] = useState<{ succeeded: number; failures: Array<Schema<'UserBulkStatusFailure'> & { username: string }> }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const canonicalSource = searchParams.toString();
  const view = parseUserView(searchParams);
  const canonicalSearch = view.canonical.toString();

  const listQuery = useMemo<UserListQuery>(() => ({
    ...(view.q ? { q: view.q } : {}),
    ...(view.accountType ? { account_type: view.accountType } : {}),
    ...(view.status === 'ALL' ? {} : { status: view.status }),
    page: view.page,
    page_size: view.pageSize,
  }), [view.accountType, view.page, view.pageSize, view.q, view.status]);
  const exportQuery = useMemo<UserExportQuery>(() => ({
    ...(view.q ? { q: view.q } : {}),
    ...(view.accountType ? { account_type: view.accountType } : {}),
    ...(view.status === 'ALL' ? {} : { status: view.status }),
  }), [view.accountType, view.q, view.status]);
  const users = useQuery({
    queryKey: queryKeys.users.list(listQuery),
    queryFn: async () => unwrap(await api.GET('/api/v1/users', { params: { query: listQuery } })),
    staleTime: QUERY_STALE_TIME.businessList,
    enabled: auth.isAdmin,
  });

  useEffect(() => {
    if (canonicalSource !== canonicalSearch) setSearchParams(canonicalSearch, { replace: true });
  }, [canonicalSearch, canonicalSource, setSearchParams]);
  useEffect(() => {
    if (!users.data) return;
    const lastPage = Math.max(1, Math.ceil(users.data.total / view.pageSize));
    if (view.page <= lastPage) return;
    const next = new URLSearchParams(view.canonical);
    if (lastPage === 1) next.delete('page'); else next.set('page', String(lastPage));
    setSearchParams(next, { replace: true });
  }, [setSearchParams, users.data, view.canonical, view.page, view.pageSize]);

  const setView = (changes: Partial<{ q: string; accountType?: AccountType; status: UserViewStatus; page: number; pageSize: number }>) => {
    const next = new URLSearchParams(view.canonical);
    if ('q' in changes) {
      const q = changes.q?.trim();
      if (q) next.set('q', q); else next.delete('q');
    }
    if ('accountType' in changes) {
      if (changes.accountType) next.set('account_type', changes.accountType); else next.delete('account_type');
    }
    if (changes.status !== undefined) {
      if (changes.status === 'ENABLED') next.delete('status'); else next.set('status', changes.status);
    }
    if (changes.page !== undefined) {
      if (changes.page === 1) next.delete('page'); else next.set('page', String(changes.page));
    }
    if (changes.pageSize !== undefined) {
      if (changes.pageSize === 20) next.delete('page_size'); else next.set('page_size', String(changes.pageSize));
    }
    setSearchParams(next);
  };

  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
  const refreshSelf = (savedUsers: User[]) => savedUsers.some((user) => user.id === auth.user?.id)
    ? queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
    : Promise.resolve();
  const create = useMutation({
    mutationFn: async (body: Schema<'UserCreate'>) => unwrap(await api.POST('/api/v1/users', { params: { header: csrfHeader() }, body })),
    onSuccess: async () => { setCreateOpen(false); message.success('用户已创建'); await refreshUsers(); },
  });
  const update = useMutation({
    mutationFn: async ({ user, body }: { user: User; body: Schema<'UserUpdate'> }) => unwrap(await api.PATCH('/api/v1/users/{user_id}', { params: { path: { user_id: user.id }, header: csrfHeader() }, body })),
    onSuccess: async (saved) => { setEditing(undefined); message.success('用户信息已保存'); await Promise.all([refreshUsers(), refreshSelf([saved])]); },
  });
  const resetPassword = useMutation({
    mutationFn: async ({ user, body }: { user: User; body: Schema<'ResetPasswordRequest'> }) => ensureSuccess(await api.POST('/api/v1/users/{user_id}/reset-password', { params: { path: { user_id: user.id }, header: csrfHeader() }, body })),
    onSuccess: async () => { setResetting(undefined); message.success('临时密码已更新，目标用户会话已撤销'); await refreshUsers(); },
  });
  const deleteUser = useMutation({
    mutationFn: async (user: User) => ensureSuccess(await api.DELETE('/api/v1/users/{user_id}', {
      params: { path: { user_id: user.id }, header: csrfHeader() },
    })),
    onSuccess: async () => { message.success('用户已删除'); await refreshUsers(); },
  });
  const toggleStatus = useMutation({
    mutationFn: async ({ user, isActive }: { user: User; isActive: boolean }) => unwrap(await api.PATCH('/api/v1/users/{user_id}', {
      params: { path: { user_id: user.id }, header: csrfHeader() },
      body: { expected_revision: user.revision, display_name: user.display_name, account_type: user.account_type, is_active: isActive },
    })),
    onSuccess: async (saved) => { message.success(saved.is_active ? '用户已启用' : '用户已停用'); await Promise.all([refreshUsers(), refreshSelf([saved])]); },
  });
  const bulkStatus = useMutation({
    mutationFn: async ({ selectedUsers, status }: { selectedUsers: User[]; status: UserStatus }) => unwrap(await api.POST('/api/v1/users/bulk-status', {
      params: { header: csrfHeader() },
      body: { items: selectedUsers.map((user) => ({ user_id: user.id, expected_revision: user.revision })), status },
    })),
    onSuccess: async (result, variables) => {
      const userNames = new Map(variables.selectedUsers.map((user) => [user.id, user.username]));
      setBatchFeedback({
        succeeded: result.succeeded.length,
        failures: result.failures.map((failure) => ({ ...failure, username: userNames.get(failure.user_id) ?? failure.user_id })),
      });
      if (result.failures.length) message.warning(`批量操作完成：成功 ${result.succeeded.length}，失败 ${result.failures.length}`);
      else message.success(`已批量${variables.status === 'ENABLED' ? '启用' : '停用'} ${result.succeeded.length} 个用户`);
      await Promise.all([refreshUsers(), refreshSelf(result.succeeded)]);
    },
  });
  const exportList = useMutation({
    mutationFn: async () => {
      const result = await api.GET('/api/v1/users/export', { params: { query: exportQuery }, parseAs: 'text' });
      const csv = unwrap(result);
      const disposition = result.response.headers.get('Content-Disposition');
      const encodedName = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plainName = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
      const fileName = encodedName ? decodeURIComponent(encodedName) : plainName ?? 'users.csv';
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => message.success('用户列表已导出'),
  });

  if (!auth.isAdmin) return <Navigate to="/" replace />;

  const items = users.data?.items ?? [];
  const selectionScope = `${canonicalSearch}:${users.dataUpdatedAt}`;
  const selectedIds = selection.scope === selectionScope ? selection.ids : [];
  const selectedUsers = items.filter((user) => selectedIds.includes(user.id));
  const hasFilters = !!(view.q || view.accountType || view.status !== 'ENABLED');
  const operationError = toggleStatus.error ?? bulkStatus.error ?? exportList.error;
  const summary = users.data?.summary;

  const resetFilters = () => {
    setSearchResetVersion((version) => version + 1);
    setSearchParams(new URLSearchParams());
  };
  const confirmToggle = (user: User) => modal.confirm({
    title: `${user.is_active ? '停用' : '启用'}用户“${user.username}”？`,
    content: user.is_active ? '停用后该用户的全部活动会话会被撤销，历史业务归属保持不变。' : '启用会恢复该账号的登录资格，不会改写其历史业务记录。',
    okText: user.is_active ? '停用用户' : '启用用户',
    cancelText: '取消',
    okButtonProps: user.is_active ? { danger: true } : undefined,
    onOk: () => toggleStatus.mutateAsync({ user, isActive: !user.is_active }),
  });
  const confirmBulk = (status: UserStatus) => {
    if (!selectedUsers.length) return;
    const verb = status === 'ENABLED' ? '启用' : '停用';
    modal.confirm({
      title: `批量${verb} ${selectedUsers.length} 个用户？`,
      content: status === 'DISABLED' ? '成功停用的用户会立即撤销全部活动会话；失败项会保留原状态并逐项说明。' : '服务端会逐项校验修订号与管理员保护，失败项会保留原状态。',
      okText: `批量${verb}`,
      cancelText: '取消',
      okButtonProps: status === 'DISABLED' ? { danger: true } : undefined,
      onOk: () => { setBatchFeedback(undefined); return bulkStatus.mutateAsync({ selectedUsers, status }); },
    });
  };
  const confirmDelete = (user: User) => modal.confirm({
    title: `删除用户“${user.username}”？`,
    content: '删除后该账号全部会话会被清理，历史审计记录保留但操作者会置空；存在业务历史引用时服务端会拒绝。此操作不可恢复。',
    okText: '删除用户',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk: () => deleteUser.mutate(user),
  });
  const exportCurrent = () => {
    if (users.data?.total === 0) { message.info('当前筛选没有可导出的用户'); return; }
    exportList.mutate();
  };
  const rowMenu = (user: User): MenuProps => {
    const items: NonNullable<MenuProps['items']> = [
      { key: 'reset', icon: <KeyOutlined />, label: '重置临时密码', disabled: user.id === auth.user?.id },
      { type: 'divider' },
      { key: 'toggle', icon: user.is_active ? <StopOutlined /> : <CheckCircleOutlined />, label: user.is_active ? '停用用户' : '启用用户', danger: user.is_active },
    ];
    if (!user.is_active) items.push({ key: 'delete', icon: <DeleteOutlined />, label: '删除用户', danger: true });
    return {
      items,
      onClick: ({ key }) => {
        if (key === 'reset') { resetPassword.reset(); setResetting(user); }
        else if (key === 'toggle') confirmToggle(user);
        else if (key === 'delete') confirmDelete(user);
      },
    };
  };

  return (
    <div className="page-stack user-management-page">
      <PageHeader
        title="用户管理"
        description="管理内部账号、账号类型、启停状态和临时密码。"
        actions={<Button aria-label="新增用户" type="primary" icon={<PlusOutlined />} onClick={() => { create.reset(); setCreateOpen(true); }}>新增用户</Button>}
      />

      <section className="user-management-summary-grid" aria-label="用户统计">
        <MetricTile icon={<UserOutlined />} label="用户总数" value={summary ? summary.user_total : <Skeleton.Input active size="small" />} meta="暂无历史基线" tone="data" />
        <MetricTile icon={<CheckCircleOutlined />} label="已启用用户" value={summary ? summary.enabled_total : <Skeleton.Input active size="small" />} meta="暂无历史基线" tone="success" />
        <MetricTile icon={<StopOutlined />} label="已停用用户" value={summary ? summary.disabled_total : <Skeleton.Input active size="small" />} meta="暂无历史基线" tone="danger" />
        <MetricTile icon={<KeyOutlined />} label="必须修改密码" value={summary ? summary.must_change_password_total : <Skeleton.Input active size="small" />} meta="暂无历史基线" tone="warning" />
        <MetricTile icon={<SafetyCertificateOutlined />} label="管理员数量" value={summary ? summary.admin_total : <Skeleton.Input active size="small" />} meta="暂无历史基线" />
      </section>

      {operationError && <OperationFailure error={operationError} />}
      {deleteUser.error && <DeletionError error={deleteUser.error} />}
      {batchFeedback?.failures.length ? (
        <Alert
          closable
          onClose={() => setBatchFeedback(undefined)}
          role="alert"
          type="warning"
          showIcon
          title={`批量操作部分完成：成功 ${batchFeedback.succeeded}，失败 ${batchFeedback.failures.length}`}
          description={<ul className="user-management-failure-list">{batchFeedback.failures.map((failure) => <li key={failure.user_id}><strong>{failure.username}</strong>：{failure.message} <span className="data-code">({failure.code})</span></li>)}</ul>}
        />
      ) : null}

      <div className="user-management-workspace">
        <Card className="user-management-list-card" styles={{ body: { padding: 0 } }}>
          <div className="user-management-toolbar">
            <UserSearchField
              key={`${view.q}:${searchResetVersion}`}
              initialValue={view.q}
              onSearch={(q) => setView({ q, page: 1 })}
            />
            <label className="user-management-filter"><span>账号类型</span><Select<AccountType | undefined> aria-label="账号类型" value={view.accountType} placeholder="全部类型" allowClear options={accountTypes} onChange={(accountType) => setView({ accountType, page: 1 })} /></label>
            <label className="user-management-filter"><span>启用状态</span><Select<UserViewStatus> aria-label="启用状态" value={view.status} options={[{ value: 'ALL', label: '全部状态' }, { value: 'ENABLED', label: '已启用' }, { value: 'DISABLED', label: '已停用' }]} onChange={(status) => setView({ status, page: 1 })} /></label>
            <label className="user-management-switch"><span>显示停用账号</span><Switch aria-label="显示停用账号" checked={view.status !== 'ENABLED'} onChange={(checked) => setView({ status: checked ? 'ALL' : 'ENABLED', page: 1 })} /></label>
            <Button aria-label="重置筛选" icon={<ReloadOutlined />} onClick={resetFilters}>重置筛选</Button>
            <Typography.Text className="user-management-total">共 <strong>{users.data ? users.data.total : '—'}</strong> 个用户</Typography.Text>
            <Button aria-label="导出列表" icon={<DownloadOutlined />} loading={exportList.isPending} onClick={exportCurrent}>导出列表</Button>
          </div>

          {users.error ? <div className="user-management-query-state"><QueryFailure error={users.error} onRetry={() => void users.refetch()} /></div> : (
            <>
              <TableRegion label="用户列表">
                <Table<User>
                  rowKey="id"
                  loading={users.isLoading}
                  dataSource={items}
                  pagination={false}
                  scroll={{ x: 980 }}
                  rowSelection={{
                    selectedRowKeys: selectedIds,
                    preserveSelectedRowKeys: false,
                    onChange: (keys) => setSelection({ scope: selectionScope, ids: keys.map(String) }),
                  }}
                  locale={{ emptyText: <NoData description="当前筛选没有用户" action={hasFilters ? <Button onClick={resetFilters}>清除筛选</Button> : undefined} /> }}
                  columns={[
                    { title: '用户名', dataIndex: 'username', render: (value: string, row) => <Space><Avatar className="user-management-avatar" aria-label={`${row.username} 的头像`} icon={<UserOutlined />}>{row.display_name.slice(0, 1)}</Avatar><span className="data-code">{value}</span></Space> },
                    { title: '显示名称', dataIndex: 'display_name' },
                    { title: '账号类型', dataIndex: 'account_type', width: 120, render: (value: string) => <StatusTag compact status={value} /> },
                    { title: '状态', dataIndex: 'is_active', width: 105, render: (value: boolean) => <StatusTag compact status={value ? 'ENABLED' : 'DISABLED'} /> },
                    { title: '必须修改密码', dataIndex: 'must_change_password', width: 135, render: (value: boolean) => <Tag className={`user-management-boolean user-management-boolean-${value ? 'yes' : 'no'}`}>{value ? '是' : '否'}</Tag> },
                    { title: '创建时间', dataIndex: 'created_at', width: 168, render: (value: string) => <time dateTime={value}>{dateTimeFormatter.format(new Date(value))}</time> },
                    { title: '操作', fixed: 'right', width: 104, render: (_, row) => <Space size={4}><Tooltip title={`编辑 ${row.username}`}><Button aria-label={`编辑用户：${row.username}`} size="small" icon={<EditOutlined />} onClick={() => { update.reset(); setEditing(row); }} /></Tooltip><Dropdown trigger={['click']} menu={rowMenu(row)}><Button aria-label={`更多操作：${row.username}`} size="small" icon={<EllipsisOutlined />} /></Dropdown></Space> },
                  ]}
                />
              </TableRegion>
              <div className="user-management-pagination">
                <Select<number> aria-label="每页数量" value={view.pageSize} options={pageSizes.map((size) => ({ value: size, label: `${size} 条/页` }))} onChange={(pageSize) => setView({ pageSize, page: 1 })} />
                <Pagination current={view.page} pageSize={view.pageSize} total={users.data?.total ?? 0} showSizeChanger={false} showQuickJumper onChange={(page) => setView({ page })} />
              </div>
            </>
          )}
        </Card>

        <aside className="user-management-aside" aria-label="用户管理说明">
          <Card size="small" title="账号类型说明">
            <div className="user-management-help-item"><StatusTag status="ADMIN" /><p>拥有系统全部管理与配置权限，负责系统治理与平台配置。</p></div>
            <div className="user-management-help-item"><StatusTag status="ENGINEER" /><p>负责内容执行、发布与观测等日常运营工作。</p></div>
          </Card>
          <Card size="small" title="临时密码说明">
            <ul><li>新建或重置后，用户下次登录必须修改密码。</li><li>服务端只保存安全哈希，重置会撤销目标用户全部会话。</li><li>请通过安全渠道告知用户临时密码。</li></ul>
          </Card>
          <Card size="small" title="重要提示">
            <ul className="user-management-warning-list"><li><WarningOutlined /> 仅停用且无业务历史引用的账号可确认删除。</li><li><WarningOutlined /> 删除会清理会话，并保留操作者置空后的历史审计。</li><li><WarningOutlined /> 建议先停用不再使用的账号，再确认其历史归属。</li></ul>
          </Card>
          <Card size="small" title="快捷操作">
            <Space wrap>
              <Button aria-label="批量启用" icon={<CheckCircleOutlined />} disabled={!selectedUsers.length} loading={bulkStatus.isPending} onClick={() => confirmBulk('ENABLED')}>批量启用</Button>
              <Button aria-label="批量停用" danger icon={<StopOutlined />} disabled={!selectedUsers.length} loading={bulkStatus.isPending} onClick={() => confirmBulk('DISABLED')}>批量停用</Button>
              <Button aria-label="导出用户列表" icon={<DownloadOutlined />} loading={exportList.isPending} onClick={exportCurrent}>导出用户列表</Button>
            </Space>
          </Card>
        </aside>
      </div>

      <Modal title="新增用户" open={createOpen} onCancel={() => { setCreateOpen(false); create.reset(); }} footer={null} destroyOnHidden>
        {create.error && <OperationFailure error={create.error} title="创建失败" />}
        <Form<Schema<'UserCreate'>> layout="vertical" scrollToFirstError onFinish={(body) => create.mutate(body)}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3, max: 64 }]}><Input autoComplete="off" /></Form.Item>
          <Form.Item name="display_name" label="显示名称" rules={[{ required: true, max: 100 }]}><Input autoComplete="name" /></Form.Item>
          <Form.Item name="temporary_password" label="临时密码" extra="账号创建后首次登录必须修改密码。" rules={[{ required: true, min: 12 }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item name="account_type" label="账号类型" rules={[{ required: true }]}><Select options={accountTypes} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={create.isPending}>创建用户</Button>
        </Form>
      </Modal>

      <Modal title={`编辑用户 ${editing?.username ?? ''}`} open={!!editing} onCancel={() => { setEditing(undefined); update.reset(); }} footer={null} destroyOnHidden>
        {update.error && <OperationFailure error={update.error} title="保存失败" />}
        {editing && (
          <Form<Schema<'UserUpdate'>> layout="vertical" scrollToFirstError initialValues={{ expected_revision: editing.revision, display_name: editing.display_name, account_type: editing.account_type, is_active: editing.is_active }} onFinish={(body) => update.mutate({ user: editing, body })}>
            <Form.Item label="用户名"><Input value={editing.username} disabled /></Form.Item>
            <Form.Item name="expected_revision" hidden><Input type="number" /></Form.Item>
            <Form.Item name="display_name" label="显示名称" rules={[{ required: true, max: 100 }]}><Input /></Form.Item>
            <Form.Item name="account_type" label="账号类型" rules={[{ required: true }]}><Select options={accountTypes} /></Form.Item>
            <Form.Item name="is_active" label="状态" rules={[{ required: true }]}><Select options={[{ value: true, label: '启用' }, { value: false, label: '停用' }]} /></Form.Item>
            <Button type="primary" htmlType="submit" loading={update.isPending}>保存修改</Button>
          </Form>
        )}
      </Modal>

      <Modal title={`重置 ${resetting?.username ?? ''} 的临时密码`} open={!!resetting} onCancel={() => { setResetting(undefined); resetPassword.reset(); }} footer={null} destroyOnHidden>
        {resetPassword.error && <OperationFailure error={resetPassword.error} title="重置失败" />}
        {resetting && (
          <Form<Schema<'ResetPasswordRequest'>> layout="vertical" scrollToFirstError onFinish={(body) => resetPassword.mutate({ user: resetting, body })}>
            <Alert className="form-alert" type="warning" showIcon title="重置成功后，该用户全部活动会话会被撤销，下次登录必须修改密码。" />
            <Form.Item name="temporary_password" label="临时密码" rules={[{ required: true, min: 8 }]}><Input.Password autoComplete="new-password" /></Form.Item>
            <Button type="primary" htmlType="submit" loading={resetPassword.isPending}>重置临时密码</Button>
          </Form>
        )}
      </Modal>
    </div>
  );
}
