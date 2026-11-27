import { useQuery } from '@tanstack/react-query';
import { ArrowRightIcon, CheckCircle2Icon, ClockAlertIcon } from 'lucide-react';
import { useState } from 'react';

import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { cn } from '@/shared/lib/utils';
import { workbenchInboxQueryOptions } from './workbench.api';
import {
  formatWorkbenchDateTime,
  inboxBucketLabels,
  inboxBucketOrder,
  inboxItemKindPresentations,
  inboxPriorityPresentations,
  resolveWorkbenchTimezone,
  type WorkbenchInboxBucket,
} from './workbench.model';

function WorkbenchInboxSection() {
  const [activeBucket, setActiveBucket] = useState<WorkbenchInboxBucket>('assigned_to_me');
  const timezone = resolveWorkbenchTimezone();
  const inboxQuery = useQuery(workbenchInboxQueryOptions(activeBucket, timezone));
  const counts = inboxQuery.data?.bucket_counts;
  const isSwitchingBucket = inboxQuery.isPlaceholderData && inboxQuery.isFetching;

  return (
    <section aria-labelledby="workbench-inbox-title" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="type-section-title text-text-primary" id="workbench-inbox-title">
            运营收件箱
          </h2>
          <p className="text-xs text-text-secondary">
            实时投影分配给我的事项、今日到期、已超时与各阶段待办，按超时与优先级自动排序。
          </p>
        </div>
        {inboxQuery.data && (
          <span className="text-xs text-text-muted">
            时区：{inboxQuery.data.timezone}
          </span>
        )}
      </div>

      <div
        aria-label="运营收件箱分桶"
        className="flex flex-wrap gap-2"
        role="tablist"
      >
        {inboxBucketOrder.map((bucket) => {
          const count = counts ? counts[bucket] : undefined;
          const selected = activeBucket === bucket;
          const isOverdueAlert = bucket === 'overdue' && (count ?? 0) > 0;
          return (
            <button
              aria-selected={selected}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : isOverdueAlert
                    ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15'
                    : 'border-border-subtle bg-surface-panel text-text-secondary hover:bg-surface-selected/45',
              )}
              key={bucket}
              onClick={() => setActiveBucket(bucket)}
              role="tab"
              type="button"
            >
              <span>{inboxBucketLabels[bucket]}</span>
              <span className="font-mono tabular-nums opacity-90">{count ?? '—'}</span>
            </button>
          );
        })}
      </div>

      {inboxQuery.isPending || isSwitchingBucket ? (
        <div className="space-y-2 rounded-xl border border-border-subtle bg-surface-panel p-4" aria-busy="true">
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
        </div>
      ) : inboxQuery.isError || !inboxQuery.data ? (
        <InlineBanner
          actions={
            <Button onClick={() => void inboxQuery.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          }
          title="运营收件箱加载失败"
          tone="danger"
        >
          {inboxQuery.error instanceof Error ? inboxQuery.error.message : '读取运营收件箱失败'}
        </InlineBanner>
      ) : inboxQuery.data.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-default bg-surface-panel/70 px-6 py-8 text-center">
          <CheckCircle2Icon aria-hidden="true" className="size-5 text-success" />
          <p className="text-sm font-medium text-text-secondary">
            “{inboxBucketLabels[activeBucket]}”分桶当前没有待处理事项。
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface-panel shadow-[var(--shadow-panel)]">
          {inboxQuery.data.items.map((item) => {
            const kindMeta = inboxItemKindPresentations[item.item_kind];
            const priorityMeta = inboxPriorityPresentations[item.priority];
            return (
              <li className="min-w-0" key={`${item.item_kind}:${item.resource_id}`}>
                <a
                  className="group flex min-w-0 items-start justify-between gap-3 p-4 transition-colors hover:bg-surface-selected/45"
                  href={item.href}
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={kindMeta.tone}>{kindMeta.label}</Badge>
                      <Badge variant={priorityMeta.tone}>优先级：{priorityMeta.label}</Badge>
                      {item.is_overdue && (
                        <Badge variant="destructive">
                          <ClockAlertIcon aria-hidden="true" className="mr-1 inline size-3" />
                          已超时
                        </Badge>
                      )}
                      <span className="min-w-0 break-words text-sm font-semibold text-text-primary group-hover:text-primary">
                        {item.title}
                      </span>
                    </div>
                    <p className="break-words text-xs text-text-secondary">{item.summary}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-tertiary">
                      <span>负责人：{item.assignee ? item.assignee.display_name : '未分派'}</span>
                      {item.due_at && (
                        <span>
                          截止：{formatWorkbenchDateTime(item.due_at, inboxQuery.data.timezone)}
                        </span>
                      )}
                    </div>
                    {item.blocked_reason && (
                      <p className="rounded bg-warning/10 px-2 py-1 text-xs text-warning-foreground">
                        阻塞说明：{item.blocked_reason}
                      </p>
                    )}
                  </div>
                  <ArrowRightIcon
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                  />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export { WorkbenchInboxSection };
