/** 登记或更正人工 GEO 观测；更正始终追加新记录，不改写历史。 */
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
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
import { TableCellText } from '../../shared/components/TableCellText';
import { TableRegion } from '../../shared/components/TableRegion';
import { EvidenceFile } from './GeoObservationDrawer';

type ObservationArticleResult = Omit<Schema<'GeoArticleResultCreate'>, 'discovered' | 'mentioned'> & {
  discovered: boolean | null;
  mentioned: boolean | null;
};

type ObservationFormValues = Omit<
  Schema<'GeoObservationCreate'>,
  'article_results' | 'attachment_file_ids' | 'tested_at'
> & {
  tested_at: string;
  article_results: ObservationArticleResult[];
};

const accuracyOptions: Array<{
  label: string;
  value: NonNullable<Schema<'GeoArticleResultCreate'>['accuracy']>;
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

export function GeoObservationForm({
  open,
  correctionId,
  initialProductId,
  initialQueryTopicId,
  initialSearchPlatform,
  initialSearchQuery,
  onClose,
  onCreated,
}: {
  open: boolean;
  correctionId?: string;
  initialProductId?: string;
  initialQueryTopicId?: string;
  initialSearchPlatform?: string;
  initialSearchQuery?: string;
  onClose: () => void;
  onCreated: (observation: GeoObservation) => void;
}) {
  const [form] = Form.useForm<ObservationFormValues>();
  const [attachments, setAttachments] = useState<FileRecord[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const correction = useQuery({ ...geoObservationQueryOptions(correctionId), enabled: open && !!correctionId });
  const correctionRecord = isManualObservation(correction.data) ? correction.data : undefined;
  const watchedProductId = Form.useWatch('product_id', form);
  const productId = correctionRecord?.product_id ?? watchedProductId;
  const products = useQuery({ ...productsQueryOptions(productSearch), enabled: open && !correctionId });
  const topics = useQuery({ ...queryTopicsQueryOptions(), enabled: open });
  const publications = useQuery({
    ...geoPublicationCandidatesQueryOptions(productId),
    enabled: open && !!productId && !correctionId,
  });
  const articleRows: Array<Schema<'GeoPublicationCandidate'> | Schema<'GeoArticleResult'>> = correctionRecord
    ? correctionRecord.article_results
    : publications.data?.items ?? [];

  useEffect(() => {
    if (!open) return;
    if (correctionRecord) {
      form.setFieldsValue({
        product_id: correctionRecord.product_id,
        query_topic_id: correctionRecord.query_topic_id ?? undefined,
        search_platform: correctionRecord.search_platform,
        search_query: correctionRecord.search_query,
        tested_at: localDateTime(new Date(correctionRecord.tested_at)),
        article_results: correctionRecord.article_results.map((item) => ({
          published_article_id: item.published_article_id,
          discovered: item.discovered,
          mentioned: item.mentioned,
          accuracy: item.accuracy,
        })),
        notes: correctionRecord.notes,
        supersedes_id: correctionRecord.id,
      });
    } else if (!correctionId) {
      form.resetFields();
      form.setFieldsValue({
        product_id: initialProductId,
        query_topic_id: initialQueryTopicId,
        search_platform: initialSearchPlatform,
        search_query: initialSearchQuery,
        tested_at: localDateTime(new Date()),
        article_results: [],
        notes: '',
      });
    }
  }, [
    correctionId,
    correctionRecord,
    form,
    initialProductId,
    initialQueryTopicId,
    initialSearchPlatform,
    initialSearchQuery,
    open,
  ]);

  useEffect(() => {
    if (correctionId || !publications.data?.items.length) return;
    const priorResults: ObservationArticleResult[] = form.getFieldValue('article_results') ?? [];
    const priorByPublication = new Map(priorResults.map((item) => [item.published_article_id, item]));
    form.setFieldValue('article_results', publications.data.items.map((item) => ({
      published_article_id: item.published_article_id,
      discovered: priorByPublication.get(item.published_article_id)?.discovered ?? false,
      mentioned: priorByPublication.get(item.published_article_id)?.mentioned ?? false,
      accuracy: priorByPublication.get(item.published_article_id)?.accuracy ?? null,
    })));
  }, [correctionId, form, publications.data]);

  const close = () => {
    form.resetFields();
    setAttachments([]);
    setProductSearch('');
    onClose();
  };
  const create = useMutation({
    mutationFn: async (values: ObservationFormValues) => {
      const articleResults = values.article_results.map((item) => {
        if (item.discovered === null || item.mentioned === null) {
          throw new Error('请先明确所有历史未采集的发现和提及结果');
        }
        return {
          ...item,
          discovered: item.discovered,
          mentioned: item.mentioned,
        };
      });
      return unwrap(await api.POST('/api/v1/geo-observations', {
        params: { header: csrfHeader() },
        body: {
          ...values,
          tested_at: new Date(values.tested_at).toISOString(),
          article_results: articleResults,
          attachment_file_ids: attachments.map((item) => item.id),
          supersedes_id: correctionRecord?.id,
        },
      }));
    },
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
  const missingPublications = !correctionId && !!productId && !publications.isLoading
    && !publications.error && !publications.data?.items.length;
  const canCorrect = !correctionId || !!correctionRecord?.available_actions.includes('CORRECT');
  const correctionError = correctionId && !correction.isLoading && (
    correction.error
    ?? (!correctionRecord ? new Error('仅当前人工观测记录可以更正') : null)
    ?? (!canCorrect ? new Error('当前记录不可更正') : null)
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
        disabled={(!correctionId && (products.isLoading || !!products.error))
          || !canCorrect
          || topics.isLoading || !!topics.error || !!correctionError || correction.isLoading}
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
          title="发现、提及和准确性是相互独立的事实；新观测未勾选表示明确的“否”，历史未采集值必须明确选择，准确性可以不判断。"
        />
        {!productId && <Alert className="form-alert" type="info" showIcon title="请先选择产品，再逐篇核对搜索结果。" />}
        {!correctionId && publications.isLoading && <QueryLoading label="正在加载产品文章" />}
        {!correctionId && publications.error && <QueryFailure error={publications.error} onRetry={() => { void publications.refetch(); }} />}
        {missingPublications && <Alert className="form-alert" type="warning" showIcon title="该产品暂无具有公开链接的已发布文章，请先完成发布登记。" />}
        {!!articleRows.length && (
          <TableRegion label="产品文章观测结果">
            <Table<Schema<'GeoPublicationCandidate'> | Schema<'GeoArticleResult'>>
              rowKey="published_article_id"
              dataSource={articleRows}
              pagination={false}
              scroll={{ x: 780 }}
              columns={[
                { title: '文章', dataIndex: 'title', width: 180, ellipsis: true, render: (value) => <TableCellText text={value} /> },
                { title: '平台', dataIndex: 'platform_name', width: 110, ellipsis: true, render: (value) => <TableCellText text={value} /> },
                { title: '链接', dataIndex: 'final_url', width: 110, render: (url) => <a href={url} target="_blank" rel="noreferrer">查看文章</a> },
                {
                  title: '发现', width: 120, render: (_, item, index) => <>
                    <Form.Item name={['article_results', index, 'published_article_id']} hidden><Input /></Form.Item>
                    {correctionRecord?.article_results[index]?.discovered === null ? (
                      <Form.Item
                        name={['article_results', index, 'discovered']}
                        rules={[{
                          validator: (_, value) => typeof value === 'boolean'
                            ? Promise.resolve()
                            : Promise.reject(new Error('请选择是否发现')),
                        }]}
                        style={{ margin: 0 }}
                      >
                        <Select
                          aria-label={`是否发现：${item.title}`}
                          placeholder="历史未采集"
                          options={[{ label: '是', value: true }, { label: '否', value: false }]}
                        />
                      </Form.Item>
                    ) : (
                      <Form.Item name={['article_results', index, 'discovered']} valuePropName="checked" style={{ margin: 0 }}>
                        <Checkbox
                          aria-label={`是否发现：${item.title}`}
                        >已发现</Checkbox>
                      </Form.Item>
                    )}
                  </>,
                },
                {
                  title: '提及', width: 120, render: (_, item, index) => (
                    correctionRecord?.article_results[index]?.mentioned === null ? (
                      <Form.Item
                        name={['article_results', index, 'mentioned']}
                        rules={[{
                          validator: (_, value) => typeof value === 'boolean'
                            ? Promise.resolve()
                            : Promise.reject(new Error('请选择是否提及')),
                        }]}
                        style={{ margin: 0 }}
                      >
                        <Select
                          aria-label={`是否提及：${item.title}`}
                          placeholder="历史未采集"
                          options={[{ label: '是', value: true }, { label: '否', value: false }]}
                        />
                      </Form.Item>
                    ) : (
                      <Form.Item name={['article_results', index, 'mentioned']} valuePropName="checked" style={{ margin: 0 }}>
                        <Checkbox
                          aria-label={`是否提及：${item.title}`}
                        >已提及</Checkbox>
                      </Form.Item>
                    )
                  ),
                },
                {
                  title: '准确性', width: 140, render: (_, item, index) => (
                    <Form.Item name={['article_results', index, 'accuracy']} style={{ margin: 0 }}>
                      <Select
                        aria-label={`准确性：${item.title}`}
                        allowClear
                        placeholder="未判断"
                        options={accuracyOptions}
                      />
                    </Form.Item>
                  ),
                },
              ]}
            />
          </TableRegion>
        )}

        {correctionRecord && (
          <Form.Item label={`已有证据截图（${correctionRecord.attachment_file_ids.length}）`}>
            {correctionRecord.attachment_file_ids.length
              ? <div className="geo-evidence-grid">{correctionRecord.attachment_file_ids.map((id) => <EvidenceFile key={id} fileId={id} />)}</div>
              : <Typography.Text type="secondary">此前没有上传证据截图</Typography.Text>}
          </Form.Item>
        )}
        <Form.Item label={correctionRecord ? '新增证据截图（可选）' : '证据截图（可选）'} extra="截图用于补充真实搜索结果证据；系统不会自动解析或联网复查。">
          <DirectUpload category="OPERATION_SCREENSHOT" disabled={!canCorrect} onUploaded={(file) => setAttachments((items) => [...items, file])} />
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
          disabled={!canCorrect || missingProducts || missingTopics || missingPublications || !articleRows.length}
        >
          {correctionId ? '追加更正记录' : '追加观测记录'}
        </Button>
      </Form>
    </Modal>
  );
}
