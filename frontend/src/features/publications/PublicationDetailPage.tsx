/** 发布详情只消费服务端 available_actions，不复制状态机。 */
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Timeline, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { actionLabels, type PublicationAction } from './publicationTypes';

export function PublicationDetailPage({ publicationId }: { publicationId: string }) {
  const navigate = useNavigate();
  const [action, setAction] = useState<PublicationAction>();
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
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.record(publicationId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.records }),
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.attentions }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(updated.task_id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    },
  });
  if (detail.isLoading) return <QueryLoading />;
  if (detail.error || !detail.data) return <QueryFailure error={detail.error ?? new Error('发布记录不存在')} />;
  const record = detail.data;
  return (
    <div className="page-stack">
      <Button className="back-link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/publications')}>返回发布工作台</Button>
      <PageHeader eyebrow="发布记录" title="发布记录" description={<>记录 ID <span className="data-code">{record.id}</span></>} breadcrumbs={[{ title: <Link to="/publications">人工发布</Link> }, { title: '发布记录' }]} actions={<StatusTag status={record.status} />} />
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
