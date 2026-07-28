/** 发布详情只读保留历史，所有状态命令统一回到发布管理 Drawer。 */
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Descriptions, Space, Timeline, Typography } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { QUERY_STALE_TIME } from '../../app/queryClient';
import { api, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';

export function PublicationDetailPage({ publicationId }: { publicationId: string }) {
  const navigate = useNavigate();
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
  if (detail.isLoading) return <QueryLoading />;
  if (detail.error || !detail.data) return <div className="page-stack"><Button className="back-link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/publications')}>返回发布管理</Button><PageHeader title="发布记录" breadcrumbs={[{ title: <Link to="/publications">发布管理</Link> }, { title: '发布记录' }]} /><QueryFailure error={detail.error ?? new Error('发布记录不存在')} onRetry={() => void detail.refetch()} /></div>;
  const record = detail.data;
  return (
    <div className="page-stack">
      <Button className="back-link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/publications')}>返回发布管理</Button>
      <PageHeader
        eyebrow="发布记录"
        title="发布记录"
        description={<>记录 ID <span className="data-code">{record.id}</span></>}
        breadcrumbs={[{ title: <Link to="/publications">发布管理</Link> }, { title: '发布记录' }]}
        actions={(
          <Space wrap>
            <StatusTag status={record.status} />
            <Button type={record.available_actions.length ? 'primary' : 'default'} onClick={() => navigate(`/publications?record=${record.id}`)}>
              {record.available_actions.length ? '在工作台处理' : '在工作台查看'}
            </Button>
          </Space>
        )}
      />
      <Card title="发布上下文" className="workspace-panel">
        <Descriptions
          column={1}
          items={[
            { label: '状态', children: <StatusTag status={record.status} /> },
            { label: '锁定内容', children: `${record.content_title} · V${record.content_version}` },
            { label: '目标平台', children: record.platform_profile_name },
            { label: '发布账号', children: `${record.platform_account_label} / ${record.account_identifier}` },
            { label: '内容任务', children: <Link className="data-code" to={`/tasks/${record.task_id}`}>{record.task_id}</Link> },
            { label: '栏目', children: record.section_url },
            { label: '实际标题', children: record.actual_title ?? '—' },
            { label: '最终 URL', children: record.final_url ?? '—' },
            { label: '发布时间', children: record.published_at ? new Date(record.published_at).toLocaleString('zh-CN') : '—' },
            { label: '内容哈希', children: <span className="data-code">{record.content_hash}</span> },
          ]}
        />
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
        {record.attachments.length > 0 && (
          <>
            <Typography.Title level={5}>已关联证据</Typography.Title>
            <ul>{record.attachments.map((file) => <li key={file.id}>{file.original_filename}</li>)}</ul>
          </>
        )}
      </Card>
    </div>
  );
}
