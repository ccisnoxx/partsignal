/** 紧凑指标卡只负责呈现服务端指标，不计算业务口径。 */
import { Card, Progress, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function MetricTile({ label, value, unit, meta, percent, tone = 'default', to, icon }: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  meta?: ReactNode;
  percent?: number | null;
  tone?: 'default' | 'data' | 'warning' | 'danger' | 'success';
  to?: string;
  icon?: ReactNode;
}) {
  const card = (
    <Card className={`metric-tile metric-${tone}${icon ? ' metric-with-icon' : ''}`} size="small">
      {icon && <span className="metric-icon" aria-hidden="true">{icon}</span>}
      <Typography.Text className="metric-label">{label}</Typography.Text>
      <div className="metric-value"><strong>{value}</strong>{unit && <span>{unit}</span>}</div>
      {percent !== undefined && percent !== null && <Progress aria-label={`${String(label)} ${percent}%`} percent={percent} showInfo={false} />}
      {meta && <Typography.Text className="metric-meta">{meta}</Typography.Text>}
    </Card>
  );
  return to ? <Link className="metric-link" to={to}>{card}</Link> : card;
}
