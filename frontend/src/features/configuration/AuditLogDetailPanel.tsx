/** 审计详情只展示服务端白名单投影，并为已有明确路由的对象提供关联入口。 */
import { ArrowRightOutlined, CloseOutlined } from '@ant-design/icons';
import { Button, Descriptions, Divider, Timeline, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { StatusTag } from '../../shared/components/StatusTag';

const fieldLabels: Record<string, string> = {
  account_type: '账号类型',
  active_version_id: '活动规则版本',
  configuration_status: '配置状态',
  is_active: '启用状态',
  prompt_configured: 'Prompt 配置状态',
  revision: '修订号',
  status: '状态',
};

function displayValue(value: unknown): ReactNode {
  if (value === null) return '空';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return <span className="data-code configuration-break-text">{JSON.stringify(value)}</span>;
}

function relatedPath(detail: Schema<'AuditLogDetail'>): string | undefined {
  if (detail.related_entry.status !== 'AVAILABLE' || !detail.target_id) return undefined;
  const parentId = detail.related_entry.parent_id;
  switch (detail.related_entry.kind) {
    case 'Product':
      return `/products/${detail.target_id}`;
    case 'FactVersion':
      return parentId ? `/products/${parentId}` : undefined;
    case 'ContentTask':
      return `/tasks/${detail.target_id}`;
    case 'ContentVersion':
      return `/content/${detail.target_id}`;
    case 'PublicationRecord':
      return `/publications/${detail.target_id}`;
    case 'PublicationAttention':
      return `/publication-attentions/${detail.target_id}`;
    case 'GeoObservation':
      return `/observations?record=${detail.target_id}`;
    case 'PlatformProfile':
      return `/configuration/platforms?platform=${detail.target_id}`;
    case 'PlatformAccount':
      return parentId ? `/settings?tab=accounts&platform_profile_id=${parentId}` : undefined;
    case 'AIChannel':
      return `/configuration/ai/channels/${detail.target_id}`;
    case 'AIModel':
      return parentId ? `/configuration/ai/channels/${parentId}?tab=models` : undefined;
    default:
      return undefined;
  }
}

function RelatedEntry({ detail }: { detail: Schema<'AuditLogDetail'> }) {
  if (detail.related_entry.status === 'MISSING') {
    return <Typography.Text type="secondary">关联对象已不存在，历史审计记录保持不变。</Typography.Text>;
  }
  const path = relatedPath(detail);
  if (!path) return <Typography.Text type="secondary">当前对象没有可用的关联入口。</Typography.Text>;
  return <Link className="audit-related-link" to={path}>查看关联对象 <ArrowRightOutlined /></Link>;
}

export function AuditLogDetailPanel({
  detail,
  error,
  loading,
  onClose,
  onRetry,
}: {
  detail: Schema<'AuditLogDetail'> | undefined;
  error: unknown;
  loading: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="audit-detail-panel">
      <header className="audit-detail-header">
        <Typography.Title level={4}>日志详情</Typography.Title>
        <Button type="text" aria-label="关闭日志详情" icon={<CloseOutlined />} onClick={onClose} />
      </header>
      <div className="audit-detail-body">
        {loading ? <QueryLoading label="正在加载日志详情" /> : error ? (
          <QueryFailure error={error} onRetry={onRetry} />
        ) : !detail ? <NoData description="请选择审计记录" /> : (
          <>
            <Descriptions
              className="audit-detail-descriptions"
              column={1}
              size="small"
              colon={false}
              items={[
                { key: 'created-at', label: '时间', children: <time dateTime={detail.created_at}>{formatBeijingTime(detail.created_at)}</time> },
                { key: 'actor', label: '操作者', children: detail.actor?.display_name ?? '已删除用户' },
                { key: 'account-type', label: '账号类型', children: detail.actor ? <StatusTag compact status={detail.actor.account_type} /> : '未记录' },
                { key: 'module', label: '业务模块', children: moduleLabel(detail.business_module) },
                { key: 'action', label: '动作', children: actionLabel(detail.action) },
                { key: 'target-type', label: '对象类型', children: targetTypeLabel(detail.target_type) },
                { key: 'target-id', label: '对象标识', children: <span className="data-code configuration-break-text">{detail.target_id ?? '未创建'}</span> },
                { key: 'request-id', label: '请求 ID', children: <span className="data-code configuration-break-text">{detail.request_id}</span> },
                { key: 'outcome', label: '执行结果', children: <StatusTag compact status={detail.outcome} /> },
              ]}
            />

            <Divider />
            <section className="audit-detail-section">
              <Typography.Title level={5}>变更摘要（非敏感）</Typography.Title>
              {detail.changes.length ? (
                <Timeline
                  items={detail.changes.map((change, index) => ({
                    key: `${change.field}-${index}`,
                    content: (
                      <div className="audit-change">
                        <strong>{fieldLabels[change.field] ?? change.field}</strong>
                        <div>
                          <span>{Object.prototype.hasOwnProperty.call(change, 'before') ? displayValue(change.before) : '历史未记录'}</span>
                          <ArrowRightOutlined aria-hidden="true" />
                          <span>{Object.prototype.hasOwnProperty.call(change, 'after') ? displayValue(change.after) : '历史未记录'}</span>
                        </div>
                      </div>
                    ),
                  }))}
                />
              ) : <Typography.Text type="secondary">此记录没有可展示的字段变化。</Typography.Text>}
              {Object.keys(detail.facts).length ? (
                <dl className="audit-facts">
                  {Object.entries(detail.facts).map(([key, value]) => (
                    <div key={key}><dt>{fieldLabels[key] ?? key}</dt><dd>{displayValue(value)}</dd></div>
                  ))}
                </dl>
              ) : null}
            </section>

            <Divider />
            <section className="audit-detail-section">
              <Typography.Title level={5}>结果说明</Typography.Title>
              <Typography.Paragraph>{detail.result_message}</Typography.Paragraph>
              {detail.error_code ? <Typography.Text className="data-code" type="secondary">错误码：{detail.error_code}</Typography.Text> : null}
            </section>

            <Divider />
            <section className="audit-detail-section">
              <Typography.Title level={5}>关联入口</Typography.Title>
              <RelatedEntry detail={detail} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const beijingDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

export function formatBeijingTime(value: string): string {
  return beijingDateTimeFormatter.format(new Date(value));
}

export const auditModuleLabels: Record<Schema<'AuditModule'>, string> = {
  IDENTITY: '用户管理',
  PRODUCT_FACTS: '产品事实',
  CONTENT_PLANNING: '内容规划',
  CONTENT_PRODUCTION: '内容生产',
  CONTENT_REVIEW: '内容与审核',
  PUBLICATION: '发布管理',
  GEO_OBSERVATION: 'GEO 观测',
  CONFIGURATION: '配置中心',
  FILE_MANAGEMENT: '文件管理',
};

export function moduleLabel(value: Schema<'AuditModule'>): string {
  return auditModuleLabels[value];
}

const actionLabels: Record<string, string> = {
  'platform_profile.updated': '更新平台配置',
  'platform_profile.enabled': '启用平台配置',
  'platform_profile.disabled': '停用平台配置',
  'platform_profile_version.activated': '激活规则版本',
  'platform_prompt.saved': '保存 Prompt',
  'content_version.approve': '审核通过',
  'content_version.request-changes': '退回修改',
  'publication.created': '创建发布登记',
  'publication.mark_published': '登记发布结果',
  'geo_observation.created': '新增观测记录',
  'platform_account.deleted': '删除发布账号',
  'user.updated': '更新用户',
  'fact_version.submit': '提交事实审核',
};

export function actionLabel(value: string): string {
  return actionLabels[value] ?? value;
}

const targetTypeLabels: Record<string, string> = {
  AIChannel: 'AI 渠道',
  AIModel: 'AI 模型',
  ContentTask: '内容任务',
  ContentVersion: '内容版本',
  FactVersion: '产品事实版本',
  GeoObservation: '观测记录',
  PlatformAccount: '发布账号',
  PlatformProfile: '平台',
  PlatformProfileVersion: '平台规则',
  Product: '产品',
  PublicationAttention: '发布异常',
  PublicationRecord: '发布记录',
  User: '用户',
};

export function targetTypeLabel(value: string): string {
  return targetTypeLabels[value] ?? value;
}
