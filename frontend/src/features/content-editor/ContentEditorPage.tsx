/** 内容版本工作台以 Markdown 为唯一编辑源，提供安全预览、修订、差异和审核。 */
import { ArrowLeftOutlined, CheckOutlined, DiffOutlined, SaveOutlined } from '@ant-design/icons';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, InputNumber, List, Modal, Row, Select, Space, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import type { ContentVersion, Schema } from '../../shared/api/types';
import { QueryLoading } from '../../shared/components/AsyncState';
import { StatusTag } from '../../shared/components/StatusTag';

function findSourceJobId(current: ContentVersion | undefined, versions: ContentVersion[]): string | undefined {
  const byId = new Map(versions.map((item) => [item.id, item]));
  let candidate = current;
  while (candidate) {
    if (candidate.source_job_id) return candidate.source_job_id;
    candidate = candidate.based_on_id ? byId.get(candidate.based_on_id) : undefined;
  }
  return undefined;
}

export function ContentEditorPage() {
  const canEdit = true;
  const canReview = true;
  const { contentVersionId = '' } = useParams();
  const [compareId, setCompareId] = useState<string>();
  const [commandName, setCommandName] = useState<'submit-review' | 'approve' | 'request-changes' | null>(null);
  const content = useQuery({ queryKey: ['content-version', contentVersionId], queryFn: async () => unwrap(await api.GET('/api/v1/content-versions/{content_version_id}', { params: { path: { content_version_id: contentVersionId } } })) });
  const versions = useQuery({ queryKey: ['content-versions', content.data?.task_id], queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/content-versions', { params: { path: { content_task_id: content.data?.task_id ?? '' } } })), enabled: !!content.data?.task_id });
  const sourceJobId = findSourceJobId(content.data, versions.data?.items ?? []);
  const sourceJob = useQuery({ queryKey: ['generation-job', sourceJobId], queryFn: async () => unwrap(await api.GET('/api/v1/generation-jobs/{generation_job_id}', { params: { path: { generation_job_id: sourceJobId ?? '' } } })), enabled: !!sourceJobId });
  const diff = useQuery({ queryKey: ['content-diff', contentVersionId, compareId], queryFn: async () => unwrap(await api.GET('/api/v1/content-versions/{content_version_id}/compare/{other_version_id}', { params: { path: { content_version_id: contentVersionId, other_version_id: compareId ?? '' } } })), enabled: !!compareId });
  const revise = useMutation({ mutationFn: async (body: Schema<'ContentRevisionCreate'>) => unwrap(await api.POST('/api/v1/content-versions/{content_version_id}/revisions', { params: { path: { content_version_id: contentVersionId }, header: csrfHeader() }, body })), onSuccess: async (created) => { await queryClient.invalidateQueries({ queryKey: ['content-versions', created.task_id] }); window.location.assign(`/content/${created.id}`); } });
  const command = useMutation({ mutationFn: async (body: Schema<'CommandRequest'>) => { if (!commandName) throw new Error('未选择审核操作'); const path = commandName === 'submit-review' ? '/api/v1/content-versions/{content_version_id}/submit-review' as const : commandName === 'approve' ? '/api/v1/content-versions/{content_version_id}/approve' as const : '/api/v1/content-versions/{content_version_id}/request-changes' as const; return unwrap(await api.POST(path, { params: { path: { content_version_id: contentVersionId }, header: csrfHeader() }, body })); }, onSuccess: async () => { setCommandName(null); await queryClient.invalidateQueries({ queryKey: ['content-version', contentVersionId] }); } });
  if (content.isLoading) return <QueryLoading />;
  if (!content.data) return <Alert type="error" message={errorMessage(content.error)} />;
  const current = content.data;
  const safeHtml = DOMPurify.sanitize(marked.parse(current.body_markdown) as string);
  return <div className="page-stack"><Link to={`/tasks/${current.task_id}`}><ArrowLeftOutlined /> 返回内容任务</Link><header className="page-heading"><div><Typography.Text className="eyebrow">CONTENT VERSION / V{current.version}</Typography.Text><Typography.Title>{current.title}</Typography.Title><Typography.Paragraph>{current.source_type === 'AI' ? 'AI 草稿' : '人工修订'} · 哈希 {current.content_hash.slice(0, 12)}</Typography.Paragraph></div><Space wrap><StatusTag status={current.status} />{canEdit && ['DRAFT','CHANGES_REQUESTED'].includes(current.status) && <Button onClick={() => setCommandName('submit-review')}>提交审核</Button>}{canReview && current.status === 'PENDING_REVIEW' && <><Button type="primary" icon={<CheckOutlined />} onClick={() => setCommandName('approve')}>批准</Button><Button danger onClick={() => setCommandName('request-changes')}>退回</Button></>}</Space></header>
    {(revise.error || command.error || sourceJob.error) && <Alert type="error" showIcon message={errorMessage(revise.error ?? command.error ?? sourceJob.error)} />}
    {current.quality_issues.length > 0 && <Card title="质量检查"><List dataSource={current.quality_issues} renderItem={(issue) => <List.Item><Space><Tag color={issue.severity === 'BLOCKING' ? 'red' : 'gold'}>{issue.severity === 'BLOCKING' ? '阻断' : '警告'}</Tag><Typography.Text code>{issue.code}</Typography.Text><span>{issue.message}</span></Space></List.Item>} /></Card>}
    <Tabs items={[
      { key: 'edit', label: canEdit ? '编辑与预览' : '安全预览', children: <Row gutter={[16, 16]}>{canEdit && <Col xs={24} xl={12}><Card title="创建人工修订"><RevisionForm content={current} loading={revise.isPending} onSubmit={(body) => revise.mutate(body)} /></Card></Col>}<Col xs={24} xl={canEdit ? 12 : 24}><Card title="当前版本安全预览"><article className="markdown-preview" dangerouslySetInnerHTML={{ __html: safeHtml }} /></Card></Col></Row> },
      { key: 'compare', label: '版本比较', children: <Card title="Markdown 行级差异" extra={<Select aria-label="选择比较版本" placeholder="选择另一版本" value={compareId} onChange={setCompareId} style={{ width: 260 }} options={versions.data?.items.filter((item) => item.id !== current.id).map((item) => ({ value: item.id, label: `V${item.version} · ${item.title}` }))} />}><div className="diff-view">{diff.data?.lines.map((line, index) => <div className={`diff-line diff-${line.kind.toLowerCase()}`} key={`${line.kind}-${index}`}><span>{line.old_line ?? ''}</span><span>{line.new_line ?? ''}</span><code>{line.kind === 'ADD' ? '+' : line.kind === 'DELETE' ? '-' : ' '} {line.text}</code></div>) ?? <Typography.Text type="secondary"><DiffOutlined /> 选择版本后查看差异</Typography.Text>}</div></Card> },
      { key: 'trace', label: '事实追溯', children: <Card><Typography.Paragraph>绑定事实版本：<Typography.Text code>{current.fact_version_id}</Typography.Text></Typography.Paragraph><Typography.Paragraph type="secondary">事实与 Prompt 追溯来自源生成作业的服务端快照，不依赖模型自报标识。</Typography.Paragraph>{sourceJob.data && <Space direction="vertical" size="middle" style={{ width: '100%' }}><Typography.Text>渠道 / 模型：{String(sourceJob.data.input_snapshot.channel.name)} / {String(sourceJob.data.input_snapshot.model.model_id)}</Typography.Text><Typography.Text>请求参数：</Typography.Text><pre>{JSON.stringify(sourceJob.data.input_snapshot.model.request_parameters, null, 2)}</pre><Typography.Text>System Message：</Typography.Text><Input.TextArea rows={8} readOnly value={sourceJob.data.input_snapshot.system_message} /><Typography.Text>User Message：</Typography.Text><Input.TextArea rows={10} readOnly value={sourceJob.data.input_snapshot.user_message} /></Space>}</Card> },
    ]} />
    <Modal title="确认审核操作" open={!!commandName} footer={null} onCancel={() => setCommandName(null)} destroyOnHidden><Typography.Paragraph type="secondary">服务端会检查阻断质量问题、绑定事实状态和审核状态机；允许创建者自行批准。</Typography.Paragraph><Form<Schema<'CommandRequest'>> layout="vertical" initialValues={{ expected_revision: current.revision, comment: '' }} onFinish={(body) => command.mutate(body)}><Form.Item name="expected_revision" hidden><InputNumber /></Form.Item><Form.Item name="comment" label="审核意见"><Input.TextArea rows={4} /></Form.Item><Button type="primary" htmlType="submit" loading={command.isPending}>确认</Button></Form></Modal>
  </div>;
}

function RevisionForm({ content, loading, onSubmit }: { content: ContentVersion; loading: boolean; onSubmit: (body: Schema<'ContentRevisionCreate'>) => void }) {
  const [markdown, setMarkdown] = useState(content.body_markdown);
  const preview = DOMPurify.sanitize(marked.parse(markdown) as string);
  return <Form<Schema<'ContentRevisionCreate'>> layout="vertical" initialValues={{ title: content.title, summary: content.summary, body_markdown: content.body_markdown, tags: content.tags }} onFinish={onSubmit}><Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="summary" label="摘要" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="body_markdown" label="Markdown 正文" rules={[{ required: true }]}><Input.TextArea rows={18} className="markdown-source" onChange={(event) => setMarkdown(event.target.value)} /></Form.Item><Form.Item name="tags" label="标签"><Select mode="tags" /></Form.Item><Form.Item name="change_summary" label="变更说明" rules={[{ required: true }]}><Input /></Form.Item><details><summary>预览本次修订</summary><article className="markdown-preview compact" dangerouslySetInnerHTML={{ __html: preview }} /></details><Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading}>创建新版本</Button></Form>;
}
