/** 发布工作台负责候选、记录、待办列表和人工发布登记。 */
import { CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Form, Input, Modal, Select, Space, Table, Tabs, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import { publicationRecordsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { FileRecord, PublicationRecord, Schema } from '../../shared/api/types';
import { QueryFailure } from '../../shared/components/AsyncState';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

type PublicationCandidate = Schema<'PublicationCandidate'>;
type PublicationAttention = Schema<'PublicationAttention'>;
const publicationTabs = new Set(['candidates', 'attentions', 'records']);

function pageParam(params: URLSearchParams, key: string) {
  const raw = params.get(key);
  return raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : 1;
}

export function PublicationWorkspace() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [candidate, setCandidate] = useState<PublicationCandidate>();
  const candidates = useQuery({
    queryKey: queryKeys.publications.candidates,
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-candidates')),
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const records = useQuery(publicationRecordsQueryOptions());
  const attentions = useQuery({
    queryKey: queryKeys.publications.attentionList('OPEN'),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-attentions', {
          params: { query: { status: 'OPEN' } },
        }),
      ),
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const defaultTab = attentions.data?.items.length ? 'attentions' : 'candidates';
  const rawTab = searchParams.get('tab');
  const activeTab = rawTab && publicationTabs.has(rawTab) ? rawTab : defaultTab;
  const candidatesPage = pageParam(searchParams, 'candidates_page');
  const attentionsPage = pageParam(searchParams, 'attentions_page');
  const recordsPage = pageParam(searchParams, 'records_page');
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (rawTab !== null && !publicationTabs.has(rawTab)) { next.delete('tab'); changed = true; }
    for (const [key, page, count] of [
      ['candidates_page', candidatesPage, candidates.data?.items.length],
      ['attentions_page', attentionsPage, attentions.data?.items.length],
      ['records_page', recordsPage, records.data?.items.length],
    ] as const) {
      const raw = searchParams.get(key);
      if ((raw !== null && !/^[1-9]\d*$/.test(raw)) || (count !== undefined && page > Math.max(1, Math.ceil(count / 10)))) {
        next.delete(key);
        changed = true;
      }
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [activeTab, attentions.data, attentionsPage, candidates.data, candidatesPage, rawTab, records.data, recordsPage, searchParams, setSearchParams]);
  const setView = (key: string, value: string | number) => {
    const next = new URLSearchParams(searchParams);
    if (typeof value === 'number' && value === 1) next.delete(key); else next.set(key, String(value));
    setSearchParams(next);
  };
  const error = candidates.error ?? records.error ?? attentions.error;
  return (
    <div className="page-stack">
      <PageHeader eyebrow="人工发布" title="人工发布" description="系统只准备发布包并记录结果，不登录或操作外部平台。" />
      {error && <QueryFailure error={error} onRetry={() => { void candidates.refetch(); void records.refetch(); void attentions.refetch(); }} />}
      <section className="workspace-summary" aria-label="人工发布摘要">
        <div><span>待发布候选</span><strong className="data-code">{candidates.data?.items.length ?? 0}</strong></div>
        <div><span>开放异常</span><strong className="data-code">{attentions.data?.items.length ?? 0}</strong></div>
        <div><span>当前记录</span><strong className="data-code">{records.data?.items.length ?? 0}</strong></div>
      </section>
      <Tabs className="workspace-tabs" activeKey={activeTab} onChange={(key) => setView('tab', key)} items={[
        { key: 'candidates', label: '待发布候选', children: <Card className="workspace-panel collection-panel"><TableRegion label="待发布候选列表"><Table<PublicationCandidate>
          rowKey={(row) => row.content_version.id}
          loading={candidates.isLoading}
          dataSource={candidates.data?.items}
          pagination={{ current: candidatesPage, pageSize: 10, showSizeChanger: false, onChange: (page) => setView('candidates_page', page) }}
          sticky={{ offsetHeader: 72 }}
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
        { key: 'attentions', label: '发布异常待办', children: <Card className="workspace-panel collection-panel"><TableRegion label="发布异常待办列表"><Table<PublicationAttention>
          rowKey="id"
          loading={attentions.isLoading}
          dataSource={attentions.data?.items}
          pagination={{ current: attentionsPage, pageSize: 10, showSizeChanger: false, onChange: (page) => setView('attentions_page', page) }}
          sticky={{ offsetHeader: 72 }}
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
        { key: 'records', label: '发布记录', children: <Card className="workspace-panel collection-panel"><TableRegion label="发布记录列表"><Table<PublicationRecord>
          rowKey="id"
          loading={records.isLoading}
          dataSource={records.data?.items}
          pagination={{ current: recordsPage, pageSize: 10, showSizeChanger: false, onChange: (page) => setView('records_page', page) }}
          sticky={{ offsetHeader: 72 }}
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
  const { message } = App.useApp();
  const [attachments, setAttachments] = useState<FileRecord[]>([]);
  const content = candidate.content_version;
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
          params: {
            header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() },
          },
          body: { ...values, attachment_file_ids: attachments.map((item) => item.id) },
        }),
      ),
    onSuccess: async (created) => {
      onClose();
      message.success('人工发布记录已登记');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.records }),
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.candidates }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(created.task_id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    },
  });
  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    message.success(`${label}已复制`);
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
