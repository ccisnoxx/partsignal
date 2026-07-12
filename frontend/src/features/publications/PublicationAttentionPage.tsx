/** 发布异常详情负责显式修复入口与显式解决命令。 */
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Space } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { StatusTag } from '../../shared/components/StatusTag';

export function PublicationAttentionPage({ attentionId }: { attentionId: string }) {
  const navigate = useNavigate();
  const [resolveOpen, setResolveOpen] = useState(false);
  const detail = useQuery({
    queryKey: queryKeys.publications.attention(attentionId),
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
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.attention(attentionId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.attentions }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    },
  });
  if (detail.isLoading) return <QueryLoading />;
  if (detail.error || !detail.data) return <QueryFailure error={detail.error ?? new Error('发布异常不存在')} />;
  const attention = detail.data;
  return (
    <div className="page-stack">
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/publications')}>返回发布工作台</Button>
      <Card title="发布异常待办">
        <Descriptions
          column={1}
          items={[
            { label: '状态', children: <StatusTag status={attention.status} /> },
            { label: '触发状态', children: <StatusTag status={attention.trigger_status} /> },
            { label: '原发布', children: <Link to={`/publications/${attention.publication_record_id}`}>{attention.publication_record_id}</Link> },
            { label: '原任务', children: <Link to={`/tasks/${attention.original_task_id}`}>{attention.original_task_id}</Link> },
            { label: '修复任务', children: attention.repair_task_id ? <Link to={`/tasks/${attention.repair_task_id}`}>{attention.repair_task_id}</Link> : '尚未创建' },
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
