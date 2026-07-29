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
  'user.created': '创建用户',
  'user.updated': '更新用户',
  'user.deleted': '删除用户',
  'user.exported': '导出用户',
  'user.password_changed': '修改密码',
  'user.password_reset': '重置密码',

  'product.created': '创建产品',
  'product.updated': '更新产品',
  'product.deleted': '删除产品',
  'product_facts.replaced': '更新产品事实',
  'fact_version.created': '创建事实版本',
  'fact_version.deleted': '删除事实版本',
  'fact_version.submit': '提交事实审核',
  'fact_version.approve': '事实审核通过',
  'fact_version.request-changes': '退回事实修改',
  'fact_version.retire': '退役事实版本',

  'query_topic.created': '创建搜索问题',
  'query_topic.updated': '更新搜索问题',
  'content_task.created': '创建内容任务',
  'content_task.cancelled': '取消内容任务',
  'content_task.deleted': '删除内容任务',
  'content_task.completed_by_verified_publication': '完成内容发布闭环',
  'content_task.user_prompt_updated': '更新任务 Prompt',

  'generation_job.created': '创建内容生成作业',
  'generation_job.retried': '重试内容生成作业',
  'humanization_job.created': '创建自然化作业',
  'content_version.manual_created': '创建人工内容',
  'content_version.revised': '修订内容',
  'content_version.submit-review': '提交内容审核',
  'content_version.approve': '审核通过',
  'content_version.request-changes': '退回修改',

  'platform_account.created': '创建发布账号',
  'platform_account.updated': '更新发布账号',
  'platform_account.enabled': '启用发布账号',
  'platform_account.disabled': '停用发布账号',
  'platform_account.deleted': '删除发布账号',
  'publication.created': '创建发布登记',
  'publication.mark_platform_review': '标记平台审核中',
  'publication.mark_published': '登记发布结果',
  'publication.verify': '验证发布结果',
  'publication.reject': '拒绝发布',
  'publication.remove': '标记发布已移除',
  'publication.mark_verification_failed': '标记发布验证失败',
  'publication_record.deleted': '删除发布记录',
  'publication_attention.opened': '创建发布异常',
  'publication_attention.repair_task_created': '创建发布修复任务',
  'publication_attention.resolved': '解决发布异常',

  'geo_observation.created': '新增观测记录',
  'geo_observation.deleted': '删除观测记录',

  'platform_type.created': '创建平台类型',
  'platform_type.updated': '更新平台类型',
  'platform_type.deleted': '删除平台类型',
  'platform_profile.created': '创建平台配置',
  'platform_profile.updated': '更新平台配置',
  'platform_profile.enabled': '启用平台配置',
  'platform_profile.disabled': '停用平台配置',
  'platform_profile.deleted': '删除平台配置',
  'platform_profile_version.created': '创建规则版本',
  'platform_profile_version.updated': '更新规则版本',
  'platform_profile_version.activated': '激活规则版本',
  'platform_profile_version.retired': '退役规则版本',
  'platform_profile_version.deleted': '删除规则版本',
  'platform_prompt.created': '创建 Prompt',
  'platform_prompt.updated': '更新 Prompt',
  'platform_prompt.saved': '保存 Prompt',
  'platform_prompt.deleted': '删除 Prompt',
  'content_humanization_prompt.saved': '保存自然化 Prompt',
  'platform_logo.candidate_imported': '导入平台 Logo 候选',

  'ai_channel.created': '创建 AI 渠道',
  'ai_channel.updated': '更新 AI 渠道',
  'ai_channel.deleted': '删除 AI 渠道',
  'ai_channel.enabled': '启用 AI 渠道',
  'ai_channel.disabled': '停用 AI 渠道',
  'ai_channel.api_key_replaced': '更换 AI 渠道密钥',
  'ai_channel.models_discovered': '获取 AI 渠道模型',
  'ai_channel_header.created': '创建 AI 渠道 Header',
  'ai_channel_header.updated': '更新 AI 渠道 Header',
  'ai_channel_header.deleted': '删除 AI 渠道 Header',
  'ai_model.created': '创建 AI 模型',
  'ai_model.updated': '更新 AI 模型',
  'ai_model.deleted': '删除 AI 模型',
  'ai_model.enabled': '启用 AI 模型',
  'ai_model.disabled': '停用 AI 模型',
  'ai_model.tested': '测试 AI 模型',

  'file.upload_intent_created': '创建文件上传',
  'file.verified': '验证文件',
  'file.aborted': '中止文件上传',
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
