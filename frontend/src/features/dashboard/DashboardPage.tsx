/** 工作台展示待办、生成失败与 GEO 基础指标的即时概览。 */
import { ArrowRightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Typography } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { dashboardSummaryQueryOptions, geoMetricsQueryOptions } from '../../shared/api/queryOptions';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageHeader } from '../../shared/components/PageHeader';

export function DashboardPage() {
  const navigate = useNavigate();
  const summary = useQuery(dashboardSummaryQueryOptions());
  const metrics = useQuery(geoMetricsQueryOptions());
  if (summary.isLoading || metrics.isLoading) return <QueryLoading label="正在加载工作台" />;
  if (summary.error || metrics.error) return <QueryFailure error={summary.error ?? metrics.error} onRetry={() => { void summary.refetch(); void metrics.refetch(); }} />;
  const rate = (value: number | null | undefined) => value == null ? null : Math.round(value * 100);
  const geoMetrics = [
    { label: '提及率', value: rate(metrics.data?.mention_rate) },
    { label: '推荐率', value: rate(metrics.data?.recommendation_rate) },
    { label: '引用率', value: rate(metrics.data?.citation_rate) },
    { label: '准确率', value: rate(metrics.data?.accuracy_rate) },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        variant="hero"
        eyebrow="运营脉搏"
        title="今天的内容链路"
        description="从待审事实到公开引用，每一步都由真实业务状态驱动。"
        actions={<Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => navigate('/tasks')}>创建内容任务</Button>}
      />
      <section className="metric-grid" aria-label="需要行动的工作项">
        <MetricTile label="待审事实" value={summary.data?.pending_fact_reviews ?? 0} to="/products" />
        <MetricTile label="待审内容" value={summary.data?.pending_content_reviews ?? 0} to="/tasks" />
        <MetricTile label="待人工发布" value={summary.data?.pending_publications ?? 0} tone="data" to="/publications" />
        <MetricTile label="发布需关注" value={summary.data?.publication_attention ?? 0} tone={summary.data?.publication_attention ? 'danger' : 'default'} to="/publications" />
        <MetricTile label="近期准确性问题" value={summary.data?.recent_accuracy_errors ?? 0} tone={summary.data?.recent_accuracy_errors ? 'danger' : 'default'} to="/observations" />
      </section>
      <Card title="GEO 信号" extra={<Link to="/observations">查看观测明细</Link>} className="workspace-panel">
        <div className="geo-metric-grid">
          {geoMetrics.map((item) => <MetricTile key={item.label} label={item.label} value={item.value ?? '—'} unit={item.value == null ? undefined : '%'} percent={item.value} meta={item.value == null ? '无可判断样本' : '当前样本口径'} />)}
        </div>
        <Typography.Text type="secondary" className="sample-note">当前样本 {metrics.data?.sample_count ?? 0} 条；无法判断的样本不进入准确率分母。</Typography.Text>
      </Card>
    </div>
  );
}
