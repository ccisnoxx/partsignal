/** 发布账号设置页，维护内部运营标识、修订号和启停状态。 */
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { platformProfilesQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { PlatformAccountListQuery, Schema } from '../../shared/api/types';
import { DeletionError } from '../../shared/components/DeletionError';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { useAuth } from '../auth/AuthProvider';

type PlatformAccount = Schema<'PlatformAccount'>;

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const platformProfileId = searchParams.get('platform_profile_id') ?? undefined;
  const setPlatformProfileId = (value?: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'accounts');
    if (value) next.set('platform_profile_id', value);
    else next.delete('platform_profile_id');
    setSearchParams(next);
  };

  return (
    <div className="page-stack publication-accounts-page">
      <PageHeader
        eyebrow="业务设置"
        title="发布账号"
        description="维护每个具体平台可选的内部运营账号；平台归属创建后不可修改。"
      />
      <PlatformAccountsPanel
        platformProfileId={platformProfileId}
        onPlatformChange={setPlatformProfileId}
      />
    </div>
  );
}

function PlatformAccountsPanel({
  platformProfileId,
  onPlatformChange,
}: {
  platformProfileId?: string;
  onPlatformChange: (value?: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformAccount>();
  const [modal, modalContext] = Modal.useModal();
  const { message } = App.useApp();
  const auth = useAuth();
  const accountQuery: PlatformAccountListQuery = platformProfileId
    ? { platform_profile_id: platformProfileId }
    : {};
  const accounts = useQuery({
    queryKey: queryKeys.platformAccounts.list(accountQuery),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/platform-accounts', {
          params: { query: accountQuery },
        }),
      ),
    staleTime: QUERY_STALE_TIME.configuration,
  });
  const platforms = useQuery(platformProfilesQueryOptions());
  const refreshAccounts = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.platformAccounts.all });
  const create = useMutation({
    mutationFn: async (body: Schema<'PlatformAccountCreate'>) =>
      unwrap(
        await api.POST('/api/v1/platform-accounts', {
          params: { header: csrfHeader() },
          body,
        }),
      ),
    onSuccess: async () => {
      setCreateOpen(false);
      message.success('发布账号已创建');
      await refreshAccounts();
    },
  });
  const update = useMutation({
    mutationFn: async (body: Schema<'PlatformAccountUpdate'>) => {
      if (!editing) throw new Error('未选择要编辑的发布账号');
      return unwrap(
        await api.PATCH('/api/v1/platform-accounts/{platform_account_id}', {
          params: {
            path: { platform_account_id: editing.id },
            header: csrfHeader(),
          },
          body,
        }),
      );
    },
    onSuccess: async () => {
      setEditing(undefined);
      message.success('发布账号已保存');
      await refreshAccounts();
    },
  });
  const setEnabled = useMutation({
    mutationFn: async ({
      account,
      enabled,
    }: {
      account: PlatformAccount;
      enabled: boolean;
    }) => {
      const options = {
        params: {
          path: { platform_account_id: account.id },
          header: csrfHeader(),
        },
        body: { expected_revision: account.revision },
      };
      return enabled
        ? unwrap(await api.POST('/api/v1/platform-accounts/{platform_account_id}/enable', options))
        : unwrap(await api.POST('/api/v1/platform-accounts/{platform_account_id}/disable', options));
    },
    onSuccess: async (account) => {
      message.success(`发布账号已${account.is_active ? '启用' : '停用'}`);
      await refreshAccounts();
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      ensureSuccess(
        await api.DELETE('/api/v1/platform-accounts/{platform_account_id}', {
          params: { path: { platform_account_id: id }, header: csrfHeader() },
        }),
      ),
    onSuccess: async () => {
      message.success('发布账号已删除');
      await refreshAccounts();
    },
  });

  const confirmDisable = (account: PlatformAccount) =>
    modal.confirm({
      title: `停用发布账号“${account.label}”？`,
      content: '停用后不会出现在新发布候选中，历史发布引用保持不变。',
      okText: '停用',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => setEnabled.mutate({ account, enabled: false }),
    });
  const confirmDelete = (account: PlatformAccount) =>
    modal.confirm({
      title: `物理删除发布账号“${account.label}”？`,
      content: '存在发布记录引用时服务端会拒绝。此操作不可恢复。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => remove.mutate(account.id),
    });
  const handleAction = (key: string, account: PlatformAccount) => {
    if (key === 'edit') {
      update.reset();
      setEditing(account);
    }
    else if (key === 'enable') setEnabled.mutate({ account, enabled: true });
    else if (key === 'disable') confirmDisable(account);
    else if (key === 'delete') confirmDelete(account);
  };

  const platformNames = new Map(platforms.data?.items.map((item) => [item.id, item.name]));
  const activePlatforms = platforms.data?.items.filter((item) => item.is_active) ?? [];
  const initialPlatformId = activePlatforms.some((item) => item.id === platformProfileId)
    ? platformProfileId
    : undefined;
  const operationError = setEnabled.error;

  return (
    <Card
      className="collection-panel publication-accounts-panel"
      extra={(
        <Space wrap>
          <Select
            allowClear
            aria-label="按平台筛选账号"
            placeholder="全部平台"
            value={platformProfileId}
            options={platforms.data?.items.map((item) => ({ value: item.id, label: item.name }))}
            onChange={onPlatformChange}
            style={{ width: 180 }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              create.reset();
              setCreateOpen(true);
            }}
          >
            新增发布账号
          </Button>
        </Space>
      )}
    >
      {modalContext}
      <Alert
        type="info"
        showIcon
        title="运营账号标识仅供内部识别"
        description="可填写平台用户名，或“注册手机号 + 持有人”等组合；这里不保存密码、Cookie 或令牌。"
      />
      {(accounts.error || platforms.error || operationError) && (
        <Alert
          role="alert"
          type="error"
          showIcon
          title={errorMessage(accounts.error ?? platforms.error ?? operationError)}
        />
      )}
      {remove.error && <DeletionError error={remove.error} />}
      <TableRegion label="发布账号列表">
        <Table<PlatformAccount>
          rowKey="id"
          loading={accounts.isLoading}
          dataSource={accounts.data?.items}
          scroll={{ x: 820 }}
          columns={[
            {
              title: '平台',
              dataIndex: 'platform_profile_id',
              width: 180,
              render: (value) => platformNames.get(value) ?? value,
            },
            { title: '业务标签', dataIndex: 'label' },
            {
              title: '运营账号标识（内部）',
              dataIndex: 'account_identifier',
              width: 280,
              render: (value) => <span className="data-code">{value}</span>,
            },
            {
              title: '状态',
              dataIndex: 'is_active',
              width: 110,
              render: (active) => <StatusTag status={active ? 'ACTIVE' : 'RETIRED'} />,
            },
            {
              title: '操作',
              fixed: 'right',
              width: 110,
              render: (_, account) => (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      { key: 'edit', label: '编辑' },
                      account.is_active
                        ? { key: 'disable', label: '停用', danger: true }
                        : { key: 'enable', label: '启用' },
                      ...(auth.isAdmin
                        ? [{ key: 'delete', label: '删除', danger: true }]
                        : []),
                    ],
                    onClick: ({ key }) => handleAction(key, account),
                  }}
                >
                  <Button
                    size="small"
                    aria-label={`更多操作：${account.label}`}
                    loading={
                      (setEnabled.isPending && setEnabled.variables.account.id === account.id)
                      || (remove.isPending && remove.variables === account.id)
                    }
                  >
                    更多 <DownOutlined />
                  </Button>
                </Dropdown>
              ),
            },
          ]}
        />
      </TableRegion>
      <Modal
        title="新增发布账号"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          create.reset();
        }}
        footer={null}
        destroyOnHidden
      >
        {create.error && (
          <Alert role="alert" type="error" showIcon title={errorMessage(create.error)} />
        )}
        <Form<Schema<'PlatformAccountCreate'>>
          key={initialPlatformId ?? 'no-platform'}
          layout="vertical"
          initialValues={{ platform_profile_id: initialPlatformId }}
          onFinish={(body) => create.mutate(body)}
        >
          <Form.Item name="platform_profile_id" label="平台" rules={[{ required: true }]}>
            <Select
              placeholder="仅显示已启用平台"
              options={activePlatforms.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <AccountFields autoFocus />
          <Button type="primary" htmlType="submit" loading={create.isPending}>创建</Button>
        </Form>
      </Modal>
      <Modal
        title="编辑发布账号"
        open={!!editing}
        onCancel={() => {
          setEditing(undefined);
          update.reset();
        }}
        footer={null}
        destroyOnHidden
      >
        {editing && (
          <>
            {update.error && (
              <Alert role="alert" type="error" showIcon title={errorMessage(update.error)} />
            )}
            <Form<Schema<'PlatformAccountUpdate'>>
              key={`${editing.id}-${editing.revision}`}
              layout="vertical"
              initialValues={{
                expected_revision: editing.revision,
                label: editing.label,
                account_identifier: editing.account_identifier,
              }}
              onFinish={(body) => update.mutate(body)}
            >
              <Form.Item label="平台">
                <Typography.Text>{platformNames.get(editing.platform_profile_id) ?? editing.platform_profile_id}</Typography.Text>
              </Form.Item>
              <Form.Item name="expected_revision" hidden><Input type="number" /></Form.Item>
              <AccountFields autoFocus />
              <Button type="primary" htmlType="submit" loading={update.isPending}>保存</Button>
            </Form>
          </>
        )}
      </Modal>
    </Card>
  );
}

function AccountFields({ autoFocus }: { autoFocus?: boolean }) {
  return (
    <>
      <Form.Item name="label" label="业务标签" rules={[{ required: true }]}>
        <Input autoFocus={autoFocus} maxLength={160} />
      </Form.Item>
      <Form.Item
        name="account_identifier"
        label="运营账号标识（内部）"
        extra="可填写平台用户名，或“注册手机号 + 持有人”等仅供运营识别的组合。"
        rules={[{ required: true }]}
      >
        <Input maxLength={200} />
      </Form.Item>
    </>
  );
}
