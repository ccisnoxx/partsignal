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
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

type PublicationTab = 'works' | 'articles' | 'issues';
type ReadyItem = Schema<'PublicationReadyItem'>;
type WorkItem = Schema<'PublicationWorkListItem'>;
type Work = Schema<'PublicationWork'>;
type ArticleItem = Schema<'PublishedArticleListItem'>;
type Article = Schema<'PublishedArticle'>;
type IssueItem = Schema<'PublishedContentIssueListItem'>;
type Issue = Schema<'PublishedContentIssue'>;
type WorkAction = Work['available_actions'][number];
type IssueAction = Issue['available_actions'][number];
type ActionTarget =
  | { kind: 'ready'; resource: ReadyItem; action: 'START' }
  | { kind: 'work'; resource: WorkItem | Work; action: WorkAction }
  | { kind: 'article'; resource: ArticleItem | Article; action: 'OPEN_ISSUE' }
  | { kind: 'issue'; resource: IssueItem | Issue; action: IssueAction };

const PAGE_SIZE = 20;
const workStatuses: Schema<'PublicationWorkStatus'>[] = [
  'ACTION_REQUIRED', 'AWAITING_VERIFICATION', 'PLATFORM_REVIEW', 'PREPARING', 'COMPLETED', 'CLOSED',
];
const actionLabels: Record<ActionTarget['action'], string> = {
  START: '开始发布',
  UPDATE_PREPARATION: '调整准备信息',
  MARK_PLATFORM_REVIEW: '标记平台处理中',
  REGISTER_RESULT: '登记发布结果',
  VERIFY: '核验发布结果',
  CLOSE: '关闭发布工作',
  OPEN_ISSUE: '登记内容问题',
  CREATE_REPAIR_TASK: '创建修复任务',
  RESOLVE: '解决内容问题',
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
  label,
  onAction,
}: {
  resource: { available_actions: readonly string[]; primary_action: string | null };
  label: string;
  onAction: (action: string) => void;
}) {
  const secondary = resource.available_actions.filter((action) => action !== resource.primary_action);
  return (
    <Space size={4}>
      {resource.primary_action && (
        <Button size="small" type="primary" onClick={() => onAction(resource.primary_action!)}>
          {actionLabels[resource.primary_action as ActionTarget['action']]}
        </Button>
      )}
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
          <Button size="small" type="text" icon={<MoreOutlined />} aria-label={`更多操作：${label}`} />
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

  useEffect(() => {
    form.resetFields();
    if (target.kind === 'work') {
      form.setFieldsValue({
        platform_account_id: target.resource.platform_account_id,
        section_url: target.resource.section_url,
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
            section_url: values.section_url!,
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
              section_url: values.section_url!,
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
      <Form form={form} layout="vertical" onFinish={(values) => command.mutate(values)}>
        {target.action === 'START' && (
          <>
            <Form.Item name="platform_account_id" label="发布账号" rules={[{ required: true, message: '请选择发布账号' }]}>
              <Select options={target.resource.matching_accounts.map((account) => ({ value: account.id, label: `${account.label} · ${account.account_identifier}` }))} />
            </Form.Item>
            <Form.Item name="section_url" label="栏目地址" rules={[{ required: true, type: 'url', message: '请输入有效栏目地址' }]}><Input /></Form.Item>
          </>
        )}
        {target.action === 'UPDATE_PREPARATION' && (
          <>
            <Form.Item name="platform_account_id" label="发布账号" rules={[{ required: true, message: '请选择发布账号' }]}>
              <Select loading={accounts.isLoading} options={accounts.data?.items.filter((account) => account.is_active).map((account) => ({ value: account.id, label: `${account.label} · ${account.account_identifier}` }))} />
            </Form.Item>
            <Form.Item name="section_url" label="栏目地址" rules={[{ required: true, type: 'url', message: '请输入有效栏目地址' }]}><Input /></Form.Item>
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
        {(needsComment || target.action === 'VERIFY') && (
          <Form.Item
            name="comment"
            label={target.action === 'VERIFY' ? '核验说明' : '操作说明'}
            rules={needsComment ? [{ required: true, whitespace: true, message: '请输入说明' }] : undefined}
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
  tab,
  selected,
  onClose,
  onAction,
}: {
  tab: PublicationTab;
  selected: string | null;
  onClose: () => void;
  onAction: (target: ActionTarget) => void;
}) {
  const screens = Grid.useBreakpoint();
  const work = useQuery({
    queryKey: queryKeys.publications.work(selected ?? ''),
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-works/{work_id}', { params: { path: { work_id: selected! } } })),
    enabled: tab === 'works' && !!selected,
  });
  const article = useQuery({
    queryKey: queryKeys.publications.article(selected ?? ''),
    queryFn: async () => unwrap(await api.GET('/api/v1/published-articles/{article_id}', { params: { path: { article_id: selected! } } })),
    enabled: tab === 'articles' && !!selected,
  });
  const issue = useQuery({
    queryKey: queryKeys.publications.issue(selected ?? ''),
    queryFn: async () => unwrap(await api.GET('/api/v1/published-content-issues/{issue_id}', { params: { path: { issue_id: selected! } } })),
    enabled: tab === 'issues' && !!selected,
  });
  const query = tab === 'works' ? work : tab === 'articles' ? article : issue;
  const title = tab === 'works' ? '发布工作详情' : tab === 'articles' ? '发布成果详情' : '内容问题详情';
  let content = null;
  if (query.isLoading) content = <QueryLoading label={`正在加载${title}`} />;
  else if (query.error) content = <QueryFailure error={query.error} onRetry={() => void query.refetch()} />;
  else if (tab === 'works' && work.data) {
    content = (
      <Space orientation="vertical" size="large" className="detail-stack">
        <Descriptions column={1} size="small" items={[
          { label: '内容', children: `${work.data.content_title} · V${work.data.content_version}` },
          { label: '阶段', children: <StatusTag status={work.data.status} /> },
          { label: '平台 / 账号', children: `${work.data.platform_profile_name} · ${work.data.platform_account_label}` },
          { label: '栏目地址', children: <a href={work.data.section_url} target="_blank" rel="noreferrer">{work.data.section_url}</a> },
          { label: '实际标题', children: work.data.actual_title ?? '尚未登记' },
          { label: '最终地址', children: work.data.final_url ? <a href={work.data.final_url} target="_blank" rel="noreferrer">{work.data.final_url}</a> : '尚未登记' },
          { label: '发布时间', children: formatDateTime(work.data.published_at) },
          { label: '关闭信息', children: work.data.close_reason ? <><StatusTag status={work.data.close_reason} /> {work.data.close_comment}</> : '—' },
        ]} />
        <section><Typography.Title level={5}>核验历史</Typography.Title><List dataSource={work.data.verifications} locale={{ emptyText: '尚无核验记录' }} renderItem={(item) => <List.Item><List.Item.Meta title={<Space><StatusTag status={item.outcome} /><time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time></Space>} description={item.comment || '未填写说明'} /></List.Item>} /></section>
        <section><Typography.Title level={5}>工作事件</Typography.Title><List dataSource={work.data.events} renderItem={(item) => <List.Item><List.Item.Meta title={`${item.action} · ${formatDateTime(item.created_at)}`} description={<><StatusTag status={item.to_status} /> {item.comment}</>} /></List.Item>} /></section>
      </Space>
    );
  } else if (tab === 'articles' && article.data) {
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
  } else if (tab === 'issues' && issue.data) {
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
  const data = tab === 'works' ? work.data : tab === 'articles' ? article.data : issue.data;
  return (
    <Drawer
      open={!!selected}
      title={title}
      size={screens.md ? 680 : '100%'}
      onClose={onClose}
      extra={data && (
        <ActionButtons
          resource={data}
          label={data.content_title}
          onAction={(action) => onAction({ kind: tab === 'works' ? 'work' : tab === 'articles' ? 'article' : 'issue', resource: data, action } as ActionTarget)}
        />
      )}
    >
      {content}
    </Drawer>
  );
}

export function PublicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const rawTab = searchParams.get('tab');
  const tab: PublicationTab = rawTab === 'articles' || rawTab === 'issues' ? rawTab : 'works';
  const page = validPage(searchParams.get('page'));
  const selected = searchParams.get('selected');
  const rawStatus = searchParams.get('status');
  const workStatus = workStatuses.includes(rawStatus as Schema<'PublicationWorkStatus'>)
    ? rawStatus as Schema<'PublicationWorkStatus'>
    : undefined;
  const issueStatus: Schema<'PublishedContentIssueStatus'> = rawStatus === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
  const updateUrl = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => value === null ? next.delete(key) : next.set(key, value));
    setSearchParams(next);
  };
  const summary = useQuery({
    queryKey: queryKeys.publications.summary,
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-workbench-summary')),
  });
  const ready = useQuery({
    queryKey: queryKeys.publications.ready,
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-ready-items')),
    enabled: tab === 'works' && !workStatus,
  });
  const works = useQuery({
    queryKey: queryKeys.publications.works(page, PAGE_SIZE, workStatus),
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-works', {
      params: { query: { page, page_size: PAGE_SIZE, ...(workStatus ? { status: workStatus } : {}) } },
    })),
    enabled: tab === 'works',
  });
  const articles = useQuery({
    queryKey: queryKeys.publications.articles(page, PAGE_SIZE),
    queryFn: async () => unwrap(await api.GET('/api/v1/published-articles', { params: { query: { page, page_size: PAGE_SIZE } } })),
    enabled: tab === 'articles',
  });
  const issues = useQuery({
    queryKey: queryKeys.publications.issues(page, PAGE_SIZE, issueStatus),
    queryFn: async () => unwrap(await api.GET('/api/v1/published-content-issues', { params: { query: { page, page_size: PAGE_SIZE, status: issueStatus } } })),
    enabled: tab === 'issues',
  });

  const workColumns: TableColumnsType<WorkItem> = [
    { title: '内容', render: (_, row) => <Button type="link" onClick={() => updateUrl({ selected: row.id })}>{row.content_title} · V{row.content_version}</Button> },
    { title: '平台 / 账号', render: (_, row) => `${row.platform_profile_name} · ${row.platform_account_label}` },
    { title: '当前阶段', dataIndex: 'status', width: 140, render: (status: string) => <StatusTag status={status} /> },
    { title: '最近情况', width: 170, render: (_, row) => row.latest_verification_outcome ? <StatusTag status={row.latest_verification_outcome} /> : '尚未核验' },
    { title: '更新时间', dataIndex: 'updated_at', width: 180, render: formatDateTime },
    { title: '操作', width: 230, fixed: 'right', render: (_, row) => <ActionButtons resource={row} label={row.content_title} onAction={(action) => setActionTarget({ kind: 'work', resource: row, action: action as WorkAction })} /> },
  ];
  const articleColumns: TableColumnsType<ArticleItem> = [
    { title: '发布成果', render: (_, row) => <Button type="link" onClick={() => updateUrl({ selected: row.id })}>{row.actual_title}</Button> },
    { title: '平台 / 账号', render: (_, row) => `${row.platform_profile_name} · ${row.platform_account_label}` },
    { title: '首次核验', dataIndex: 'verified_at', width: 180, render: formatDateTime },
    { title: '健康状态', width: 120, render: (_, row) => <StatusTag status={row.retired ? 'RETIRED' : row.has_open_issue ? 'OPEN' : 'COMPLETED'} /> },
    { title: '操作', width: 220, fixed: 'right', render: (_, row) => <ActionButtons resource={row} label={row.actual_title} onAction={(action) => setActionTarget({ kind: 'article', resource: row, action: action as 'OPEN_ISSUE' })} /> },
  ];
  const issueColumns: TableColumnsType<IssueItem> = [
    { title: '内容问题', render: (_, row) => <Button type="link" onClick={() => updateUrl({ selected: row.id })}>{row.content_title}</Button> },
    { title: '类型', dataIndex: 'kind', width: 150, render: (kind: string) => <StatusTag status={kind} /> },
    { title: '状态', dataIndex: 'status', width: 110, render: (status: string) => <StatusTag status={status} /> },
    { title: '打开时间', dataIndex: 'opened_at', width: 180, render: formatDateTime },
    { title: '修复任务', width: 120, render: (_, row) => row.repair_task_id ? <Link to={`/tasks/${row.repair_task_id}`}>查看任务</Link> : '未创建' },
    { title: '操作', width: 230, fixed: 'right', render: (_, row) => <ActionButtons resource={row} label={row.content_title} onAction={(action) => setActionTarget({ kind: 'issue', resource: row, action: action as IssueAction })} /> },
  ];
  const activeQuery = tab === 'works' ? works : tab === 'articles' ? articles : issues;

  return (
    <div className="page-shell">
      <PageHeader eyebrow="人工发布与公开内容" title="发布管理" description="发布工作、只读发布成果和发布后内容问题各自拥有清晰生命周期。" />
      {summary.error ? <QueryFailure error={summary.error} onRetry={() => void summary.refetch()} /> : (
        <div className="metric-grid">
          <MetricTile icon={<SendOutlined />} label="待开始" value={summary.data?.ready_count ?? '—'} tone="data" />
          <MetricTile icon={<ReadOutlined />} label="进行中" value={summary.data?.active_count ?? '—'} />
          <MetricTile label="待核验" value={summary.data?.awaiting_verification_count ?? '—'} tone="warning" />
          <MetricTile icon={<ExclamationCircleOutlined />} label="需处理" value={summary.data?.action_required_count ?? '—'} tone="danger" />
          <MetricTile icon={<CloseCircleOutlined />} label="开放问题" value={summary.data?.open_issue_count ?? '—'} tone="danger" />
        </div>
      )}
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(key) => updateUrl({ tab: key, page: '1', selected: null, status: key === 'issues' ? 'OPEN' : null })}
          items={[
            { key: 'works', label: '发布工作' },
            { key: 'articles', label: '发布成果' },
            { key: 'issues', label: '内容问题' },
          ]}
        />
        {tab === 'works' && (
          <Select
            aria-label="发布工作状态"
            value={workStatus ?? ''}
            onChange={(value) => updateUrl({ status: value || null, page: '1', selected: null })}
            options={[{ value: '', label: '当前待处理' }, ...workStatuses.map((status) => ({ value: status, label: <StatusTag status={status} compact /> }))]}
          />
        )}
        {tab === 'issues' && (
          <Select
            aria-label="内容问题状态"
            value={issueStatus}
            onChange={(value) => updateUrl({ status: value, page: '1', selected: null })}
            options={[{ value: 'OPEN', label: '待处置' }, { value: 'RESOLVED', label: '已解决' }]}
          />
        )}
        {tab === 'works' && !workStatus && (
          <section>
            <Typography.Title level={4}>待开始</Typography.Title>
            {ready.isLoading ? <QueryLoading label="正在加载待开始内容" /> : ready.error ? <QueryFailure error={ready.error} onRetry={() => void ready.refetch()} /> : (
              <TableRegion label="待开始发布列表">
                <Table<ReadyItem>
                  rowKey={(row) => row.content_version.id}
                  size="small"
                  pagination={false}
                  dataSource={ready.data?.items}
                  locale={{ emptyText: '没有待开始内容' }}
                  columns={[
                    { title: '内容', render: (_, row) => `${row.content_version.title} · V${row.content_version.version}` },
                    { title: '目标平台', dataIndex: 'platform_profile_name' },
                    { title: '可用账号', render: (_, row) => `${row.matching_accounts.length} 个` },
                    { title: '操作', width: 160, render: (_, row) => <ActionButtons resource={row} label={row.content_version.title} onAction={(action) => setActionTarget({ kind: 'ready', resource: row, action: action as 'START' })} /> },
                  ]}
                />
              </TableRegion>
            )}
          </section>
        )}
        <section>
          <Typography.Title level={4}>{tab === 'works' ? '发布工作' : tab === 'articles' ? '发布成果' : '内容问题'}</Typography.Title>
          {activeQuery.isLoading ? <QueryLoading label="正在加载发布管理列表" /> : activeQuery.error ? <QueryFailure error={activeQuery.error} onRetry={() => void activeQuery.refetch()} /> : (
            <TableRegion label="发布管理列表">
              {tab === 'works' ? <Table<WorkItem> rowKey="id" dataSource={works.data?.items} columns={workColumns} scroll={{ x: 1050 }} pagination={{ current: page, pageSize: PAGE_SIZE, total: works.data?.total, showSizeChanger: false, onChange: (next) => updateUrl({ page: String(next), selected: null }) }} />
                : tab === 'articles' ? <Table<ArticleItem> rowKey="id" dataSource={articles.data?.items} columns={articleColumns} scroll={{ x: 900 }} pagination={{ current: page, pageSize: PAGE_SIZE, total: articles.data?.total, showSizeChanger: false, onChange: (next) => updateUrl({ page: String(next), selected: null }) }} />
                  : <Table<IssueItem> rowKey="id" dataSource={issues.data?.items} columns={issueColumns} scroll={{ x: 1000 }} pagination={{ current: page, pageSize: PAGE_SIZE, total: issues.data?.total, showSizeChanger: false, onChange: (next) => updateUrl({ page: String(next), selected: null }) }} />}
            </TableRegion>
          )}
        </section>
      </Card>
      <DetailDrawer tab={tab} selected={selected} onClose={() => updateUrl({ selected: null })} onAction={setActionTarget} />
      <ActionModal target={actionTarget} onClose={() => setActionTarget(null)} />
    </div>
  );
}
