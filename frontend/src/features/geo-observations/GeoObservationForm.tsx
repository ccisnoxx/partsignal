/** 登记或更正人工 GEO 观测；更正始终追加新记录，不改写历史。 */
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import {
  geoObservationQueryOptions,
  geoPublicationCandidatesQueryOptions,
  productsQueryOptions,
  queryTopicsQueryOptions,
} from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { FileRecord, GeoObservation, Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

type ObservationFormValues = Omit<Schema<'GeoObservationCreate'>, 'attachment_file_ids' | 'tested_at'> & {
  tested_at: string;
};

const articleRecommendationOptions: Array<{
  label: string;
  value: Schema<'GeoArticleResultCreate'>['recommendation_status'];
}> = [
  { label: '已推荐', value: 'RECOMMENDED' },
  { label: '未推荐', value: 'NOT_RECOMMENDED' },
];
const accuracyOptions: Array<{
  label: string;
  value: Schema<'GeoArticleResultCreate'>['accuracy'];
}> = [
  { label: '准确', value: 'ACCURATE' },
  { label: '部分准确', value: 'PARTIAL' },
  { label: '不准确', value: 'INCORRECT' },
  { label: '无法判断', value: 'UNJUDGEABLE' },
];

function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isManualObservation(record: GeoObservation | undefined): record is Schema<'ManualGeoObservation'> {
  return record?.observation_kind === 'MANUAL_ARTICLE_SEARCH';
}

export function GeoObservationForm({ open, correctionId, onClose, onCreated }: {
  open: boolean;
  correctionId?: string;
  onClose: () => void;
  onCreated: (observation: GeoObservation) => void;
}) {
  const [form] = Form.useForm<ObservationFormValues>();
  const [attachments, setAttachments] = useState<FileRecord[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const correction = useQuery({ ...geoObservationQueryOptions(correctionId), enabled: open && !!correctionId });
  const correctionRecord = isManualObservation(correction.data) ? correction.data : undefined;
  const watchedProductId = Form.useWatch('product_id', form);
  const watchedArticleResults = Form.useWatch('article_results', form) ?? [];
  const productId = correctionRecord?.product_id ?? watchedProductId;
  const products = useQuery({ ...productsQueryOptions(productSearch), enabled: open && !correctionId });
  const topics = useQuery({ ...queryTopicsQueryOptions(), enabled: open });
  const publications = useQuery({
    ...geoPublicationCandidatesQueryOptions(productId),
    enabled: open && !!productId && (!correctionId || !!correctionRecord),
  });

  useEffect(() => {
    if (!open) return;
    if (correctionRecord) {
      form.setFieldsValue({
        product_id: correctionRecord.product_id,
        query_topic_id: correctionRecord.query_topic_id ?? undefined,
        search_platform: correctionRecord.search_platform,
        search_query: correctionRecord.search_query,
        tested_at: localDateTime(new Date()),
        article_results: [],
        notes: '',
        supersedes_id: correctionRecord.id,
      });
    } else if (!correctionId) {
      form.resetFields();
      form.setFieldsValue({ tested_at: localDateTime(new Date()), article_results: [], notes: '' });
    }
  }, [correctionId, correctionRecord, form, open]);

  useEffect(() => {
    if (!publications.data?.items.length) return;
    // 更正必须重新确认当前全部文章，不沿用旧记录结论。
    const priorResults: Schema<'GeoArticleResultCreate'>[] = correctionRecord
      ? []
      : form.getFieldValue('article_results') ?? [];
    const priorByPublication = new Map(priorResults.map((item) => [item.publication_record_id, item]));
    form.setFieldValue('article_results', publications.data.items.map((item) => ({
      ...priorByPublication.get(item.publication_record_id),
      publication_record_id: item.publication_record_id,
    })));
  }, [correctionRecord, form, publications.data]);

  const close = () => {
    form.resetFields();
    setAttachments([]);
    setProductSearch('');
    onClose();
  };
  const create = useMutation({
    mutationFn: async (values: ObservationFormValues) => unwrap(await api.POST('/api/v1/geo-observations', {
      params: { header: csrfHeader() },
      body: {
        ...values,
        tested_at: new Date(values.tested_at).toISOString(),
        attachment_file_ids: attachments.map((item) => item.id),
        supersedes_id: correctionRecord?.id,
      },
    })),
    onSuccess: async (observation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.geo.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
      close();
      onCreated(observation);
    },
  });
  const missingProducts = !correctionId && !products.isLoading && !products.data?.items.length;
  const missingTopics = !topics.isLoading && !topics.error && !topics.data?.items.length;
  const missingPublications = !!productId && !publications.isLoading && !publications.error && !publications.data?.items.length;
  const correctionError = correctionId && !correction.isLoading && (
    correction.error
    ?? (!correctionRecord ? new Error('仅当前人工观测记录可以更正') : null)
    ?? (correctionRecord && !correctionRecord.available_actions.includes('CORRECT') ? new Error('当前记录不可更正') : null)
  );

  return (
    <Modal
      title={correctionId ? '更正人工观测' : '登记人工观测'}
      open={open}
      footer={null}
      onCancel={close}
      width={900}
      destroyOnHidden
    >
      {create.error && <Alert role="alert" className="form-alert" type="error" showIcon title={errorMessage(create.error)} />}
      {correction.isLoading && correctionId && <QueryLoading label="正在加载待更正记录" />}
      {correctionError && <QueryFailure error={correctionError} onRetry={() => { void correction.refetch(); }} />}
      {products.error && !correctionId && <QueryFailure error={products.error} onRetry={() => { void products.refetch(); }} />}
      {products.isLoading && !correctionId && <QueryLoading label="正在加载产品" />}
      {topics.error && <QueryFailure error={topics.error} onRetry={() => { void topics.refetch(); }} />}
      {topics.isLoading && <QueryLoading label="正在加载问题主题" />}
      {missingProducts && <Alert className="form-alert" type="warning" showIcon title="登记观测前需要至少一个产品。" />}
      {missingTopics && <Alert className="form-alert" type="warning" showIcon title="登记观测前需要至少一个问题主题。" />}
      {correctionId && correctionRecord && (
        <Alert className="form-alert" type="info" showIcon title="更正会追加一条新记录，原记录继续保留在历史中。" />
      )}
      <Form<ObservationFormValues>
        form={form}
        layout="vertical"
        className="observation-form"
        disabled={products.isLoading || topics.isLoading || !!products.error || !!topics.error || !!correctionError || correction.isLoading}
        scrollToFirstError
        onFinish={(values) => create.mutate(values)}
      >
        <div className="geo-form-grid">
          <Form.Item name="product_id" label="产品" rules={[{ required: true }]}>
            <Select
              showSearch
              filterOption={false}
              onSearch={setProductSearch}
              disabled={!!correctionId}
              onChange={() => form.setFieldValue('article_results', [])}
              options={correctionRecord
                ? [{ value: correctionRecord.product_id, label: correctionRecord.product_label }]
                : products.data?.items.map((item) => ({ value: item.id, label: `${item.brand} ${item.part_number}` }))}
            />
          </Form.Item>
          <Form.Item name="query_topic_id" label="问题主题" rules={[{ required: true, message: '请选择真实问题主题' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={!!correctionRecord?.query_topic_id}
              placeholder="选择已配置的问题主题"
              options={topics.data?.items.map((item) => ({ value: item.id, label: item.canonical_question }))}
            />
          </Form.Item>
          <Form.Item name="search_platform" label="人工搜索平台" rules={[{ required: true, whitespace: true }]}>
            <Input disabled={!!correctionId} placeholder="豆包、DeepSeek、元宝等" />
          </Form.Item>
          <Form.Item name="tested_at" label="观测时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
        </div>
        <Form.Item name="search_query" label="实际搜索词" rules={[{ required: true, whitespace: true }]}>
          <Input.TextArea disabled={!!correctionId} rows={3} placeholder="填写在站外搜索网站中实际提交的内容" />
        </Form.Item>

        <Typography.Title level={5}>逐篇观测结果</Typography.Title>
        <Alert
          className="form-alert"
          type="info"
          showIcon
          title="阶段严格按发现、提及、推荐、引用、结果准确累计；修改前序事实后，必须重新确认受影响的后续事实。"
        />
        {!productId && <Alert className="form-alert" type="info" showIcon title="请先选择产品，再逐篇核对搜索结果。" />}
        {publications.isLoading && <QueryLoading label="正在加载产品文章" />}
        {publications.error && <QueryFailure error={publications.error} onRetry={() => { void publications.refetch(); }} />}
        {missingPublications && <Alert className="form-alert" type="warning" showIcon title="该产品暂无具有公开链接的已发布文章，请先完成发布登记。" />}
        {!!publications.data?.items.length && (
          <TableRegion label="产品文章观测结果">
            <Table<Schema<'GeoPublicationCandidate'>>
              rowKey="publication_record_id"
              dataSource={publications.data.items}
              pagination={false}
              scroll={{ x: 1160 }}
              columns={[
                { title: '文章', dataIndex: 'title' },
                { title: '平台', dataIndex: 'platform_name', width: 130 },
                { title: '链接', dataIndex: 'final_url', width: 110, render: (url) => <a href={url} target="_blank" rel="noreferrer">查看文章</a> },
                {
                  title: '发现', width: 130, render: (_, item, index) => <>
                    <Form.Item name={['article_results', index, 'publication_record_id']} hidden><Input /></Form.Item>
                    <Form.Item name={['article_results', index, 'discovered']} rules={[{ required: true, message: '请选择是否发现' }]} style={{ margin: 0 }}>
                      <Select
                        aria-label={`是否发现：${item.title}`}
                        placeholder="请选择"
                        onChange={(value) => {
                          if (value === true) return;
                          for (const field of ['mentioned', 'recommendation_status', 'cited'] as const) form.setFieldValue(['article_results', index, field], undefined);
                          if (watchedArticleResults[index]?.accuracy === 'ACCURATE') form.setFieldValue(['article_results', index, 'accuracy'], undefined);
                        }}
                        options={[{ label: '已发现', value: true }, { label: '未发现', value: false }]}
                      />
                    </Form.Item>
                  </>,
                },
                {
                  title: '提及', width: 130, render: (_, item, index) => (
                    <Form.Item name={['article_results', index, 'mentioned']} rules={[{ required: true, message: '请选择是否提及' }]} style={{ margin: 0 }}>
                      <Select
                        aria-label={`是否提及：${item.title}`}
                        placeholder="请选择"
                        onChange={(value) => {
                          if (value === true) return;
                          for (const field of ['recommendation_status', 'cited'] as const) form.setFieldValue(['article_results', index, field], undefined);
                          if (watchedArticleResults[index]?.accuracy === 'ACCURATE') form.setFieldValue(['article_results', index, 'accuracy'], undefined);
                        }}
                        options={[
                          { label: '已提及', value: true, disabled: watchedArticleResults[index]?.discovered !== true },
                          { label: '未提及', value: false },
                        ]}
                      />
                    </Form.Item>
                  ),
                },
                {
                  title: '推荐', width: 130, render: (_, item, index) => (
                    <Form.Item name={['article_results', index, 'recommendation_status']} rules={[{ required: true, message: '请选择推荐结论' }]} style={{ margin: 0 }}>
                      <Select
                        aria-label={`文章推荐结果：${item.title}`}
                        placeholder="请选择"
                        onChange={(value) => {
                          if (value === 'RECOMMENDED') return;
                          form.setFieldValue(['article_results', index, 'cited'], undefined);
                          if (watchedArticleResults[index]?.accuracy === 'ACCURATE') form.setFieldValue(['article_results', index, 'accuracy'], undefined);
                        }}
                        options={articleRecommendationOptions.map((option) => ({
                          ...option,
                          disabled: option.value === 'RECOMMENDED' && watchedArticleResults[index]?.mentioned !== true,
                        }))}
                      />
                    </Form.Item>
                  ),
                },
                {
                  title: '引用', width: 130, render: (_, item, index) => (
                    <Form.Item name={['article_results', index, 'cited']} rules={[{ required: true, message: '请选择是否引用' }]} style={{ margin: 0 }}>
                      <Select
                        aria-label={`是否引用：${item.title}`}
                        placeholder="请选择"
                        onChange={(value) => {
                          if (value !== true && watchedArticleResults[index]?.accuracy === 'ACCURATE') form.setFieldValue(['article_results', index, 'accuracy'], undefined);
                        }}
                        options={[
                          { label: '有引用', value: true, disabled: watchedArticleResults[index]?.recommendation_status !== 'RECOMMENDED' },
                          { label: '无引用', value: false },
                        ]}
                      />
                    </Form.Item>
                  ),
                },
                {
                  title: '准确性', width: 140, render: (_, item, index) => (
                    <Form.Item name={['article_results', index, 'accuracy']} rules={[{ required: true, message: '请选择准确性' }]} style={{ margin: 0 }}>
                      <Select
                        aria-label={`准确性：${item.title}`}
                        placeholder="请选择"
                        options={accuracyOptions.map((option) => ({
                          ...option,
                          disabled: option.value === 'ACCURATE' && watchedArticleResults[index]?.cited !== true,
                        }))}
                      />
                    </Form.Item>
                  ),
                },
              ]}
            />
          </TableRegion>
        )}

        <Form.Item label="证据截图" required extra="至少上传一张真实搜索结果截图；系统不会自动解析或联网复查。">
          <DirectUpload category="OPERATION_SCREENSHOT" onUploaded={(file) => setAttachments((items) => [...items, file])} />
          <Space wrap className="geo-upload-list">
            {attachments.map((file) => <Typography.Text key={file.id}>{file.original_filename} <StatusTag status={file.status} /></Typography.Text>)}
          </Space>
        </Form.Item>
        <Form.Item name="notes" label="人工备注"><Input.TextArea rows={3} /></Form.Item>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          htmlType="submit"
          loading={create.isPending}
          disabled={missingProducts || missingTopics || missingPublications || !publications.data?.items.length || !attachments.length}
        >
          {correctionId ? '追加更正记录' : '追加观测记录'}
        </Button>
      </Form>
    </Modal>
  );
}
