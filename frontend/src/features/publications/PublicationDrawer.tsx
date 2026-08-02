/** 按选中候选或发布记录打开登记抽屉，所有状态动作只消费服务端 available_actions。 */
import { CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Timeline,
  Typography,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { ApiError, api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { FileRecord, Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { StatusTag } from '../../shared/components/StatusTag';
import {
  actionLabels,
  type PublicationCommandAction,
  type PublicationDeleteTarget,
} from './publicationTypes';

type PublicationCandidate = Schema<'PublicationCandidate'>;

type PublicationDrawerProps = {
  candidate?: PublicationCandidate;
  publicationId?: string;
  initialAction?: PublicationCommandAction;
  deletePending: boolean;
  onClose: () => void;
  onAfterClose: () => void;
  onCreated: (publicationId: string) => void;
  onDelete: (record: PublicationDeleteTarget) => void;
};

export function PublicationDrawer({
  candidate,
  publicationId,
  initialAction,
  deletePending,
  onClose,
  onAfterClose,
  onCreated,
  onDelete,
}: PublicationDrawerProps) {
  const { modal } = App.useApp();
  const contentIdentity = candidate
    ? `candidate:${candidate.content_version.id}`
    : `publication:${publicationId ?? 'closed'}:${initialAction ?? 'view'}`;
  const open = !!candidate || !!publicationId;
  // dirty 只服务关闭判断；绑定内容身份可在换对象时同步失效，不复制 URL 打开状态。
  const dirtyRef = useRef({ contentIdentity, value: false });
  const openCompletedRef = useRef(false);
  // 入场动画完成前关闭时 rc Drawer 不触发 afterOpenChange(false)，此时 Portal 已直接卸载。
  useEffect(() => {
    if (open || openCompletedRef.current) return;
    dirtyRef.current = { contentIdentity, value: false };
    onAfterClose();
  }, [contentIdentity, onAfterClose, open]);
  const setDirty = (value: boolean) => {
    dirtyRef.current = { contentIdentity, value };
  };
  const requestClose = () => {
    if (dirtyRef.current.contentIdentity !== contentIdentity || !dirtyRef.current.value) {
      onClose();
      return;
    }
    modal.confirm({
      title: '放弃未提交内容？',
      content: '当前 Drawer 中的表单和已上传但尚未绑定的文件选择将被清除。',
      okText: '放弃并关闭',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: () => {
        setDirty(false);
        onClose();
      },
    });
  };
  // 关闭后只由业务触发器回焦，避免临时菜单焦点覆盖真实入口。
  return (
    <Drawer
      className="publication-drawer"
      rootClassName="publication-drawer-root"
      title={candidate ? '准备人工发布' : '发布结果登记'}
      open={open}
      size="large"
      focusable={{ focusTriggerAfterClose: false }}
      onClose={requestClose}
      afterOpenChange={(nextOpen) => {
        if (nextOpen) {
          openCompletedRef.current = true;
          return;
        }
        if (!openCompletedRef.current) return;
        openCompletedRef.current = false;
        dirtyRef.current = { contentIdentity, value: false };
        onAfterClose();
      }}
      destroyOnHidden
      keyboard
    >
      {candidate ? (
        <CandidateRegistration
          key={contentIdentity}
          candidate={candidate}
          onCreated={onCreated}
          onDirtyChange={setDirty}
        />
      ) : publicationId ? (
        <PublicationRegistration
          key={contentIdentity}
          publicationId={publicationId}
          initialAction={initialAction}
          deletePending={deletePending}
          onDelete={onDelete}
          onDirtyChange={setDirty}
        />
      ) : null}
    </Drawer>
  );
}

function CandidateRegistration({
  candidate,
  onCreated,
  onDirtyChange,
}: {
  candidate: PublicationCandidate;
  onCreated: (publicationId: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { message } = App.useApp();
  const [attachments, setAttachments] = useState<FileRecord[]>([]);
  const content = candidate.content_version;
  const canRegister = candidate.available_actions.includes('REGISTER');
  const packageQuery = useQuery({
    queryKey: queryKeys.publications.package(content.id),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/content-versions/{content_version_id}/publication-package', {
          params: { path: { content_version_id: content.id } },
        }),
      ),
    staleTime: QUERY_STALE_TIME.detail,
  });
  const create = useMutation({
    mutationFn: async (values: Schema<'ManualPublicationCreate'>) =>
      unwrap(
        await api.POST('/api/v1/publication-records/manual', {
          params: { header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } },
          body: { ...values, attachment_file_ids: attachments.map((item) => item.id) },
        }),
      ),
    onSuccess: async (created) => {
      onDirtyChange(false);
      message.success('待人工发布记录已登记');
      await invalidatePublicationQueries(created.task_id, created.id);
      onCreated(created.id);
    },
  });
  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    message.success(`${label}已复制`);
  };
  return (
    <div className="publication-drawer-stack">
      {create.error && <Alert type="error" showIcon title={errorMessage(create.error)} />}
      {packageQuery.error ? (
        <QueryFailure error={packageQuery.error} onRetry={() => void packageQuery.refetch()} />
      ) : (
        <Card size="small" className="publication-drawer-card" loading={packageQuery.isLoading}>
          <Typography.Title level={5}>{packageQuery.data?.title ?? content.title}</Typography.Title>
          <Space wrap size={[6, 6]}>
            <StatusTag status={content.status} />
            <Typography.Text type="secondary">V{content.version}</Typography.Text>
            <Typography.Text type="secondary">{candidate.platform_profile_name}</Typography.Text>
          </Space>
          <Divider />
          <Space wrap>
            <Button disabled={!packageQuery.data} icon={<CopyOutlined />} onClick={() => packageQuery.data && void copy(packageQuery.data.title, '标题')}>
              复制标题
            </Button>
            <Button disabled={!packageQuery.data} icon={<CopyOutlined />} onClick={() => packageQuery.data && void copy(packageQuery.data.body_markdown, 'Markdown')}>
              复制 Markdown
            </Button>
            <Button disabled={!packageQuery.data} icon={<CopyOutlined />} onClick={() => packageQuery.data && void copy(packageQuery.data.body_text, '纯文本')}>
              复制纯文本
            </Button>
          </Space>
          <Typography.Paragraph className="publication-hash" type="secondary" copyable={!!packageQuery.data}>
            内容哈希：{packageQuery.data?.content_hash ?? content.content_hash}
          </Typography.Paragraph>
        </Card>
      )}
      <Alert
        type="info"
        showIcon
        title="此步骤只创建待人工发布记录"
        description="发布账号必须属于内容锁定平台；这里上传的材料会在候选创建阶段关联发布记录。"
      />
      <Form<Schema<'ManualPublicationCreate'>>
        layout="vertical"
        disabled={!packageQuery.data || !canRegister}
        initialValues={{ content_version_id: content.id, attachment_file_ids: [] }}
        onValuesChange={() => onDirtyChange(true)}
        onFinish={(body) => create.mutate(body)}
      >
        <Form.Item name="content_version_id" hidden><Input /></Form.Item>
        <Form.Item
          name="platform_account_id"
          label="发布账号"
          extra="本篇文章只能选择一个账号"
          rules={[{ required: true, message: '请选择匹配平台账号' }]}
        >
          <Select
            placeholder="选择锁定平台下的账号"
            options={candidate.matching_accounts.map((item) => ({
              value: item.id,
              label: `${item.label} / ${item.account_identifier}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="section_url" label="目标栏目 URL" rules={[{ required: true, type: 'url', message: '请输入有效的目标栏目 URL' }]}>
          <Input type="url" placeholder="https://目标平台.example/section" />
        </Form.Item>
        <Form.Item label="准备阶段证据（可选）">
          <DirectUpload
            category="OPERATION_SCREENSHOT"
            accept="image/png,image/jpeg,image/webp"
            disabled={!packageQuery.data || !canRegister}
            onUploaded={(file) => {
              setAttachments((items) => [...items, file]);
              onDirtyChange(true);
            }}
          />
          <UploadedFiles files={attachments} />
        </Form.Item>
        <Button block type="primary" htmlType="submit" loading={create.isPending} disabled={!packageQuery.data || !canRegister}>
          登记待人工发布
        </Button>
      </Form>
    </div>
  );
}

function PublicationRegistration({
  publicationId,
  initialAction,
  deletePending,
  onDelete,
  onDirtyChange,
}: {
  publicationId: string;
  initialAction?: PublicationCommandAction;
  deletePending: boolean;
  onDelete: (record: PublicationDeleteTarget) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { message } = App.useApp();
  const [action, setAction] = useState<PublicationCommandAction | undefined>(initialAction);
  const [attachments, setAttachments] = useState<FileRecord[]>([]);
  const detail = useQuery({
    queryKey: queryKeys.publications.record(publicationId),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-records/{publication_id}', {
          params: { path: { publication_id: publicationId } },
        }),
      ),
    staleTime: QUERY_STALE_TIME.detail,
  });
  const mutate = useMutation({
    mutationFn: async (values: Schema<'PublicationCommand'>) => {
      if (!action) throw new Error('未选择发布状态');
      const body = {
        ...values,
        ...(action === 'mark-published' ? { attachment_file_ids: attachments.map((item) => item.id) } : {}),
      };
      return unwrap(
        await api.POST('/api/v1/publication-records/{publication_id}/{command}', {
          params: { path: { publication_id: publicationId, command: action }, header: csrfHeader() },
          body,
        }),
      );
    },
    onSuccess: async (updated) => {
      onDirtyChange(false);
      message.success(action ? commandSuccessMessage(action) : '发布状态已更新');
      setAction(undefined);
      setAttachments([]);
      await invalidatePublicationQueries(updated.task_id, publicationId);
    },
    onError: async (error) => {
      if (
        error instanceof ApiError
        && ['INVALID_STATE_TRANSITION', 'PUBLICATION_ATTACHMENT_EXISTS'].includes(error.code)
      ) {
        await detail.refetch();
      }
    },
  });
  if (detail.isLoading) return <QueryLoading />;
  if (detail.error || !detail.data) {
    return <QueryFailure error={detail.error ?? new Error('发布记录不存在')} onRetry={() => void detail.refetch()} />;
  }
  const record = detail.data;
  const activeAction = action && record.available_actions.includes(action) ? action : undefined;
  return (
    <div className="publication-drawer-stack">
      {mutate.error && <Alert type="error" showIcon title={errorMessage(mutate.error)} />}
      <Card size="small" className="publication-drawer-card">
        <Descriptions
          size="small"
          column={1}
          items={[
            { label: '发布状态', children: <StatusTag status={record.status} /> },
            { label: '锁定内容', children: `${record.content_title} · V${record.content_version}` },
            { label: '目标平台', children: record.platform_profile_name },
            { label: '发布账号', children: `${record.platform_account_label} / ${record.account_identifier}` },
            { label: '内容哈希', children: <span className="data-code">{record.content_hash}</span> },
            { label: '目标栏目', children: <a href={record.section_url} target="_blank" rel="noreferrer">打开栏目 <LinkOutlined /></a> },
            { label: '实际标题', children: record.actual_title ?? '—' },
            { label: '最终 URL', children: record.final_url ? <a href={record.final_url} target="_blank" rel="noreferrer">打开页面 <LinkOutlined /></a> : '尚未登记' },
            { label: '发布时间', children: record.published_at ? formatDateTime(record.published_at) : '—' },
          ]}
        />
      </Card>
      {record.available_actions.length > 0 ? (
        <div className="publication-command-grid" aria-label="服务端允许的操作">
          {record.available_actions.map((item) => (
            <Button
              key={item}
              type={item === 'mark-published' || item === 'verify' ? 'primary' : 'default'}
              danger={item === 'delete' || item === 'reject' || item === 'remove' || item === 'mark-verification-failed'}
              loading={item === 'delete' && deletePending}
              onClick={() => {
                if (item === 'delete') {
                  onDelete(record);
                  return;
                }
                setAction(item);
                setAttachments([]);
                onDirtyChange(false);
                mutate.reset();
              }}
            >
              {actionLabels[item]}
            </Button>
          ))}
        </div>
      ) : (
        <Alert type="success" showIcon title="当前记录没有可执行的状态命令" />
      )}
      {activeAction && (
        <Card size="small" title={actionLabels[activeAction]} className="publication-drawer-card">
          {activeAction === 'remove' && (
            <Alert
              type="warning"
              showIcon
              title="标记已移除会保留发布历史"
              description="该操作表示已发布页面下线，并创建发布需关注事项；不会物理删除发布记录或既有状态事件。"
            />
          )}
          {activeAction === 'mark-verification-failed' && (
            <Alert
              type="error"
              showIcon
              title="验证失败会进入发布需关注"
              description="该操作保留已发生的发布事实，并创建需要查看上下文、修复或显式解决的关注事项。"
            />
          )}
          <Form<Schema<'PublicationCommand'>>
            key={activeAction}
            layout="vertical"
            initialValues={{ comment: '', attachment_file_ids: [] }}
            onValuesChange={() => onDirtyChange(true)}
            onFinish={(body) => mutate.mutate(body)}
          >
            {activeAction === 'mark-published' && (
              <>
                <Form.Item name="actual_title" label="实际发布标题" rules={[{ required: true, message: '请输入实际发布标题' }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="final_url" label="最终文章 URL" rules={[{ required: true, type: 'url', message: '请输入有效的最终文章 URL' }]}>
                  <Input type="url" />
                </Form.Item>
                <Form.Item name="published_at" label="发布时间" rules={[{ required: true, message: '请输入带时区的 RFC3339 时间' }]} extra="示例：2026-07-20T10:00:00+08:00">
                  <Input placeholder="2026-07-20T10:00:00+08:00" />
                </Form.Item>
                <Form.Item label="结果证据（可选）" extra="证据与发布状态在同一服务端事务中追加；命令失败时不会建立关联。">
                  <DirectUpload
                    category="OPERATION_SCREENSHOT"
                    accept="image/png,image/jpeg,image/webp"
                    onUploaded={(file) => {
                      setAttachments((items) => [...items, file]);
                      onDirtyChange(true);
                    }}
                  />
                  <UploadedFiles files={attachments} bound={false} />
                </Form.Item>
              </>
            )}
            {activeAction === 'verify' && (
              <Form.Item name="content_matches" label="页面正文核对" rules={[{ required: true, message: '请确认正文核对结果' }]}>
                <Select options={[{ value: true, label: '已人工核对，与批准正文一致' }]} />
              </Form.Item>
            )}
            <Form.Item name="comment" label="操作说明" rules={[{ required: true, whitespace: true, message: '请填写操作说明' }]}>
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
            <Space>
              <Button
                type="primary"
                danger={activeAction === 'remove' || activeAction === 'mark-verification-failed'}
                htmlType="submit"
                loading={mutate.isPending}
              >
                {activeAction === 'remove' ? '确认标记已移除' : activeAction === 'mark-verification-failed' ? '确认标记验证失败' : '确认提交'}
              </Button>
              <Button onClick={() => {
                setAction(undefined);
                setAttachments([]);
                onDirtyChange(false);
                mutate.reset();
              }}>取消</Button>
            </Space>
          </Form>
        </Card>
      )}
      {record.attachments.length > 0 && (
        <Card size="small" title="已关联证据" className="publication-drawer-card">
          <UploadedFiles files={record.attachments} bound />
        </Card>
      )}
      <Card size="small" title="状态轨迹" className="publication-drawer-card">
        <Timeline
          items={record.status_events.map((event) => ({
            content: (
              <>
                <StatusTag status={event.status} /> <Typography.Text>{event.comment}</Typography.Text>
                <br />
                <Typography.Text type="secondary">{formatDateTime(event.created_at)}</Typography.Text>
              </>
            ),
          }))}
        />
      </Card>
    </div>
  );
}

function UploadedFiles({ files, bound = false }: { files: FileRecord[]; bound?: boolean }) {
  if (files.length === 0) return null;
  return (
    <ul className="publication-file-list">
      {files.map((file) => (
        <li key={file.id}>
          <Typography.Text ellipsis={{ tooltip: file.original_filename }}>{file.original_filename}</Typography.Text>
          {bound ? <StatusTag status={file.status} /> : <Typography.Text type="warning">已上传，尚未绑定</Typography.Text>}
        </li>
      ))}
    </ul>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

async function invalidatePublicationQueries(taskId: string, publicationId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.publications.record(publicationId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.publications.records }),
    queryClient.invalidateQueries({ queryKey: queryKeys.publications.candidates }),
    queryClient.invalidateQueries({ queryKey: queryKeys.publications.attentions }),
    queryClient.invalidateQueries({ queryKey: ['publication-workbench-summary'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(taskId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
  ]);
}

function commandSuccessMessage(action: PublicationCommandAction) {
  if (action === 'remove') return '已标记为已移除，发布记录和历史事件已保留';
  if (action === 'mark-verification-failed') return '已标记验证失败，记录已进入发布需关注';
  return `${actionLabels[action]}已完成`;
}
