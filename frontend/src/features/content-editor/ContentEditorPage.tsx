/** 内容审核页只消费服务端冻结审核上下文，Markdown 仍是唯一可编辑正文源。 */
import {
  ArrowLeftOutlined,
  CheckOutlined,
  CodeOutlined,
  EditOutlined,
  EyeOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  HistoryOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { ContentVersion, Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { renderSanitizedMarkdown } from '../../shared/markdown';
import { RevisionForm } from './RevisionForm';

type ReviewAction = Schema<'ContentReviewAction'>;
type ReviewCommand = Pick<Schema<'CommandRequest'>, 'expected_revision' | 'comment'>;
type ReviewContext = Schema<'ContentReviewContext'>;
type QualityIssue = Schema<'QualityIssue'>;

const actionLabels: Record<ReviewAction, string> = {
  SUBMIT_REVIEW: '提交审核',
  APPROVE: '批准内容',
  REQUEST_CHANGES: '退回修改',
};

const formatDateTime = (value: string) => new Date(value).toLocaleString('zh-CN');

function QualityIssueGroup({ title, severity, issues }: { title: string; severity: QualityIssue['severity']; issues: QualityIssue[] }) {
  return (
    <section className={`quality-issue-group quality-issue-${severity.toLowerCase()}`} aria-label={title}>
      <header>
        <Space size={8}><StatusTag status={severity} /><strong>{title}</strong></Space>
        <span className="quality-issue-count data-code">{issues.length}</span>
      </header>
      {issues.length === 0 ? (
        <Typography.Text type="secondary">当前没有此类问题。</Typography.Text>
      ) : (
        <ul className="review-data-list">
          {issues.map((issue) => (
            <li key={issue.code}>
              <div className="quality-issue-copy">
                <Typography.Text code>{issue.code}</Typography.Text>
                <Typography.Paragraph>{issue.message}</Typography.Paragraph>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FactEvidencePanel({ review }: { review: ReviewContext }) {
  const fact = review.fact_version;
  const safeHtml = renderSanitizedMarkdown(fact.body_markdown);
  return (
    <section id="review-facts" className="review-side-panel" aria-label="冻结产品事实">
      <Descriptions
        size="small"
        column={1}
        items={[
          { label: '冻结事实', children: <span className="data-code">V{fact.version}</span> },
          { label: '事实状态', children: <StatusTag status={fact.status} /> },
          { label: '数据分级', children: <StatusTag status={fact.classification} /> },
          { label: '变更说明', children: fact.change_summary },
        ]}
      />
      <Divider titlePlacement="left" plain>不可变 Markdown</Divider>
      <article className="markdown-preview review-reading-surface" dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </section>
  );
}

function ReviewHistoryPanel({ review }: { review: ReviewContext }) {
  return (
    <section id="review-history" className="review-side-panel" aria-label="完整审核历史">
      {review.review_history.length === 0 ? (
        <Typography.Text type="secondary">当前版本链尚无审核记录。</Typography.Text>
      ) : (
        <Timeline
          items={review.review_history.map((item) => ({
            content: (
              <div className="review-history-entry">
                <Space wrap size={6}>
                  <StatusTag status={item.action} />
                  <strong>{item.actor.display_name}</strong>
                  <Typography.Text type="secondary">V{item.target_version}</Typography.Text>
                </Space>
                <Typography.Paragraph>{item.comment || '未填写意见'}</Typography.Paragraph>
                <Typography.Text type="secondary">{formatDateTime(item.created_at)}</Typography.Text>
              </div>
            ),
          }))}
        />
      )}
    </section>
  );
}

function TraceContext({ review }: { review: ReviewContext }) {
  if (!review.generation_trace && review.humanization_traces.length === 0) return null;
  return (
    <section id="review-trace" className="review-context-section" aria-label="AI 追溯">
      <Typography.Title level={5}>AI 追溯</Typography.Title>
      {review.generation_trace && (
        <Descriptions
          size="small"
          column={1}
          items={[
            { label: '生成作业', children: <span className="data-code">{review.generation_trace.job_id.slice(0, 8)}</span> },
            { label: '适配器', children: review.generation_trace.input_snapshot.adapter_name },
            { label: '模型', children: String(review.generation_trace.input_snapshot.model.model_id) },
          ]}
        />
      )}
      {review.humanization_traces.map((trace, index) => (
        <Descriptions
          key={trace.job_id}
          size="small"
          column={1}
          title={`自然化 ${index + 1}`}
          items={[
            { label: '自然化作业', children: <span className="data-code">{trace.job_id.slice(0, 8)}</span> },
            { label: '源版本', children: <span className="data-code">{trace.source_content_version_id.slice(0, 8)}</span> },
            { label: '模型', children: String(trace.input_snapshot.model.model_id) },
            { label: 'Prompt revision', children: trace.input_snapshot.humanization_prompt.revision },
          ]}
        />
      ))}
    </section>
  );
}

function DiffPanel({ review }: { review: ReviewContext }) {
  return (
    <section id="review-diff" aria-label="版本差异">
      {review.diff ? (
        <div className="diff-view">
          {review.diff.lines.map((line, index) => (
            <div className={`diff-line diff-${line.kind.toLowerCase()}`} key={`${line.kind}-${index}`}>
              <span>{line.old_line ?? ''}</span>
              <span>{line.new_line ?? ''}</span>
              <code>{line.kind === 'ADD' ? '+' : line.kind === 'DELETE' ? '-' : ' '} {line.text}</code>
            </div>
          ))}
        </div>
      ) : (
        <Alert type="info" showIcon title="首个版本没有可比较的源版本" />
      )}
    </section>
  );
}

export function ContentEditorPage() {
  const { contentVersionId = '' } = useParams();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [action, setAction] = useState<ReviewAction>();
  const [revisionDirty, setRevisionDirty] = useState(false);
  const [savedDraft, setSavedDraft] = useState<{ id: string; revision: number }>();
  const revisionDirtyRef = useRef(false);
  const [modal, modalContext] = Modal.useModal();
  const [queueOpen, setQueueOpen] = useState(() => window.matchMedia('(min-width: 769px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 769px)');
    const syncQueueDisclosure = () => setQueueOpen(media.matches);
    media.addEventListener('change', syncQueueDisclosure);
    return () => media.removeEventListener('change', syncQueueDisclosure);
  }, []);
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!revisionDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);
  const context = useQuery({
    queryKey: queryKeys.contentVersions.review(contentVersionId),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-versions/{content_version_id}/review-context', {
      params: { path: { content_version_id: contentVersionId } },
    })),
    staleTime: QUERY_STALE_TIME.detail,
  });
  const taskId = context.data?.content.task_id ?? '';
  const versions = useQuery({
    queryKey: queryKeys.contentTasks.versions(taskId),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/content-versions', {
      params: { path: { content_task_id: taskId } },
    })),
    enabled: taskId !== '',
    staleTime: QUERY_STALE_TIME.detail,
  });
  const tasks = useQuery({
    queryKey: queryKeys.contentTasks.all,
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks')),
    enabled: taskId !== '',
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const revise = useMutation({
    mutationFn: async (body: Schema<'ContentRevisionCreate'>) => unwrap(await api.POST('/api/v1/content-versions/{content_version_id}/revisions', {
      params: { path: { content_version_id: contentVersionId }, header: csrfHeader() },
      body,
    })),
    onSuccess: async (created) => {
      revisionDirtyRef.current = false;
      setRevisionDirty(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.versions(created.task_id) });
      window.location.assign(`/content/${created.id}`);
    },
  });
  const saveDraft = useMutation({
    mutationFn: async (body: Schema<'ContentRevisionCreate'>) => unwrap(await api.PUT('/api/v1/content-versions/{content_version_id}', {
      params: { path: { content_version_id: contentVersionId }, header: csrfHeader() },
      body: {
        expected_revision: context.data!.content.revision,
        title: body.title,
        summary: body.summary,
        body_markdown: body.body_markdown,
        tags: body.tags,
      },
    })),
    onSuccess: async (saved) => {
      setRevisionDirtyState(false);
      setSavedDraft({ id: saved.id, revision: saved.revision });
      message.success('人工草稿已保存');
      queryClient.setQueryData<ReviewContext>(queryKeys.contentVersions.review(contentVersionId), (current) => current
        ? { ...current, content: saved }
        : current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.versions(saved.task_id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentVersions.detail(saved.id) }),
      ]);
    },
  });
  const deleteDraft = useMutation({
    mutationFn: async (version: ContentVersion) => ensureSuccess(await api.DELETE('/api/v1/content-versions/{content_version_id}', {
      params: {
        path: { content_version_id: version.id },
        query: { expected_revision: version.revision },
        header: csrfHeader(),
      },
    })),
    onSuccess: async (_, version) => {
      setRevisionDirtyState(false);
      message.success('人工未审核草稿已删除');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.versions(version.task_id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(version.task_id) }),
      ]);
      navigate(`/tasks/${version.task_id}`);
    },
  });
  const command = useMutation({
    mutationFn: async (body: ReviewCommand) => {
      if (!action) throw new Error('未选择审核操作');
      if (action === 'SUBMIT_REVIEW') {
        return unwrap(await api.POST('/api/v1/content-versions/{content_version_id}/submit-review', {
          params: { path: { content_version_id: contentVersionId }, header: csrfHeader() }, body,
        }));
      }
      if (action === 'APPROVE') {
        return unwrap(await api.POST('/api/v1/content-versions/{content_version_id}/approve', {
          params: { path: { content_version_id: contentVersionId }, header: csrfHeader() }, body,
        }));
      }
      return unwrap(await api.POST('/api/v1/content-versions/{content_version_id}/request-changes', {
        params: { path: { content_version_id: contentVersionId }, header: csrfHeader() }, body,
      }));
    },
    onSuccess: async () => {
      message.success(action ? `${actionLabels[action]}已完成` : '内容状态已更新');
      setAction(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contentVersions.review(contentVersionId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentVersions.detail(contentVersionId) }),
      ]);
    },
  });
  const abandon = useMutation({
    mutationFn: async (version: ContentVersion) => unwrap(await api.POST('/api/v1/content-versions/{content_version_id}/abandon', {
      params: { path: { content_version_id: version.id }, header: csrfHeader() },
      body: { expected_revision: version.revision, comment: '用户确认放弃当前内容版本' },
    })),
    onSuccess: async (version) => {
      message.success('当前内容版本已放弃');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.versions(version.task_id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(version.task_id) }),
      ]);
      navigate(`/tasks/${version.task_id}`);
    },
  });
  const setRevisionDirtyState = (dirty: boolean) => {
    revisionDirtyRef.current = dirty;
    setRevisionDirty(dirty);
  };
  const handleWorkspaceNavigation = (event: ReactMouseEvent<HTMLAnchorElement>, destination: string) => {
    if (!revisionDirty) return;
    event.preventDefault();
    modal.confirm({
      title: '放弃未保存的内容修订？',
      content: '离开后，本次尚未创建为新版本的 Markdown 修订不会保留。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: () => {
        setRevisionDirtyState(false);
        navigate(destination);
      },
    });
  };
  if (context.isLoading) return <div className="page-stack content-review-page"><PageHeader title="内容审核" breadcrumbs={[{ title: <Link to="/tasks">内容任务</Link> }, { title: '内容审核' }]} /><QueryLoading label="正在加载内容审核上下文" /></div>;
  if (context.error || !context.data) {
    return (
      <div className="page-stack content-review-page">
        <Link className="back-link" to="/tasks"><ArrowLeftOutlined aria-hidden /> 返回任务列表</Link>
        <PageHeader title="内容审核" breadcrumbs={[{ title: <Link to="/tasks">内容任务</Link> }, { title: '内容审核' }]} />
        <QueryFailure error={context.error ?? new Error('内容审核上下文不存在')} onRetry={() => void context.refetch()} />
      </div>
    );
  }

  const review = context.data;
  const current = review.content;
  const canSave = current.available_actions.includes('SAVE');
  const canRevise = current.available_actions.includes('CREATE_REVISION');
  const editorMode = canSave ? 'save' : canRevise ? 'revision' : undefined;
  const blockingIssues = current.quality_issues.filter((issue) => issue.severity === 'BLOCKING');
  const warningIssues = current.quality_issues.filter((issue) => issue.severity === 'WARNING');
  const safeHtml = renderSanitizedMarkdown(current.body_markdown);
  const taskSummary = tasks.data?.items.find((item) => item.id === current.task_id);
  const actionPending = command.isPending || revise.isPending || saveDraft.isPending || deleteDraft.isPending;
  const documentOverview = (
    <section className="review-document-overview" aria-label="内容摘要与标签">
      <div>
        <Typography.Text strong>摘要</Typography.Text>
        <Typography.Paragraph>{current.summary}</Typography.Paragraph>
      </div>
      <div>
        <Typography.Text strong>标签</Typography.Text>
        <Space wrap>{current.tags.length ? current.tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Typography.Text type="secondary">无标签</Typography.Text>}</Space>
      </div>
    </section>
  );

  return (
    <div className="page-stack content-review-page">
      {modalContext}
      <div className="content-review-topbar">
        <Link className="back-link" to={`/tasks/${current.task_id}`} onClick={(event) => handleWorkspaceNavigation(event, `/tasks/${current.task_id}`)}><ArrowLeftOutlined aria-hidden /> 返回内容任务</Link>
        <span>内容编辑与审核</span>
      </div>

      <div className="content-review-layout">
        <aside className="review-context-column" aria-label="内容队列">
          <Card
            size="small"
            title={<Space size={8}><FileTextOutlined aria-hidden /><span>内容队列</span></Space>}
            className="review-glass-panel review-queue-card"
          >
            <details
              className="review-queue-details"
              open={queueOpen}
              onToggle={(event) => setQueueOpen(event.currentTarget.open)}
            >
              <summary>展开同任务内容版本{versions.data ? `（${versions.data.items.length}）` : ''}</summary>
              {(versions.isLoading || tasks.isLoading) && <QueryLoading label="正在加载内容队列" />}
              {(versions.error || tasks.error) && (
                <QueryFailure
                  error={versions.error ?? tasks.error}
                  onRetry={() => {
                    void versions.refetch();
                    void tasks.refetch();
                  }}
                />
              )}
              {versions.data && tasks.data && !taskSummary && (
                <Alert type="error" showIcon title="内容队列缺少当前任务的平台名称" />
              )}
              {versions.data && taskSummary && (
                <nav className="review-queue-list" aria-label="同任务内容版本">
                  {versions.data.items.map((item) => (
                    <Link
                      key={item.id}
                      to={`/content/${item.id}`}
                      onClick={item.id === current.id ? undefined : (event) => handleWorkspaceNavigation(event, `/content/${item.id}`)}
                      className="review-queue-item"
                      aria-current={item.id === current.id ? 'page' : undefined}
                    >
                      <strong>{item.title}</strong>
                      <span className="review-queue-platform">{taskSummary.platform.name}</span>
                      <span className="review-queue-meta">
                        <span>任务 <span className="data-code">{item.task_id.slice(0, 8)}</span></span>
                        <time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time>
                      </span>
                    </Link>
                  ))}
                </nav>
              )}
            </details>
          </Card>
        </aside>

        <main className="review-document-column">
          <Card className="review-glass-panel review-document-workspace">
            <PageHeader
              eyebrow={<Space size={7}><FileProtectOutlined aria-hidden /><span>正文工作区 / Markdown · V{current.version}</span></Space>}
              title={current.title}
              description={(
                <Space wrap size={[10, 4]} className="content-review-header-meta">
                  <StatusTag status={current.source_type} />
                  <span>任务 <span className="data-code">{current.task_id.slice(0, 8)}</span></span>
                  <span>任务状态 <StatusTag status={review.task.status} /></span>
                  {taskSummary && <span>平台 · {taskSummary.platform.name}</span>}
                  <span title={current.created_by}>创建人 <span className="data-code">{current.created_by.slice(0, 8)}</span></span>
                  <time dateTime={current.created_at}>{formatDateTime(current.created_at)}</time>
                </Space>
              )}
              actions={<Space>
                <StatusTag status={current.status} />
                {current.available_actions.includes('DELETE') && <Button danger loading={deleteDraft.isPending} onClick={() => modal.confirm({
                  title: '彻底删除人工未审核草稿？',
                  content: '该草稿及未保存修改都会被永久删除，操作不可恢复。若它是当前版本，任务会恢复到直接父版本或“尚未创建首稿”。',
                  okText: '确认彻底删除',
                  cancelText: '继续编辑',
                  okButtonProps: { danger: true },
                  onOk: () => deleteDraft.mutateAsync(current),
                })}>彻底删除草稿</Button>}
                {current.available_actions.includes('ABANDON') && <Button danger loading={abandon.isPending} onClick={() => modal.confirm({
                  title: '放弃当前内容版本？',
                  content: '该版本会进入只读历史；任务将恢复到最近批准版本，没有批准版本时回到“尚未创建首稿”。此操作不可撤销。',
                  okText: '确认放弃',
                  cancelText: '继续编辑',
                  okButtonProps: { danger: true },
                  onOk: () => abandon.mutateAsync(current),
                })}>放弃当前版本</Button>}
              </Space>}
            />
            <Tabs
              className="review-document-tabs"
              defaultActiveKey={editorMode ? 'revision' : 'preview'}
              items={[
                ...(editorMode ? [{
                  key: 'revision',
                  label: <Space size={6}><EditOutlined aria-hidden />编辑</Space>,
                  children: <section id="review-revision" aria-label={editorMode === 'save' ? '编辑人工草稿' : '创建人工修订'}><RevisionForm
                    key={`${current.id}:${current.revision}:${editorMode}`}
                    content={current}
                    mode={editorMode}
                    saved={savedDraft?.id === current.id && savedDraft.revision === current.revision}
                    loading={editorMode === 'save' ? saveDraft.isPending : revise.isPending}
                    error={editorMode === 'save' ? saveDraft.error : revise.error}
                    onDirtyChange={setRevisionDirtyState}
                    onSubmit={(body) => editorMode === 'save' ? saveDraft.mutate(body) : revise.mutate(body)}
                  /></section>,
                }] : []),
                {
                  key: 'preview',
                  label: <Space size={6}><EyeOutlined aria-hidden />预览</Space>,
                  children: (
                    <>
                      {documentOverview}
                      <section id="review-content" className="review-editor-frame" aria-label="Markdown 安全预览">
                        <header><span>Markdown 正文预览</span><Typography.Text type="secondary">由 Markdown 实时派生</Typography.Text></header>
                        <article className="markdown-preview review-reading-surface" dangerouslySetInnerHTML={{ __html: safeHtml }} />
                      </section>
                    </>
                  ),
                },
                {
                  key: 'source',
                  label: <Space size={6}><CodeOutlined aria-hidden />Markdown 源文</Space>,
                  children: (
                    <>
                      {documentOverview}
                      <section className="review-editor-frame" aria-label="当前 Markdown 源文">
                        <header><span>Markdown 正文</span><Typography.Text type="secondary">当前版本只读</Typography.Text></header>
                        <Input.TextArea aria-label="当前 Markdown 正文" rows={28} readOnly value={current.body_markdown} className="markdown-source review-current-source" />
                      </section>
                    </>
                  ),
                },
                {
                  key: 'diff',
                  label: '版本差异',
                  children: <DiffPanel review={review} />,
                },
              ]}
            />
          </Card>
        </main>

        <aside className="review-decision-column" aria-label="质量检查与审核决策">
          <Card
            title={<Space size={8}><WarningOutlined aria-hidden /><span>质量与审核</span></Space>}
            className="review-glass-panel review-decision-card"
          >
            <div className="review-quality-totals" aria-label="质量问题统计">
              <div><span>阻断问题</span><strong className="data-code review-count-danger">{blockingIssues.length}</strong></div>
              <div><span>优化建议</span><strong className="data-code review-count-warning">{warningIssues.length}</strong></div>
            </div>
            {blockingIssues.length > 0 && <Alert type="error" showIcon title={`${blockingIssues.length} 个阻断问题会阻止批准`} />}
            <Tabs
              className="review-decision-tabs"
              defaultActiveKey="quality"
              items={[
                {
                  key: 'quality',
                  label: '质量检查',
                  children: <section id="review-quality" className="review-side-panel" aria-label="质量检查"><QualityIssueGroup title="阻断问题" severity="BLOCKING" issues={blockingIssues} /><QualityIssueGroup title="优化建议" severity="WARNING" issues={warningIssues} /></section>,
                },
                { key: 'facts', label: '产品事实', children: <><FactEvidencePanel review={review} /><TraceContext review={review} /></> },
                { key: 'history', label: <Space size={5}><HistoryOutlined aria-hidden />审核记录</Space>, children: <ReviewHistoryPanel review={review} /> },
              ]}
            />
            {command.error && <Alert role="alert" type="error" showIcon title="审核操作失败" description={errorMessage(command.error)} />}
            <div className="review-decision-actions">
              <Typography.Text type="secondary">操作由服务端当前状态与权限决定</Typography.Text>
              {review.available_actions.length === 0 ? (
                <Alert type="info" showIcon title="当前状态没有可执行审核操作" />
              ) : (
                <div className="review-action-grid">
                  {review.available_actions.map((item) => (
                    <Button
                      key={item}
                      type={item === 'REQUEST_CHANGES' ? 'default' : 'primary'}
                      danger={item === 'REQUEST_CHANGES'}
                      className={item === 'APPROVE' ? 'review-approve-button' : undefined}
                      icon={item === 'APPROVE' ? <CheckOutlined aria-hidden /> : undefined}
                      loading={command.isPending && action === item}
                      disabled={actionPending}
                      onClick={() => setAction(item)}
                    >
                      {actionLabels[item]}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        title={action ? actionLabels[action] : '审核操作'}
        open={!!action}
        footer={null}
        closable={!command.isPending}
        keyboard={!command.isPending}
        mask={{ closable: !command.isPending }}
        onCancel={() => !command.isPending && setAction(undefined)}
        destroyOnHidden
      >
        {action === 'APPROVE' && (
          <Alert
            type="warning"
            showIcon
            title="请显式确认批准"
            description="批准后该不可变版本可进入人工发布；服务端仍会复核冻结事实和阻断质量问题。"
          />
        )}
        <Form<ReviewCommand>
          layout="vertical"
          initialValues={{ expected_revision: current.revision, comment: '' }}
          onFinish={(body) => command.mutate(body)}
        >
          <Form.Item name="expected_revision" hidden><InputNumber /></Form.Item>
          <Form.Item
            name="comment"
            label="审核意见"
            required={action === 'REQUEST_CHANGES'}
            rules={action === 'REQUEST_CHANGES' ? [{ required: true, whitespace: true, message: '退回必须填写意见' }] : []}
          >
            <Input.TextArea rows={5} />
          </Form.Item>
          <Button type="primary" danger={action === 'REQUEST_CHANGES'} htmlType="submit" loading={command.isPending}>
            {action === 'APPROVE' ? '确认批准' : '确认'}
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
