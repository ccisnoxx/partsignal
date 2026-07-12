/** 内容审核页只消费服务端冻结审核上下文，Markdown 仍是唯一可编辑正文源。 */
import { ArrowLeftOutlined, CheckOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import type { ContentVersion, Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';

type ReviewAction = Schema<'ContentReviewAction'>;
type ReviewCommand = Pick<Schema<'CommandRequest'>, 'expected_revision' | 'comment'>;

const actionLabels: Record<ReviewAction, string> = {
  SUBMIT_REVIEW: '提交审核',
  APPROVE: '批准内容',
  REQUEST_CHANGES: '退回修改',
};

export function ContentEditorPage() {
  const { contentVersionId = '' } = useParams();
  const [action, setAction] = useState<ReviewAction>();
  const context = useQuery({
    queryKey: ['content-review-context', contentVersionId],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/content-versions/{content_version_id}/review-context', {
          params: { path: { content_version_id: contentVersionId } },
        }),
      ),
  });
  const revise = useMutation({
    mutationFn: async (body: Schema<'ContentRevisionCreate'>) =>
      unwrap(
        await api.POST('/api/v1/content-versions/{content_version_id}/revisions', {
          params: { path: { content_version_id: contentVersionId }, header: csrfHeader() },
          body,
        }),
      ),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['content-versions', created.task_id] });
      window.location.assign(`/content/${created.id}`);
    },
  });
  const command = useMutation({
    mutationFn: async (body: ReviewCommand) => {
      if (!action) throw new Error('未选择审核操作');
      if (action === 'SUBMIT_REVIEW') {
        return unwrap(
          await api.POST('/api/v1/content-versions/{content_version_id}/submit-review', {
            params: { path: { content_version_id: contentVersionId }, header: csrfHeader() },
            body,
          }),
        );
      }
      if (action === 'APPROVE') {
        return unwrap(
          await api.POST('/api/v1/content-versions/{content_version_id}/approve', {
            params: { path: { content_version_id: contentVersionId }, header: csrfHeader() },
            body,
          }),
        );
      }
      return unwrap(
        await api.POST('/api/v1/content-versions/{content_version_id}/request-changes', {
          params: { path: { content_version_id: contentVersionId }, header: csrfHeader() },
          body,
        }),
      );
    },
    onSuccess: async () => {
      setAction(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['content-review-context', contentVersionId] }),
        queryClient.invalidateQueries({ queryKey: ['content-version', contentVersionId] }),
      ]);
    },
  });
  if (context.isLoading) return <QueryLoading />;
  if (context.error || !context.data) {
    return <QueryFailure error={context.error ?? new Error('内容审核上下文不存在')} />;
  }
  const review = context.data;
  const current = review.content;
  const fact = review.fact_version.snapshot;
  const evidenceStatus = new Map(
    review.evidence_statuses.map((item) => [item.client_key, item.file_status]),
  );
  const safeHtml = DOMPurify.sanitize(marked.parse(current.body_markdown) as string);
  return (
    <div className="page-stack">
      <Link className="back-link" to={`/tasks/${current.task_id}`}><ArrowLeftOutlined /> 返回内容任务</Link>
      <PageHeader
        eyebrow={`CONTENT VERSION / V${current.version}`}
        title={current.title}
        description={<>{current.source_type === 'AI' ? 'AI 草稿' : '人工修订'} · 哈希 <span className="data-code">{current.content_hash.slice(0, 12)}</span></>}
        breadcrumbs={[{ title: <Link to="/tasks">内容任务</Link> }, { title: `V${current.version} 审核` }]}
        actions={<>
          <StatusTag status={current.status} />
          {review.available_actions.map((item) => (
            <Button
              key={item}
              type={item === 'APPROVE' ? 'primary' : 'default'}
              danger={item === 'REQUEST_CHANGES'}
              icon={item === 'APPROVE' ? <CheckOutlined /> : undefined}
              onClick={() => setAction(item)}
            >
              {actionLabels[item]}
            </Button>
          ))}
        </>}
      />
      {(revise.error || command.error) && (
        <Alert role="alert" type="error" showIcon message={errorMessage(revise.error ?? command.error)} />
      )}
      <section className="review-summary" aria-label="审核摘要">
        <div><span>状态</span><strong><StatusTag status={current.status} /></strong></div>
        <div><span>质量问题</span><strong className="data-code">{current.quality_issues.length}</strong></div>
        <div><span>冻结事实</span><strong className="data-code">V{review.fact_version.version}</strong></div>
        <div><span>审核记录</span><strong className="data-code">{review.review_history.length}</strong></div>
      </section>
      <Row gutter={[16, 16]} className="review-cockpit">
        <Col xs={24} xl={16}>
          <div className="review-document-grid">
            <Card title="当前 Markdown 正文" className="review-document-card">
              <Input.TextArea aria-label="当前 Markdown 正文" rows={18} readOnly value={current.body_markdown} className="markdown-source" />
            </Card>
            <Card title="安全预览" className="review-document-card">
              <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: safeHtml }} />
            </Card>
          </div>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="审核决策依据" className="decision-rail">
            <Descriptions size="small" column={1} items={[
              { label: '事实版本', children: <span className="data-code">V{review.fact_version.version}</span> },
              { label: '证据数量', children: <span className="data-code">{fact.evidences.length}</span> },
              { label: '内容哈希', children: <span className="data-code">{current.content_hash.slice(0, 12)}</span> },
            ]} />
            <Typography.Title level={5}>质量问题</Typography.Title>
            {current.quality_issues.length === 0 ? <Alert type="success" showIcon message="当前版本没有质量问题" /> : (
              <List dataSource={current.quality_issues} renderItem={(issue) => <List.Item><Space align="start"><Tag color={issue.severity === 'BLOCKING' ? 'red' : 'gold'}>{issue.severity === 'BLOCKING' ? '阻断' : '警告'}</Tag><div><Typography.Text code>{issue.code}</Typography.Text><Typography.Paragraph>{issue.message}</Typography.Paragraph></div></Space></List.Item>} />
            )}
          </Card>
        </Col>
      </Row>
      <Card title="相对源版本的 Markdown 差异" className="workspace-panel">
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
          <Typography.Text type="secondary">首个版本没有可比较的源版本。</Typography.Text>
        )}
      </Card>
      <Card title={`任务锁定事实 V${review.fact_version.version}`} className="workspace-panel">
        <Descriptions
          column={1}
          items={[
            { label: '事实版本 ID', children: review.fact_version.id },
            { label: '变更说明', children: review.fact_version.change_summary },
            { label: '事实状态', children: <StatusTag status={review.fact_version.status} /> },
          ]}
        />
        <Typography.Title level={5}>关键参数与测试条件</Typography.Title>
        <List
          dataSource={fact.parameters}
          renderItem={(item) => (
            <List.Item>
              <Descriptions
                size="small"
                column={1}
                items={[
                  { label: item.name, children: item.text_value ?? item.typical_value ?? `${item.min_value ?? '—'} ～ ${item.max_value ?? '—'} ${item.unit}` },
                  { label: '测试条件', children: item.test_conditions },
                  { label: '证据键', children: item.evidence_keys.join('、') || '无' },
                ]}
              />
            </List.Item>
          )}
        />
        <Typography.Title level={5}>替代等级、适用条件与排除边界</Typography.Title>
        <List
          dataSource={fact.replacement_relations}
          locale={{ emptyText: '没有替代关系' }}
          renderItem={(item) => (
            <List.Item>
              <Descriptions
                size="small"
                column={1}
                items={[
                  { label: '替代等级', children: <StatusTag status={item.replacement_level} /> },
                  { label: '适用条件', children: item.conditions },
                  { label: '排除边界', children: item.exclusions },
                ]}
              />
            </List.Item>
          )}
        />
        <Typography.Title level={5}>绑定证据及文件状态</Typography.Title>
        <List
          dataSource={fact.evidences}
          locale={{ emptyText: '锁定事实没有证据' }}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical">
                <Space>
                  <strong>{item.title}</strong>
                  <StatusTag status={item.confidentiality} />
                  <StatusTag status={evidenceStatus.get(item.client_key) ?? 'URL_ONLY'} />
                </Space>
                <Typography.Text type="secondary">
                  {item.type} · {item.version} · {item.source_url ?? '无公开 URL'}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      </Card>
      {review.generation_trace && (
        <Card title="生成追溯" className="workspace-panel">
          <Descriptions
            column={1}
            items={[
              { label: '生成作业', children: review.generation_trace.job_id },
              { label: '适配器', children: review.generation_trace.input_snapshot.adapter_name },
              { label: '模型', children: String(review.generation_trace.input_snapshot.model.model_id) },
              { label: '冻结事实版本', children: String(review.generation_trace.input_snapshot.approved_facts.fact_version_id) },
            ]}
          />
        </Card>
      )}
      <Card title="完整审核历史" className="workspace-panel">
        <Timeline
          items={review.review_history.map((item) => ({
            children: (
              <>
                <Space>
                  <StatusTag status={item.action} />
                  <strong>{item.actor.display_name}</strong>
                  <Typography.Text type="secondary">V{item.target_version}</Typography.Text>
                </Space>
                <Typography.Paragraph>{item.comment || '未填写意见'}</Typography.Paragraph>
                <Typography.Text type="secondary">
                  {new Date(item.created_at).toLocaleString('zh-CN')}
                </Typography.Text>
              </>
            ),
          }))}
        />
      </Card>
      {current.status !== 'APPROVED' && current.status !== 'SUPERSEDED' && (
        <Card title="创建人工修订">
          <RevisionForm
            content={current}
            loading={revise.isPending}
            onSubmit={(body) => revise.mutate(body)}
          />
        </Card>
      )}
      <Modal
        title={action ? actionLabels[action] : '审核操作'}
        open={!!action}
        footer={null}
        onCancel={() => setAction(undefined)}
        destroyOnHidden
      >
        {action === 'APPROVE' && (
          <Alert
            type="warning"
            showIcon
            message="请显式确认批准"
            description="批准后该不可变版本可进入人工发布；服务端仍会复核锁定事实和阻断质量问题。"
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
            rules={action === 'REQUEST_CHANGES' ? [{ required: true, whitespace: true, message: '退回必须填写意见' }] : []}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={command.isPending}>
            {action === 'APPROVE' ? '确认批准' : '确认'}
          </Button>
        </Form>
      </Modal>
    </div>
  );
}

function RevisionForm({
  content,
  loading,
  onSubmit,
}: {
  content: ContentVersion;
  loading: boolean;
  onSubmit: (body: Schema<'ContentRevisionCreate'>) => void;
}) {
  const [markdown, setMarkdown] = useState(content.body_markdown);
  const preview = DOMPurify.sanitize(marked.parse(markdown) as string);
  return (
    <Form<Schema<'ContentRevisionCreate'>>
      layout="vertical"
      initialValues={{
        title: content.title,
        summary: content.summary,
        body_markdown: content.body_markdown,
        tags: content.tags,
      }}
      onFinish={onSubmit}
    >
      <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="summary" label="摘要" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
      <Form.Item name="body_markdown" label="Markdown 正文" rules={[{ required: true }]}>
        <Input.TextArea rows={18} className="markdown-source" onChange={(event) => setMarkdown(event.target.value)} />
      </Form.Item>
      <Form.Item name="tags" label="标签"><Select mode="tags" /></Form.Item>
      <Form.Item name="change_summary" label="变更说明" rules={[{ required: true }]}><Input /></Form.Item>
      <details>
        <summary>预览本次修订</summary>
        <article className="markdown-preview compact" dangerouslySetInnerHTML={{ __html: preview }} />
      </details>
      <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading}>
        创建新版本
      </Button>
    </Form>
  );
}
