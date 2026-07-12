/** 人工发布工作台消费服务端候选、允许动作和异常状态，不复制发布状态机。 */
import { ArrowLeftOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Timeline,
  Typography,
  message,
} from 'antd';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import type { FileRecord, PublicationRecord, Schema } from '../../shared/api/types';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

type PublicationCandidate = Schema<'PublicationCandidate'>;
type PublicationAttention = Schema<'PublicationAttention'>;
type PublicationAction = PublicationRecord['available_actions'][number];

const actionLabels: Record<PublicationAction, string> = {
  'mark-platform-review': '提交平台审核',
  'mark-published': '登记已发布',
  verify: '验证正文一致',
  reject: '平台拒绝',
  remove: '标记已移除',
  'mark-verification-failed': '标记验证失败',
};

export function PublicationsPage() {
  const { publicationId, attentionId } = useParams<{
    publicationId?: string;
    attentionId?: string;
  }>();
  const location = useLocation();
  if (attentionId && location.pathname.endsWith('/repair')) {
    return <PublicationRepairPage attentionId={attentionId} />;
  }
  if (attentionId) return <PublicationAttentionPage attentionId={attentionId} />;
  if (publicationId) return <PublicationDetailPage publicationId={publicationId} />;
  return <PublicationWorkspace />;
}

function PublicationWorkspace() {
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<PublicationCandidate>();
  const candidates = useQuery({
    queryKey: ['publication-candidates'],
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-candidates')),
  });
  const records = useQuery({
    queryKey: ['publication-records'],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-records', {
          params: { query: { page: 1, page_size: 100 } },
        }),
      ),
  });
  const attentions = useQuery({
    queryKey: ['publication-attentions', 'OPEN'],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-attentions', {
          params: { query: { status: 'OPEN' } },
        }),
      ),
  });
  const error = candidates.error ?? records.error ?? attentions.error;
  return (
    <div className="page-stack">
      <PageHeader eyebrow="HUMAN PUBLISHING" title="人工发布" description="系统只准备发布包并记录结果，不登录或操作外部平台。" />
      {error && <QueryFailure error={error} onRetry={() => { void candidates.refetch(); void records.refetch(); void attentions.refetch(); }} />}
      <section className="workspace-summary" aria-label="人工发布摘要">
        <div><span>待发布候选</span><strong className="data-code">{candidates.data?.items.length ?? 0}</strong></div>
        <div><span>开放异常</span><strong className="data-code">{attentions.data?.items.length ?? 0}</strong></div>
        <div><span>当前记录</span><strong className="data-code">{records.data?.items.length ?? 0}</strong></div>
      </section>
      <Tabs className="workspace-tabs" defaultActiveKey={attentions.data?.items.length ? 'attentions' : 'candidates'} items={[
        { key: 'candidates', label: '待发布候选', children: <Card className="workspace-panel"><TableRegion label="待发布候选列表"><Table<PublicationCandidate>
          rowKey={(row) => row.content_version.id}
          loading={candidates.isLoading}
          dataSource={candidates.data?.items}
          scroll={{ x: 760 }}
          columns={[
            { title: '标题', render: (_, row) => row.content_version.title },
            { title: '版本', render: (_, row) => `V${row.content_version.version}` },
            {
              title: '锁定平台',
              render: (_, row) => `${row.platform_profile_name} / 规则 V${row.platform_profile_version}`,
            },
            { title: '可用账号', render: (_, row) => row.matching_accounts.length },
            {
              title: '操作',
              render: (_, row) => (
                <Button
                  type="primary"
                  disabled={row.matching_accounts.length === 0}
                  onClick={() => setCandidate(row)}
                >
                  准备人工发布
                </Button>
              ),
            },
          ]}
        /></TableRegion></Card> },
        { key: 'attentions', label: '发布异常待办', children: <Card className="workspace-panel"><TableRegion label="发布异常待办列表"><Table<PublicationAttention>
          rowKey="id"
          loading={attentions.isLoading}
          dataSource={attentions.data?.items}
          scroll={{ x: 680 }}
          columns={[
            {
              title: '打开时间',
              dataIndex: 'opened_at',
              render: (value: string) => new Date(value).toLocaleString('zh-CN'),
            },
            { title: '触发状态', dataIndex: 'trigger_status', render: (value) => <StatusTag status={value} /> },
            { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
            {
              title: '操作',
              render: (_, row) => (
                <Button onClick={() => navigate(`/publication-attentions/${row.id}`)}>处理</Button>
              ),
            },
          ]}
        /></TableRegion></Card> },
        { key: 'records', label: '发布记录', children: <Card className="workspace-panel"><TableRegion label="发布记录列表"><Table<PublicationRecord>
          rowKey="id"
          loading={records.isLoading}
          dataSource={records.data?.items}
          scroll={{ x: 960 }}
          columns={[
            {
              title: '创建时间',
              dataIndex: 'created_at',
              render: (value: string) => new Date(value).toLocaleString('zh-CN'),
            },
            { title: '内容版本', dataIndex: 'content_version_id' },
            { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
            {
              title: '最终 URL',
              dataIndex: 'final_url',
              render: (url: string | null) =>
                url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    打开 <LinkOutlined />
                  </a>
                ) : (
                  '—'
                ),
            },
            {
              title: '操作',
              render: (_, row) => (
                <Button onClick={() => navigate(`/publications/${row.id}`)}>查看与更新</Button>
              ),
            },
          ]}
        /></TableRegion></Card> },
      ]} />
      {candidate && (
        <PublicationCreateModal candidate={candidate} onClose={() => setCandidate(undefined)} />
      )}
    </div>
  );
}

function PublicationCreateModal({
  candidate,
  onClose,
}: {
  candidate: PublicationCandidate;
  onClose: () => void;
}) {
  const [attachments, setAttachments] = useState<FileRecord[]>([]);
  const content = candidate.content_version;
  const packageQuery = useQuery({
    queryKey: ['publication-package', content.id],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/content-versions/{content_version_id}/publication-package', {
          params: { path: { content_version_id: content.id } },
        }),
      ),
  });
  const create = useMutation({
    mutationFn: async (values: Schema<'ManualPublicationCreate'>) =>
      unwrap(
        await api.POST('/api/v1/publication-records/manual', {
          params: {
            header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() },
          },
          body: { ...values, attachment_file_ids: attachments.map((item) => item.id) },
        }),
      ),
    onSuccess: async (created) => {
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['publication-records'] }),
        queryClient.invalidateQueries({ queryKey: ['publication-candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['content-task', created.task_id] }),
        queryClient.invalidateQueries({ queryKey: ['content-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
  });
  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    void message.success(`${label}已复制`);
  };
  return (
    <Modal title="准备人工发布" open footer={null} onCancel={onClose} width={800} destroyOnHidden>
      {create.error && <Alert type="error" message={errorMessage(create.error)} />}
      <Card size="small" title={packageQuery.data?.title ?? content.title} loading={packageQuery.isLoading}>
        <Typography.Paragraph>
          锁定平台：{candidate.platform_profile_name} / 规则 V{candidate.platform_profile_version}
        </Typography.Paragraph>
        <Space wrap>
          <Button icon={<CopyOutlined />} onClick={() => packageQuery.data && void copy(packageQuery.data.title, '标题')}>
            复制标题
          </Button>
          <Button icon={<CopyOutlined />} onClick={() => packageQuery.data && void copy(packageQuery.data.body_markdown, 'Markdown')}>
            复制 Markdown
          </Button>
          <Button icon={<CopyOutlined />} onClick={() => packageQuery.data && void copy(packageQuery.data.body_text, '纯文本')}>
            复制纯文本
          </Button>
        </Space>
        <Typography.Paragraph type="secondary">
          内容哈希：{packageQuery.data?.content_hash}
        </Typography.Paragraph>
      </Card>
      <Form<Schema<'ManualPublicationCreate'>>
        layout="vertical"
        initialValues={{ content_version_id: content.id, attachment_file_ids: [] }}
        onFinish={(body) => create.mutate(body)}
      >
        <Form.Item name="content_version_id" hidden><Input /></Form.Item>
        <Form.Item name="platform_account_id" label="匹配平台账号" rules={[{ required: true }]}>
          <Select
            options={candidate.matching_accounts.map((item) => ({
              value: item.id,
              label: `${item.label} / ${item.account_identifier}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="section_url" label="目标栏目 URL" rules={[{ required: true, type: 'url' }]}>
          <Input type="url" />
        </Form.Item>
        <Form.Item label="发布截图（可选）">
          <DirectUpload
            category="OPERATION_SCREENSHOT"
            onUploaded={(file) => setAttachments((items) => [...items, file])}
          />
          {attachments.map((file) => <StatusTag key={file.id} status={file.status} />)}
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={create.isPending}>
          登记待人工发布
        </Button>
      </Form>
    </Modal>
  );
}

function PublicationDetailPage({ publicationId }: { publicationId: string }) {
  const navigate = useNavigate();
  const [action, setAction] = useState<PublicationAction>();
  const detail = useQuery({
    queryKey: ['publication-record', publicationId],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-records/{publication_id}', {
          params: { path: { publication_id: publicationId } },
        }),
      ),
  });
  const mutate = useMutation({
    mutationFn: async (body: Schema<'PublicationCommand'>) => {
      if (!action) throw new Error('未选择发布状态');
      return unwrap(
        await api.POST('/api/v1/publication-records/{publication_id}/{command}', {
          params: { path: { publication_id: publicationId, command: action }, header: csrfHeader() },
          body,
        }),
      );
    },
    onSuccess: async (updated) => {
      setAction(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['publication-record', publicationId] }),
        queryClient.invalidateQueries({ queryKey: ['publication-records'] }),
        queryClient.invalidateQueries({ queryKey: ['publication-attentions'] }),
        queryClient.invalidateQueries({ queryKey: ['content-task', updated.task_id] }),
        queryClient.invalidateQueries({ queryKey: ['content-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
  });
  if (detail.isLoading) return <QueryLoading />;
  if (detail.error || !detail.data) return <QueryFailure error={detail.error ?? new Error('发布记录不存在')} />;
  const record = detail.data;
  return (
    <div className="page-stack">
      <Button className="back-link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/publications')}>返回发布工作台</Button>
      <PageHeader eyebrow="PUBLICATION RECORD" title="发布记录" description={<>记录 ID <span className="data-code">{record.id}</span></>} breadcrumbs={[{ title: <Link to="/publications">人工发布</Link> }, { title: '发布记录' }]} actions={<StatusTag status={record.status} />} />
      <Card title="发布上下文" className="workspace-panel">
        <Descriptions
          column={1}
          items={[
            { label: '状态', children: <StatusTag status={record.status} /> },
            { label: '内容任务', children: <Link className="data-code" to={`/tasks/${record.task_id}`}>{record.task_id}</Link> },
            { label: '内容版本', children: <span className="data-code">{record.content_version_id}</span> },
            { label: '栏目', children: record.section_url },
            { label: '最终 URL', children: record.final_url ?? '—' },
            { label: '内容哈希', children: <span className="data-code">{record.content_hash}</span> },
          ]}
        />
        <Space wrap className="command-bar">
          {record.available_actions.map((item) => (
            <Button key={item} onClick={() => setAction(item)}>{actionLabels[item]}</Button>
          ))}
        </Space>
        <Typography.Title level={5}>状态轨迹</Typography.Title><Timeline
          items={record.status_events.map((event) => ({
            children: (
              <>
                <strong><StatusTag status={event.status} /></strong> {event.comment}
                <br />
                <Typography.Text type="secondary">
                  {new Date(event.created_at).toLocaleString('zh-CN')}
                </Typography.Text>
              </>
            ),
          }))}
        />
      </Card>
      <Modal title={action ? actionLabels[action] : '更新发布状态'} open={!!action} footer={null} onCancel={() => setAction(undefined)} destroyOnHidden>
        {mutate.error && <Alert type="error" message={errorMessage(mutate.error)} />}
        <Form<Schema<'PublicationCommand'>> layout="vertical" initialValues={{ comment: '' }} onFinish={(body) => mutate.mutate(body)}>
          {action === 'mark-published' && (
            <>
              <Form.Item name="actual_title" label="实际标题" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="final_url" label="最终 URL" rules={[{ required: true, type: 'url' }]}><Input type="url" /></Form.Item>
              <Form.Item name="published_at" label="发布时间（RFC3339）" rules={[{ required: true }]}><Input placeholder="2026-07-11T10:00:00+08:00" /></Form.Item>
            </>
          )}
          {action === 'verify' && (
            <Form.Item name="content_matches" label="正文一致" rules={[{ required: true }]}>
              <Select options={[{ value: true, label: '已人工核对，与批准正文一致' }]} />
            </Form.Item>
          )}
          <Form.Item name="comment" label="说明" rules={[{ required: true }]}><Input.TextArea /></Form.Item>
          <Button type="primary" htmlType="submit" loading={mutate.isPending}>确认</Button>
        </Form>
      </Modal>
    </div>
  );
}

function PublicationAttentionPage({ attentionId }: { attentionId: string }) {
  const navigate = useNavigate();
  const [resolveOpen, setResolveOpen] = useState(false);
  const detail = useQuery({
    queryKey: ['publication-attention', attentionId],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-attentions/{attention_id}', {
          params: { path: { attention_id: attentionId } },
        }),
      ),
  });
  const resolveMutation = useMutation({
    mutationFn: async (body: Schema<'ResolvePublicationAttentionRequest'>) =>
      unwrap(
        await api.POST('/api/v1/publication-attentions/{attention_id}/resolve', {
          params: { path: { attention_id: attentionId }, header: csrfHeader() },
          body,
        }),
      ),
    onSuccess: async () => {
      setResolveOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['publication-attention', attentionId] }),
        queryClient.invalidateQueries({ queryKey: ['publication-attentions'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
  });
  if (detail.isLoading) return <QueryLoading />;
  if (detail.error || !detail.data) return <QueryFailure error={detail.error ?? new Error('发布异常不存在')} />;
  const attention = detail.data;
  return (
    <div className="page-stack">
      <Button className="back-link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/publications')}>返回发布工作台</Button>
      <PageHeader eyebrow="PUBLICATION ATTENTION" title="发布异常待办" description="异常待办保留原发布上下文，创建修复任务不会自动关闭待办。" breadcrumbs={[{ title: <Link to="/publications">人工发布</Link> }, { title: '异常待办' }]} actions={<StatusTag status={attention.status} />} />
      <Card title="异常上下文" className="workspace-panel">
        <Descriptions
          column={1}
          items={[
            { label: '状态', children: <StatusTag status={attention.status} /> },
            { label: '触发状态', children: <StatusTag status={attention.trigger_status} /> },
            { label: '原发布', children: <Link className="data-code" to={`/publications/${attention.publication_record_id}`}>{attention.publication_record_id}</Link> },
            { label: '原任务', children: <Link className="data-code" to={`/tasks/${attention.original_task_id}`}>{attention.original_task_id}</Link> },
            { label: '修复任务', children: attention.repair_task_id ? <Link className="data-code" to={`/tasks/${attention.repair_task_id}`}>{attention.repair_task_id}</Link> : '尚未创建' },
            { label: '处置说明', children: attention.resolution_comment ?? '—' },
          ]}
        />
        <Space>
          {attention.available_actions.includes('CREATE_REPAIR_TASK') && (
            <Button type="primary" onClick={() => navigate(`/publication-attentions/${attention.id}/repair`)}>
              创建修复任务
            </Button>
          )}
          {attention.available_actions.includes('RESOLVE') && (
            <Button onClick={() => setResolveOpen(true)}>显式解决</Button>
          )}
        </Space>
      </Card>
      <Modal title="解决发布异常" open={resolveOpen} footer={null} onCancel={() => setResolveOpen(false)} destroyOnHidden>
        {resolveMutation.error && <Alert type="error" message={errorMessage(resolveMutation.error)} />}
        <Form<Schema<'ResolvePublicationAttentionRequest'>>
          layout="vertical"
          initialValues={{ expected_revision: attention.revision, resolution_comment: '' }}
          onFinish={(body) => resolveMutation.mutate(body)}
        >
          <Form.Item name="expected_revision" hidden><InputNumber /></Form.Item>
          <Form.Item name="resolution_comment" label="处置说明" rules={[{ required: true, whitespace: true, message: '必须填写处置说明' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={resolveMutation.isPending}>确认解决</Button>
        </Form>
      </Modal>
    </div>
  );
}

function PublicationRepairPage({ attentionId }: { attentionId: string }) {
  const navigate = useNavigate();
  const context = useQuery({
    queryKey: ['publication-repair-context', attentionId],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-attentions/{attention_id}/repair-context', {
          params: { path: { attention_id: attentionId } },
        }),
      ),
  });
  const create = useMutation({
    mutationFn: async (body: Schema<'PublicationRepairTaskCreate'>) =>
      unwrap(
        await api.POST('/api/v1/publication-attentions/{attention_id}/repair-task', {
          params: { path: { attention_id: attentionId }, header: csrfHeader() },
          body,
        }),
      ),
    onSuccess: async (task) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['publication-attention', attentionId] }),
        queryClient.invalidateQueries({ queryKey: ['publication-attentions'] }),
        queryClient.invalidateQueries({ queryKey: ['content-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      navigate(`/tasks/${task.id}`);
    },
  });
  if (context.isLoading) return <QueryLoading />;
  if (context.error || !context.data) return <QueryFailure error={context.error ?? new Error('修复上下文不存在')} />;
  const data = context.data;
  const missingFactCandidate = data.fact_candidates.length === 0;
  const missingPlatformCandidate = data.platform_candidates.length === 0;
  return (
    <div className="page-stack">
      <Button className="back-link" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/publication-attentions/${attentionId}`)}>
        返回异常详情
      </Button>
      <PageHeader eyebrow="REPAIR TASK" title="创建发布修复任务" description="固定继承原产品、目标问题和平台，并显式选择当前事实与规则版本。" breadcrumbs={[{ title: <Link to="/publications">人工发布</Link> }, { title: <Link to={`/publication-attentions/${attentionId}`}>异常待办</Link> }, { title: '创建修复任务' }]} />
      <Card title="固定修复上下文" className="workspace-panel">
        <Descriptions
          column={1}
          items={[
            { label: '产品', children: `${data.product.brand} ${data.product.part_number}` },
            { label: '目标问题', children: data.query_topic.canonical_question },
            { label: '平台', children: data.platform_profile_name },
            { label: '原事实版本', children: `V${data.original_fact_version.version}` },
            { label: '原平台规则', children: `V${data.original_platform_version.version}` },
          ]}
        />
      </Card>
      <Card title="创建修复任务" className="workspace-panel">
        {create.error && <Alert type="error" message={errorMessage(create.error)} />}
        {missingFactCandidate && <Alert type="error" showIcon message="当前产品没有可选的已批准事实版本，无法创建修复任务。" />}
        {missingPlatformCandidate && <Alert type="error" showIcon message="原平台没有当前 ACTIVE 规则版本，无法创建修复任务。" />}
        <Form<Schema<'PublicationRepairTaskCreate'>>
          layout="vertical"
          initialValues={{
            expected_attention_revision: data.attention.revision,
            ...data.defaults,
          }}
          onFinish={(body) => create.mutate(body)}
        >
          <Form.Item name="expected_attention_revision" hidden><InputNumber /></Form.Item>
          <Form.Item name="fact_version_id" label="当前已批准事实版本" rules={[{ required: true }]}>
            <Select
              options={data.fact_candidates.map((item) => ({
                value: item.version.id,
                label: `V${item.version.version} · ${item.version.change_summary} · ${item.difference.changes.length} 项变化`,
              }))}
            />
          </Form.Item>
          <List
            size="small"
            header="事实版本差异"
            dataSource={data.fact_candidates}
            renderItem={(item) => (
              <List.Item>
                V{item.version.version}：{item.difference.changes.map((change) => change.field).join('、') || '无变化'}
              </List.Item>
            )}
          />
          <Form.Item name="platform_profile_version_id" label="当前 ACTIVE 平台规则" rules={[{ required: true }]}>
            <Select
              options={data.platform_candidates.map((item) => ({
                value: item.version.id,
                label: `V${item.version.version} · ${item.difference.changes.length} 项变化`,
              }))}
            />
          </Form.Item>
          <List
            size="small"
            header="平台规则差异"
            dataSource={data.platform_candidates}
            renderItem={(item) => (
              <List.Item>
                V{item.version.version}：{item.difference.changes.map((change) => change.field).join('、') || '无变化'}
              </List.Item>
            )}
          />
          <Form.Item name="target_audience" label="目标受众" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="content_angle" label="内容角度" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="conversion_goal" label="转化目标" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="desired_format" label="内容格式" rules={[{ required: true }]}><Input /></Form.Item>
          <Space align="start">
            <Form.Item name="desired_length_min" label="最小长度" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item>
            <Form.Item name="desired_length_max" label="最大长度" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item>
          </Space>
          <Form.Item name="canonical_url" label="Canonical URL" rules={[{ required: true, type: 'url' }]}><Input type="url" /></Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={create.isPending}
            disabled={missingFactCandidate || missingPlatformCandidate}
          >
            创建修复任务
          </Button>
        </Form>
      </Card>
    </div>
  );
}
