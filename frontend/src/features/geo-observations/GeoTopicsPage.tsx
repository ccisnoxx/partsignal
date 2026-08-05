/** GEO 问题库页面，维护人工观测使用的问题主题。 */
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import { queryTopicsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { QueryTopic, Schema } from '../../shared/api/types';
import { PageHeader } from '../../shared/components/PageHeader';
import { TableCellText } from '../../shared/components/TableCellText';
import { TableRegion } from '../../shared/components/TableRegion';

const intentOptions: Array<{ label: string; value: Schema<'IntentType'> }> = [
  { label: '品牌', value: 'BRAND' },
  { label: '产品', value: 'PRODUCT' },
  { label: '替代选型', value: 'REPLACEMENT' },
  { label: '对比', value: 'COMPARISON' },
  { label: '应用', value: 'APPLICATION' },
  { label: '故障排查', value: 'TROUBLESHOOTING' },
];
const intentLabels = new Map(intentOptions.map((item) => [item.value, item.label]));

export function GeoTopicsPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<QueryTopic>();
  const navigate = useNavigate();
  const topics = useQuery(queryTopicsQueryOptions());
  const create = useMutation({
    mutationFn: async (body: Schema<'QueryTopicCreate'>) =>
      unwrap(
        await api.POST('/api/v1/query-topics', {
          params: { header: csrfHeader() },
          body,
        }),
      ),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.queryTopics });
    },
  });
  const update = useMutation({
    mutationFn: async (body: Schema<'QueryTopicCreate'>) => {
      if (!editing) throw new Error('未选择要编辑的问题主题');
      return unwrap(await api.PATCH('/api/v1/query-topics/{query_topic_id}', {
        params: { path: { query_topic_id: editing.id }, header: csrfHeader() },
        body: { ...body, expected_revision: editing.revision },
      }));
    },
    onSuccess: async () => {
      setEditing(undefined);
      await queryClient.invalidateQueries({ queryKey: queryKeys.queryTopics });
    },
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="GEO 观测"
        title="GEO 问题库"
        description="维护人工 GEO 观测选择的问题主题和覆盖分析维度。"
      />
      <Card
        className="collection-panel"
        extra={(
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            新增问题
          </Button>
        )}
      >
        {(topics.error || create.error || update.error) && (
          <Alert
            role="alert"
            type="error"
            showIcon
            title={errorMessage(topics.error ?? create.error ?? update.error)}
          />
        )}
        <TableRegion label="GEO 问题库列表">
          <Table<QueryTopic>
            rowKey="id"
            loading={topics.isLoading}
            dataSource={topics.data?.items}
            scroll={{ x: 990 }}
            columns={[
              { title: '标准问题', dataIndex: 'canonical_question', width: 320, ellipsis: true, render: (value) => <TableCellText text={value} /> },
              {
                title: '意图',
                dataIndex: 'intent_type',
                width: 140,
                render: (value: Schema<'IntentType'>) => intentLabels.get(value) ?? value,
              },
              {
                title: '变体',
                dataIndex: 'variants',
                width: 320,
                ellipsis: true,
                render: (items: string[]) => <TableCellText text={items.join(' / ')} />,
              },
              {
                title: '操作',
                fixed: 'right',
                width: 210,
                render: (_, row) => (
                  <Space size={4}>
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => navigate(`/observations?create=true&query_topic_id=${row.id}&search_query=${encodeURIComponent(row.canonical_question)}`)}
                    >
                      使用此问题观测
                    </Button>
                    <Button size="small" onClick={() => setEditing(row)}>编辑</Button>
                  </Space>
                ),
              },
            ]}
          />
        </TableRegion>
      </Card>
      <Modal
        title={editing ? '编辑 GEO 问题' : '新增 GEO 问题'}
        open={open || !!editing}
        onCancel={() => { setOpen(false); setEditing(undefined); }}
        footer={null}
        destroyOnHidden
      >
        <Form<Schema<'QueryTopicCreate'>>
          key={editing?.id ?? 'new'}
          layout="vertical"
          initialValues={editing ? {
            canonical_question: editing.canonical_question,
            intent_type: editing.intent_type,
            variants: editing.variants,
          } : undefined}
          onFinish={(body) => editing ? update.mutate(body) : create.mutate(body)}
        >
          <Form.Item name="canonical_question" label="标准问题" rules={[{ required: true }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="intent_type" label="意图" rules={[{ required: true }]}>
            <Select options={intentOptions} />
          </Form.Item>
          <Form.Item name="variants" label="问题变体" rules={[{ required: true }]}>
            <Select mode="tags" tokenSeparators={[',']} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={create.isPending || update.isPending}>{editing ? '保存' : '创建'}</Button>
        </Form>
      </Modal>
    </div>
  );
}
