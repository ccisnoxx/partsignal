/** 工作台展示待办与人工 GEO 文章观测的即时概览。 */
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
  const articleRecommendationRate = rate(metrics.data?.article_recommendation_rate);

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
        <MetricTile label="待审事实" value={summary.data?.pending_fact_reviews ?? 0} tone={summary.data?.pending_fact_reviews ? 'warning' : 'default'} to="/products" />
        <MetricTile label="待审内容" value={summary.data?.pending_content_reviews ?? 0} tone={summary.data?.pending_content_reviews ? 'warning' : 'default'} to="/tasks" />
        <MetricTile label="待人工发布" value={summary.data?.pending_publications ?? 0} tone={summary.data?.pending_publications ? 'data' : 'default'} to="/publications" />
        <MetricTile label="发布需关注" value={summary.data?.publication_attention ?? 0} tone={summary.data?.publication_attention ? 'danger' : 'default'} to="/publications" />
        <MetricTile label="未推荐文章" value={metrics.data?.not_recommended_article_count ?? 0} tone={metrics.data?.not_recommended_article_count ? 'warning' : 'default'} to="/observations" />
      </section>
      <Card title="GEO 信号" extra={<Link to="/observations">查看观测明细</Link>} className="workspace-panel">
        <div className="geo-metric-grid">
          <MetricTile label="人工观测" value={metrics.data?.manual_observation_count ?? 0} meta="当前有效记录" />
          <MetricTile label="文章结果" value={metrics.data?.article_result_count ?? 0} meta="逐篇人工判断" />
          <MetricTile label="已推荐文章" value={metrics.data?.recommended_article_count ?? 0} meta={`未推荐 ${metrics.data?.not_recommended_article_count ?? 0} 篇`} />
          <MetricTile label="文章推荐率" value={articleRecommendationRate ?? '—'} unit={articleRecommendationRate == null ? undefined : '%'} percent={articleRecommendationRate} meta={articleRecommendationRate == null ? '暂无文章结果' : '已推荐 / 全部文章结果'} />
        </div>
        <Typography.Text type="secondary" className="sample-note">当前人工观测 {metrics.data?.manual_observation_count ?? 0} 条；文章链接与发布状态以发布记录为准。</Typography.Text>
      </Card>
    </div>
  );
}
