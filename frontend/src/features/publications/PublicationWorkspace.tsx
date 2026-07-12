/** 发布工作台负责候选、记录、待办列表和人工发布登记。 */
import { CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Typography, message } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { FileRecord, PublicationRecord, Schema } from '../../shared/api/types';
import { QueryFailure } from '../../shared/components/AsyncState';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { StatusTag } from '../../shared/components/StatusTag';

type PublicationCandidate = Schema<'PublicationCandidate'>;
type PublicationAttention = Schema<'PublicationAttention'>;

export function PublicationWorkspace() {
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<PublicationCandidate>();
  const candidates = useQuery({
    queryKey: queryKeys.publications.candidates,
    queryFn: async () => unwrap(await api.GET('/api/v1/publication-candidates')),
  });
  const records = useQuery({
    queryKey: queryKeys.publications.records,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-records', {
          params: { query: { page: 1, page_size: 100 } },
        }),
      ),
  });
  const attentions = useQuery({
    queryKey: queryKeys.publications.attentionList('OPEN'),
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
      <header className="page-heading">
        <div>
          <Typography.Text className="eyebrow">HUMAN PUBLISHING</Typography.Text>
          <Typography.Title>人工发布</Typography.Title>
          <Typography.Paragraph>
            系统只准备发布包并记录结果，不登录或操作外部平台。
          </Typography.Paragraph>
        </div>
      </header>
      {error && <QueryFailure error={error} />}
      <Card title="待发布候选">
        <Table<PublicationCandidate>
          rowKey={(row) => row.content_version.id}
          loading={candidates.isLoading}
          dataSource={candidates.data?.items}
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
        />
      </Card>
      <Card title="发布异常待办">
        <Table<PublicationAttention>
          rowKey="id"
          loading={attentions.isLoading}
          dataSource={attentions.data?.items}
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
        />
      </Card>
      <Card title="发布记录">
        <Table<PublicationRecord>
          rowKey="id"
          loading={records.isLoading}
          dataSource={records.data?.items}
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
        />
      </Card>
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
    queryKey: queryKeys.publications.package(content.id),
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
