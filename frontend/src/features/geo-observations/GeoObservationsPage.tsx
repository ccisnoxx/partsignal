/** GEO 观测页登记站外人工搜索结果，并逐篇记录产品文章是否被推荐。 */
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import { geoMetricsQueryOptions, geoPublicationCandidatesQueryOptions, productsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { FileRecord, GeoObservation, Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

const articleRecommendationOptions: Array<{ label: string; value: Schema<'GeoArticleResultCreate'>['recommendation_status'] }> = [
  { label: '已推荐', value: 'RECOMMENDED' },
  { label: '未推荐', value: 'NOT_RECOMMENDED' },
];

function observationDetails(row: GeoObservation) {
  if (row.observation_kind === 'MANUAL_ARTICLE_SEARCH') {
    return (
      <Space orientation="vertical" size="small">
        <Typography.Paragraph><strong>实际搜索词：</strong>{row.search_query}</Typography.Paragraph>
        <Typography.Text><strong>搜索结果截图：</strong>{row.attachment_file_ids.length} 张</Typography.Text>
        <ul>
          {row.article_results.map((item) => (
            <li key={item.publication_record_id}>
              <a href={item.final_url} target="_blank" rel="noreferrer">{item.title}</a>
              {' · '}{item.platform_name}{' · '}
              <StatusTag status={item.recommendation_status} />
            </li>
          ))}
        </ul>
      </Space>
    );
  }
  return (
    <Space orientation="vertical">
      <Typography.Paragraph><strong>历史实际提示：</strong>{row.actual_prompt}</Typography.Paragraph>
      <Typography.Paragraph><strong>历史回答摘要：</strong>{row.answer_summary}</Typography.Paragraph>
      <Typography.Paragraph><strong>历史引用：</strong>{row.citations.map((item) => item.url).join('；') || '无'}</Typography.Paragraph>
    </Space>
  );
}

export function GeoObservationsPage() {
  const [open, setOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPage = searchParams.get('page');
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  const metrics = useQuery(geoMetricsQueryOptions());
  const observations = useQuery({ queryKey: queryKeys.geo.observations, queryFn: async () => unwrap(await api.GET('/api/v1/geo-observations')), staleTime: QUERY_STALE_TIME.businessList });
  useEffect(() => {
    if ((rawPage !== null && !/^[1-9]\d*$/.test(rawPage)) || (observations.data && page > Math.max(1, Math.ceil(observations.data.items.length / 10)))) {
      const next = new URLSearchParams(searchParams);
      next.delete('page');
      setSearchParams(next, { replace: true });
    }
  }, [observations.data, page, rawPage, searchParams, setSearchParams]);
  const setPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage === 1) next.delete('page'); else next.set('page', String(nextPage));
    setSearchParams(next);
  };
  if (metrics.isLoading || observations.isLoading) return <QueryLoading label="正在加载 GEO 观测工作台" />;
  if (metrics.error || observations.error) return <div className="page-stack"><PageHeader eyebrow="观测记录" title="GEO 观测" description="记录站外人工搜索证据和逐篇文章推荐结果。" /><QueryFailure error={metrics.error ?? observations.error} onRetry={() => { void metrics.refetch(); void observations.refetch(); }} /></div>;
  const recommendationRate = metrics.data?.article_recommendation_rate == null ? null : Math.round(metrics.data.article_recommendation_rate * 100);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="观测记录" title="GEO 观测" description="人工在搜索网站核对产品文章；系统只登记真实结果，不调用模型联网搜索。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>登记观测</Button>} />
      <section className="geo-metric-grid" aria-label="GEO 人工文章指标">
        <MetricTile label="人工观测" value={metrics.data?.manual_observation_count ?? 0} meta="当前有效记录" />
        <MetricTile label="文章结果" value={metrics.data?.article_result_count ?? 0} meta="逐篇人工判断" />
        <MetricTile label="已推荐文章" value={metrics.data?.recommended_article_count ?? 0} meta={`未推荐 ${metrics.data?.not_recommended_article_count ?? 0} 篇`} />
        <MetricTile label="文章推荐率" value={recommendationRate ?? '—'} unit={recommendationRate == null ? undefined : '%'} percent={recommendationRate} meta={recommendationRate == null ? '暂无文章结果' : '已推荐 / 全部文章结果'} />
      </section>
      <Card title={`观测记录（${observations.data?.items.length ?? 0} 条）`} className="workspace-panel collection-panel">
        <TableRegion label="GEO 观测列表">
          <Table<GeoObservation>
            rowKey="id"
            dataSource={observations.data?.items}
            pagination={{ current: page, pageSize: 10, showSizeChanger: false, onChange: setPage }}
            sticky={{ offsetHeader: 72 }}
            scroll={{ x: 760 }}
            expandable={{ expandedRowRender: observationDetails }}
            columns={[
              { title: '观测时间', dataIndex: 'tested_at', width: 190, render: (value) => <span className="data-code">{new Date(value).toLocaleString('zh-CN')}</span> },
              { title: '类型', width: 130, render: (_, row) => row.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? '人工文章搜索' : '历史模型观测' },
              { title: '搜索平台 / 模型', render: (_, row) => <span className="data-code">{row.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? row.search_platform : row.model_name}</span> },
              { title: '文章结果', width: 100, render: (_, row) => row.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? row.article_results.length : '—' },
              { title: '已推荐', width: 90, render: (_, row) => row.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? row.article_results.filter((item) => item.recommendation_status === 'RECOMMENDED').length : '—' },
            ]}
          />
        </TableRegion>
      </Card>
      <ObservationModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function ObservationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<Schema<'GeoObservationCreate'>>();
  const [attachments, setAttachments] = useState<FileRecord[]>([]);
  const productId = Form.useWatch('product_id', form);
  const products = useQuery({ ...productsQueryOptions(), enabled: open });
  const publications = useQuery({ ...geoPublicationCandidatesQueryOptions(productId), enabled: open && !!productId });
  useEffect(() => {
    if (publications.data?.items.length && !form.getFieldValue('article_results')?.length) {
      form.setFieldValue('article_results', publications.data.items.map((item) => ({ publication_record_id: item.publication_record_id })));
    }
  }, [form, publications.data]);
  const close = () => {
    form.resetFields();
    setAttachments([]);
    onClose();
  };
  const create = useMutation({
    mutationFn: async (values: Schema<'GeoObservationCreate'>) => unwrap(await api.POST('/api/v1/geo-observations', { params: { header: csrfHeader() }, body: { ...values, attachment_file_ids: attachments.map((item) => item.id) } })),
    onSuccess: async () => {
      close();
      await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.geo.observations }), queryClient.invalidateQueries({ queryKey: queryKeys.geo.metrics }), queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })]);
    },
  });
  const missingProducts = !products.data?.items.length;
  const missingPublications = !!productId && !publications.isLoading && !publications.error && !publications.data?.items.length;

  return (
    <Modal title="登记 GEO 观测" open={open} footer={null} onCancel={close} width={900} destroyOnHidden>
      {create.error && <Alert role="alert" className="form-alert" type="error" showIcon title={errorMessage(create.error)} />}
      {products.error && <QueryFailure error={products.error} onRetry={() => { void products.refetch(); }} />}
      {products.isLoading && <QueryLoading label="正在加载产品" />}
      {!products.isLoading && !products.error && missingProducts && <Alert className="form-alert" type="warning" showIcon title="登记观测前需要至少一个产品。" />}
      <Form<Schema<'GeoObservationCreate'>>
        form={form}
        layout="vertical"
        className="observation-form"
        disabled={products.isLoading || !!products.error}
        scrollToFirstError
        initialValues={{ tested_at: new Date().toISOString(), article_results: [], notes: '' }}
        onFinish={(body) => create.mutate(body)}
      >
        <Space align="start" wrap className="form-grid">
          <Form.Item name="product_id" label="产品" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" onChange={() => form.setFieldValue('article_results', [])} options={products.data?.items.map((item) => ({ value: item.id, label: `${item.brand} ${item.part_number}` }))} /></Form.Item>
          <Form.Item name="search_platform" label="人工搜索平台" rules={[{ required: true, whitespace: true }]}><Input placeholder="豆包、DeepSeek、元宝等" /></Form.Item>
          <Form.Item name="tested_at" label="观测时间（RFC3339）" rules={[{ required: true }]}><Input /></Form.Item>
        </Space>
        <Form.Item name="search_query" label="实际搜索词" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} placeholder="填写在站外搜索网站中实际提交的内容" /></Form.Item>

        <Typography.Title level={5}>产品已发布文章</Typography.Title>
        {!productId && <Alert className="form-alert" type="info" showIcon title="请先选择产品，再逐篇核对搜索结果。" />}
        {publications.isLoading && <QueryLoading label="正在加载产品文章" />}
        {publications.error && <QueryFailure error={publications.error} onRetry={() => { void publications.refetch(); }} />}
        {missingPublications && <Alert className="form-alert" type="warning" showIcon title="该产品暂无具有公开链接的已发布文章，请先完成发布登记。" />}
        {!!publications.data?.items.length && (
          <TableRegion label="产品文章推荐结果">
            <Table<Schema<'GeoPublicationCandidate'>>
              rowKey="publication_record_id"
              dataSource={publications.data.items}
              pagination={false}
              scroll={{ x: 700 }}
              columns={[
                { title: '文章', dataIndex: 'title' },
                { title: '平台', dataIndex: 'platform_name', width: 150 },
                { title: '链接', dataIndex: 'final_url', width: 120, render: (url) => <a href={url} target="_blank" rel="noreferrer">查看文章</a> },
                { title: '搜索结果', width: 160, render: (_, item, index) => <><Form.Item name={['article_results', index, 'publication_record_id']} hidden><Input /></Form.Item><Form.Item name={['article_results', index, 'recommendation_status']} rules={[{ required: true, message: '请选择推荐结果' }]} style={{ margin: 0 }}><Select aria-label={`文章推荐结果：${item.title}`} placeholder="请选择" options={articleRecommendationOptions} /></Form.Item></> },
              ]}
            />
          </TableRegion>
        )}

        <Form.Item label="搜索结果截图" required extra="至少上传一张真实搜索结果截图；系统不会自动解析或联网复查。">
          <DirectUpload category="OPERATION_SCREENSHOT" onUploaded={(file) => setAttachments((items) => [...items, file])} />
          <Space wrap>{attachments.map((file) => <Typography.Text key={file.id}>{file.original_filename} <StatusTag status={file.status} /></Typography.Text>)}</Space>
        </Form.Item>
        <Form.Item name="notes" label="备注"><Input.TextArea /></Form.Item>
        <Button type="primary" htmlType="submit" loading={create.isPending} disabled={missingProducts || missingPublications || !publications.data?.items.length || !attachments.length}>追加观测</Button>
      </Form>
    </Modal>
  );
}
