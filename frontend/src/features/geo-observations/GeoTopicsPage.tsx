/** GEO 问题库页面，维护人工观测使用的问题主题。 */
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Select, Table } from 'antd';
import { useState } from 'react';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import { queryTopicsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { QueryTopic, Schema } from '../../shared/api/types';
import { PageHeader } from '../../shared/components/PageHeader';
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
        {(topics.error || create.error) && (
          <Alert
            role="alert"
            type="error"
            showIcon
            message={errorMessage(topics.error ?? create.error)}
          />
        )}
        <TableRegion label="GEO 问题库列表">
          <Table<QueryTopic>
            rowKey="id"
            loading={topics.isLoading}
            dataSource={topics.data?.items}
            scroll={{ x: 720 }}
            columns={[
              { title: '标准问题', dataIndex: 'canonical_question' },
              {
                title: '意图',
                dataIndex: 'intent_type',
                width: 140,
                render: (value: Schema<'IntentType'>) => intentLabels.get(value) ?? value,
              },
              {
                title: '变体',
                dataIndex: 'variants',
                width: 400,
                render: (items: string[]) => items.join(' / '),
              },
            ]}
          />
        </TableRegion>
      </Card>
      <Modal
        title="新增 GEO 问题"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form<Schema<'QueryTopicCreate'>>
          layout="vertical"
          onFinish={(body) => create.mutate(body)}
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
          <Button type="primary" htmlType="submit" loading={create.isPending}>创建</Button>
        </Form>
      </Modal>
    </div>
  );
}
