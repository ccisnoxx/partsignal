/** AI 渠道 Runtime 只消费服务端聚合与脱敏审计投影，URL 是筛选和分页的唯一 owner。 */
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { AuditDetailContent, OutcomeBadge, actorLabel, formatTime } from '@/domains/audit/audit-detail-content';
import { auditDetailQueryOptions } from '@/domains/audit/audit.api';
import { auditActionLabel, auditOutcomeLabels } from '@/domains/audit/audit.model';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { Button } from '@/design-system/primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/design-system/primitives/sheet';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { DetailSection } from '@/design-system/workspace/detail-section';
import type { components } from '@/shared/api/generated/schema';
import {
  aiChannelLogsQueryOptions,
  aiChannelUsageQueryOptions,
} from './ai-channel.api';
import {
  type AIChannelWorkspaceSearch,
} from './ai-channel-workspace.model';

type AuditLog = components['schemas']['AuditLog'];
type UsageSearch = Extract<AIChannelWorkspaceSearch, { tab: 'usage' }>;
type LogsSearch = Extract<AIChannelWorkspaceSearch, { tab: 'logs' }>;

type AIChannelRuntimeSectionProps = {
  channelId: string;
  onSearchChange: (search: AIChannelWorkspaceSearch) => Promise<void> | void;
  search: UsageSearch | LogsSearch;
};

const usagePeriodItems = [
  { label: '最近 7 天', value: '7d' },
  { label: '最近 30 天', value: '30d' },
  { label: '最近 90 天', value: '90d' },
  { label: '全部时间', value: 'all' },
] as const;

function AIChannelRuntimeSection(props: AIChannelRuntimeSectionProps) {
  return props.search.tab === 'usage'
    ? <UsageSection {...props} search={props.search} />
    : <LogsSection {...props} search={props.search} />;
}

function UsageSection({ channelId, onSearchChange, search }: AIChannelRuntimeSectionProps & { search: UsageSearch }) {
  const usage = useQuery(aiChannelUsageQueryOptions(channelId, search.period));
  return (
    <DetailSection
      actions={(
        <Select
          items={usagePeriodItems}
          onValueChange={(period) => period && onSearchChange({ tab: 'usage', period })}
          value={search.period}
        >
          <SelectTrigger aria-label="统计时间范围"><SelectValue /></SelectTrigger>
          <SelectContent>
            {usagePeriodItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      description="只统计服务端正式 GENERATE/HUMANIZE 作业；连接测试和模型发现不计入。"
      title="使用统计"
    >
      {usage.isPending ? <RuntimeSkeleton label="正在加载使用统计" /> : !usage.data ? (
        <RuntimeNotice message={errorMessage(usage.error)} onRetry={() => void usage.refetch()} />
      ) : (
        <div className="space-y-4">
          {usage.error && (
            <RuntimeNotice message={`使用统计刷新失败：${errorMessage(usage.error)}`} onRetry={() => void usage.refetch()} />
          )}
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label="业务作业" value={formatNumber(usage.data.total_jobs)} />
            <Metric label="成功" value={formatNumber(usage.data.succeeded_jobs)} />
            <Metric label="失败" value={formatNumber(usage.data.failed_jobs)} />
            <Metric label="成功率" value={usage.data.success_rate === null ? '暂无数据' : `${(usage.data.success_rate * 100).toFixed(1)}%`} />
            <Metric label="平均响应" value={usage.data.average_response_duration_ms === null ? '暂无数据' : `${formatNumber(usage.data.average_response_duration_ms)} ms`} />
          </dl>
          <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border-subtle bg-surface-muted p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Metadata label="输入 Token" value={optionalNumber(usage.data.prompt_tokens)} />
            <Metadata label="输出 Token" value={optionalNumber(usage.data.completion_tokens)} />
            <Metadata label="Token 合计" value={optionalNumber(usage.data.total_tokens)} />
            <Metadata label="最近使用" value={optionalTime(usage.data.last_used_at)} />
            <Metadata label="统计开始" value={optionalTime(usage.data.period_started_at)} />
            <Metadata label="统计结束" value={formatTime(usage.data.period_ended_at)} />
          </dl>
        </div>
      )}
    </DetailSection>
  );
}

function LogsSection({ channelId, onSearchChange, search }: AIChannelRuntimeSectionProps & { search: LogsSearch }) {
  const logs = useQuery(aiChannelLogsQueryOptions(channelId, search.page, search.pageSize));
  const [target, setTarget] = useState<AuditLog>();
  const finalFocus = useRef<HTMLElement | null>(null);

  return (
    <>
      <DetailSection
        description="按服务端顺序与分页展示渠道、Header 和模型的脱敏配置事件。"
        title="操作日志"
      >
        {logs.isPending ? <RuntimeSkeleton label="正在加载操作日志" /> : !logs.data ? (
          <RuntimeNotice message={errorMessage(logs.error)} onRetry={() => void logs.refetch()} />
        ) : (
          <div className="space-y-3">
            {logs.error && (
              <RuntimeNotice message={`操作日志刷新失败：${errorMessage(logs.error)}`} onRetry={() => void logs.refetch()} />
            )}
            {logs.data.items.length === 0 ? (
              logs.data.total === 0 ? (
                <p className="rounded-lg border border-dashed border-border-default p-6 text-center text-text-muted">暂无渠道操作日志。</p>
              ) : (
                <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-4" role="alert">
                  <p>当前页超出有效范围，未自动修改 URL。</p>
                  <Button
                    onClick={() => onSearchChange({
                      tab: 'logs',
                      page: Math.ceil(logs.data.total / search.pageSize),
                      pageSize: search.pageSize,
                    })}
                    type="button"
                    variant="outline"
                  >
                    返回最后有效页
                  </Button>
                </div>
              )
            ) : (
              <TableShell regionLabel="AI 渠道操作日志">
                <thead><tr><th data-column-role="primary" scope="col">动作</th><th className="hidden md:table-cell" data-column-role="metadata" scope="col">时间</th><th className="hidden lg:table-cell" data-column-role="metadata" scope="col">操作者</th><th className="hidden md:table-cell" data-column-role="status" scope="col">结果</th><th data-column-role="actions" scope="col">操作</th></tr></thead>
                <tbody>
                  {logs.data.items.map((log) => (
                    <tr key={log.id}>
                      <td className="min-w-56" data-column-role="primary">
                        <strong className="block">{auditActionLabel(log.action)}</strong>
                        <code className="mt-1 block break-all text-xs text-text-muted">{log.request_id}</code>
                        <div className="mt-2 space-y-1 text-xs text-text-secondary md:hidden">
                          <p>{formatTime(log.created_at)}</p>
                          <p>{actorLabel(log)} · {auditOutcomeLabels[log.outcome]}</p>
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap md:table-cell" data-column-role="metadata"><time dateTime={log.created_at}>{formatTime(log.created_at)}</time></td>
                      <td className="hidden min-w-36 lg:table-cell" data-column-role="metadata"><span className="block">{log.actor?.display_name ?? '用户已删除/未记录'}</span><span className="text-xs text-text-muted">{log.actor?.account_type ?? '未记录'}</span></td>
                      <td className="hidden md:table-cell" data-column-role="status"><OutcomeBadge outcome={log.outcome} /></td>
                      <td data-column-role="actions">
                        <Button
                          onClick={(event) => {
                            finalFocus.current = event.currentTarget;
                            setTarget(log);
                          }}
                          size="sm"
                          type="button"
                          variant="outline"
                        >查看详情</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
            <TablePagination
              onPageIndexChange={(pageIndex) => onSearchChange({ tab: 'logs', page: pageIndex + 1, pageSize: search.pageSize })}
              onPageSizeChange={(pageSize) => onSearchChange({ tab: 'logs', page: 1, pageSize: pageSize as 10 | 20 | 50 })}
              pageCount={Math.ceil(logs.data.total / search.pageSize)}
              pageIndex={search.page - 1}
              pageSize={search.pageSize}
              totalItems={logs.data.total}
            />
          </div>
        )}
      </DetailSection>
      <AuditDetailSheet
        finalFocus={finalFocus}
        onClose={() => setTarget(undefined)}
        target={target}
      />
    </>
  );
}

function AuditDetailSheet({ finalFocus, onClose, target }: {
  finalFocus: { current: HTMLElement | null };
  onClose: () => void;
  target?: AuditLog;
}) {
  const detail = useQuery({
    ...auditDetailQueryOptions(target?.id ?? ''),
    enabled: target !== undefined,
  });
  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={target !== undefined}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" finalFocus={finalFocus}>
        <SheetHeader>
          <SheetTitle>渠道操作日志详情</SheetTitle>
          <SheetDescription>只展示服务端 CONFIGURATION 白名单中的安全字段。</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          {detail.isPending ? <RuntimeSkeleton label="正在加载日志详情" /> : !detail.data ? (
            <RuntimeNotice message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
          ) : <AuditDetailContent detail={detail.data} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border-subtle bg-surface-muted p-4"><dt className="text-xs text-text-muted">{label}</dt><dd className="mt-2 break-words text-2xl font-semibold tabular-nums text-text-primary">{value}</dd></div>;
}

function Metadata({ label, mono = false, value }: { label: string; mono?: boolean; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-text-muted">{label}</dt><dd className={`mt-1 break-words text-text-secondary${mono ? ' font-mono' : ''}`}>{value}</dd></div>;
}

function RuntimeSkeleton({ label }: { label: string }) {
  return <div aria-label={label} className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
}

function RuntimeNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert"><span>{message}</span><Button onClick={onRetry} size="sm" type="button" variant="outline">重试</Button></div>;
}

function formatNumber(value: number) {
  return value.toLocaleString('zh-CN');
}

function optionalNumber(value: number | null) {
  return value === null ? '暂无数据' : formatNumber(value);
}

function optionalTime(value: string | null) {
  return value === null ? '暂无数据' : formatTime(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'AI 渠道 Runtime 发生未知错误';
}

export { AIChannelRuntimeSection };
export type { AIChannelRuntimeSectionProps };
