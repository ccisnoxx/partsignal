/** URL 驱动的观测详情抽屉，按只读投影展示历史、发布内容与证据。 */
import { EditOutlined, LinkOutlined } from '@ant-design/icons';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  Alert, Button, Descriptions, Divider, Drawer, Empty, Grid, Image, Space, Typography,
} from 'antd';
import { api, errorMessage, unwrap } from '../../shared/api/client';
import { geoObservationQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { GeoObservation, PublicationRecord } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { StatusTag } from '../../shared/components/StatusTag';

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

function HistoricalFact({ value, yes, no }: { value: boolean | null; yes: string; no: string }) {
  return <Typography.Text type={value === null ? 'secondary' : undefined}>{value === null ? '历史未采集' : value ? yes : no}</Typography.Text>;
}

export function EvidenceFile({ fileId }: { fileId: string }) {
  const file = useQuery({
    queryKey: queryKeys.files.detail(fileId),
    queryFn: async () => unwrap(await api.GET('/api/v1/files/{file_id}', { params: { path: { file_id: fileId } } })),
  });
  const download = useQuery({
    queryKey: queryKeys.files.download(fileId),
    queryFn: async () => unwrap(await api.GET('/api/v1/files/{file_id}/download-url', { params: { path: { file_id: fileId } } })),
    enabled: file.data?.status === 'VERIFIED',
    staleTime: 0,
    gcTime: 0,
  });
  if (file.isLoading || download.isLoading) return <QueryLoading label="正在加载证据截图" />;
  if (file.error || download.error || !file.data || !download.data) {
    return <Alert type="error" showIcon title={errorMessage(file.error ?? download.error ?? new Error('证据文件不存在'))} />;
  }
  if (file.data.content_type.startsWith('image/')) {
    return (
      <figure className="geo-evidence-item">
        <Image src={download.data.url} alt={file.data.original_filename} />
        <figcaption>{file.data.original_filename}</figcaption>
      </figure>
    );
  }
  return <Button href={download.data.url} target="_blank" icon={<LinkOutlined />}>{file.data.original_filename}</Button>;
}

function LegacyPublications({ ids }: { ids: string[] }) {
  const publications = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.publications.record(id),
      queryFn: async () => unwrap(await api.GET('/api/v1/publication-records/{publication_id}', {
        params: { path: { publication_id: id } },
      })),
    })),
  });
  if (!ids.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未关联发布内容" />;
  const error = publications.find((query) => query.error)?.error;
  if (error) return <Alert type="error" showIcon title={errorMessage(error)} />;
  if (publications.some((query) => query.isLoading)) return <QueryLoading label="正在加载关联发布内容" />;
  return <PublicationList items={publications.flatMap((query) => query.data ? [query.data] : [])} />;
}

function PublicationList({ items }: { items: PublicationRecord[] }) {
  if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未关联发布内容" />;
  return (
    <div className="geo-detail-list">
      {items.map((item) => (
        <div className="geo-detail-list-item" key={item.id}>
          <Space orientation="vertical" size={4}>
            <Space wrap><Typography.Text strong>{item.content_title}</Typography.Text><StatusTag status={item.status} /></Space>
            <Typography.Text type="secondary">{item.platform_profile_name} · V{item.content_version}</Typography.Text>
            {item.final_url
              ? <a href={item.final_url} target="_blank" rel="noreferrer">查看发布内容 <LinkOutlined /></a>
              : <Typography.Text type="secondary">尚无公开链接</Typography.Text>}
          </Space>
        </div>
      ))}
    </div>
  );
}

function ManualDetails({ record }: { record: Extract<GeoObservation, { observation_kind: 'MANUAL_ARTICLE_SEARCH' }> }) {
  const hasHistoricalGaps = record.query_topic_id === null || record.article_results.some((item) => (
    item.discovered === null || item.mentioned === null
  ));
  return (
    <>
      <Typography.Title level={5}>完整搜索词</Typography.Title>
      <Typography.Paragraph className="geo-detail-question">{record.search_query}</Typography.Paragraph>
      {hasHistoricalGaps && <Alert className="geo-detail-note" type="warning" showIcon title="该记录存在补采前未采集事实；未知值保持未知，不按“否”推断。" />}
      <Typography.Title level={5}>逐篇观测结论</Typography.Title>
      {record.article_results.length ? (
        <div className="geo-detail-list">
          {record.article_results.map((item) => (
            <div className="geo-detail-list-item" key={item.publication_record_id}>
              <Space orientation="vertical" size={4}>
                <Typography.Text strong>{item.title}</Typography.Text>
                <Typography.Text type="secondary">{item.platform_name}</Typography.Text>
                <Space wrap size={[12, 4]}>
                  <span>发现：<HistoricalFact value={item.discovered} yes="已发现" no="未发现" /></span>
                  <span>提及：<HistoricalFact value={item.mentioned} yes="已提及" no="未提及" /></span>
                  <span>准确性：{item.accuracy === null ? <Typography.Text type="secondary">未判断</Typography.Text> : <StatusTag status={item.accuracy} />}</span>
                </Space>
                <a href={item.final_url} target="_blank" rel="noreferrer">查看发布内容 <LinkOutlined /></a>
              </Space>
            </div>
          ))}
        </div>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有逐篇观测结果" />}
    </>
  );
}

function LegacyDetails({ record }: { record: Extract<GeoObservation, { observation_kind: 'LEGACY_MODEL_RESULT' }> }) {
  return (
    <>
      <Typography.Title level={5}>完整问题</Typography.Title>
      <Typography.Paragraph className="geo-detail-question">{record.actual_prompt}</Typography.Paragraph>
      <Typography.Title level={5}>历史回答摘要</Typography.Title>
      <Typography.Paragraph>{record.answer_summary}</Typography.Paragraph>
      <Typography.Title level={5}>观测结论</Typography.Title>
      <Space wrap>
        <StatusTag status={record.mentioned ? 'MENTIONED' : 'NOT_MENTIONED'} />
        <StatusTag status={record.accuracy} />
      </Space>
      <Typography.Title level={5}>关联发布内容</Typography.Title>
      <LegacyPublications ids={record.publication_record_ids} />
    </>
  );
}

function DetailContent({ record }: { record: GeoObservation }) {
  return (
    <div className="geo-detail-content">
      <Space wrap className="geo-detail-tags">
        <StatusTag status={record.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? 'MANUAL_ARTICLE_SEARCH' : 'LEGACY_MODEL_RESULT'} />
        <StatusTag status={record.is_current ? 'CURRENT' : 'HISTORICAL'} />
      </Space>
      <Descriptions
        size="small"
        column={1}
        items={[
          { label: '产品', children: record.product_label },
          {
            label: '问题主题 ID',
            children: record.query_topic_id
              ? <Typography.Text copyable className="data-code">{record.query_topic_id}</Typography.Text>
              : <Typography.Text type="secondary">历史未采集</Typography.Text>,
          },
          { label: record.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? '搜索平台' : '观测模型', children: record.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? record.search_platform : `${record.model_name}${record.model_version ? ` ${record.model_version}` : ''}` },
          { label: '观测时间', children: formatDateTime(record.tested_at) },
          { label: '记录人', children: `${record.recorder.display_name}（${record.recorder.username}）` },
        ]}
      />
      <Divider />
      {record.observation_kind === 'MANUAL_ARTICLE_SEARCH' ? <ManualDetails record={record} /> : <LegacyDetails record={record} />}
      <Divider />
      <Typography.Title level={5}>证据截图（{record.attachment_file_ids.length}）</Typography.Title>
      {record.attachment_file_ids.length
        ? <div className="geo-evidence-grid">{record.attachment_file_ids.map((id) => <EvidenceFile key={id} fileId={id} />)}</div>
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有证据截图" />}
      <Divider />
      <Typography.Title level={5}>人工备注</Typography.Title>
      <Typography.Paragraph>{record.notes || '未填写备注'}</Typography.Paragraph>
      <Divider />
      <Typography.Title level={5}>记录信息</Typography.Title>
      <Descriptions
        size="small"
        column={1}
        items={[
          { label: '记录 ID', children: <Typography.Text copyable className="data-code">{record.id}</Typography.Text> },
          { label: '创建时间', children: formatDateTime(record.created_at) },
          { label: '更正原记录', children: record.supersedes_id ? <Typography.Text copyable className="data-code">{record.supersedes_id}</Typography.Text> : '—' },
        ]}
      />
    </div>
  );
}

export function GeoObservationDrawer({ recordId, onClose, onCorrect }: {
  recordId?: string;
  onClose: () => void;
  onCorrect: (recordId: string) => void;
}) {
  const screens = Grid.useBreakpoint();
  const observation = useQuery(geoObservationQueryOptions(recordId));
  const canCorrect = observation.data?.available_actions.includes('CORRECT');
  return (
    <Drawer
      title="观测详情"
      placement="right"
      open={!!recordId}
      size={screens.md ? 380 : '100%'}
      maskClosable
      onClose={onClose}
      destroyOnHidden
      className="geo-detail-drawer"
      extra={canCorrect && recordId ? <Button icon={<EditOutlined />} onClick={() => onCorrect(recordId)}>更正</Button> : undefined}
    >
      {observation.isLoading && <QueryLoading label="正在加载观测详情" />}
      {observation.error && <QueryFailure error={observation.error} onRetry={() => { void observation.refetch(); }} />}
      {observation.data && <DetailContent record={observation.data} />}
    </Drawer>
  );
}
