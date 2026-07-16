/** 展示管理员配置相关审计记录。 */
import { useQuery } from '@tanstack/react-query';
import { Card, Table } from 'antd';
import { QUERY_STALE_TIME } from '../../app/queryClient';
import { api, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { TableRegion } from '../../shared/components/TableRegion';

export function AuditLogPage() {
  const audit = useQuery({
    queryKey: queryKeys.auditLogs,
    queryFn: async () => unwrap(await api.GET('/api/v1/audit-logs', { params: { query: { page: 1, page_size: 100 } } })),
    staleTime: QUERY_STALE_TIME.configuration,
  });
  const items = audit.data?.items ?? [];
  return <div className="page-stack">
    <PageHeader eyebrow="治理记录" title="审计日志" description="查看配置与管理操作留下的审计记录。" />
    <Card className="collection-panel">{audit.isLoading ? <QueryLoading label="正在加载审计日志" /> : audit.error ? <QueryFailure error={audit.error} onRetry={() => void audit.refetch()} /> : items.length === 0 ? <NoData description="暂无审计记录" /> : <TableRegion label="审计日志"><Table<Schema<'AuditLog'>> rowKey="id" dataSource={items} scroll={{ x: 900 }} columns={[
      { title: '时间', dataIndex: 'created_at', render: (value) => <span className="data-code">{new Date(value).toLocaleString('zh-CN')}</span> },
      { title: '动作', dataIndex: 'action' },
      { title: '对象', render: (_, row) => <span className="data-code">{row.target_type} / {row.target_id}</span> },
      { title: '请求 ID', dataIndex: 'request_id', render: (value) => <span className="data-code configuration-break-text">{value}</span> },
    ]} /></TableRegion>}</Card>
  </div>;
}
