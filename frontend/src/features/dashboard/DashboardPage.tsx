/** 工作台用真实 GEO 结果和行动计数提供管理层即时概览。 */
import {
  ArrowRightOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  PieChartOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { dashboardSummaryQueryOptions, geoMetricsQueryOptions } from '../../shared/api/queryOptions';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageHeader } from '../../shared/components/PageHeader';
import { useAuth } from '../auth/AuthProvider';

const shortcuts = [
  { label: '产品事实', description: '查看事实与审核', to: '/products', icon: <DatabaseOutlined /> },
  { label: '内容任务', description: '处理生成与审核', to: '/tasks', icon: <FileTextOutlined /> },
  { label: '人工发布', description: '登记并跟进发布', to: '/publications', icon: <RocketOutlined /> },
  { label: 'GEO 观测', description: '记录与查看观测', to: '/observations', icon: <BarChartOutlined /> },
] as const;

export function DashboardPage() {
  const auth = useAuth();
  const summary = useQuery(dashboardSummaryQueryOptions());
  const metrics = useQuery(geoMetricsQueryOptions());
  const rate = (value: number | null | undefined) => value == null ? null : Math.round(value * 100);
  const articleRecommendationRate = rate(metrics.data?.article_recommendation_rate);
  const reviewNeedsAction = !!(summary.data?.pending_fact_reviews || summary.data?.pending_content_reviews);
  const publicationNeedsAttention = !!summary.data?.publication_attention;
  const publicationNeedsAction = publicationNeedsAttention || !!summary.data?.pending_publications;
  const geoNeedsAttention = !!summary.data?.recent_accuracy_errors;
  const geoNeedsAction = geoNeedsAttention || !!metrics.data?.not_recommended_article_count;
  const pendingItems = [
    { label: '发布需关注', description: '开放的发布关注记录', value: summary.data?.publication_attention ?? 0, to: '/publications', tone: 'danger' },
    { label: '近 30 日准确性问题', description: '部分准确或不准确的模型观测', value: summary.data?.recent_accuracy_errors ?? 0, to: '/observations', tone: 'danger' },
    { label: '待审事实', description: '等待人工审核的事实版本', value: summary.data?.pending_fact_reviews ?? 0, to: '/products', tone: 'warning' },
    { label: '待审内容', description: '等待人工审核的内容版本', value: summary.data?.pending_content_reviews ?? 0, to: '/tasks', tone: 'warning' },
    { label: '待人工发布', description: '已进入人工发布环节的记录', value: summary.data?.pending_publications ?? 0, to: '/publications', tone: 'warning' },
    { label: '未推荐文章', description: '人工观测中尚未获得推荐的文章', value: metrics.data?.not_recommended_article_count ?? 0, to: '/observations', tone: 'warning' },
  ];
  const priorityItems = pendingItems.filter((item) => item.tone === 'danger' || item.label === '待人工发布');

  return (
    <div className="page-stack dashboard-page">
      <PageHeader
        title="总览"
        description={<>你好，<strong>{auth.user?.display_name}</strong>。以下数据来自当前有效业务记录。</>}
      />

      {summary.isLoading || metrics.isLoading ? (
        <Card className="dashboard-glass-panel dashboard-query-state">
          <QueryLoading label="正在加载工作台" />
        </Card>
      ) : summary.error || metrics.error ? (
        <Card className="dashboard-glass-panel dashboard-query-state">
          <QueryFailure error={summary.error ?? metrics.error} onRetry={() => { void summary.refetch(); void metrics.refetch(); }} />
        </Card>
      ) : (
        <>
          <section className="dashboard-kpi-grid" aria-label="GEO 管理指标">
            <div className="dashboard-metric-cell"><span className="dashboard-metric-icon dashboard-metric-purple" aria-hidden="true"><EyeOutlined /></span><MetricTile label="人工观测" value={metrics.data?.manual_observation_count ?? 0} meta="当前有效记录" /></div>
            <div className="dashboard-metric-cell"><span className="dashboard-metric-icon dashboard-metric-blue" aria-hidden="true"><FileTextOutlined /></span><MetricTile label="文章结果" value={metrics.data?.article_result_count ?? 0} meta="逐篇人工判断" tone="data" /></div>
            <div className="dashboard-metric-cell"><span className="dashboard-metric-icon dashboard-metric-green" aria-hidden="true"><CheckCircleOutlined /></span><MetricTile label="已推荐文章" value={metrics.data?.recommended_article_count ?? 0} meta={`未推荐 ${metrics.data?.not_recommended_article_count ?? 0} 篇`} tone="success" /></div>
            <div className="dashboard-metric-cell"><span className="dashboard-metric-icon dashboard-metric-orange" aria-hidden="true"><PieChartOutlined /></span><MetricTile label="文章推荐率" value={articleRecommendationRate ?? '—'} unit={articleRecommendationRate == null ? undefined : '%'} percent={articleRecommendationRate} meta={articleRecommendationRate == null ? '暂无文章结果' : '已推荐 / 全部文章结果'} tone="data" /></div>
          </section>

          <Card title="运营状态摘要" className="dashboard-glass-panel dashboard-status-panel">
            <div className="dashboard-status-grid">
              <section className={`dashboard-status-item dashboard-status-${reviewNeedsAction ? 'warning' : 'success'}`} aria-label="审核流程状态">
                <span className="dashboard-status-icon" aria-hidden="true">{reviewNeedsAction ? <ExclamationCircleOutlined /> : <CheckCircleOutlined />}</span>
                <div className="dashboard-status-copy"><Typography.Text strong>审核流程</Typography.Text><Badge status={reviewNeedsAction ? 'warning' : 'success'} text={reviewNeedsAction ? '待处理' : '正常'} /><Typography.Text type="secondary">待审事实 {summary.data?.pending_fact_reviews ?? 0} · 待审内容 {summary.data?.pending_content_reviews ?? 0}</Typography.Text></div>
              </section>
              <section className={`dashboard-status-item dashboard-status-${publicationNeedsAttention ? 'danger' : publicationNeedsAction ? 'warning' : 'success'}`} aria-label="发布流程状态">
                <span className="dashboard-status-icon" aria-hidden="true">{publicationNeedsAction ? <ExclamationCircleOutlined /> : <CheckCircleOutlined />}</span>
                <div className="dashboard-status-copy"><Typography.Text strong>发布流程</Typography.Text><Badge status={publicationNeedsAttention ? 'error' : publicationNeedsAction ? 'warning' : 'success'} text={publicationNeedsAttention ? '需关注' : publicationNeedsAction ? '待处理' : '正常'} /><Typography.Text type="secondary">待人工发布 {summary.data?.pending_publications ?? 0} · 发布需关注 {summary.data?.publication_attention ?? 0}</Typography.Text></div>
              </section>
              <section className={`dashboard-status-item dashboard-status-${geoNeedsAttention ? 'danger' : geoNeedsAction ? 'warning' : 'success'}`} aria-label="GEO 观测状态">
                <span className="dashboard-status-icon" aria-hidden="true">{geoNeedsAction ? <ExclamationCircleOutlined /> : <CheckCircleOutlined />}</span>
                <div className="dashboard-status-copy"><Typography.Text strong>GEO 观测</Typography.Text><Badge status={geoNeedsAttention ? 'error' : geoNeedsAction ? 'warning' : 'success'} text={geoNeedsAttention ? '需关注' : geoNeedsAction ? '待跟进' : '正常'} /><Typography.Text type="secondary">未推荐文章 {metrics.data?.not_recommended_article_count ?? 0} · 准确性问题 {summary.data?.recent_accuracy_errors ?? 0}</Typography.Text></div>
              </section>
            </div>
          </Card>

          <div className="dashboard-work-grid">
            <Card title="待处理事项" className="dashboard-glass-panel dashboard-actions-panel">
              <div className="dashboard-action-header" aria-hidden="true"><span>事项</span><span>数量</span><span>状态</span><span>操作</span></div>
              <ul className="dashboard-action-list">
                {pendingItems.map((item) => (
                  <li key={item.label} className={`dashboard-action-item dashboard-action-${item.tone}${item.value === 0 ? ' is-clear' : ''}`}>
                    <div className="dashboard-action-main">
                      <span className="dashboard-action-icon" aria-hidden="true">{item.value > 0 ? <ExclamationCircleOutlined /> : <CheckCircleOutlined />}</span>
                      <span className="dashboard-action-copy">
                        <Typography.Text strong>{item.label}</Typography.Text>
                        <small>{item.value > 0 ? item.description : '当前无需处理'}</small>
                      </span>
                    </div>
                    <span className="dashboard-action-count">{item.value}</span>
                    <span className="dashboard-action-state">{item.value > 0 ? item.tone === 'danger' ? '需关注' : '待处理' : '已清零'}</span>
                    <Link to={item.to} aria-label={`处理${item.label}`}>去处理 <ArrowRightOutlined /></Link>
                  </li>
                ))}
              </ul>
            </Card>

            <aside className="dashboard-side-stack" aria-label="运营辅助入口">
              <Card title="快捷入口" className="dashboard-glass-panel dashboard-shortcuts-panel">
                <nav className="dashboard-shortcut-grid" aria-label="工作流快捷入口">
                  {shortcuts.map((item) => (
                    <Link key={item.to} className="dashboard-shortcut" to={item.to} aria-label={`进入${item.label}`}>
                      <span className="dashboard-shortcut-icon" aria-hidden="true">{item.icon}</span>
                      <span className="dashboard-shortcut-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                    </Link>
                  ))}
                </nav>
              </Card>
              <Card title="重点提醒" className="dashboard-glass-panel dashboard-priority-panel">
                <div className="dashboard-priority-list">
                  {priorityItems.map((item) => <Link key={item.label} className={item.value === 0 ? 'is-clear' : undefined} to={item.to} aria-label={`查看${item.label}`}><span>{item.label}</span><strong>{item.value}</strong><ArrowRightOutlined aria-hidden="true" /></Link>)}
                </div>
              </Card>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
