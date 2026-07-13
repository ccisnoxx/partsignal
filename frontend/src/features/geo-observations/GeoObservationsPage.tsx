/** GEO 观测页追加人工测试事实，并从原始观测展示可复算指标。 */
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import { geoMetricsQueryOptions, productsQueryOptions, publicationRecordsQueryOptions, queryTopicsQueryOptions } from '../../shared/api/queryOptions';
import type { FileRecord, GeoObservation, Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

export function GeoObservationsPage() {
  const [open, setOpen] = useState(false);
  const metrics = useQuery(geoMetricsQueryOptions());
  const observations = useQuery({ queryKey: ['geo-observations'], queryFn: async () => unwrap(await api.GET('/api/v1/geo-observations')), staleTime: QUERY_STALE_TIME.businessList });
  if (metrics.isLoading || observations.isLoading) return <QueryLoading label="正在加载 GEO 观测工作台" />;
  if (metrics.error || observations.error) return <QueryFailure error={metrics.error ?? observations.error} onRetry={() => { void metrics.refetch(); void observations.refetch(); }} />;
  const rate = (value: number | null | undefined) => value == null ? null : Math.round(value * 100);
  const metricItems = [
    { label: '提及率', value: rate(metrics.data?.mention_rate) },
    { label: '推荐率', value: rate(metrics.data?.recommendation_rate) },
    { label: '引用率', value: rate(metrics.data?.citation_rate) },
    { label: '准确率', value: rate(metrics.data?.accuracy_rate) },
  ];

  return (
    <div className="page-stack">
      <PageHeader eyebrow="MEASUREMENT LOG" title="GEO 观测" description="只记录实际测试结果；更正会追加新记录，不覆盖历史。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>登记观测</Button>} />
      <section className="geo-metric-grid" aria-label="GEO 指标">
        {metricItems.map((item) => <MetricTile key={item.label} label={item.label} value={item.value ?? '—'} unit={item.value == null ? undefined : '%'} percent={item.value} meta={item.value == null ? '无可判断样本' : `${metrics.data?.sample_count ?? 0} 个当前样本`} />)}
      </section>
      <Card title={`原始观测（${metrics.data?.sample_count ?? 0} 个指标样本）`} className="workspace-panel">
        <TableRegion label="GEO 原始观测列表">
          <Table<GeoObservation>
            rowKey="id"
            dataSource={observations.data?.items}
            scroll={{ x: 960 }}
            expandable={{ expandedRowRender: (row) => <Space orientation="vertical"><Typography.Paragraph><strong>实际提示：</strong>{row.actual_prompt}</Typography.Paragraph><Typography.Paragraph><strong>回答摘要：</strong>{row.answer_summary}</Typography.Paragraph><Typography.Paragraph><strong>引用：</strong>{row.citations.map((item) => item.url).join('；') || '无'}</Typography.Paragraph></Space> }}
            columns={[
              { title: '测试时间', dataIndex: 'tested_at', width: 190, render: (value) => <span className="data-code">{new Date(value).toLocaleString('zh-CN')}</span> },
              { title: '模型', width: 200, render: (_, row) => <span className="data-code">{row.model_name}{row.model_version ? ` / ${row.model_version}` : ''}</span> },
              { title: '提及', dataIndex: 'mentioned', width: 80, render: (value) => value ? '是' : '否' },
              { title: '推荐', dataIndex: 'recommendation', width: 120, render: (value) => <StatusTag status={value} /> },
              { title: '准确性', dataIndex: 'accuracy', width: 120, render: (value) => <StatusTag status={value} /> },
              { title: '引用数', dataIndex: 'citations', width: 90, render: (items: Schema<'GeoCitation'>[]) => <span className="data-code">{items.length}</span> },
            ]}
          />
        </TableRegion>
      </Card>
      <ObservationModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function ObservationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [attachments, setAttachments] = useState<FileRecord[]>([]);
  const products = useQuery({ ...productsQueryOptions(), enabled: open });
  const topics = useQuery({ ...queryTopicsQueryOptions(), enabled: open });
  const publications = useQuery({ ...publicationRecordsQueryOptions(), enabled: open });
  const close = () => { setAttachments([]); onClose(); };
  const create = useMutation({
    mutationFn: async (values: Schema<'GeoObservationCreate'>) => unwrap(await api.POST('/api/v1/geo-observations', { params: { header: csrfHeader() }, body: { ...values, attachment_file_ids: attachments.map((item) => item.id) } })),
    onSuccess: async () => {
      close();
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['geo-observations'] }), queryClient.invalidateQueries({ queryKey: ['geo-metrics'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
    },
  });
  const dependencyError = products.error ?? topics.error ?? publications.error;
  const dependenciesLoading = products.isLoading || topics.isLoading || publications.isLoading;
  const missingPrerequisite = !products.data?.items.length || !topics.data?.items.length;

  return (
    <Modal title="登记 GEO 观测" open={open} footer={null} onCancel={close} width={900} destroyOnHidden>
      {create.error && <Alert role="alert" className="form-alert" type="error" showIcon message={errorMessage(create.error)} />}
      {dependencyError && <QueryFailure error={dependencyError} onRetry={() => { void products.refetch(); void topics.refetch(); void publications.refetch(); }} />}
      {dependenciesLoading && <QueryLoading label="正在加载观测前置数据" />}
      {!dependenciesLoading && !dependencyError && missingPrerequisite && <Alert className="form-alert" type="warning" showIcon message="登记观测前需要至少一个产品和目标问题。" />}
      <Form<Schema<'GeoObservationCreate'>>
        layout="vertical"
        className="observation-form"
        disabled={dependenciesLoading || !!dependencyError}
        scrollToFirstError
        initialValues={{ web_search_enabled: true, mentioned: false, recommendation: 'NONE', accuracy: 'UNJUDGEABLE', citations: [], publication_record_ids: [], notes: '', attachment_file_ids: [] }}
        onFinish={(body) => create.mutate(body)}
      >
        <Space align="start" wrap className="form-grid">
          <Form.Item name="query_topic_id" label="目标问题" rules={[{ required: true }]}><Select options={topics.data?.items.map((item) => ({ value: item.id, label: item.canonical_question }))} /></Form.Item>
          <Form.Item name="product_id" label="产品" rules={[{ required: true }]}><Select options={products.data?.items.map((item) => ({ value: item.id, label: `${item.brand} ${item.part_number}` }))} /></Form.Item>
          <Form.Item name="model_name" label="模型名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="model_version" label="可见版本"><Input /></Form.Item>
          <Form.Item name="tested_at" label="测试时间（RFC3339）" rules={[{ required: true }]}><Input placeholder="2026-07-10T10:00:00+08:00" /></Form.Item>
        </Space>
        <Form.Item name="actual_prompt" label="实际提示词" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
        <Form.Item name="answer_summary" label="回答摘要" rules={[{ required: true }]}><Input.TextArea rows={5} /></Form.Item>
        <Space align="start" wrap className="form-grid">
          <Form.Item name="web_search_enabled" valuePropName="checked"><Checkbox>启用联网搜索</Checkbox></Form.Item>
          <Form.Item name="mentioned" valuePropName="checked"><Checkbox>提及产品</Checkbox></Form.Item>
          <Form.Item name="recommendation" label="推荐状态"><Select options={['NONE','CANDIDATE','RECOMMENDED'].map((value) => ({ value }))} /></Form.Item>
          <Form.Item name="accuracy" label="准确性"><Select options={['ACCURATE','PARTIAL','INCORRECT','UNJUDGEABLE'].map((value) => ({ value }))} /></Form.Item>
        </Space>
        <Form.List name="citations">{(fields, { add, remove }) => <><Typography.Title level={5}>引用来源</Typography.Title>{fields.map(({ key, name, ...field }) => <Space key={key} align="start" wrap className="dynamic-row"><Form.Item {...field} name={[name, 'url']} label="URL" rules={[{ required: true, type: 'url' }]}><Input type="url" /></Form.Item><Form.Item {...field} name={[name, 'source_type']} label="来源类型" rules={[{ required: true }]}><Select options={['OFFICIAL','EXTERNAL_COMPANY','OTHER'].map((value) => ({ value }))} /></Form.Item><Form.Item {...field} name={[name, 'publication_record_id']} label="关联发布"><Select allowClear options={publications.data?.items.map((item) => ({ value: item.id, label: item.final_url ?? item.id }))} /></Form.Item><Button danger onClick={() => remove(name)}>删除</Button></Space>)}<Button icon={<PlusOutlined />} onClick={() => add({ source_type: 'OTHER' })}>添加引用</Button></>}</Form.List>
        <Form.Item name="publication_record_ids" label="相关发布记录"><Select mode="multiple" options={publications.data?.items.map((item) => ({ value: item.id, label: item.final_url ?? item.id }))} /></Form.Item>
        <Form.Item label="测试截图"><DirectUpload category="OPERATION_SCREENSHOT" onUploaded={(file) => setAttachments((items) => [...items, file])} /><Space wrap>{attachments.map((file) => <StatusTag key={file.id} status={file.status} />)}</Space></Form.Item>
        <Form.Item name="supersedes_id" label="被更正观测 ID"><Input className="data-code" /></Form.Item>
        <Form.Item name="notes" label="备注"><Input.TextArea /></Form.Item>
        <Button type="primary" htmlType="submit" loading={create.isPending} disabled={missingPrerequisite}>追加观测</Button>
      </Form>
    </Modal>
  );
}
