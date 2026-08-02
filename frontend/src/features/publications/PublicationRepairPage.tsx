/** 修复页只提交服务端给出的事实和平台候选。 */
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, InputNumber, Select, Typography } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';

export function PublicationRepairPage({ attentionId }: { attentionId: string }) {
  const navigate = useNavigate();
  const context = useQuery({
    queryKey: queryKeys.publications.repair(attentionId),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/publication-attentions/{attention_id}/repair-context', {
          params: { path: { attention_id: attentionId } },
        }),
      ),
    staleTime: QUERY_STALE_TIME.detail,
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
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.attention(attentionId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.attentions }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
      navigate(`/tasks/${task.id}`);
    },
  });
  if (context.isLoading) return <QueryLoading />;
  if (context.error || !context.data) return <div className="page-stack"><Button className="back-link" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/publication-attentions/${attentionId}`)}>返回异常详情</Button><PageHeader title="创建发布修复任务" breadcrumbs={[{ title: <Link to="/publications">发布管理</Link> }, { title: <Link to={`/publication-attentions/${attentionId}`}>异常待办</Link> }, { title: '创建修复任务' }]} /><QueryFailure error={context.error ?? new Error('修复上下文不存在')} onRetry={() => void context.refetch()} /></div>;
  const data = context.data;
  const missingFactCandidate = data.fact_candidates.length === 0;
  const canCreateRepairTask = data.attention.available_actions.includes('CREATE_REPAIR_TASK');
  return (
    <div className="page-stack">
      <Button className="back-link" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/publication-attentions/${attentionId}`)}>
        返回异常详情
      </Button>
      <PageHeader eyebrow="修复任务" title="创建发布修复任务" description="固定继承原产品和目标平台，只需显式选择当前已批准事实版本。" breadcrumbs={[{ title: <Link to="/publications">发布管理</Link> }, { title: <Link to={`/publication-attentions/${attentionId}`}>异常待办</Link> }, { title: '创建修复任务' }]} />
      <Card title="固定修复上下文" className="workspace-panel">
        <Descriptions
          column={1}
          items={[
            { label: '产品', children: `${data.product.brand} ${data.product.part_number}` },
            ...(data.query_topic ? [{ label: 'GEO 问题', children: data.query_topic.canonical_question }] : []),
            { label: '平台', children: data.platform_profile_name },
            { label: '原事实版本', children: `V${data.original_fact_version.version}` },
          ]}
        />
      </Card>
      <Card title="创建修复任务" className="workspace-panel">
        {create.error && <Alert type="error" title={errorMessage(create.error)} />}
        {!canCreateRepairTask && <Alert type="info" showIcon title="该异常待办已处置或已有修复任务，当前上下文仅供查看。" />}
        {missingFactCandidate && <Alert type="error" showIcon title="当前产品没有可选的已批准事实版本，无法创建修复任务。" />}
        {canCreateRepairTask && <Form<Schema<'PublicationRepairTaskCreate'>>
          layout="vertical"
          initialValues={{
            expected_attention_revision: data.attention.revision,
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
          <Typography.Text strong>事实版本差异</Typography.Text>
          <ul>
            {data.fact_candidates.map((item) => (
              <li key={item.version.id}>
                V{item.version.version}：{item.difference.changes.map((change) => change.field).join('、') || '无变化'}
              </li>
            ))}
          </ul>
          <Button
            type="primary"
            htmlType="submit"
            loading={create.isPending}
            disabled={missingFactCandidate}
          >
            创建修复任务
          </Button>
        </Form>}
      </Card>
    </div>
  );
}
