/** 发布管理工作台只消费服务端投影的阶段、主动作和允许动作。 */
import {
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  MoreOutlined,
  ReadOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Grid,
  Input,
  List,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableCellText } from '../../shared/components/TableCellText';
import { TableRegion } from '../../shared/components/TableRegion';
import { useFocusReturn } from '../../shared/hooks/useFocusReturn';

type PublicationTab = 'works' | 'articles' | 'history';
type ResourceKind = 'work' | 'article' | 'issue';
type ReadyItem = Schema<'PublicationReadyItem'>;
type WorkItem = Schema<'PublicationWorkListItem'>;
type Work = Schema<'PublicationWork'>;
type ArticleItem = Schema<'PublishedArticleListItem'>;
type Article = Schema<'PublishedArticle'>;
type IssueItem = Schema<'PublishedContentIssueListItem'>;
type Issue = Schema<'PublishedContentIssue'>;
type WorkAction = Work['available_actions'][number];
type IssueAction = Issue['available_actions'][number];
type WorkPrimaryTask = WorkItem['primary_task'];
type ArticlePrimaryTask = ArticleItem['primary_task'];
type IssuePrimaryTask = IssueItem['primary_task'];
type ActionTarget =
  | { kind: 'ready'; resource: ReadyItem; action: 'START' }
  | { kind: 'work'; resource: WorkItem | Work; action: WorkAction }
  | { kind: 'article'; resource: ArticleItem | Article; action: 'OPEN_ISSUE' }
  | { kind: 'issue'; resource: IssueItem | Issue; action: IssueAction };

const PAGE_SIZE = 20;
const workStatuses: Schema<'PublicationWorkStatus'>[] = [
  'ACTION_REQUIRED', 'AWAITING_VERIFICATION', 'PLATFORM_REVIEW', 'PREPARING',
];
const actionLabels: Record<ActionTarget['action'], string> = {
  START: '开始发布',
  UPDATE_PREPARATION: '调整准备信息',
  MARK_PLATFORM_REVIEW: '标记平台处理中',
  REGISTER_RESULT: '登记发布结果',
  VERIFY: '核验发布结果',
  SWITCH_CONTENT_VERSION: '切换待发布版本',
  CLOSE: '关闭发布工作',
  OPEN_ISSUE: '登记内容问题',
  CREATE_REPAIR_TASK: '创建修复任务',
  RESOLVE: '解决内容问题',
};
const workTaskLabels: Record<WorkPrimaryTask, string> = {
  CONTINUE_PREPARATION: '继续发布准备',
  REGISTER_RESULT: '登记发布结果',
  RUN_FIRST_VERIFICATION: '执行首次核验',
  FIX_AND_REVERIFY: '修复并重新核验',
  VIEW_COMPLETION: '查看完成记录',
  VIEW_CLOSURE: '查看关闭记录',
};
const workTaskActions: Record<WorkPrimaryTask, WorkAction | null> = {
  CONTINUE_PREPARATION: 'UPDATE_PREPARATION',
  REGISTER_RESULT: 'REGISTER_RESULT',
  RUN_FIRST_VERIFICATION: 'VERIFY',
  FIX_AND_REVERIFY: 'VERIFY',
  VIEW_COMPLETION: null,
  VIEW_CLOSURE: null,
};
const articleTaskLabels: Record<ArticlePrimaryTask, string> = {
  START_PRODUCT_OBSERVATION: '开始产品观测',
  HANDLE_CONTENT_ISSUE: '处理内容问题',
  VIEW_HISTORY: '查看历史',
};
const issueTaskLabels: Record<IssuePrimaryTask, string> = {
  HANDLE_CONTENT_ISSUE: '处理内容问题',
  CONTINUE_REPAIR: '继续修复',
  CONFIRM_RESOLUTION: '确认处理结果',
  VIEW_RESOLUTION: '查看处理结果',
};
const issueTaskActions: Record<IssuePrimaryTask, IssueAction | null> = {
  HANDLE_CONTENT_ISSUE: 'CREATE_REPAIR_TASK',
  CONTINUE_REPAIR: null,
  CONFIRM_RESOLUTION: 'RESOLVE',
  VIEW_RESOLUTION: null,
};

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function validPage(value: string | null) {
  const page = Number(value ?? 1);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function ActionButtons({
  resource,
  primaryLabel,
  primaryAction,
  accessibleLabel,
  onPrimary,
  onAction,
}: {
  resource: { available_actions: readonly string[] };
  primaryLabel: string;
  primaryAction: string | null;
  accessibleLabel: string;
  onPrimary: () => void;
  onAction: (action: string) => void;
}) {
  const secondary = resource.available_actions.filter((action) => action !== primaryAction);
  return (
    <Space className="publication-action-buttons" size={4}>
      <Button size="small" type="primary" onClick={onPrimary}>{primaryLabel}</Button>
      {secondary.length > 0 && (
        <Dropdown
          trigger={['click']}
          menu={{
            items: secondary.map((action) => ({
              key: action,
              label: actionLabels[action as ActionTarget['action']],
              danger: action === 'CLOSE',
            })),
            onClick: ({ key }) => onAction(key),
          }}
        >
          <Button size="small" type="text" icon={<MoreOutlined />} aria-label={`更多操作：${accessibleLabel}`} />
        </Dropdown>
      )}
    </Space>
  );
}

function ActionModalContent({ target, onClose }: { target: ActionTarget; onClose: () => void }) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [attachments, setAttachments] = useState<Schema<'FileRecord'>[]>([]);
  const platformId = target.kind === 'ready' || target.kind === 'work'
    ? target.resource.platform_profile_id
    : undefined;
  const issueId = target.kind === 'issue' ? target.resource.id : '';
  const accounts = useQuery({
    queryKey: queryKeys.platformAccounts.list({ platform_profile_id: platformId }),
    queryFn: async () => unwrap(await api.GET('/api/v1/platform-accounts', {
      params: { query: { platform_profile_id: platformId! } },
    })),
    enabled: target.action === 'UPDATE_PREPARATION',
  });
  const repair = useQuery({
    queryKey: queryKeys.publications.repair(issueId),
    queryFn: async () => unwrap(await api.GET('/api/v1/published-content-issues/{issue_id}/repair-context', {
      params: { path: { issue_id: issueId } },
    })),
    enabled: target.kind === 'issue' && target.action === 'CREATE_REPAIR_TASK',
  });
  const contentVersions = useQuery({
    queryKey: queryKeys.contentTasks.versions(target.kind === 'work' ? target.resource.task_id : ''),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/content-versions', {
      params: { path: { content_task_id: target.kind === 'work' ? target.resource.task_id : '' } },
    })),
    enabled: target.kind === 'work' && target.action === 'SWITCH_CONTENT_VERSION',
  });

  useEffect(() => {
    form.resetFields();
    if (target.kind === 'work') {
      form.setFieldsValue({
        platform_account_id: target.resource.platform_account_id,
        actual_title: target.resource.actual_title,
        final_url: target.resource.final_url,
      });
    }
  }, [form, target]);

  const command = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      if (target.kind === 'ready') {
        return unwrap(await api.POST('/api/v1/publication-works', {
          params: { header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } },
          body: {
            content_version_id: target.resource.content_version.id,
            platform_account_id: values.platform_account_id!,
          },
        }));
      }
      if (target.kind === 'work') {
        const params = { path: { work_id: target.resource.id }, header: csrfHeader() };
        if (target.action === 'UPDATE_PREPARATION') {
          return unwrap(await api.PATCH('/api/v1/publication-works/{work_id}/preparation', {
            params,
            body: {
              platform_account_id: values.platform_account_id!,
              expected_revision: target.resource.revision,
              comment: values.comment!,
            },
          }));
        }
        if (target.action === 'MARK_PLATFORM_REVIEW') {
          return unwrap(await api.POST('/api/v1/publication-works/{work_id}/platform-review', {
            params,
            body: { expected_revision: target.resource.revision, comment: values.comment! },
          }));
        }
        if (target.action === 'REGISTER_RESULT') {
          return unwrap(await api.PUT('/api/v1/publication-works/{work_id}/result', {
            params,
            body: {
              actual_title: values.actual_title!,
              final_url: values.final_url!,
              published_at: new Date(values.published_at!).toISOString(),
              expected_revision: target.resource.revision,
              comment: values.comment!,
              attachment_file_ids: attachments.map((file) => file.id),
            },
          }));
        }
        if (target.action === 'VERIFY') {
          const outcome = values.outcome as Schema<'PublicationVerificationOutcome'>;
          return unwrap(await api.POST('/api/v1/publication-works/{work_id}/verifications', {
            params,
            body: {
              outcome,
              content_matches: outcome === 'PASSED',
              expected_revision: target.resource.revision,
              comment: values.comment ?? '',
            },
          }));
        }
        if (target.action === 'SWITCH_CONTENT_VERSION') {
          return unwrap(await api.POST('/api/v1/publication-works/{work_id}/content-version', {
            params,
            body: {
              content_version_id: values.content_version_id!,
              expected_revision: target.resource.revision,
              comment: values.comment!,
            },
          }));
        }
        return unwrap(await api.POST('/api/v1/publication-works/{work_id}/close', {
          params,
          body: {
            reason: values.reason as Schema<'PublicationCloseReason'>,
            comment: values.comment!,
            expected_revision: target.resource.revision,
          },
        }));
      }
      if (target.kind === 'article') {
        return unwrap(await api.POST('/api/v1/published-articles/{article_id}/issues', {
          params: { path: { article_id: target.resource.id }, header: csrfHeader() },
          body: {
            kind: values.kind as Schema<'PublishedContentIssueKind'>,
            description: values.description!,
          },
        }));
      }
      if (target.action === 'CREATE_REPAIR_TASK') {
        return unwrap(await api.POST('/api/v1/published-content-issues/{issue_id}/repair-task', {
          params: { path: { issue_id: target.resource.id }, header: csrfHeader() },
          body: {
            fact_version_id: values.fact_version_id!,
            expected_issue_revision: target.resource.revision,
          },
        }));
      }
      return unwrap(await api.POST('/api/v1/published-content-issues/{issue_id}/resolve', {
        params: { path: { issue_id: target.resource.id }, header: csrfHeader() },
        body: {
          outcome: values.outcome as Schema<'PublishedContentIssueResolution'>,
          comment: values.comment!,
          expected_revision: target.resource.revision,
        },
      }));
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.geo.all }),
      ]);
      message.success('操作已完成');
      onClose();
    },
  });

  const needsComment = ['UPDATE_PREPARATION', 'MARK_PLATFORM_REVIEW', 'REGISTER_RESULT', 'CLOSE', 'RESOLVE'].includes(target.action);
  return (
    <Modal
      open
      title={actionLabels[target.action]}
      okText="确认提交"
      okButtonProps={{ danger: target.action === 'CLOSE' }}
      confirmLoading={command.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      {target.action === 'CLOSE' && (
        <Alert
          className="form-alert"
          type="warning"
          showIcon
          title="关闭后发布工作不可恢复，来源内容任务将同时取消。"
        />
      )}
      {command.error && <Alert type="error" showIcon title={errorMessage(command.error)} />}
      {accounts.error && <QueryFailure error={accounts.error} onRetry={() => void accounts.refetch()} />}
      {repair.error && <QueryFailure error={repair.error} onRetry={() => void repair.refetch()} />}
      {contentVersions.error && <QueryFailure error={contentVersions.error} onRetry={() => void contentVersions.refetch()} />}
      <Form form={form} layout="vertical" onFinish={(values) => command.mutate(values)}>
        {target.action === 'START' && (
          <Form.Item name="platform_account_id" label="发布账号" rules={[{ required: true, message: '请选择发布账号' }]}>
            <Select options={target.resource.matching_accounts.map((account) => ({ value: account.id, label: `${account.label} · ${account.account_identifier}` }))} />
          </Form.Item>
        )}
        {target.action === 'UPDATE_PREPARATION' && (
          <>
            <Form.Item name="platform_account_id" label="发布账号" rules={[{ required: true, message: '请选择发布账号' }]}>
              <Select loading={accounts.isLoading} options={accounts.data?.items.filter((account) => account.is_active).map((account) => ({ value: account.id, label: `${account.label} · ${account.account_identifier}` }))} />
            </Form.Item>
          </>
        )}
        {target.action === 'REGISTER_RESULT' && (
          <>
            <Form.Item name="actual_title" label="实际标题" rules={[{ required: true, whitespace: true, message: '请输入实际标题' }]}><Input /></Form.Item>
            <Form.Item name="final_url" label="最终公开地址" rules={[{ required: true, type: 'url', message: '请输入有效公开地址' }]}><Input /></Form.Item>
            <Form.Item name="published_at" label="发布时间" rules={[{ required: true, message: '请选择发布时间' }]}><Input type="datetime-local" /></Form.Item>
            <Form.Item label="发布证据（可选）">
              <DirectUpload category="OPERATION_SCREENSHOT" onUploaded={(file) => setAttachments((current) => [...current, file])} />
              {attachments.map((file) => <Tag key={file.id}>{file.original_filename}</Tag>)}
            </Form.Item>
          </>
        )}
        {target.action === 'VERIFY' && (
          <Form.Item name="outcome" label="核验结果" rules={[{ required: true, message: '请选择核验结果' }]}>
            <Select options={[{ value: 'PASSED', label: '内容一致，核验通过' }, { value: 'FAILED', label: '核验失败，继续待处理' }]} />
          </Form.Item>
        )}
        {target.action === 'SWITCH_CONTENT_VERSION' && (
          <>
            <Alert
              className="form-alert"
              type="warning"
              showIcon
              title="切换会保留原发布工作和事件历史，后续核验只针对新版本。"
            />
            <Form.Item name="content_version_id" label="新的批准版本" rules={[{ required: true, message: '请选择批准版本' }]}>
              <Select
                loading={contentVersions.isLoading}
                options={contentVersions.data?.items
                  .filter((version) => version.status === 'APPROVED' && version.id !== target.resource.content_version_id)
                  .map((version) => ({ value: version.id, label: `${version.title} · V${version.version}` }))}
              />
            </Form.Item>
          </>
        )}
        {target.action === 'CLOSE' && (
          <Form.Item name="reason" label="关闭原因" rules={[{ required: true, message: '请选择关闭原因' }]}>
            <Select options={[
              { value: 'PLATFORM_REJECTED', label: '平台拒绝' },
              { value: 'BUSINESS_CANCELLED', label: '业务取消' },
              { value: 'OTHER', label: '其他' },
            ]} />
          </Form.Item>
        )}
        {target.action === 'OPEN_ISSUE' && (
          <>
            <Form.Item name="kind" label="问题类型" rules={[{ required: true, message: '请选择问题类型' }]}>
              <Select options={[
                { value: 'PAGE_UNAVAILABLE', label: '页面不可用' },
                { value: 'CONTENT_CHANGED', label: '公开内容已变化' },
                { value: 'OTHER', label: '其他' },
              ]} />
            </Form.Item>
            <Form.Item name="description" label="问题说明" rules={[{ required: true, whitespace: true, message: '请输入问题说明' }]}><Input.TextArea rows={4} /></Form.Item>
          </>
        )}
        {target.action === 'CREATE_REPAIR_TASK' && (
          <Form.Item name="fact_version_id" label="修复所用事实版本" rules={[{ required: true, message: '请选择事实版本' }]}>
            <Select loading={repair.isLoading} options={repair.data?.fact_candidates.map((candidate) => ({ value: candidate.version.id, label: `V${candidate.version.version} · ${candidate.version.status}` }))} />
          </Form.Item>
        )}
        {target.action === 'RESOLVE' && (
          <Form.Item name="outcome" label="处理结果" rules={[{ required: true, message: '请选择处理结果' }]}>
            <Select options={[{ value: 'RESTORED', label: '已恢复，可继续观测' }, { value: 'RETIRED', label: '永久退役' }]} />
          </Form.Item>
        )}
        {(needsComment || target.action === 'VERIFY' || target.action === 'SWITCH_CONTENT_VERSION') && (
          <Form.Item
            name="comment"
            label={target.action === 'VERIFY' ? '核验说明' : '操作说明'}
            rules={needsComment || target.action === 'SWITCH_CONTENT_VERSION' ? [{ required: true, whitespace: true, message: '请输入说明' }] : undefined}
          >
            <Input.TextArea rows={3} placeholder={target.action === 'VERIFY' ? '核验失败时必须说明原因' : undefined} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

function ActionModal({ target, onClose }: { target: ActionTarget | null; onClose: () => void }) {
  if (!target) return null;
  const targetId = target.kind === 'ready' ? target.resource.content_version.id : target.resource.id;
  return <ActionModalContent key={`${target.kind}-${targetId}-${target.action}`} target={target} onClose={onClose} />;
}

function DetailDrawer({
  kind,
  selected,
  onClose,
  onAction,
  onOpenDetail,
  restoreFocus,
}: {
  kind: ResourceKind | null;
  selected: string | null;
  onClose: () => void;
  onAction: (target: ActionTarget) => void;
  onOpenDetail: (kind: ResourceKind, id: string) => void;
  restoreFocus: () => void;
}) {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const openCompletedRef = useRef(false);
  const [closingSelection, setClosingSelection] = useState<{ selected: string; kind: ResourceKind } | null>(null);
  const activeSelected = selected ?? closingSelection?.selected ?? '';
  const activeKind = kind ?? closingSelection?.kind ?? 'work';
  const open = !!selected && !!kind;

  useEffect(() => {
    if (!open && !openCompletedRef.current) restoreFocus();
  }, [open, restoreFocus]);

  const work = useQuery({
    queryKey: queryKeys.publications.work(activeSelected),
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-works/{work_id}', { params: { path: { work_id: activeSelected } } })),
    enabled: open && activeKind === 'work',
  });
  const article = useQuery({
    queryKey: queryKeys.publications.article(activeSelected),
    queryFn: async () => unwrap(await api.GET('/api/v1/published-articles/{article_id}', { params: { path: { article_id: activeSelected } } })),
    enabled: open && activeKind === 'article',
  });
  const issue = useQuery({
    queryKey: queryKeys.publications.issue(activeSelected),
    queryFn: async () => unwrap(await api.GET('/api/v1/published-content-issues/{issue_id}', { params: { path: { issue_id: activeSelected } } })),
    enabled: open && activeKind === 'issue',
  });
  const query = activeKind === 'work' ? work : activeKind === 'article' ? article : issue;
  const title = activeKind === 'work' ? '发布工作详情' : activeKind === 'article' ? '发布成果详情' : '内容问题详情';
  let content = null;
  if (query.isLoading) content = <QueryLoading label={`正在加载${title}`} />;
  else if (query.error) content = <QueryFailure error={query.error} onRetry={() => void query.refetch()} />;
  else if (activeKind === 'work' && work.data) {
    content = (
      <Space orientation="vertical" size="large" className="detail-stack">
        <Descriptions column={1} size="small" items={[
          { label: '内容', children: `${work.data.content_title} · V${work.data.content_version}` },
          { label: '阶段', children: <StatusTag status={work.data.status} /> },
          { label: '平台 / 账号', children: `${work.data.platform_profile_name} · ${work.data.platform_account_label}` },
          { label: '实际标题', children: work.data.actual_title ?? '尚未登记' },
          { label: '最终地址', children: work.data.final_url ? <a href={work.data.final_url} target="_blank" rel="noreferrer">{work.data.final_url}</a> : '尚未登记' },
          { label: '发布时间', children: formatDateTime(work.data.published_at) },
          { label: '关闭信息', children: work.data.close_reason ? <><StatusTag status={work.data.close_reason} /> {work.data.close_comment}</> : '—' },
        ]} />
        <section><Typography.Title level={5}>核验历史</Typography.Title><List dataSource={work.data.verifications} locale={{ emptyText: '尚无核验记录' }} renderItem={(item) => <List.Item><List.Item.Meta title={<Space><StatusTag status={item.outcome} /><time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time></Space>} description={item.comment || '未填写说明'} /></List.Item>} /></section>
        <section><Typography.Title level={5}>工作事件</Typography.Title><List dataSource={work.data.events} renderItem={(item) => <List.Item><List.Item.Meta title={`${item.action} · ${formatDateTime(item.created_at)}`} description={<><StatusTag status={item.to_status} /> {item.comment}</>} /></List.Item>} /></section>
      </Space>
    );
  } else if (activeKind === 'article' && article.data) {
    content = (
      <Space orientation="vertical" size="large" className="detail-stack">
        <Alert type="info" showIcon title="发布成果为只读历史，不提供修改或删除。" />
        <Descriptions column={1} size="small" items={[
          { label: '内容', children: `${article.data.content_title} · V${article.data.content_version}` },
          { label: '实际标题', children: article.data.actual_title },
          { label: '公开地址', children: <a href={article.data.final_url} target="_blank" rel="noreferrer">{article.data.final_url}</a> },
          { label: '平台 / 账号', children: `${article.data.platform_profile_name} · ${article.data.platform_account_label}` },
          { label: '发布时间', children: formatDateTime(article.data.published_at) },
          { label: '首次核验', children: `${formatDateTime(article.data.verified_at)} · ${article.data.verification.comment || '无说明'}` },
        ]} />
        <section><Typography.Title level={5}>历史问题</Typography.Title><List dataSource={article.data.issues} locale={{ emptyText: '没有内容问题' }} renderItem={(item) => <List.Item><List.Item.Meta title={<Space><StatusTag status={item.kind} /><StatusTag status={item.status} /></Space>} description={item.description} /></List.Item>} /></section>
      </Space>
    );
  } else if (activeKind === 'issue' && issue.data) {
    content = (
      <Space orientation="vertical" size="large" className="detail-stack">
        <Descriptions column={1} size="small" items={[
          { label: '状态', children: <StatusTag status={issue.data.status} /> },
          { label: '问题类型', children: <StatusTag status={issue.data.kind} /> },
          { label: '问题说明', children: issue.data.description },
          { label: '原发布成果', children: <a href={issue.data.final_url} target="_blank" rel="noreferrer">{issue.data.actual_title}</a> },
          { label: '修复任务', children: issue.data.repair_task_id ? <Link to={`/tasks/${issue.data.repair_task_id}`}>查看修复任务</Link> : '尚未创建' },
          { label: '处理结果', children: issue.data.resolution_outcome ? <><StatusTag status={issue.data.resolution_outcome} /> {issue.data.resolution_comment}</> : '—' },
        ]} />
        <Alert type="info" showIcon title="修复任务和问题状态彼此独立；创建任务不会自动解决问题。" />
      </Space>
    );
  }
  const data = activeKind === 'work' ? work.data : activeKind === 'article' ? article.data : issue.data;
  let actions = null;
  if (activeKind === 'work' && work.data) {
    const primaryAction = workTaskActions[work.data.primary_task];
    if (primaryAction || work.data.available_actions.length) {
      actions = (
        <ActionButtons
          resource={work.data}
          primaryLabel={workTaskLabels[work.data.primary_task]}
          primaryAction={primaryAction}
          accessibleLabel={work.data.content_title}
          onPrimary={() => primaryAction && onAction({ kind: 'work', resource: work.data!, action: primaryAction })}
          onAction={(action) => onAction({ kind: 'work', resource: work.data!, action: action as WorkAction })}
        />
      );
    }
  } else if (activeKind === 'article' && article.data && article.data.primary_task !== 'VIEW_HISTORY') {
    actions = (
      <ActionButtons
        resource={article.data}
        primaryLabel={articleTaskLabels[article.data.primary_task]}
        primaryAction={null}
        accessibleLabel={article.data.actual_title}
        onPrimary={() => {
          if (article.data?.primary_task === 'START_PRODUCT_OBSERVATION') {
            navigate(`/observations?product_id=${article.data.product_id}&create=true`);
          } else if (article.data?.open_issue_id) {
            onOpenDetail('issue', article.data.open_issue_id);
          }
        }}
        onAction={(action) => onAction({ kind: 'article', resource: article.data!, action: action as 'OPEN_ISSUE' })}
      />
    );
  } else if (activeKind === 'issue' && issue.data && issue.data.primary_task !== 'VIEW_RESOLUTION') {
    const primaryAction = issueTaskActions[issue.data.primary_task];
    actions = (
      <ActionButtons
        resource={issue.data}
        primaryLabel={issueTaskLabels[issue.data.primary_task]}
        primaryAction={primaryAction}
        accessibleLabel={`内容问题 ${issue.data.content_title}`}
        onPrimary={() => {
          if (primaryAction) onAction({ kind: 'issue', resource: issue.data!, action: primaryAction });
          else if (issue.data?.repair_task_id) navigate(`/tasks/${issue.data.repair_task_id}`);
        }}
        onAction={(action) => onAction({ kind: 'issue', resource: issue.data!, action: action as IssueAction })}
      />
    );
  }
  return (
    <Drawer
      rootClassName="publication-drawer-root"
      className="publication-drawer"
      open={open}
      title={title}
      size={screens.md ? 560 : '100%'}
      onClose={() => {
        if (selected && kind) setClosingSelection({ selected, kind });
        onClose();
      }}
      focusable={{ focusTriggerAfterClose: false }}
      destroyOnHidden
      afterOpenChange={(nextOpen) => {
        if (nextOpen) openCompletedRef.current = true;
        else if (openCompletedRef.current) {
          openCompletedRef.current = false;
          setClosingSelection(null);
          restoreFocus();
        }
      }}
      extra={data ? actions : null}
    >
      {content}
    </Drawer>
  );
}

export function PublicationsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const screens = Grid.useBreakpoint();
  const mobile = screens.md === false;
  const { focusReturnTargetProps, restoreFocus } = useFocusReturn();
  const rawTab = searchParams.get('tab');
  const tab: PublicationTab = rawTab === 'articles' || rawTab === 'history' ? rawTab : 'works';
  const page = validPage(searchParams.get('page'));
  const workPage = validPage(searchParams.get('work_page'));
  const issuePage = validPage(searchParams.get('issue_page'));
  const selected = searchParams.get('selected');
  const rawKind = searchParams.get('kind');
  const selectedKind: ResourceKind | null = rawKind === 'work' || rawKind === 'article' || rawKind === 'issue'
    ? rawKind
    : tab === 'articles' && selected ? 'article' : null;
  const rawStatus = searchParams.get('status');
  const platformAccountId = searchParams.get('platform_account_id') ?? undefined;
  const contentTaskId = searchParams.get('content_task_id') ?? undefined;
  const requestedContentVersionId = searchParams.get('content_version_id') ?? undefined;
  const requestedPlatformProfileId = searchParams.get('platform_profile_id') ?? undefined;
  const referenceMode = !!(platformAccountId || contentTaskId);
  const workStatus = workStatuses.includes(rawStatus as Schema<'PublicationWorkStatus'>)
    ? rawStatus as Schema<'PublicationWorkStatus'>
    : undefined;
  const historyStatus: 'CLOSED' | 'RESOLVED' = rawStatus === 'RESOLVED' ? 'RESOLVED' : 'CLOSED';
  const updateUrl = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => value === null ? next.delete(key) : next.set(key, value));
    setSearchParams(next);
  };
  const openDetail = (kind: ResourceKind, id: string) => updateUrl({ kind, selected: id });
  const workActions = (row: WorkItem) => {
    const primaryAction = workTaskActions[row.primary_task];
    return (
      <ActionButtons
        resource={row}
        primaryLabel={workTaskLabels[row.primary_task]}
        primaryAction={primaryAction}
        accessibleLabel={row.content_title}
        onPrimary={() => primaryAction
          ? setActionTarget({ kind: 'work', resource: row, action: primaryAction })
          : openDetail('work', row.id)}
        onAction={(action) => setActionTarget({ kind: 'work', resource: row, action: action as WorkAction })}
      />
    );
  };
  const articleActions = (row: ArticleItem) => (
    <ActionButtons
      resource={row}
      primaryLabel={articleTaskLabels[row.primary_task]}
      primaryAction={null}
      accessibleLabel={row.actual_title}
      onPrimary={() => {
        if (row.primary_task === 'START_PRODUCT_OBSERVATION') {
          navigate(`/observations?product_id=${row.product_id}&create=true`);
        } else if (row.primary_task === 'HANDLE_CONTENT_ISSUE') {
          if (row.open_issue_id) openDetail('issue', row.open_issue_id);
          else void message.error('发布成果缺少开放问题标识，无法进入处理工作区');
        } else openDetail('article', row.id);
      }}
      onAction={(action) => setActionTarget({ kind: 'article', resource: row, action: action as 'OPEN_ISSUE' })}
    />
  );
  const issueActions = (row: IssueItem) => {
    const primaryAction = issueTaskActions[row.primary_task];
    return (
      <ActionButtons
        resource={row}
        primaryLabel={issueTaskLabels[row.primary_task]}
        primaryAction={primaryAction}
        accessibleLabel={`内容问题 ${row.content_title}`}
        onPrimary={() => {
          if (primaryAction) setActionTarget({ kind: 'issue', resource: row, action: primaryAction });
          else if (row.primary_task === 'CONTINUE_REPAIR' && row.repair_task_id) navigate(`/tasks/${row.repair_task_id}`);
          else if (row.primary_task === 'VIEW_RESOLUTION') openDetail('issue', row.id);
          else void message.error('内容问题缺少修复任务标识，无法继续处理');
        }}
        onAction={(action) => setActionTarget({ kind: 'issue', resource: row, action: action as IssueAction })}
      />
    );
  };
  const readyActions = (row: ReadyItem) => (
    <ActionButtons
      resource={row}
      primaryLabel="开始发布"
      primaryAction="START"
      accessibleLabel={row.content_version.title}
      onPrimary={() => setActionTarget({ kind: 'ready', resource: row, action: 'START' })}
      onAction={() => setActionTarget({ kind: 'ready', resource: row, action: 'START' })}
    />
  );
  const summary = useQuery({
    queryKey: queryKeys.publications.summary,
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-workbench-summary')),
    enabled: tab === 'works' && !referenceMode,
  });
  const ready = useQuery({
    queryKey: queryKeys.publications.ready,
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-ready-items')),
    enabled: tab === 'works' && !referenceMode,
  });
  const requestedReadyItem = ready.data?.items.find((row) => row.content_version.id === requestedContentVersionId);
  const requestedActionTarget: ActionTarget | null = requestedReadyItem
    ? { kind: 'ready', resource: requestedReadyItem, action: 'START' }
    : null;
  const requestedReadyUnavailable = !!requestedContentVersionId && ready.isSuccess && !requestedReadyItem;
  const worksQueryPage = referenceMode ? page : tab === 'history' ? page : workPage;
  const worksPageParam = referenceMode || tab === 'history' ? 'page' : 'work_page';
  const worksQueryStatus = referenceMode ? undefined : tab === 'history' ? 'CLOSED' : workStatus;
  const works = useQuery({
    queryKey: queryKeys.publications.works(worksQueryPage, PAGE_SIZE, worksQueryStatus, platformAccountId, contentTaskId),
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-works', {
      params: { query: {
        page: worksQueryPage,
        page_size: PAGE_SIZE,
        ...(worksQueryStatus ? { status: worksQueryStatus } : {}),
        ...(platformAccountId ? { platform_account_id: platformAccountId } : {}),
        ...(contentTaskId ? { content_task_id: contentTaskId } : {}),
      } },
    })),
    enabled: referenceMode || tab === 'works' || (tab === 'history' && historyStatus === 'CLOSED'),
  });
  const articles = useQuery({
    queryKey: queryKeys.publications.articles(page, PAGE_SIZE),
    queryFn: async () => unwrap(await api.GET('/api/v1/published-articles', { params: { query: { page, page_size: PAGE_SIZE } } })),
    enabled: tab === 'articles' && !referenceMode,
  });
  const issuesQueryPage = tab === 'history' ? page : issuePage;
  const issuesQueryStatus: Schema<'PublishedContentIssueStatus'> = tab === 'history' ? 'RESOLVED' : 'OPEN';
  const issues = useQuery({
    queryKey: queryKeys.publications.issues(issuesQueryPage, PAGE_SIZE, issuesQueryStatus),
    queryFn: async () => unwrap(await api.GET('/api/v1/published-content-issues', { params: { query: { page: issuesQueryPage, page_size: PAGE_SIZE, status: issuesQueryStatus } } })),
    enabled: !referenceMode && (tab === 'works' || (tab === 'history' && historyStatus === 'RESOLVED')),
  });

  const workColumns: TableColumnsType<WorkItem> = [
    { title: '内容', render: (_, row) => <Tooltip title={`${row.content_title} · V${row.content_version}`} trigger={['hover', 'focus']}><Button {...focusReturnTargetProps} className="publication-table-title table-cell-ellipsis" type="link" onClick={() => openDetail('work', row.id)}>{row.content_title} · V{row.content_version}</Button></Tooltip> },
    { title: '平台 / 账号', width: 210, render: (_, row) => <TableCellText text={`${row.platform_profile_name} · ${row.platform_account_label}`} /> },
    { title: '当前阶段', dataIndex: 'status', width: 128, render: (status: string) => <StatusTag status={status} /> },
    { title: '最近情况', width: 126, render: (_, row) => row.latest_verification_outcome ? <StatusTag status={row.latest_verification_outcome} /> : '尚未核验' },
    { title: '更新时间', dataIndex: 'updated_at', width: 156, render: formatDateTime },
    { title: '操作', width: 168, fixed: 'right', render: (_, row) => workActions(row) },
  ];
  const articleColumns: TableColumnsType<ArticleItem> = [
    { title: '发布成果', render: (_, row) => <Tooltip title={row.actual_title} trigger={['hover', 'focus']}><Button {...focusReturnTargetProps} className="publication-table-title table-cell-ellipsis" type="link" onClick={() => openDetail('article', row.id)}>{row.actual_title}</Button></Tooltip> },
    { title: '平台 / 账号', width: 210, render: (_, row) => <TableCellText text={`${row.platform_profile_name} · ${row.platform_account_label}`} /> },
    { title: '首次核验', dataIndex: 'verified_at', width: 156, render: formatDateTime },
    { title: '健康状态', width: 112, render: (_, row) => <StatusTag status={row.retired ? 'RETIRED' : row.has_open_issue ? 'OPEN' : 'COMPLETED'} /> },
    { title: '操作', width: 154, fixed: 'right', render: (_, row) => articleActions(row) },
  ];
  const issueColumns: TableColumnsType<IssueItem> = [
    { title: '内容问题', render: (_, row) => <Tooltip title={`${row.content_title}：${row.description}`} trigger={['hover', 'focus']}><Button {...focusReturnTargetProps} className="publication-table-title table-cell-ellipsis" type="link" onClick={() => openDetail('issue', row.id)}>{row.content_title}</Button></Tooltip> },
    { title: '类型', dataIndex: 'kind', width: 138, render: (kind: string) => <StatusTag status={kind} /> },
    { title: '状态', dataIndex: 'status', width: 100, render: (status: string) => <StatusTag status={status} /> },
    { title: '打开时间', dataIndex: 'opened_at', width: 156, render: formatDateTime },
    { title: '修复任务', width: 108, render: (_, row) => row.repair_task_id ? <Link to={`/tasks/${row.repair_task_id}`}>查看任务</Link> : '未创建' },
    { title: '操作', width: 168, fixed: 'right', render: (_, row) => issueActions(row) },
  ];

  const workCollection = works.isLoading ? <QueryLoading label="正在加载发布工作" /> : works.error
    ? <QueryFailure error={works.error} onRetry={() => void works.refetch()} />
    : mobile ? (
      <div className="publication-mobile-list" role="list" aria-label={tab === 'history' ? '已关闭发布工作移动列表' : '发布工作移动列表'}>
        {(works.data?.items.length ?? 0) === 0 ? <NoData description={tab === 'history' ? '没有已关闭发布工作' : '没有当前发布工作'} /> : works.data?.items.map((row) => (
          <article className="publication-task-card" role="listitem" key={row.id}>
            <header>
              <Button {...focusReturnTargetProps} type="link" onClick={() => openDetail('work', row.id)}>{row.content_title} · V{row.content_version}</Button>
              <StatusTag status={row.status} />
            </header>
            <div className="publication-card-meta"><span>{row.platform_profile_name} · {row.platform_account_label}</span><time dateTime={row.updated_at}>{formatDateTime(row.updated_at)}</time></div>
            <p>{row.latest_verification_outcome === 'FAILED' ? '上次核验失败，仍需复核公开页面。' : row.latest_verification_outcome ? `最近核验：${row.latest_verification_outcome}` : '尚未核验，按当前推荐动作继续处理。'}</p>
            <footer>{workActions(row)}</footer>
          </article>
        ))}
        <Pagination hideOnSinglePage current={worksQueryPage} pageSize={PAGE_SIZE} total={works.data?.total ?? 0} showSizeChanger={false} onChange={(next) => updateUrl({ [worksPageParam]: String(next), selected: null, kind: null })} />
      </div>
    ) : (
      <TableRegion label={tab === 'history' ? '已关闭发布工作列表' : '发布管理列表'}>
        <Table<WorkItem> rowKey="id" dataSource={works.data?.items} columns={workColumns} scroll={{ x: 920 }} pagination={{ current: worksQueryPage, pageSize: PAGE_SIZE, total: works.data?.total, showSizeChanger: false, onChange: (next) => updateUrl({ [worksPageParam]: String(next), selected: null, kind: null }) }} />
      </TableRegion>
    );

  const issueCollection = issues.isLoading ? <QueryLoading label="正在加载内容问题" /> : issues.error
    ? <QueryFailure error={issues.error} onRetry={() => void issues.refetch()} />
    : mobile ? (
      <div className="publication-mobile-list" role="list" aria-label={tab === 'history' ? '已解决内容问题移动列表' : '开放内容问题移动列表'}>
        {(issues.data?.items.length ?? 0) === 0 ? <NoData description={tab === 'history' ? '没有已解决内容问题' : '没有开放内容问题'} /> : issues.data?.items.map((row) => (
          <article className="publication-task-card publication-issue-card" role="listitem" key={row.id}>
            <header>
              <Button {...focusReturnTargetProps} type="link" onClick={() => openDetail('issue', row.id)}>{row.content_title}</Button>
              <StatusTag status={row.status} />
            </header>
            <div className="publication-card-meta"><StatusTag status={row.kind} compact /><time dateTime={row.opened_at}>{formatDateTime(row.opened_at)}</time></div>
            <p>{row.description}</p>
            <footer>{issueActions(row)}</footer>
          </article>
        ))}
        <Pagination hideOnSinglePage current={issuesQueryPage} pageSize={PAGE_SIZE} total={issues.data?.total ?? 0} showSizeChanger={false} onChange={(next) => updateUrl({ [tab === 'history' ? 'page' : 'issue_page']: String(next), selected: null, kind: null })} />
      </div>
    ) : (
      <TableRegion label={tab === 'history' ? '已解决内容问题列表' : '开放内容问题列表'}>
        <Table<IssueItem> rowKey="id" dataSource={issues.data?.items} columns={issueColumns} scroll={{ x: 860 }} pagination={{ current: issuesQueryPage, pageSize: PAGE_SIZE, total: issues.data?.total, showSizeChanger: false, onChange: (next) => updateUrl({ [tab === 'history' ? 'page' : 'issue_page']: String(next), selected: null, kind: null }) }} />
      </TableRegion>
    );

  const readyCollection = ready.isLoading ? <QueryLoading label="正在加载待开始内容" /> : ready.error
    ? <QueryFailure error={ready.error} onRetry={() => void ready.refetch()} />
    : mobile ? (
      <div className="publication-mobile-list" role="list" aria-label="待开始发布移动列表">
        {(ready.data?.items.length ?? 0) === 0 ? <NoData description="没有待开始内容" /> : ready.data?.items.map((row) => (
          <article className="publication-task-card" role="listitem" key={row.content_version.id}>
            <header><strong>{row.content_version.title} · V{row.content_version.version}</strong><StatusTag status={row.content_version.status} /></header>
            <div className="publication-card-meta"><span>{row.platform_profile_name}</span><span>{row.matching_accounts.length} 个可用账号</span></div>
            <p>内容已批准，可选择匹配账号开始发布。</p>
            <footer>{readyActions(row)}</footer>
          </article>
        ))}
      </div>
    ) : (
      <TableRegion label="待开始发布列表">
        <Table<ReadyItem>
          rowKey={(row) => row.content_version.id}
          size="small"
          pagination={false}
          dataSource={ready.data?.items}
          locale={{ emptyText: '没有待开始内容' }}
          scroll={{ x: 660 }}
          columns={[
            { title: '内容', render: (_, row) => <TableCellText text={`${row.content_version.title} · V${row.content_version.version}`} /> },
            { title: '目标平台', dataIndex: 'platform_profile_name', width: 200, render: (value: string) => <TableCellText text={value} /> },
            { title: '可用账号', width: 100, render: (_, row) => `${row.matching_accounts.length} 个` },
            { title: '操作', width: 132, fixed: 'right', render: (_, row) => readyActions(row) },
          ]}
        />
      </TableRegion>
    );

  const articleCollection = articles.isLoading ? <QueryLoading label="正在加载发布成果" /> : articles.error
    ? <QueryFailure error={articles.error} onRetry={() => void articles.refetch()} />
    : mobile ? (
      <div className="publication-mobile-list" role="list" aria-label="发布成果移动列表">
        {(articles.data?.items.length ?? 0) === 0 ? <NoData description="没有发布成果" /> : articles.data?.items.map((row) => (
          <article className="publication-task-card" role="listitem" key={row.id}>
            <header><Button {...focusReturnTargetProps} type="link" onClick={() => openDetail('article', row.id)}>{row.actual_title}</Button><StatusTag status={row.retired ? 'RETIRED' : row.has_open_issue ? 'OPEN' : 'COMPLETED'} /></header>
            <div className="publication-card-meta"><span>{row.platform_profile_name} · {row.platform_account_label}</span><time dateTime={row.verified_at}>{formatDateTime(row.verified_at)}</time></div>
            <p>核验通过形成的只读发布成果。</p>
            <footer>{articleActions(row)}</footer>
          </article>
        ))}
        <Pagination hideOnSinglePage current={page} pageSize={PAGE_SIZE} total={articles.data?.total ?? 0} showSizeChanger={false} onChange={(next) => updateUrl({ page: String(next), selected: null, kind: null })} />
      </div>
    ) : (
      <TableRegion label="发布成果列表">
        <Table<ArticleItem> rowKey="id" dataSource={articles.data?.items} columns={articleColumns} scroll={{ x: 820 }} pagination={{ current: page, pageSize: PAGE_SIZE, total: articles.data?.total, showSizeChanger: false, onChange: (next) => updateUrl({ page: String(next), selected: null, kind: null }) }} />
      </TableRegion>
    );

  return (
    <div className="page-stack publication-workbench">
      <PageHeader eyebrow="人工发布与公开内容" title="发布管理" description="优先处理当前发布工作与公开内容问题，成果和历史记录用于追溯。" />
      <Card className="publication-panel">
        {requestedReadyUnavailable && (
          <Alert
            className="form-alert"
            type="warning"
            showIcon
            title="该内容当前不能开始发布"
            description="服务端未将该版本列入待开始内容。请先为目标平台新增并启用发布账号；若已有可用账号，请返回内容任务确认是否已创建发布工作或上下文状态已变化。"
            action={<Button href={`/settings?tab=accounts${requestedPlatformProfileId ? `&platform_profile_id=${requestedPlatformProfileId}` : ''}`}>配置发布账号</Button>}
          />
        )}
        {!referenceMode && <Tabs
          activeKey={tab}
          onChange={(key) => updateUrl({ tab: key, page: '1', work_page: null, issue_page: null, selected: null, kind: null, status: key === 'history' ? 'CLOSED' : null })}
          items={[
            { key: 'works', label: '待处理' },
            { key: 'articles', label: '发布成果' },
            { key: 'history', label: '历史记录' },
          ]}
        />}
        {referenceMode && <section className="publication-section">
          <Alert type="info" showIcon title="正在查看删除阻断引用" description="这里包含匹配的全部发布工作，包括已完成和已关闭历史；发布历史不可删除。" action={<Button href="/publications">返回完整工作台</Button>} />
          <header className="publication-section-header"><div><Typography.Title level={4}>关联发布工作</Typography.Title><Typography.Text type="secondary">服务端按发布账号或内容任务精确筛选。</Typography.Text></div></header>
          {workCollection}
        </section>}
        {tab === 'works' && !referenceMode && (
          <>
            {summary.error ? <QueryFailure error={summary.error} onRetry={() => void summary.refetch()} /> : (
              <section className="publication-status-strip" aria-label="发布待处理摘要">
                <div><SendOutlined /><span>待开始</span><strong>{summary.data?.ready_count ?? '—'}</strong></div>
                <div><ReadOutlined /><span>进行中</span><strong>{summary.data?.active_count ?? '—'}</strong></div>
                <div><ReadOutlined /><span>待核验</span><strong>{summary.data?.awaiting_verification_count ?? '—'}</strong></div>
                <div className="is-attention"><ExclamationCircleOutlined /><span>需处理</span><strong>{summary.data?.action_required_count ?? '—'}</strong></div>
                <div className="is-attention"><CloseCircleOutlined /><span>开放问题</span><strong>{summary.data?.open_issue_count ?? '—'}</strong></div>
              </section>
            )}
            {(issues.isLoading || issues.error || (issues.data?.total ?? 0) > 0) && <section className="publication-section publication-priority-section">
              <header className="publication-section-header"><div><Typography.Title level={4}>开放内容问题</Typography.Title><Typography.Text type="secondary">公开页面异常，需要先判断修复或结束处理。</Typography.Text></div></header>
              {issueCollection}
            </section>}
            <section className="publication-section">
              <header className="publication-section-header"><div><Typography.Title level={4}>当前发布工作</Typography.Title><Typography.Text type="secondary">服务端已按需处理程度排序。</Typography.Text></div><Select aria-label="发布工作状态" value={workStatus ?? ''} onChange={(value) => updateUrl({ status: value || null, work_page: '1', selected: null, kind: null })} options={[{ value: '', label: '全部待处理' }, ...workStatuses.map((status) => ({ value: status, label: <StatusTag status={status} compact /> }))]} /></header>
              {workCollection}
            </section>
            <section className="publication-section">
              <header className="publication-section-header"><div><Typography.Title level={4}>待开始内容</Typography.Title><Typography.Text type="secondary">已批准且尚未创建发布工作的内容。</Typography.Text></div></header>
              {readyCollection}
            </section>
          </>
        )}
        {tab === 'articles' && !referenceMode && <section className="publication-section">
          <header className="publication-section-header"><div><Typography.Title level={4}>发布成果</Typography.Title><Typography.Text type="secondary">首次核验通过后形成的只读公开成果。</Typography.Text></div></header>
          {articleCollection}
        </section>}
        {tab === 'history' && !referenceMode && <section className="publication-section">
          <header className="publication-section-header"><div><Typography.Title level={4}>{historyStatus === 'CLOSED' ? '已关闭发布工作' : '已解决内容问题'}</Typography.Title><Typography.Text type="secondary">只用于查询已经结束的处理记录。</Typography.Text></div><Select aria-label="历史记录类型" value={historyStatus} onChange={(value) => updateUrl({ status: value, page: '1', selected: null, kind: null })} options={[{ value: 'CLOSED', label: '已关闭工作' }, { value: 'RESOLVED', label: '已解决问题' }]} /></header>
          {historyStatus === 'CLOSED' ? workCollection : issueCollection}
        </section>}
      </Card>
      <DetailDrawer kind={selectedKind} selected={selected} onClose={() => updateUrl({ selected: null, kind: null })} onAction={setActionTarget} onOpenDetail={openDetail} restoreFocus={restoreFocus} />
      <ActionModal target={actionTarget ?? requestedActionTarget} onClose={() => {
        setActionTarget(null);
        if (requestedContentVersionId) updateUrl({ content_version_id: null });
      }} />
    </div>
  );
}
