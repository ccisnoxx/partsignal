/** 平台规则版本状态、影响、审计与危险操作面板。 */
import { DeleteOutlined, RetweetOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Card, Timeline, Typography } from 'antd';
import { Link } from 'react-router-dom';
import type { Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { StatusTag } from '../../shared/components/StatusTag';
import type { RuleVersionSummary } from './PlatformRuleDetail';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

const auditActionLabels: Record<string, string> = {
  'platform_profile_version.created': '创建版本',
  'platform_profile_version.updated': '更新规则',
  'platform_profile_version.activated': '激活版本',
  'platform_profile_version.retired': '退役版本',
};

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : '—';
}

export function PlatformRuleMetaPanel({
  version,
  creatorName,
  changeSummary,
  impact,
  impactLoading,
  impactError,
  retryImpact,
  auditItems,
  auditLoading,
  auditError,
  retryAudit,
  actorName,
  onRetire,
  onDelete,
}: {
  version: RuleVersionSummary;
  creatorName: string;
  changeSummary: string;
  impact?: Schema<'PlatformRuleImpactSummary'>;
  impactLoading: boolean;
  impactError: Error | null;
  retryImpact: () => void;
  auditItems?: Schema<'AuditLog'>[];
  auditLoading: boolean;
  auditError: Error | null;
  retryAudit: () => void;
  actorName: (actorId: string | null) => string;
  onRetire: (version: RuleVersionSummary) => void;
  onDelete: (version: RuleVersionSummary) => void;
}) {
  const canRetire = version.available_actions.includes('RETIRE');
  const canDelete = version.available_actions.includes('DELETE');
  return (
    <aside className="platform-rule-meta-panel" aria-label={`版本 V${version.version} 信息`}>
      <Card size="small" title="版本状态" className="platform-rule-meta-card platform-rule-status-card">
        <dl>
          <div><dt>当前状态</dt><dd><StatusTag status={version.status} /></dd></div>
          <div><dt>版本号</dt><dd>V{version.version}</dd></div>
          <div><dt>创建人</dt><dd>{creatorName}</dd></div>
          <div><dt>创建时间</dt><dd>{formatDate(version.created_at)}</dd></div>
          <div><dt>激活时间</dt><dd>{formatDate(version.activated_at)}</dd></div>
          <div><dt>最后变更</dt><dd>{formatDate(version.last_changed_at)}</dd></div>
        </dl>
        <div className="platform-rule-change-summary"><strong>修改摘要</strong><p>{changeSummary}</p></div>
        <Link className="platform-rule-reference-link" to={`/tasks?platform_profile_version_id=${version.id}`}>被 {version.reference_count} 个内容任务引用 <RightOutlined /></Link>
      </Card>

      <Card size="small" title="发布影响摘要" className="platform-rule-meta-card">
        {impactLoading ? <QueryLoading label="正在加载影响摘要" /> : impactError ? <QueryFailure error={impactError} onRetry={retryImpact} /> : impact ? (
          <dl className="platform-rule-impact-list">
            <div><dt>当前绑定内容任务</dt><dd>{impact.bound_task_total}</dd></div>
            <div><dt>未发布内容任务</dt><dd>{impact.unpublished_task_total}</dd></div>
            <div><dt>审核中内容任务</dt><dd>{impact.reviewing_task_total}</dd></div>
            <div><dt>已发布内容任务</dt><dd>{impact.published_task_total}</dd></div>
          </dl>
        ) : <Typography.Text type="secondary">暂无影响数据</Typography.Text>}
      </Card>

      <Card size="small" title="变更历史" className="platform-rule-meta-card platform-rule-history-card">
        {auditLoading ? <QueryLoading label="正在加载变更历史" /> : auditError ? <QueryFailure error={auditError} onRetry={retryAudit} /> : auditItems?.length ? (
          <Timeline items={auditItems.map((item) => {
            const comment = typeof item.change_summary.comment === 'string' ? item.change_summary.comment : undefined;
            return {
              content: <div className="platform-rule-history-item"><time dateTime={item.created_at}>{formatDate(item.created_at)}</time><strong>{auditActionLabels[item.action] ?? item.action}</strong><span>{actorName(item.actor_id)}</span>{comment && <p>{comment}</p>}</div>,
            };
          })} />
        ) : <Typography.Text type="secondary">暂无变更历史</Typography.Text>}
      </Card>

      <Card size="small" title="危险操作" className="platform-rule-meta-card platform-rule-danger-card">
        <div>
          <Button danger icon={<RetweetOutlined />} disabled={!canRetire} onClick={() => onRetire(version)}>退役此版本</Button>
          <Button danger icon={<DeleteOutlined />} disabled={!canDelete} onClick={() => onDelete(version)}>删除此版本</Button>
        </div>
        <Typography.Text type="secondary">
          {version.status === 'ACTIVE' ? '活动版本只能在激活替代草稿时自动退役。' : canDelete ? '删除不可恢复，请先确认版本不再需要。' : '被内容任务引用的版本不可删除。'}
        </Typography.Text>
      </Card>
    </aside>
  );
}
