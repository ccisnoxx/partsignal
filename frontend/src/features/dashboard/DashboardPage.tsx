/** 工作台展示待办、生成失败与 GEO 基础指标的即时概览。 */
import { useQuery } from '@tanstack/react-query';
import { ArrowRightOutlined } from '@ant-design/icons';
import { Button, Card, Col, Progress, Row, Space, Statistic, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../../shared/api/client';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';

export function DashboardPage() {
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: async () => unwrap(await api.GET('/api/v1/dashboard/summary')) });
  const metrics = useQuery({ queryKey: ['geo-metrics'], queryFn: async () => unwrap(await api.GET('/api/v1/geo-metrics')) });
  if (summary.isLoading || metrics.isLoading) return <QueryLoading />;
  if (summary.error || metrics.error) return <QueryFailure error={summary.error ?? metrics.error} />;
  const rate = (value: number | null | undefined) => Math.round((value ?? 0) * 100);

  return (
    <div className="page-stack">
      <header className="page-hero">
        <div><Typography.Text className="eyebrow">OPERATIONS PULSE</Typography.Text><Typography.Title>今天的内容链路</Typography.Title>
        <Typography.Paragraph>从待审事实到公开引用，每一步都由真实业务状态驱动。</Typography.Paragraph></div>
        <Button type="primary" size="large"><Link to="/tasks">创建内容任务 <ArrowRightOutlined /></Link></Button>
      </header>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}><Card><Statistic title="待审事实" value={summary.data?.pending_fact_reviews ?? 0} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="待审内容" value={summary.data?.pending_content_reviews ?? 0} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="待人工发布" value={summary.data?.pending_publications ?? 0} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="发布需关注" value={summary.data?.publication_attention ?? 0} valueStyle={{ color: summary.data?.publication_attention ? '#b42318' : undefined }} /></Card></Col>
      </Row>
      <Card title="GEO 信号" extra={<Link to="/observations">查看观测明细</Link>}>
        <Row gutter={[32, 24]}>
          {[
            ['提及率', metrics.data?.mention_rate], ['推荐率', metrics.data?.recommendation_rate],
            ['引用率', metrics.data?.citation_rate], ['准确率', metrics.data?.accuracy_rate],
          ].map(([label, value]) => <Col xs={12} lg={6} key={String(label)}><Space direction="vertical"><Typography.Text type="secondary">{label}</Typography.Text><Progress type="dashboard" size={104} percent={rate(value as number | null)} strokeColor="#d85f36" /></Space></Col>)}
        </Row>
        <Typography.Text type="secondary">当前样本 {metrics.data?.sample_count ?? 0} 条；无法判断的样本不进入准确率分母。</Typography.Text>
      </Card>
    </div>
  );
}
