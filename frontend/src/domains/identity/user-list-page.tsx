import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { BulkActionBar } from '@/design-system/data-table/bulk-action-bar';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { FilterBar } from '@/design-system/data-table/filter-bar';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { TableToolbar } from '@/design-system/data-table/table-toolbar';
import type { BulkAction, ColumnRole } from '@/design-system/data-table/types';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Badge } from '@/design-system/primitives/badge';
import { Button, buttonVariants } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import type { components } from '@/shared/api/generated/schema';
import {
  UserRequestError,
  bulkUpdateUserStatus,
  createUser,
  deleteUser,
  exportUsers,
  resetUserPassword,
  setUserEnabled,
  updateUser,
  userKeys,
  userListQueryOptions,
} from './user.api';
import {
  accountTypeRegistry,
  accountTypeValues,
  hasUserFilters,
  mapUserCreateError,
  normalizeUserPageSize,
  resetPasswordFormSchema,
  resolveUserActions,
  userCreateFormSchema,
  userEditFormSchema,
  userSelectionScope,
  userStatusRegistry,
  userSearchToApiParams,
  type ResetPasswordFormValues,
  type User,
  type UserCommand,
  type UserCreateFormValues,
  type UserCreateErrorMapping,
  type UserEditFormValues,
  type UserSearch,
  type UserStatus,
} from './user-list.model';

const columnRoles = [
  'metadata', 'primary', 'status', 'status', 'metadata', 'date', 'actions',
] as const satisfies readonly ColumnRole[];

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const emptyUsers: User[] = [];

type UserListPageProps = {
  csrfToken: string | null;
  currentUserId: string;
  onAuthChanged: () => Promise<void>;
  onSearchChange: (search: UserSearch) => Promise<void> | void;
  search: UserSearch;
};

type SelectedUser = Pick<User, 'id' | 'revision' | 'username'>;
type Selection = { scope: string; items: Record<string, SelectedUser> };
type CommandTarget = { command: Exclude<UserCommand, 'delete-user' | 'show-deletion-blockers'>; user: User; focusReturn: HTMLElement | null };
type DeletionIntent = { id: string; command: 'delete-user' | 'show-deletion-blockers'; focusReturn: HTMLElement | null };
type BulkFeedback = {
  succeeded: number;
  failures: Array<components['schemas']['UserBulkStatusFailure'] & { username: string }>;
};

function UserListPage({
  csrfToken,
  currentUserId,
  onAuthChanged,
  onSearchChange,
  search,
}: UserListPageProps) {
  const queryClient = useQueryClient();
  const users = useQuery(userListQueryOptions(search));
  const activeListKey = JSON.stringify(userSearchToApiParams(search));
  const previousListKey = useRef(activeListKey);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CommandTarget>();
  const [resetTarget, setResetTarget] = useState<CommandTarget>();
  const [commandTarget, setCommandTarget] = useState<CommandTarget>();
  const [deletionIntent, setDeletionIntent] = useState<DeletionIntent>();
  const [bulkDisableTarget, setBulkDisableTarget] = useState<SelectedUser[]>();
  const scope = userSelectionScope(search);
  const [selection, setSelection] = useState<Selection>({ scope, items: {} });
  const [selectionNotice, setSelectionNotice] = useState<string>();
  const [bulkFeedback, setBulkFeedback] = useState<BulkFeedback>();
  const rows = users.data?.items ?? emptyUsers;
  const total = users.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);
  const selectedItems = selection.scope === scope ? Object.values(selection.items) : [];
  const selectedIds = new Set(selectedItems.map((item) => item.id));
  const filtered = hasUserFilters(search);

  useEffect(() => {
    if (previousListKey.current !== activeListKey) {
      previousListKey.current = activeListKey;
      // 搜索、筛选或分页改变后，旧删除意图不得在新 query key 中复活。
      setDeletionIntent(undefined);
    }
  }, [activeListKey]);

  useEffect(() => {
    if (deletionIntent && users.data && !users.data.items.some((user) => user.id === deletionIntent.id)) {
      // 当前用户 query 已确认目标消失，不能从其他筛选或分页 cache 恢复。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeletionIntent(undefined);
    }
  }, [deletionIntent, users.data]);

  function changeSearch(changes: Partial<UserSearch>, resetPage = true) {
    setDeletionIntent(undefined);
    void onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  async function refreshUsers(savedUsers: readonly User[] = []) {
    await queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    if (savedUsers.some((user) => user.id === currentUserId)) await onAuthChanged();
  }

  useEffect(() => {
    if (selection.scope !== scope) {
      // URL 查询是选择范围的外部 owner，范围切换后必须同步销毁旧快照。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Object.keys(selection.items).length) setSelectionNotice('查询范围已变化，已清除原有选择。');
      setSelection({ scope, items: {} });
      return;
    }
    if (!users.data) return;
    const visible = new Map(rows.map((user) => [user.id, user.revision]));
    const stale = Object.values(selection.items).some((item) => visible.get(item.id) !== item.revision);
    if (stale) {
      // 服务端 revision 是选择有效性的权威依据，刷新后发现漂移必须整体清空。
      setSelection({ scope, items: {} });
      setSelectionNotice('列表数据已更新，已清除过期选择。');
    }
  }, [rows, scope, selection, users.data]);

  const command = useMutation({
    mutationFn: async (target: CommandTarget) => {
      switch (target.command) {
        case 'enable-user': return setUserEnabled(target.user, true, csrfToken);
        case 'disable-user': return setUserEnabled(target.user, false, csrfToken);
        default: throw new Error(`用户列表收到无法执行的确认命令：${target.command}`);
      }
    },
    onSuccess: async (saved) => {
      setCommandTarget(undefined);
      command.reset();
      await refreshUsers(saved ? [saved] : []);
    },
  });

  const bulk = useMutation({
    mutationFn: ({ items, status }: { items: SelectedUser[]; status: UserStatus }) => (
      bulkUpdateUserStatus(
        items.map((item) => ({ user_id: item.id, expected_revision: item.revision })),
        status,
        csrfToken,
      )
    ),
    onSuccess: async (result, variables) => {
      const names = new Map(variables.items.map((item) => [item.id, item.username]));
      setBulkFeedback({
        succeeded: result.succeeded.length,
        failures: result.failures.map((failure) => ({
          ...failure,
          username: names.get(failure.user_id) ?? failure.user_id,
        })),
      });
      setSelection({ scope, items: {} });
      setBulkDisableTarget(undefined);
      await refreshUsers(result.succeeded);
    },
  });

  const exportList = useMutation({
    mutationFn: () => exportUsers(search),
    onSuccess: ({ blob, fileName }) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });

  function openCommand(commandName: string, user: User, focusReturn?: HTMLElement | null) {
    if (
      commandName !== 'edit-user'
      && commandName !== 'reset-password'
      && commandName !== 'enable-user'
      && commandName !== 'disable-user'
      && commandName !== 'delete-user'
      && commandName !== 'show-deletion-blockers'
    ) {
      throw new Error(`用户列表收到未知页面命令：${commandName}`);
    }
    const targetFocus = focusReturn
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (commandName === 'delete-user' || commandName === 'show-deletion-blockers') {
      setDeletionIntent({ id: user.id, command: commandName, focusReturn: targetFocus });
    } else {
      const target: CommandTarget = {
        command: commandName as Exclude<UserCommand, 'delete-user' | 'show-deletion-blockers'>,
        user,
        focusReturn: targetFocus,
      };
      if (target.command === 'edit-user') setEditTarget(target);
      else if (target.command === 'reset-password') setResetTarget(target);
      else setCommandTarget(target);
    }
  }

  async function handleUserDeleted() {
    const deletedId = deletionIntent?.id;
    setDeletionIntent(undefined);
    await refreshUsers();
    if (deletedId && rows.length === 1 && search.page > 1) changeSearch({ page: search.page - 1 }, false);
  }

  function toggleSelected(user: User, checked: boolean) {
    setSelection((current) => {
      const items = current.scope === scope ? { ...current.items } : {};
      if (checked) items[user.id] = { id: user.id, username: user.username, revision: user.revision };
      else delete items[user.id];
      return { scope, items };
    });
    setSelectionNotice(undefined);
  }

  const allVisibleSelected = rows.length > 0 && rows.every((user) => selectedIds.has(user.id));
  const someVisibleSelected = rows.some((user) => selectedIds.has(user.id));
  const bulkActions: readonly BulkAction[] = [
    { key: 'enable', label: '批量启用', command: 'bulk-enable', intent: 'secondary', enabled: !bulk.isPending },
    {
      key: 'disable',
      label: '批量停用',
      command: 'bulk-disable',
      intent: 'danger',
      enabled: !bulk.isPending,
      confirmation: 'custom',
    },
  ];

  return (
    <section aria-labelledby="user-list-title" className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="type-page-title" id="user-list-title">用户管理</h1>
          <p className="max-w-3xl text-text-secondary">管理内部账号、账号类型、启停状态和临时密码。</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} ref={createTrigger} type="button">新增用户</Button>
      </header>

      <UserSummary data={users.data?.summary} />

      {users.data && users.error && (
        <Notice message={`刷新失败，已保留当前列表：${errorMessage(users.error)}`} onClose={() => void users.refetch()} />
      )}
      {selectionNotice && <Notice message={selectionNotice} onClose={() => setSelectionNotice(undefined)} tone="warning" />}
      {(bulk.error || exportList.error) && (
        <Notice message={errorMessage(bulk.error ?? exportList.error)} onClose={() => { bulk.reset(); exportList.reset(); }} />
      )}
      {bulkFeedback && <BulkResult feedback={bulkFeedback} onClose={() => setBulkFeedback(undefined)} />}

      <TableToolbar actions={(
        <Button
          disabled={exportList.isPending || total === 0}
          onClick={() => exportList.mutate()}
          type="button"
          variant="outline"
        >
          {exportList.isPending ? '导出中…' : '导出 CSV'}
        </Button>
      )}>
        <UserFilters
          key={`${search.q ?? ''}-${search.accountType ?? ''}-${search.status}`}
          onChange={(changes) => changeSearch(changes)}
          search={search}
        />
      </TableToolbar>

      <BulkActionBar
        actions={bulkActions}
        onClear={() => setSelection({ scope, items: {} })}
        onCommand={(commandName) => {
          if (commandName === 'bulk-enable') {
            setBulkFeedback(undefined);
            bulk.mutate({ items: selectedItems, status: 'ENABLED' });
          } else if (commandName === 'bulk-disable') {
            setBulkDisableTarget(selectedItems);
          } else {
            throw new Error(`用户列表收到未知批量命令：${commandName}`);
          }
        }}
        selectedCount={selectedItems.length}
      />

      <TableShell className="user-list-table" regionLabel="用户列表">
        <thead>
          <tr>
            <th data-column-role="metadata" data-user-selection scope="col">
              <SelectionCheckbox
                aria-label="选择当前页全部用户"
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected && !allVisibleSelected}
                onChange={(event) => rows.forEach((user) => toggleSelected(user, event.currentTarget.checked))}
              />
            </th>
            <th data-column-role="primary" scope="col">用户</th>
            <th data-column-role="status" data-user-column="account-type" scope="col">账号类型</th>
            <th data-column-role="status" data-user-column="status" scope="col">状态</th>
            <th data-user-column="password" data-column-role="metadata" scope="col">登录安全</th>
            <th data-user-column="created" data-column-role="date" scope="col">创建时间</th>
            <th data-column-role="actions" scope="col">操作</th>
          </tr>
        </thead>
        {users.isPending ? (
          <TableSkeleton columnRoles={columnRoles} />
        ) : users.error && !users.data ? (
          <EmptyTable
            action={<Button onClick={() => void users.refetch()} variant="outline">重试</Button>}
            colSpan={columnRoles.length}
            description={errorMessage(users.error)}
            kind="error"
            title="用户列表加载失败"
          />
        ) : total === 0 ? (
          <EmptyTable
            action={filtered ? <Button onClick={() => changeSearch({ q: undefined, accountType: undefined, status: 'ENABLED' })} variant="outline">清除筛选</Button> : undefined}
            colSpan={columnRoles.length}
            description={filtered ? '没有符合当前条件的用户。' : '当前还没有用户。'}
            kind={filtered ? 'filtered-empty' : 'empty'}
            title={filtered ? '未找到匹配用户' : '暂无用户'}
          />
        ) : rows.length === 0 ? (
          <EmptyTable
            action={<Button onClick={() => changeSearch({ page: pageCount }, false)} variant="outline">返回最后一页</Button>}
            colSpan={columnRoles.length}
            description="URL 指定的页码已超过当前结果范围。"
            kind="filtered-empty"
            title="当前页已超出范围"
          />
        ) : (
          <tbody>
            {rows.map((user) => {
              const pending = command.isPending && command.variables?.user.id === user.id;
              const actions = resolveUserActions(user, pending);
              return (
                <tr key={user.id}>
                  <td data-column-role="metadata" data-user-selection>
                    <SelectionCheckbox
                      aria-label={`选择用户 ${user.username}`}
                      checked={selectedIds.has(user.id)}
                      onChange={(event) => toggleSelected(user, event.currentTarget.checked)}
                    />
                  </td>
                  <td data-column-role="primary"><UserIdentity user={user} /></td>
                  <td data-column-role="status" data-user-column="account-type"><Badge variant={accountTypeRegistry[user.account_type].tone}>{accountTypeRegistry[user.account_type].label}</Badge></td>
                  <td data-column-role="status" data-user-column="status"><UserStatusBadge user={user} /></td>
                  <td data-user-column="password" data-column-role="metadata">{user.must_change_password ? '必须修改密码' : '已完成初始改密'}</td>
                  <td data-user-column="created" data-column-role="date"><time dateTime={user.created_at}>{dateTimeFormatter.format(new Date(user.created_at))}</time></td>
                  <td data-column-role="actions">
                    <RowActions
                      objectLabel={user.username}
                      onCommand={(commandName, focusReturn) => openCommand(commandName, user, focusReturn)}
                      overflow={actions.overflow}
                      primary={actions.primary}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        )}
      </TableShell>

      {!users.isPending && !(users.error && !users.data) && (
        <TablePagination
          onPageIndexChange={(pageIndex) => changeSearch({ page: pageIndex + 1 }, false)}
          onPageSizeChange={(pageSize) => changeSearch({ pageSize: normalizeUserPageSize(pageSize) })}
          pageCount={pageCount}
          pageIndex={search.page - 1}
          pageSize={search.pageSize}
          totalItems={total}
        />
      )}

      {createOpen && (
        <CreateUserDialog
          csrfToken={csrfToken}
          finalFocus={createTrigger}
          onClose={() => setCreateOpen(false)}
          onCreated={async (created) => refreshUsers([created])}
        />
      )}
      {editTarget && (
        <EditUserDialog
          csrfToken={csrfToken}
          onClose={() => setEditTarget(undefined)}
          onReload={async () => { setEditTarget(undefined); await users.refetch(); }}
          onSaved={async (saved) => { setEditTarget(undefined); await refreshUsers([saved]); }}
          target={editTarget}
        />
      )}
      {resetTarget && (
        <ResetPasswordDialog
          csrfToken={csrfToken}
          onClose={() => setResetTarget(undefined)}
          onReload={async () => { setResetTarget(undefined); await users.refetch(); }}
          onSaved={async () => { setResetTarget(undefined); await refreshUsers(); }}
          target={resetTarget}
        />
      )}
      <UserCommandDialog
        error={command.error}
        onClose={() => { if (!command.isPending) { setCommandTarget(undefined); command.reset(); } }}
        onConfirm={() => commandTarget && command.mutate(commandTarget)}
        onReload={async () => { setCommandTarget(undefined); command.reset(); await users.refetch(); }}
        pending={command.isPending}
        target={commandTarget}
      />
      <UserDeletionDialog
        csrfToken={csrfToken}
        intent={deletionIntent}
        key={deletionIntent?.id ?? 'none'}
        onClose={() => setDeletionIntent(undefined)}
        onDeleted={handleUserDeleted}
        onReload={async () => {
          const result = await users.refetch();
          if (result.error) throw result.error;
          if (deletionIntent && !result.data?.items.some((user) => user.id === deletionIntent.id)) {
            setDeletionIntent(undefined);
          }
        }}
        queryClient={queryClient}
        queryError={users.error}
        queryFetching={users.isFetching}
        search={search}
        users={users.data}
      />
      <BulkDisableDialog
        error={bulk.error}
        items={bulkDisableTarget}
        onClose={() => { if (!bulk.isPending) { setBulkDisableTarget(undefined); bulk.reset(); } }}
        onConfirm={() => {
          if (!bulkDisableTarget) return;
          setBulkFeedback(undefined);
          bulk.mutate({ items: bulkDisableTarget, status: 'DISABLED' });
        }}
        onReload={async () => { setBulkDisableTarget(undefined); bulk.reset(); await users.refetch(); }}
        pending={bulk.isPending}
      />
    </section>
  );
}

function UserSummary({ data }: { data?: components['schemas']['UserSummary'] }) {
  const items = [
    ['用户总数', data?.user_total],
    ['已启用', data?.enabled_total],
    ['已停用', data?.disabled_total],
    ['必须改密', data?.must_change_password_total],
    ['管理员', data?.admin_total],
  ] as const;
  return (
    <section aria-label="用户统计" className="space-y-2">
      <p className="text-xs text-text-muted">全局统计，不受当前筛选影响。</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {items.map(([label, value]) => (
          <div className="rounded-lg border border-border-subtle bg-surface-raised p-3" key={label}>
            <span className="text-xs text-text-muted">{label}</span>
            <strong className="mt-1 block text-xl tabular-nums">{value ?? '—'}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function UserFilters({ onChange, search }: { onChange: (changes: Partial<UserSearch>) => void; search: UserSearch }) {
  const [query, setQuery] = useState(search.q ?? '');
  return (
    <FilterBar
      filters={(
        <>
          <UserFilterSelect
            ariaLabel="账号类型"
            items={[{ value: 'ALL', label: '全部类型' }, { value: 'ADMIN', label: 'ADMIN' }, { value: 'ENGINEER', label: 'ENGINEER' }]}
            onChange={(value) => onChange({ accountType: value === 'ALL' ? undefined : value as UserSearch['accountType'] })}
            value={search.accountType ?? 'ALL'}
          />
          <UserFilterSelect
            ariaLabel="启用状态"
            items={[{ value: 'ALL', label: '全部状态' }, { value: 'ENABLED', label: 'Enabled' }, { value: 'DISABLED', label: 'Disabled' }]}
            onChange={(value) => onChange({ status: value as UserSearch['status'] })}
            value={search.status}
          />
        </>
      )}
      onQueryChange={setQuery}
      onReset={() => { setQuery(''); onChange({ q: undefined, accountType: undefined, status: 'ENABLED' }); }}
      onSubmit={() => onChange({ q: query.trim() || undefined })}
      placeholder="搜索用户名或显示名称"
      query={query}
      resetDisabled={!query && !hasUserFilters(search)}
      searchLabel="搜索用户"
    />
  );
}

function UserFilterSelect({
  ariaLabel,
  items,
  onChange,
  value,
}: {
  ariaLabel: string;
  items: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Select items={items} onValueChange={(next) => next && onChange(next)} value={value}>
      <SelectTrigger aria-label={ariaLabel} className="w-full md:w-44"><SelectValue /></SelectTrigger>
      <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function UserIdentity({ user }: { user: User }) {
  return (
    <div className="min-w-0">
      <strong className="table-cell-ellipsis block font-medium">{user.display_name}</strong>
      <span className="table-cell-ellipsis block text-xs text-text-muted">@{user.username}</span>
      <div className="user-list-mobile-summary text-xs text-text-secondary">
        <span>{accountTypeRegistry[user.account_type].label}</span>
        <span>{userStatusRegistry[user.is_active ? 'ENABLED' : 'DISABLED'].label}</span>
        <span>{user.must_change_password ? '必须修改密码' : '已完成初始改密'}</span>
        <time dateTime={user.created_at}>{dateTimeFormatter.format(new Date(user.created_at))}</time>
      </div>
    </div>
  );
}

function UserStatusBadge({ user }: { user: User }) {
  const presentation = userStatusRegistry[user.is_active ? 'ENABLED' : 'DISABLED'];
  return <Badge variant={presentation.tone}>{presentation.label}</Badge>;
}

type SelectionCheckboxProps = Omit<ComponentProps<'input'>, 'type'> & { indeterminate?: boolean };

function SelectionCheckbox({ indeterminate = false, ...props }: SelectionCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input className="size-4 accent-[var(--interaction-primary)]" ref={ref} type="checkbox" {...props} />;
}

function CreateUserDialog({
  csrfToken,
  finalFocus,
  onClose,
  onCreated,
}: {
  csrfToken: string | null;
  finalFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreated: (user: User) => Promise<void>;
}) {
  const [error, setError] = useState<UserCreateErrorMapping>();
  const form = useForm<UserCreateFormValues>({
    defaultValues: { username: '', display_name: '', temporary_password: '', account_type: 'ENGINEER' },
    resolver: zodResolver(userCreateFormSchema),
  });
  const create = useMutation({ gcTime: 0, mutationFn: (values: UserCreateFormValues) => createUser(values, csrfToken) });

  async function submit(values: UserCreateFormValues) {
    setError(undefined);
    form.clearErrors();
    try {
      const created = await create.mutateAsync(values);
      create.reset();
      form.reset();
      onClose();
      await onCreated(created);
    } catch (reason) {
      const detail = reason instanceof UserRequestError ? reason.detail : undefined;
      const mapped = detail
        ? mapUserCreateError(detail)
        : { kind: 'summary' as const, formMessage: errorMessage(reason) };
      setError(mapped);
      if (mapped.kind === 'username') form.setError('username', { type: 'server', message: mapped.fieldMessage });
      form.setValue('temporary_password', '');
      create.reset();
      if (mapped.kind === 'username') form.setFocus('username');
    }
  }

  const summaryErrors = [];
  if (error?.kind === 'summary') summaryErrors.push({ id: 'server-message', message: error.formMessage });
  if (error?.requestId) summaryErrors.push({ id: 'server-request-id', message: `请求 ID：${error.requestId}` });

  return (
    <Dialog onOpenChange={(open) => !open && !create.isPending && onClose()} open>
      <DialogContent finalFocus={finalFocus} showCloseButton={!create.isPending}>
        <DialogHeader>
          <DialogTitle>新增用户</DialogTitle>
          <DialogDescription>临时密码只用于本次提交；用户首次登录必须修改密码。</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="grid gap-4 sm:grid-cols-2" id="user-create-form" noValidate onSubmit={form.handleSubmit(submit)}>
            <ErrorSummary className="sm:col-span-2" errors={summaryErrors} />
            <FormField<UserCreateFormValues, 'username'>
              id="user-create-username"
              label="用户名"
              name="username"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} autoFocus id={context.inputId} />}
            />
            <FormField<UserCreateFormValues, 'display_name'>
              id="user-create-display-name"
              label="显示名称"
              name="display_name"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId} />}
            />
            <FormField<UserCreateFormValues, 'temporary_password'>
              className="sm:col-span-2"
              id="user-create-password"
              label="临时密码"
              name="temporary_password"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} autoComplete="new-password" id={context.inputId} type="password" />}
            />
            <FormField<UserCreateFormValues, 'account_type'>
              id="user-create-account-type"
              label="账号类型"
              name="account_type"
              required
              render={(context) => (
                <Select items={accountTypeValues.map((value) => ({ label: accountTypeRegistry[value].label, value }))} onValueChange={(value) => value && context.field.onChange(value)} value={context.field.value}>
                  <SelectTrigger aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId}><SelectValue /></SelectTrigger>
                  <SelectContent>{accountTypeValues.map((value) => <SelectItem key={value} value={value}>{accountTypeRegistry[value].label}</SelectItem>)}</SelectContent>
                </Select>
              )}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <DialogClose disabled={create.isPending} render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={create.isPending} form="user-create-form" type="submit">{create.isPending ? '创建中…' : '创建用户'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  csrfToken,
  onClose,
  onReload,
  onSaved,
  target,
}: {
  csrfToken: string | null;
  onClose: () => void;
  onReload: () => Promise<void>;
  onSaved: (user: User) => Promise<void>;
  target: CommandTarget;
}) {
  const [error, setError] = useState<unknown>();
  const form = useForm<UserEditFormValues>({
    defaultValues: {
      display_name: target.user.display_name,
      account_type: target.user.account_type,
      is_active: target.user.is_active,
    },
    resolver: zodResolver(userEditFormSchema),
  });
  const update = useMutation({ mutationFn: (values: UserEditFormValues) => updateUser(target.user, values, csrfToken) });
  const conflict = isRevisionConflict(error);

  async function submit(values: UserEditFormValues) {
    setError(undefined);
    try {
      await onSaved(await update.mutateAsync(values));
    } catch (reason) {
      setError(reason);
      update.reset();
    }
  }

  return (
    <Dialog onOpenChange={(open) => !open && !update.isPending && onClose()} open>
      <DialogContent finalFocus={{ current: target.focusReturn }} showCloseButton={!update.isPending}>
        <DialogHeader>
          <DialogTitle>编辑用户 {target.user.username}</DialogTitle>
          <DialogDescription>保存显示名称、账号类型和启用状态；服务端会校验当前修订。</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="grid gap-4 sm:grid-cols-2" id="user-edit-form" noValidate onSubmit={form.handleSubmit(submit)}>
            <ErrorSummary className="sm:col-span-2" errors={error ? [{ id: 'server', message: errorMessage(error) }] : []} />
            {conflict && <Button className="sm:col-span-2" onClick={() => void onReload()} type="button" variant="outline">重新加载列表</Button>}
            <FormField<UserEditFormValues, 'display_name'>
              id="user-edit-display-name"
              label="显示名称"
              name="display_name"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} autoFocus id={context.inputId} />}
            />
            <FormField<UserEditFormValues, 'account_type'>
              id="user-edit-account-type"
              label="账号类型"
              name="account_type"
              required
              render={(context) => (
                <Select items={accountTypeValues.map((value) => ({ label: accountTypeRegistry[value].label, value }))} onValueChange={(value) => value && context.field.onChange(value)} value={context.field.value}>
                  <SelectTrigger aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId}><SelectValue /></SelectTrigger>
                  <SelectContent>{accountTypeValues.map((value) => <SelectItem key={value} value={value}>{accountTypeRegistry[value].label}</SelectItem>)}</SelectContent>
                </Select>
              )}
            />
            <FormField<UserEditFormValues, 'is_active'>
              id="user-edit-status"
              label="状态"
              name="is_active"
              required
              render={(context) => (
                <Select onValueChange={(value) => context.field.onChange(value === 'ENABLED')} value={context.field.value ? 'ENABLED' : 'DISABLED'}>
                  <SelectTrigger aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ENABLED">Enabled</SelectItem><SelectItem value="DISABLED">Disabled</SelectItem></SelectContent>
                </Select>
              )}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <DialogClose disabled={update.isPending} render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={update.isPending} form="user-edit-form" type="submit">{update.isPending ? '保存中…' : '保存修改'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  csrfToken,
  onClose,
  onReload,
  onSaved,
  target,
}: {
  csrfToken: string | null;
  onClose: () => void;
  onReload: () => Promise<void>;
  onSaved: () => Promise<void>;
  target: CommandTarget;
}) {
  const [error, setError] = useState<unknown>();
  const form = useForm<ResetPasswordFormValues>({
    defaultValues: { temporary_password: '' },
    resolver: zodResolver(resetPasswordFormSchema),
  });
  const resetPassword = useMutation({
    gcTime: 0,
    mutationFn: (values: ResetPasswordFormValues) => resetUserPassword(target.user, values.temporary_password, csrfToken),
  });
  const conflict = isRevisionConflict(error);

  async function submit(values: ResetPasswordFormValues) {
    setError(undefined);
    try {
      await resetPassword.mutateAsync(values);
      resetPassword.reset();
      form.reset();
      await onSaved();
    } catch (reason) {
      setError(reason);
      if (!isRevisionConflict(reason)) form.setValue('temporary_password', '');
      resetPassword.reset();
    }
  }

  return (
    <Dialog onOpenChange={(open) => !open && !resetPassword.isPending && onClose()} open>
      <DialogContent finalFocus={{ current: target.focusReturn }} showCloseButton={!resetPassword.isPending}>
        <DialogHeader>
          <DialogTitle>重置 {target.user.username} 的临时密码</DialogTitle>
          <DialogDescription>成功后会撤销该用户全部会话，下次登录必须修改密码。</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" id="user-reset-password-form" noValidate onSubmit={form.handleSubmit(submit)}>
            <ErrorSummary errors={error ? [{ id: 'server', message: errorMessage(error) }] : []} />
            {conflict && <Button onClick={() => void onReload()} type="button" variant="outline">重新加载列表</Button>}
            <FormField<ResetPasswordFormValues, 'temporary_password'>
              id="user-reset-password"
              label="临时密码"
              name="temporary_password"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} autoComplete="new-password" autoFocus id={context.inputId} type="password" />}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <DialogClose disabled={resetPassword.isPending} render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={resetPassword.isPending} form="user-reset-password-form" type="submit">{resetPassword.isPending ? '重置中…' : '重置临时密码'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserCommandDialog({
  error,
  onClose,
  onConfirm,
  onReload,
  pending,
  target,
}: {
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
  onReload: () => Promise<void>;
  pending: boolean;
  target?: CommandTarget;
}) {
  if (!target) return null;
  const presentation = commandPresentation(target);
  const conflict = isRevisionConflict(error);
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent finalFocus={{ current: target.focusReturn }} showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{presentation.title}</DialogTitle>
          <DialogDescription>{presentation.description}</DialogDescription>
        </DialogHeader>
        <ErrorSummary errors={error ? [{ id: 'server', message: errorMessage(error) }] : []} />
        {conflict && <Button onClick={() => void onReload()} type="button" variant="outline">重新加载列表</Button>}
        <DialogFooter>
          <DialogClose disabled={pending} render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={pending} onClick={onConfirm} type="button" variant={presentation.danger ? 'destructive' : 'default'}>
            {pending ? '处理中…' : presentation.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserDeletionDialog({
  csrfToken,
  intent,
  onClose,
  onDeleted,
  onReload,
  queryClient,
  queryError,
  queryFetching,
  search,
  users,
}: {
  csrfToken: string | null;
  intent?: DeletionIntent;
  onClose: () => void;
  onDeleted: () => Promise<void>;
  onReload: () => Promise<void>;
  queryClient: ReturnType<typeof useQueryClient>;
  queryError: unknown;
  queryFetching: boolean;
  search: UserSearch;
  users?: components['schemas']['UserList'];
}) {
  const [reloadMessage, setReloadMessage] = useState<string>();
  const remove = useMutation({
    mutationFn: (variables: { id: string; expectedRevision: number }) => deleteUser(variables, csrfToken),
  });
  if (!intent) return null;
  const activeIntent = intent;
  const current = users?.items.find((user) => user.id === activeIntent.id);
  if (!current) return null;
  const blockers = current.deletion?.blockers ?? [];
  const hasDeleteProjection = current.deletion !== null && current.available_actions.includes('DELETE');
  const conflict = remove.error instanceof UserRequestError && remove.error.status === 409;
  const stale = Boolean(queryError);
  const canDelete = !queryFetching
    && !stale
    && !conflict
    && hasDeleteProjection
    && blockers.length === 0;

  async function confirm() {
    if (!canDelete) return;
    const exactKey = userKeys.list(userSearchToApiParams(search));
    const queryState = queryClient.getQueryState(exactKey);
    if (!queryState || queryState.fetchStatus === 'fetching' || queryState.error) return;
    const latest = queryClient.getQueryData<components['schemas']['UserList']>(exactKey)
      ?.items.find((user) => user.id === activeIntent.id);
    if (!latest || queryFetching || queryError) return;
    resolveUserActions(latest, false);
    if (latest.deletion === null || !latest.available_actions.includes('DELETE') || latest.deletion.blockers.length > 0) return;
    try {
      await remove.mutateAsync({ id: latest.id, expectedRevision: latest.revision });
      await onDeleted();
    } catch {
      // 删除冲突保留当前确认上下文，只有显式重新加载才解除冻结。
    }
  }

  async function reload() {
    setReloadMessage(undefined);
    try {
      await onReload();
      remove.reset();
      setReloadMessage('已读取当前用户投影，请重新确认。');
    } catch (error) {
      setReloadMessage(errorMessage(error));
    }
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open && !remove.isPending) onClose(); }} open>
      <DialogContent
        finalFocus={() => activeIntent.focusReturn?.isConnected ? activeIntent.focusReturn : null}
        showCloseButton={!remove.isPending}
      >
        <DialogHeader>
          <DialogTitle>
            {blockers.length
              ? `用户 ${current.username} 暂不可删除`
              : hasDeleteProjection ? `删除用户“${current.username}”？` : `用户“${current.username}”当前不可删除`}
          </DialogTitle>
          <DialogDescription>
            {blockers.length
              ? '当前存在业务历史引用；可按该用户精确筛选系统审计。'
              : hasDeleteProjection
                ? '删除不可恢复；服务端会校验当前 revision 与业务历史引用。'
                : '服务端当前未提供删除资格，请刷新列表后再试。'}
          </DialogDescription>
        </DialogHeader>
        {blockers.length > 0 && (
          <>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {blockers.map((blocker) => <li key={blocker.type}>{blocker.type}：{blocker.count}</li>)}
            </ul>
            <a className={buttonVariants({ variant: 'outline' })} href={`/system/audit?actorId=${encodeURIComponent(current.id)}`}>查看审计历史</a>
          </>
        )}
        {queryFetching && <p className="text-sm text-text-secondary" role="status">正在同步用户投影…</p>}
        {Boolean(queryError) && <p className="text-sm text-destructive" role="alert">当前用户列表刷新失败，无法确认最新删除资格。</p>}
        {remove.error && <p className="text-sm text-destructive" role="alert">{errorMessage(remove.error)}</p>}
        {hasDeleteProjection && conflict && <Button onClick={() => void reload()} type="button" variant="outline">重新加载当前用户列表</Button>}
        {reloadMessage && <p className="text-sm text-text-secondary" role="status">{reloadMessage}</p>}
        <DialogFooter>
          <DialogClose disabled={remove.isPending} render={<Button variant="outline" />}>关闭</DialogClose>
          {hasDeleteProjection && blockers.length === 0 && <Button disabled={!canDelete || remove.isPending} onClick={() => void confirm()} type="button" variant="destructive">
            {remove.isPending ? '删除中…' : '删除用户'}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function commandPresentation(target: CommandTarget) {
  switch (target.command) {
    case 'enable-user': return { title: `启用用户“${target.user.username}”？`, description: '启用会恢复登录资格，不会改写历史业务记录。', confirmLabel: '启用用户', danger: false };
    case 'disable-user': return { title: `停用用户“${target.user.username}”？`, description: '停用后会撤销该用户全部活动会话，历史业务归属保持不变。', confirmLabel: '停用用户', danger: true };
    default: throw new Error(`用户列表收到无法展示的确认命令：${target.command}`);
  }
}

function BulkDisableDialog({
  error,
  items,
  onClose,
  onConfirm,
  onReload,
  pending,
}: {
  error: unknown;
  items?: SelectedUser[];
  onClose: () => void;
  onConfirm: () => void;
  onReload: () => Promise<void>;
  pending: boolean;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={Boolean(items)}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>批量停用 {items?.length ?? 0} 个用户？</DialogTitle>
          <DialogDescription>成功项会立即撤销全部会话；服务端会逐项校验修订号与管理员保护。</DialogDescription>
        </DialogHeader>
        <ErrorSummary errors={error ? [{ id: 'server', message: errorMessage(error) }] : []} />
        {isRevisionConflict(error) && <Button onClick={() => void onReload()} type="button" variant="outline">重新加载列表</Button>}
        <DialogFooter>
          <DialogClose disabled={pending} render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={pending} onClick={onConfirm} type="button" variant="destructive">{pending ? '处理中…' : '批量停用'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkResult({ feedback, onClose }: { feedback: BulkFeedback; onClose: () => void }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm" role="status">
      <div className="flex items-start justify-between gap-3">
        <strong>批量操作完成：成功 {feedback.succeeded}，失败 {feedback.failures.length}</strong>
        <Button onClick={onClose} size="sm" variant="ghost">关闭</Button>
      </div>
      {feedback.failures.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {feedback.failures.map((failure) => <li key={failure.user_id}><strong>{failure.username}</strong>：{failure.message}（{failure.code}）</li>)}
        </ul>
      )}
    </div>
  );
}

function Notice({ message, onClose, tone = 'danger' }: { message: string; onClose: () => void; tone?: 'danger' | 'warning' }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm ${tone === 'danger' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-warning/30 bg-warning/5'}`} role="alert">
      <span>{message}</span>
      <Button onClick={onClose} size="sm" variant="outline">{tone === 'danger' ? '重试或关闭' : '关闭'}</Button>
    </div>
  );
}

function isRevisionConflict(error: unknown) {
  return error instanceof UserRequestError && error.detail?.code === 'REVISION_CONFLICT';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '用户管理发生未知错误';
}

export { UserListPage };
export type { UserListPageProps };
