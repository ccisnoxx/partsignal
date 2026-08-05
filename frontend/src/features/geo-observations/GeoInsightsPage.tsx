/** GEO 分析洞察页：一个 URL 筛选对象驱动一个服务端读模型，并复用于浏览器打印。 */
import {
  DownOutlined, ExclamationCircleOutlined, ExportOutlined, FallOutlined, PrinterOutlined,
  TrophyOutlined, UpOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, DatePicker, Descriptions, Form, Modal, Select, Space, Table, Tooltip, Typography,
  type DescriptionsProps, type TableColumnsType,
} from 'antd';
import dayjs from 'dayjs';
import { useEffect, useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import { geoInsightsQueryOptions, platformProfilesQueryOptions, productsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { GeoInsightQuery, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';

type GeoInsights = Schema<'GeoInsights'>;
type FilterOptions = Schema<'GeoInsightFilterOptions'>;
type RateTrend = Schema<'GeoInsightRateTrend'>;
type RatePoint = Schema<'GeoInsightRatePoint'>;
type PlatformPerformance = Schema<'GeoInsightPlatformPerformance'>;
type ContentRow = Schema<'GeoInsightContentPerformance'> | Schema<'GeoInsightDecliningContent'> | Schema<'GeoInsightLongUnmentionedContent'>;
type DeclineBasis = Schema<'GeoInsightDeclineBasis'>;
type Recommendation = Schema<'GeoInsightRecommendation'>;
type CoverageStatus = Schema<'GeoInsightCoverageItem'>['status'];
type CoverageRow = Schema<'GeoInsightCoverageItem'>;
type OptimizationRequest = Schema<'GeoOptimizationContentTaskCreate'>;
type OptimizationTarget = Pick<OptimizationRequest, 'rule_code' | 'date_from' | 'date_to'>
  & Partial<Pick<OptimizationRequest, 'published_article_id' | 'query_topic_id' | 'geo_platform' | 'product_id' | 'platform_profile_id'>>;

const optionalFilterKeys = [
  'product_id', 'content_platform_id', 'geo_platform', 'published_article_id', 'query_topic_id',
] as const satisfies readonly (keyof GeoInsightQuery)[];

const coverageStatuses: Array<{
  status: CoverageStatus;
  countKey: keyof GeoInsights['question_coverage']['by_status'];
  label: string;
  description: string;
}> = [
  { status: 'STABLE', countKey: 'stable', label: '稳定覆盖', description: '覆盖率 ≥ 60%（≥3 次）' },
  { status: 'OCCASIONAL', countKey: 'occasional', label: '偶尔命中', description: '30%–60%（≥3 次）' },
  { status: 'UNCOVERED', countKey: 'uncovered', label: '尚未覆盖', description: '覆盖率 < 30%（≥3 次）' },
  { status: 'INSUFFICIENT_DATA', countKey: 'insufficient_data', label: '数据不足', description: '仅 0–2 次完整观测' },
];

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultDates(now = new Date()): Pick<GeoInsightQuery, 'date_from' | 'date_to'> {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 29);
  return { date_from: utcDateString(start), date_to: utcDateString(now) };
}

export function geoInsightFiltersFromParams(
  params: URLSearchParams,
  defaults = defaultDates(),
): GeoInsightQuery {
  const filters: GeoInsightQuery = {
    date_from: params.get('date_from') ?? defaults.date_from,
    date_to: params.get('date_to') ?? defaults.date_to,
  };
  optionalFilterKeys.forEach((key) => {
    const value = params.get(key);
    if (value !== null) filters[key] = value;
  });
  return filters;
}

function formatRate(value: number | null | undefined): string {
  return value == null ? '暂无数据' : `${(value * 100).toFixed(1)}%`;
}

function formatChange(value: number | null): string {
  if (value == null) return '不可计算';
  if (value === 0) return '0.0%';
  return `${value > 0 ? '↑' : '↓'} ${Math.abs(value * 100).toFixed(1)}%`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

const declineMetricLabels: Record<DeclineBasis['metric'], string> = {
  discovery_rate: '发现率',
  mention_rate: '提及率',
  accuracy_rate: '准确率',
};

function declineBasisText(basis: DeclineBasis): string {
  return `${declineMetricLabels[basis.metric]} ${formatRate(basis.previous_value)} → ${formatRate(basis.current_value)}（下降 ${(basis.decline * 100).toFixed(1)} 个百分点）`;
}

function rateMeta(value: Schema<'GeoInsightRateValue'>): string {
  return value.denominator ? `${value.numerator} / ${value.denominator} 条关系` : '无完整关系样本';
}

function pointX(index: number, count: number): number {
  return count <= 1 ? 50 : 6 + (index * 88) / (count - 1);
}

function trendPointDetail(point: RatePoint): string {
  return point.value == null
    ? '无样本'
    : `${formatRate(point.value)} · ${point.numerator} / ${point.denominator} 条关系`;
}

function TrendCard({ label, color, trend }: {
  label: string;
  color: string;
  trend: RateTrend;
}) {
  const points = trend.points;
  const tooltipId = useId();
  const [keyboardPointIndex, setKeyboardPointIndex] = useState<number>();
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number>();
  const activePointIndex = hoveredPointIndex ?? keyboardPointIndex;
  const activePoint = activePointIndex === undefined ? undefined : points[activePointIndex];
  const activeTooltip = activePoint ? `${activePoint.date} · ${trendPointDetail(activePoint)}` : undefined;
  const current = formatRate(trend.current.value);
  const previous = formatRate(trend.previous.value);
  const currentMeta = rateMeta(trend.current);
  const y = (value: number | null) => value == null ? 42 : 42 - value * 34;
  const currentDate = points[points.length - 1]?.date.slice(5).replace('-', '.') ?? '—';
  const firstDate = points[0]?.date ?? '无日期';
  const lastDate = points[points.length - 1]?.date ?? '无日期';
  const chartLabel = `${label}趋势：${firstDate} 至 ${lastDate}，当前 ${current}，上一周期 ${previous}，变化 ${formatChange(trend.change)}。${currentMeta}。使用左右方向键浏览每日数据。`;

  const handleChartKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const currentIndex = keyboardPointIndex ?? 0;
    let nextIndex: number;
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === 'ArrowRight') nextIndex = Math.min(points.length - 1, currentIndex + 1);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = points.length - 1;
    else return;
    event.preventDefault();
    setKeyboardPointIndex(nextIndex);
  };

  return (
    <article className="geo-insight-trend-card">
      <div className="geo-insight-trend-card-body">
        <div className="geo-insight-trend-current-badge" aria-hidden="true"><span>{currentDate}</span><strong>{current}</strong></div>
        <div className="geo-insight-trend-heading">
          <span>{label}</span>
          <strong>{current}</strong>
        </div>
        <div className="geo-insight-trend-meta">
          <span>上一周期 {previous}</span>
          <span className={trend.change == null || trend.change === 0 ? undefined : trend.change > 0 ? 'is-positive' : 'is-negative'}>{formatChange(trend.change)}</span>
        </div>
        <div className="geo-insight-chart-frame">
          <div className="geo-insight-chart-y-axis" aria-hidden="true">
            {['100%', '50%', '0%'].map((axisLabel) => <span key={axisLabel}>{axisLabel}</span>)}
          </div>
          <div className="geo-insight-chart-plot">
            <svg
              viewBox="0 0 100 48"
              role="img"
              aria-label={chartLabel}
              aria-describedby={activeTooltip ? tooltipId : undefined}
              preserveAspectRatio="none"
              tabIndex={0}
              onFocus={() => setKeyboardPointIndex(points.length ? 0 : undefined)}
              onBlur={() => setKeyboardPointIndex(undefined)}
              onKeyDown={handleChartKeyDown}
            >
              {[8, 25, 42].map((gridY) => (
                <line key={gridY} className="geo-insight-chart-grid" x1="6" y1={gridY} x2="94" y2={gridY} />
              ))}
              {points.slice(1).map((point, index) => {
                const previousPoint = points[index]!;
                const previousValue = previousPoint.value;
                const value = point.value;
                if (previousValue == null || value == null) return null;
                return (
                  <line
                    key={`${previousPoint.date}-${point.date}`}
                    className="geo-insight-chart-line"
                    x1={pointX(index, points.length)}
                    y1={y(previousValue)}
                    x2={pointX(index + 1, points.length)}
                    y2={y(value)}
                    style={{ stroke: color }}
                  />
                );
              })}
              {points.map((point, index) => {
                const value = point.value;
                return (
                  <circle
                    key={point.date}
                    className={`geo-insight-chart-point${value == null ? ' is-empty' : ''}${activePointIndex === index ? ' is-active' : ''}`}
                    cx={pointX(index, points.length)}
                    cy={y(value)}
                    r="2.2"
                    style={value == null ? undefined : { fill: color, stroke: color }}
                    onMouseEnter={() => setHoveredPointIndex(index)}
                    onMouseLeave={() => setHoveredPointIndex(undefined)}
                  />
                );
              })}
            </svg>
            <div className="geo-insight-chart-x-axis" aria-hidden="true">
              <span>{firstDate.slice(5).replace('-', '.')}</span>
              <span>{lastDate.slice(5).replace('-', '.')}</span>
            </div>
          </div>
        </div>
        {activeTooltip && <div id={tooltipId} className="geo-insight-chart-tooltip" role="tooltip">{activeTooltip}</div>}
        <small>{currentMeta}</small>
      </div>
    </article>
  );
}

const platformColumns: TableColumnsType<PlatformPerformance> = [
  {
    title: 'GEO 平台', dataIndex: 'geo_platform', width: 180, ellipsis: { showTitle: false }, render: (value: string) => (
      <Tooltip title={value} trigger={['hover', 'focus']}>
        <span className="geo-insight-platform-name" tabIndex={0}>
          <span className="geo-platform-mark">GEO</span><strong className="table-cell-ellipsis">{value}</strong>
        </span>
      </Tooltip>
    ),
  },
  { title: '观测次数', dataIndex: 'observation_count', width: 72 },
  { title: '发现率', dataIndex: 'discovery_rate', width: 112, render: (value) => <RateBar value={value} color="var(--ps-geo-series-blue)" /> },
  { title: '提及率', dataIndex: 'mention_rate', width: 112, render: (value) => <RateBar value={value} color="var(--ps-geo-series-green)" /> },
  { title: '准确率', dataIndex: 'accuracy_rate', width: 112, render: (value) => <RateBar value={value} color="var(--ps-geo-series-teal)" /> },
];

function RateBar({ value, color }: { value: Schema<'GeoInsightRateValue'>; color: string }) {
  const percentage = value.value == null ? 0 : Math.max(0, Math.min(100, value.value * 100));
  return (
    <Tooltip title={rateMeta(value)} trigger={['hover', 'focus']}>
      <span
        className="geo-insight-rate-bar"
        style={{ '--geo-rate-color': color } as CSSProperties}
        tabIndex={0}
        aria-label={`${formatRate(value.value)}，${rateMeta(value)}`}
      >
        <span className="geo-insight-rate-bar-track"><span style={{ width: `${percentage}%` }} /></span>
        <span>{formatRate(value.value)}</span>
      </span>
    </Tooltip>
  );
}

function OptimizationModal({ target, onClose }: { target: OptimizationTarget | null; onClose: () => void }) {
  const [form] = Form.useForm<Pick<OptimizationRequest, 'product_id' | 'platform_profile_id' | 'fact_version_id'>>();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const productId = Form.useWatch('product_id', form);
  const products = useQuery({ ...productsQueryOptions(), enabled: !!target });
  const platforms = useQuery({ ...platformProfilesQueryOptions(), enabled: !!target });
  const facts = useQuery({
    queryKey: queryKeys.products.factVersions(productId ?? ''),
    queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/fact-versions', {
      params: { path: { product_id: productId! } },
    })),
    enabled: !!target && !!productId,
  });
  const create = useMutation({
    mutationFn: async (values: Pick<OptimizationRequest, 'product_id' | 'platform_profile_id' | 'fact_version_id'>) => {
      if (!target) throw new Error('未选择 GEO 优化依据');
      return unwrap(await api.POST('/api/v1/geo-insights/optimization-content-tasks', {
        params: { header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } },
        body: {
          rule_code: target.rule_code,
          date_from: target.date_from,
          date_to: target.date_to,
          published_article_id: target.published_article_id ?? null,
          query_topic_id: target.query_topic_id ?? null,
          geo_platform: target.geo_platform ?? null,
          ...values,
        },
      }));
    },
    onSuccess: async (task) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.geo.all }),
      ]);
      message.success('GEO 优化任务已创建');
      onClose();
      navigate(`/tasks/${task.id}`);
    },
  });
  return (
    <Modal open={!!target} title="创建 GEO 优化任务" footer={null} onCancel={onClose} destroyOnHidden>
      <Alert className="form-alert" type="info" showIcon title="服务端会按当前周期重新计算异常；指标过期或样本不足时会拒绝创建。" />
      {create.error && <Alert className="form-alert" type="error" showIcon title={errorMessage(create.error)} />}
      <Form
        key={target ? `${target.rule_code}-${target.published_article_id ?? target.query_topic_id}` : 'closed'}
        form={form}
        layout="vertical"
        initialValues={{ product_id: target?.product_id, platform_profile_id: target?.platform_profile_id }}
        onValuesChange={(changed) => { if ('product_id' in changed) form.setFieldValue('fact_version_id', undefined); }}
        onFinish={(values) => create.mutate(values)}
      >
        <Form.Item name="product_id" label="产品" rules={[{ required: true, message: '请选择产品' }]}>
          <Select showSearch optionFilterProp="label" loading={products.isLoading} options={products.data?.items.map((item) => ({ value: item.id, label: `${item.brand} ${item.part_number}` }))} />
        </Form.Item>
        <Form.Item name="platform_profile_id" label="内容平台" rules={[{ required: true, message: '请选择内容平台' }]}>
          <Select showSearch optionFilterProp="label" loading={platforms.isLoading} options={platforms.data?.items.filter((item) => item.is_active).map((item) => ({ value: item.id, label: item.name }))} />
        </Form.Item>
        <Form.Item name="fact_version_id" label="已批准事实版本" rules={[{ required: true, message: '请选择已批准事实版本' }]}>
          <Select disabled={!productId} loading={facts.isLoading} options={facts.data?.items.filter((item) => item.status === 'APPROVED').map((item) => ({ value: item.id, label: `V${item.version} · ${item.change_summary}` }))} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={create.isPending}>创建优化任务</Button>
      </Form>
    </Modal>
  );
}

function observationPath(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); });
  return `/observations?${params.toString()}`;
}

function PlatformPerformanceCard({ rows, filters, interactive, unavailable }: { rows: PlatformPerformance[]; filters: GeoInsightQuery; interactive: boolean; unavailable?: string }) {
  const columns: TableColumnsType<PlatformPerformance> = [...platformColumns];
  if (interactive) columns.push({
      title: '操作',
      fixed: 'right',
      width: 130,
      render: (_, row) => (
        <Link to={observationPath({ geo_platform: row.geo_platform, date_from: filters.date_from, date_to: filters.date_to })}>
          <Button type="primary" size="small">查看观测明细</Button>
        </Link>
      ),
    });
  return (
    <Card className="geo-insight-section-card geo-insight-platform-card" title="平台表现对比">
      {rows.length ? (
        <>
          <div className="geo-insight-platform-legend" aria-label="平台表现图例">
            <span><i style={{ background: 'var(--ps-geo-series-blue)' }} />发现率</span>
            <span><i className="is-mention" />提及率</span>
            <span><i className="is-accuracy" />准确率</span>
          </div>
          <TableRegion label="GEO 平台表现">
            <Table rowKey="geo_platform" size="small" pagination={false} dataSource={rows} columns={columns} scroll={{ x: interactive ? 718 : 588 }} />
          </TableRegion>
        </>
      ) : <NoData description={unavailable ?? '当前筛选范围暂无平台表现数据'} />}
    </Card>
  );
}

function ContentRankingCard({
  title, rows, kind, filters, onOptimize, emptyDescription,
}: {
  title: string;
  rows: ContentRow[];
  kind: 'best' | 'declining' | 'long';
  filters: GeoInsightQuery;
  onOptimize?: (target: OptimizationTarget) => void;
  emptyDescription?: string;
}) {
  const columns: TableColumnsType<ContentRow> = [
    {
      title: '发布内容', dataIndex: 'title', ellipsis: { showTitle: false }, render: (value: string, row) => (
        <Tooltip
          title={kind === 'declining' && 'basis' in row && row.basis.length > 0
            ? `${value}；下降依据：${row.basis.map(declineBasisText).join('；')}`
            : value}
          trigger={['hover', 'focus']}
        >
          <Link className="geo-insight-ranking-text table-cell-ellipsis" to={`/publications/${row.published_article_id}`}>{value}</Link>
        </Tooltip>
      ),
    },
    {
      title: '内容平台', dataIndex: 'content_platform', width: 80, ellipsis: { showTitle: false }, render: (value: string) => (
        <Tooltip title={value} trigger={['hover', 'focus']}><span className="geo-insight-ranking-text table-cell-ellipsis" tabIndex={0} aria-label={`内容平台：${value}`}>{value}</span></Tooltip>
      ),
    },
    { title: '观测', dataIndex: 'observation_count', width: 48 },
    { title: '发现', dataIndex: 'discovery_rate', width: 56, render: (value) => <Tooltip title={rateMeta(value)}>{formatRate(value.value)}</Tooltip> },
    { title: '提及', dataIndex: 'mention_rate', width: 56, render: (value) => <Tooltip title={rateMeta(value)}>{formatRate(value.value)}</Tooltip> },
    { title: '准确', dataIndex: 'accuracy_rate', width: 56, render: (value) => <Tooltip title={rateMeta(value)}>{formatRate(value.value)}</Tooltip> },
  ];
  if (kind === 'long') {
    columns.push({ title: '未提及', width: 70, render: (_, row) => 'unmentioned_days' in row ? `${row.unmentioned_days} 天` : '—' });
  }
  if (onOptimize) columns.push({
    title: '操作',
    fixed: 'right',
    width: 128,
    render: (_, row) => row.primary_task === 'CREATE_OPTIMIZATION_TASK' ? (
      <Button
        type="primary"
        size="small"
        onClick={() => onOptimize({
          rule_code: kind === 'declining' ? 'CONTENT_DECLINE' : 'LONG_UNMENTIONED',
          date_from: filters.date_from!,
          date_to: filters.date_to!,
          published_article_id: row.published_article_id,
          product_id: row.product_id,
          platform_profile_id: row.content_platform_id,
        })}
      >
        创建优化任务
      </Button>
    ) : (
      <Link to={observationPath({ published_article_id: row.published_article_id, date_from: filters.date_from, date_to: filters.date_to })}>
        <Button type="primary" size="small">查看内容表现</Button>
      </Link>
    ),
  });
  const titleIcon = kind === 'best'
    ? <TrophyOutlined className="is-best" />
    : kind === 'declining' ? <FallOutlined className="is-declining" /> : <WarningOutlined className="is-long" />;
  return (
    <section className="geo-insight-ranking-card" aria-label={title}>
      <h3>{titleIcon}<span>{title}</span></h3>
      {rows.length ? (
        <TableRegion label={title}>
          <Table rowKey="published_article_id" size="small" pagination={false} dataSource={rows} columns={columns} scroll={{ x: kind === 'long' ? 650 : 580 }} />
        </TableRegion>
      ) : <NoData description={emptyDescription ?? '当前筛选范围暂无符合门槛的内容'} />}
    </section>
  );
}

function CoverageCard({ coverage, filters, onOptimize }: {
  coverage: GeoInsights['question_coverage'];
  filters: GeoInsightQuery;
  onOptimize?: (target: OptimizationTarget) => void;
}) {
  const platforms = [...new Set(coverage.matrix.map((item) => item.geo_platform))];
  const groupedCounts = new Map<string, number>();
  coverage.matrix.forEach((item) => {
    const key = `${item.status}\u0000${item.geo_platform}`;
    groupedCounts.set(key, (groupedCounts.get(key) ?? 0) + 1);
  });
  return (
    <Card className="geo-insight-section-card geo-insight-coverage-card" title="搜索问题分析">
      {platforms.length ? (
        <div className="geo-insight-coverage-overview" role="list" aria-label="搜索问题覆盖概览">
          {coverageStatuses.map(({ status, countKey, label }) => (
            <article key={status} role="listitem">
              <StatusTag status={status} />
              <strong>{coverage.by_status[countKey]}</strong>
              <span>{label}</span>
              <small>{platforms.map((platform) => `${platform} ${groupedCounts.get(`${status}\u0000${platform}`) ?? 0}`).join(' · ')}</small>
            </article>
          ))}
        </div>
      ) : <NoData description="当前筛选范围暂无可分析的问题与 GEO 平台组合" />}
      <ul className="geo-insight-coverage-legend" aria-label="覆盖状态说明">
        {coverageStatuses.map(({ status, label, description }) => <li key={status} className={`is-${status.toLowerCase().replace('_', '-')}`}><i /><span>{label}：{description}</span></li>)}
      </ul>
      {!!coverage.matrix.length && (
        <TableRegion label="问题主题与 GEO 平台覆盖明细">
          <Table<CoverageRow>
            rowKey={(row) => `${row.query_topic_id}-${row.geo_platform}`}
            size="small"
            pagination={false}
            dataSource={coverage.matrix}
            scroll={{ x: 760 }}
            columns={[
              { title: '问题主题', dataIndex: 'canonical_question', ellipsis: true },
              { title: 'GEO 平台', dataIndex: 'geo_platform', width: 120, ellipsis: true },
              { title: '覆盖状态', dataIndex: 'status', width: 110, render: (status) => <StatusTag status={status} /> },
              { title: '样本', dataIndex: 'observation_count', width: 64 },
              { title: '覆盖率', dataIndex: 'coverage_rate', width: 90, render: (value) => formatRate(value.value) },
              ...(onOptimize ? [{
                title: '操作', fixed: 'right', width: 132, render: (_, row) => {
                  if (row.primary_task === 'CREATE_OPTIMIZATION_TASK') {
                    return <Button type="primary" size="small" onClick={() => onOptimize({
                      rule_code: 'QUESTION_COVERAGE_GAP',
                      date_from: filters.date_from!,
                      date_to: filters.date_to!,
                      query_topic_id: row.query_topic_id,
                      geo_platform: row.geo_platform,
                    })}>创建优化任务</Button>;
                  }
                  const path = observationPath({
                    query_topic_id: row.query_topic_id,
                    search_platform: row.geo_platform,
                    search_query: row.canonical_question,
                    date_from: filters.date_from,
                    date_to: filters.date_to,
                    create: row.primary_task === 'ADD_OBSERVATION' ? 'true' : undefined,
                  });
                  return <Link to={path}><Button type="primary" size="small">{row.primary_task === 'ADD_OBSERVATION' ? '补充观测' : '查看观测依据'}</Button></Link>;
                },
              } satisfies NonNullable<TableColumnsType<CoverageRow>[number]>] : []),
            ]}
          />
        </TableRegion>
      )}
    </Card>
  );
}

function RecommendationList({ rows }: { rows: Recommendation[] }) {
  return (
    <div className="geo-insight-recommendation-list">
      {rows.map((item, index) => (
        <article key={`${item.rule_code}-${index}`}>
          <span className="geo-insight-recommendation-index">{index + 1}</span>
          <div>
            <strong>{item.title}</strong>
            <p title={`${item.basis_text} · 影响 ${item.impact_relationship_count} 条关系 · 规则 ${item.rule_code}`}>{item.basis_text} <small>· 影响 {item.impact_relationship_count} 条关系 · 规则 {item.rule_code}</small></p>
          </div>
          <span className="geo-insight-recommendation-actions">
            {item.detail_path && <Link to={item.detail_path}>查看详情</Link>}
            <StatusTag status={item.priority} />
          </span>
        </article>
      ))}
    </div>
  );
}

function RecommendationsCard({ rows, printMode }: { rows: Recommendation[]; printMode: boolean }) {
  const [open, setOpen] = useState(false);
  const visibleRows = printMode ? rows : rows.slice(0, 5);
  return (
    <Card
      className="geo-insight-section-card geo-insight-recommendations-card"
      title="优先优化建议"
      extra={!printMode && rows.length > 5 ? <Button type="link" onClick={() => setOpen(true)}>查看全部建议</Button> : undefined}
    >
      {visibleRows.length ? <RecommendationList rows={visibleRows} /> : <NoData description="当前筛选范围暂无确定性优化建议" />}
      <Modal title={`全部优化建议（${rows.length}）`} open={open} onCancel={() => setOpen(false)} footer={null} width={880}>
        <RecommendationList rows={rows} />
      </Modal>
    </Card>
  );
}

function DataQualityAlert({ data, printMode }: { data: GeoInsights; printMode: boolean }) {
  const { data_quality: quality } = data;
  const hasWarning = quality.excluded_incomplete_observation_count > 0
    || quality.excluded_incomplete_relation_count > 0
    || quality.unavailable_sections.length > 0;
  const summary = `数据质量：完整 ${quality.eligible_observation_count} 条 · 排除观测 ${quality.excluded_incomplete_observation_count} 条 · 排除关系 ${quality.excluded_incomplete_relation_count} 条`;
  if (!printMode) {
    const details = quality.unavailable_sections.map((section) => `${section.code}：${section.message}`).join('；');
    return (
      <Tooltip title={`${summary}${details ? `；${details}` : ''}`} trigger={['hover', 'focus']}>
        <span
          className={`geo-insight-quality-chip${hasWarning ? ' is-warning' : ''}`}
          role="status"
          aria-label={`${summary}${details ? `；${details}` : ''}`}
          tabIndex={0}
        >
          <ExclamationCircleOutlined aria-hidden="true" />
          <span>完整 {quality.eligible_observation_count} 条</span>
          {quality.unavailable_sections.length > 0 && <span>· {quality.unavailable_sections.length} 项限制</span>}
        </span>
      </Tooltip>
    );
  }
  return (
    <Alert
      className="geo-insight-quality"
      type={hasWarning ? 'warning' : 'info'}
      showIcon
      title={(
        <div className="geo-insight-quality-summary">
          <span>{summary}</span>
          {quality.unavailable_sections.length > 0 && (
            <details className="geo-insight-quality-details" open={printMode}>
              <summary>{quality.unavailable_sections.length} 项分析限制</summary>
              <ul>
                {quality.unavailable_sections.map((section) => <li key={section.code}><code>{section.code}</code><span>{section.message}</span></li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    />
  );
}

function InsightSections({ data, filters, printMode, onOptimize }: {
  data: GeoInsights;
  filters: GeoInsightQuery;
  printMode: boolean;
  onOptimize?: (target: OptimizationTarget) => void;
}) {
  const unavailable = new Map(data.data_quality.unavailable_sections.map((section) => [section.code, section.message]));
  if (data.data_quality.eligible_observation_count === 0) {
    return (
      <>
        {printMode && <DataQualityAlert data={data} printMode />}
        <Card className="geo-insight-state-card"><NoData description="当前筛选范围没有完整人工观测，无法生成洞察。调整筛选或补充真实观测后重试。" /></Card>
      </>
    );
  }
  return (
    <>
      {printMode && <DataQualityAlert data={data} printMode />}
      <Card
        className="geo-insight-parent-card geo-insight-trend-panel"
        title="GEO 指标趋势"
        extra={<Typography.Text type="secondary">对比期：{data.period.previous.date_from} – {data.period.previous.date_to}</Typography.Text>}
      >
        <section className="geo-insight-trend-grid" aria-label="GEO 指标趋势" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
          <TrendCard label="发现率" color="var(--ps-geo-series-blue)" trend={data.trends.discovery_rate} />
          <TrendCard label="提及率" color="var(--ps-geo-series-green)" trend={data.trends.mention_rate} />
          <TrendCard label="结果准确率" color="var(--ps-geo-series-teal)" trend={data.trends.accuracy_rate} />
        </section>
      </Card>
      <PlatformPerformanceCard rows={data.platform_performance} filters={filters} interactive={!printMode} unavailable={unavailable.get('NO_GEO_PLATFORMS')} />
      <Card className="geo-insight-parent-card geo-insight-ranking-panel" title="内容表现排行">
        <section className="geo-insight-ranking-grid" aria-label="内容表现排行">
          <ContentRankingCard title="表现最佳内容 Top 5" kind="best" rows={data.content_rankings.best} filters={filters} onOptimize={onOptimize} />
          <ContentRankingCard title="表现下降内容 Top 5" kind="declining" rows={data.content_rankings.declining} filters={filters} onOptimize={onOptimize} emptyDescription={unavailable.get('NO_COMPLETE_PREVIOUS_OBSERVATIONS')} />
          <ContentRankingCard title="长期未获得提及的内容 Top 5" kind="long" rows={data.content_rankings.long_unmentioned} filters={filters} onOptimize={onOptimize} emptyDescription={unavailable.get('LONG_UNMENTIONED_PERIOD_TOO_SHORT')} />
        </section>
      </Card>
      <section className="geo-insight-two-column geo-insight-bottom-grid">
        <CoverageCard coverage={data.question_coverage} filters={filters} onOptimize={onOptimize} />
        <RecommendationsCard rows={data.recommendations} printMode={printMode} />
      </section>
    </>
  );
}

function FilterPanel({
  filters, options, collapsed, loading, onChange, onPeriodChange, onReset, onToggle,
}: {
  filters: GeoInsightQuery;
  options?: FilterOptions;
  collapsed: boolean;
  loading: boolean;
  onChange: (key: keyof GeoInsightQuery, value: string | undefined) => void;
  onPeriodChange: (dateFrom: string, dateTo: string) => void;
  onReset: () => void;
  onToggle: () => void;
}) {
  return (
    <Card
      className="geo-filter-card geo-insight-filter-card"
      size="small"
      title="分析筛选器"
      extra={<Button type="text" aria-label={collapsed ? '展开筛选' : '收起筛选'} icon={collapsed ? <DownOutlined /> : <UpOutlined />} onClick={onToggle}>{collapsed ? '展开' : '收起'}</Button>}
    >
      {!collapsed ? (
        <div className="geo-insight-filter-grid" role="search" aria-label="分析洞察筛选">
          <div className="geo-insight-filter-field geo-insight-period-field">
            <span>时间范围</span>
            <DatePicker.RangePicker
              aria-label="时间范围"
              allowClear={false}
              format="M.D"
              separator="–"
              prefix={<span>近 {dayjs(filters.date_to).diff(dayjs(filters.date_from), 'day') + 1} 天</span>}
              value={filters.date_from && filters.date_to ? [dayjs(filters.date_from), dayjs(filters.date_to)] : null}
              onChange={(range) => {
                if (!range?.[0] || !range[1]) return;
                onPeriodChange(range[0].format('YYYY-MM-DD'), range[1].format('YYYY-MM-DD'));
              }}
            />
          </div>
          <div className="geo-insight-filter-field"><span>内容平台</span><Select aria-label="内容平台" placeholder="全部平台" allowClear showSearch virtual={false} optionFilterProp="label" loading={loading} value={filters.content_platform_id} onChange={(value) => onChange('content_platform_id', value)} options={options?.content_platforms.map((item) => ({ value: item.id, label: item.label }))} /></div>
          <div className="geo-insight-filter-field"><span>产品</span><Select aria-label="产品" placeholder="全部产品" allowClear showSearch virtual={false} optionFilterProp="label" loading={loading} value={filters.product_id} onChange={(value) => onChange('product_id', value)} options={options?.products.map((item) => ({ value: item.id, label: item.label }))} /></div>
          <div className="geo-insight-filter-field"><span>GEO 观测平台</span><Select aria-label="GEO 观测平台" placeholder="全部平台" allowClear showSearch virtual={false} loading={loading} value={filters.geo_platform} onChange={(value) => onChange('geo_platform', value)} options={options?.geo_platforms.map((value) => ({ value, label: value }))} /></div>
          <div className="geo-insight-filter-field"><span>发布内容</span><Select aria-label="发布内容" placeholder="全部内容" allowClear showSearch virtual={false} optionFilterProp="label" loading={loading} value={filters.published_article_id} onChange={(value) => onChange('published_article_id', value)} options={options?.publications.map((item) => ({ value: item.id, label: `${item.label} · ${item.platform_name}` }))} /></div>
          <div className="geo-insight-filter-field"><span>搜索问题</span><Select aria-label="搜索问题" placeholder="全部问题" allowClear showSearch virtual={false} optionFilterProp="label" loading={loading} value={filters.query_topic_id} onChange={(value) => onChange('query_topic_id', value)} options={options?.query_topics.map((item) => ({ value: item.id, label: item.label }))} /></div>
          <Button className="geo-insight-filter-reset" aria-label="重置" onClick={onReset}>重置</Button>
        </div>
      ) : <Typography.Text type="secondary">筛选区已折叠，当前 URL 中的全部条件仍统一作用于所有洞察区块。</Typography.Text>}
    </Card>
  );
}

function filterSummary(filters: GeoInsightQuery, options: FilterOptions): DescriptionsProps['items'] {
  const optionLabel = (items: Schema<'GeoInsightOption'>[], id?: string) => id ? items.find((item) => item.id === id)?.label ?? id : '全部';
  return [
    { key: 'period', label: '时间范围', children: `${filters.date_from} 至 ${filters.date_to}` },
    { key: 'product', label: '产品', children: optionLabel(options.products, filters.product_id) },
    { key: 'content-platform', label: '内容平台', children: optionLabel(options.content_platforms, filters.content_platform_id) },
    { key: 'geo-platform', label: 'GEO 平台', children: filters.geo_platform ?? '全部' },
    { key: 'publication', label: '发布内容', children: filters.published_article_id ? options.publications.find((item) => item.id === filters.published_article_id)?.label ?? filters.published_article_id : '全部' },
    { key: 'topic', label: '搜索问题', children: optionLabel(options.query_topics, filters.query_topic_id) },
  ];
}

function GeoInsightsView({ printMode = false }: { printMode?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [optimizationTarget, setOptimizationTarget] = useState<OptimizationTarget | null>(null);
  const defaults = useMemo(() => defaultDates(), []);
  const filters = geoInsightFiltersFromParams(searchParams, defaults);
  const collapsed = searchParams.get('filters_collapsed') === 'true';
  const insights = useQuery(geoInsightsQueryOptions(filters));

  useEffect(() => {
    if (searchParams.has('date_from') && searchParams.has('date_to')) return;
    const next = new URLSearchParams(searchParams);
    if (!next.has('date_from')) next.set('date_from', defaults.date_from!);
    if (!next.has('date_to')) next.set('date_to', defaults.date_to!);
    setSearchParams(next, { replace: true });
  }, [defaults.date_from, defaults.date_to, searchParams, setSearchParams]);

  const updateFilter = (key: keyof GeoInsightQuery, value: string | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined) next.delete(key); else next.set(key, value);
    setSearchParams(next);
  };
  const updatePeriod = (dateFrom: string, dateTo: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('date_from', dateFrom);
    next.set('date_to', dateTo);
    setSearchParams(next);
  };
  const reset = () => setSearchParams({ date_from: defaults.date_from!, date_to: defaults.date_to! });
  const toggleFilters = () => {
    const next = new URLSearchParams(searchParams);
    if (collapsed) next.delete('filters_collapsed'); else next.set('filters_collapsed', 'true');
    setSearchParams(next);
  };
  const printParams = new URLSearchParams(searchParams);
  if (!printParams.has('date_from')) printParams.set('date_from', defaults.date_from!);
  if (!printParams.has('date_to')) printParams.set('date_to', defaults.date_to!);
  const printPath = `/observations/insights/print?${printParams.toString()}`;

  return (
    <div className={`page-stack geo-insights-page${printMode ? ' geo-insights-print' : ''}`}>
      {printMode ? (
        <PageHeader
          title="GEO 分析洞察报告"
          description="本报告直接呈现同一筛选下的服务端洞察结果。"
          actions={<Button className="geo-print-action" type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>打印 / 另存为 PDF</Button>}
        />
      ) : (
        <PageHeader
          title="GEO 分析洞察"
          description="基于真实人工观测比较趋势、平台表现、内容覆盖与行动建议。"
          actions={(
            <>
              {insights.data && <DataQualityAlert data={insights.data} printMode={false} />}
              <Button type="primary" icon={<ExportOutlined />} href={printPath} target="_blank">导出洞察报告</Button>
            </>
          )}
        />
      )}
      {!printMode && (
        <nav className="geo-subnav" aria-label="GEO 观测页面">
          <NavLink end to="/observations">观测记录</NavLink>
          <NavLink to="/observations/insights">分析洞察</NavLink>
        </nav>
      )}
      {!printMode && (
        <FilterPanel
          filters={filters}
          options={insights.data?.filter_options}
          collapsed={collapsed}
          loading={insights.isLoading}
          onChange={updateFilter}
          onPeriodChange={updatePeriod}
          onReset={reset}
          onToggle={toggleFilters}
        />
      )}
      {printMode && insights.data && (
        <Card className="geo-insight-print-summary" title="报告范围" extra={`生成于 ${formatDateTime(insights.data.generated_at)}`}>
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} items={filterSummary(filters, insights.data.filter_options)} />
        </Card>
      )}
      {insights.isLoading
        ? <Card className="geo-insight-state-card"><QueryLoading label="正在加载 GEO 分析洞察" /></Card>
        : insights.error
          ? (
              <Card className="geo-insight-state-card">
                <QueryFailure
                  error={insights.error}
                  actions={(
                    <Space wrap>
                      <Button aria-label="重试" onClick={() => { void insights.refetch(); }}>重试</Button>
                      <Button aria-label="重置筛选" onClick={reset}>重置筛选</Button>
                    </Space>
                  )}
                />
              </Card>
            )
          : insights.data && <InsightSections data={insights.data} filters={filters} printMode={printMode} onOptimize={printMode ? undefined : setOptimizationTarget} />}
      {!printMode && <OptimizationModal target={optimizationTarget} onClose={() => setOptimizationTarget(null)} />}
    </div>
  );
}

export function GeoInsightsPage() {
  return <GeoInsightsView />;
}

export function GeoInsightsPrintPage() {
  return <GeoInsightsView printMode />;
}
