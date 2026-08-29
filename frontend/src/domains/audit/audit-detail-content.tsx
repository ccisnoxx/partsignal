import { Badge } from '@/design-system/primitives/badge';
import {
  auditActionLabel,
  auditModuleLabels,
  auditOutcomeLabels,
  projectAuditChanges,
  projectAuditFacts,
  resolveAuditRelatedLink,
  type AuditLog,
  type AuditLogDetail,
} from './audit.model';

function AuditDetailContent({ detail }: { detail: AuditLogDetail }) {
  const projection = projectDetail(detail);
  if (!projection.data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        安全投影失败：{projection.error}
      </div>
    );
  }
  const { action, changes, facts, related } = projection.data;
  return (
    <div className="space-y-6">
      <section aria-labelledby="audit-detail-identity" className="space-y-3">
        <h3 className="type-section-title" id="audit-detail-identity">基础信息</h3>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Metadata label="时间" value={formatTime(detail.created_at)} />
          <Metadata label="操作者" value={actorLabel(detail)} />
          <Metadata label="模块" value={auditModuleLabels[detail.business_module]} />
          <Metadata label="动作" value={action} />
          <Metadata label="对象" value={`${detail.target_type} / ${detail.target_id ?? '未记录'}`} />
          <Metadata label="执行结果" value={auditOutcomeLabels[detail.outcome]} />
          <Metadata label="Request ID" mono value={detail.request_id} />
        </dl>
      </section>

      <section aria-labelledby="audit-detail-projection" className="space-y-3">
        <h3 className="type-section-title" id="audit-detail-projection">安全变更摘要</h3>
        {changes.length === 0 && facts.length === 0 ? (
          <p className="text-sm text-text-muted">此记录没有可展示的字段变化。</p>
        ) : (
          <div className="space-y-3 text-sm">
            {changes.map((change) => (
              <div className="rounded-lg border border-border-subtle p-3" key={change.field}>
                <strong>{change.label}</strong>
                <p className="mt-1 break-words text-text-secondary">{change.before} → {change.after}</p>
              </div>
            ))}
            {facts.length > 0 && (
              <dl className="grid gap-3 sm:grid-cols-2">
                {facts.map((fact) => <Metadata key={fact.field} label={fact.label} value={fact.value} />)}
              </dl>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="audit-detail-result" className="space-y-2">
        <h3 className="type-section-title" id="audit-detail-result">结果说明</h3>
        <p className="text-sm text-text-secondary">{detail.result_message}</p>
        {detail.error_code && <p className="font-mono text-xs text-text-muted">错误码：{detail.error_code}</p>}
      </section>

      <section aria-labelledby="audit-detail-related" className="space-y-2">
        <h3 className="type-section-title" id="audit-detail-related">关联对象</h3>
        {related ? (
          <a className="inline-flex min-h-8 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={related.href}>
            {related.label}
          </a>
        ) : (
          <p className="text-sm text-text-muted">
            {detail.related_entry.status === 'MISSING' ? '关联对象已不存在，历史审计记录保持不变。' : '当前对象没有可用的关联入口。'}
          </p>
        )}
      </section>
    </div>
  );
}

function projectDetail(detail: AuditLogDetail) {
  try {
    return {
      data: {
        action: auditActionLabel(detail.action),
        changes: projectAuditChanges(detail.changes),
        facts: projectAuditFacts(detail.facts),
        related: resolveAuditRelatedLink(detail),
      },
      error: null,
    } as const;
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : '审计详情包含无法展示的字段',
    } as const;
  }
}

function OutcomeBadge({ outcome }: { outcome: AuditLog['outcome'] }) {
  const variant = outcome === 'SUCCESS' ? 'success' : outcome === 'FAILED' ? 'destructive' : 'warning';
  return <Badge variant={variant}>{auditOutcomeLabels[outcome]}</Badge>;
}

function Metadata({ label, mono = false, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={`mt-1 break-words text-text-secondary${mono ? ' font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function actorLabel(log: AuditLog) {
  return log.actor ? `${log.actor.display_name}（${log.actor.account_type}）` : '用户已删除/未记录';
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
}

export { AuditDetailContent, OutcomeBadge, actorLabel, formatTime };
