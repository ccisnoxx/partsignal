import { useQuery } from '@tanstack/react-query';

import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  leadershipEvidenceQueryOptions,
  type LeadershipEvidenceQueryParams,
} from './leadership-dashboard.api';
import {
  citationObsLabels,
  collectionModeLabels,
  formatShortDateTime,
  linkStatusLabels,
  runStatusLabels,
} from './leadership-dashboard.model';

export type EvidenceSelection = {
  title: string;
  params: LeadershipEvidenceQueryParams;
};

type Props = {
  selection: EvidenceSelection | null;
  onClose: () => void;
};

export function LeadershipEvidenceDrawer({ selection, onClose }: Props) {
  const query = useQuery(
    leadershipEvidenceQueryOptions(selection?.params ?? {}, Boolean(selection)),
  );

  if (!selection) return null;

  return (
    <div
      aria-label="原始观测证据下钻"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      role="dialog"
    >
      <div className="flex h-full w-full max-w-2xl flex-col bg-surface-panel shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text-primary">
              原始证据下钻：{selection.title}
            </h2>
            <p className="text-xs text-text-tertiary">
              展示底层观测回答原文、采集/登记时间、联网与引用检查状态及文章归因关系
            </p>
          </div>
          <Button onClick={onClose} size="sm" type="button" variant="outline">
            关闭
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {query.isLoading && (
            <p className="text-sm text-text-secondary">正在加载关联观测证据…</p>
          )}
          {query.error && (
            <InlineBanner tone="danger">
              {query.error instanceof Error ? query.error.message : '证据加载失败'}
            </InlineBanner>
          )}
          {query.data && query.data.items.length === 0 && (
            <p className="rounded-lg border border-border-subtle bg-surface-app p-4 text-sm text-text-secondary">
              当前条件下暂无可展示的观测证据。
            </p>
          )}

          {query.data?.items.map((item) => (
            <article
              className="space-y-3 rounded-lg border border-border-subtle bg-surface-app p-4"
              key={item.run_id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{item.platform_name}</Badge>
                  <Badge variant="outline">
                    {collectionModeLabels[item.collection_mode] ?? item.collection_mode}
                  </Badge>
                  <Badge
                    variant={
                      item.status === 'COMPLETED'
                        ? 'success'
                        : item.status === 'NEEDS_REVIEW'
                          ? 'warning'
                          : item.status === 'FAILED'
                            ? 'destructive'
                            : 'secondary'
                    }
                  >
                    {runStatusLabels[item.status] ?? item.status}
                  </Badge>
                  {item.is_backfill && (
                    <Badge variant="info">
                      历史补录{item.backfill_source ? ` · ${item.backfill_source}` : ''}
                    </Badge>
                  )}
                  {item.query_modified && <Badge variant="warning">实际已改问（不计入固定基线）</Badge>}
                </div>
                <span className="text-xs text-text-tertiary">
                  采集：{formatShortDateTime(item.collected_at ?? item.effective_at)} · 登记：
                  {formatShortDateTime(item.registered_at)}
                </span>
              </div>

              <div className="space-y-1 text-sm">
                <p className="font-medium text-text-primary">标准问题：{item.prompt_text}</p>
                {item.query_modified && item.actual_prompt_text && (
                  <p className="text-xs text-text-warning">
                    实际改问原文：{item.actual_prompt_text}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-text-secondary">
                <span>记录人：{item.recorder_name ?? '系统/未指定'}</span>
                <span>
                  联网状态：
                  {item.web_search_observed === true
                    ? '已观察到联网'
                    : item.web_search_observed === false
                      ? '未观察到联网'
                      : '未知'}
                </span>
                <span>
                  引用检查：
                  {item.citation_observation_status
                    ? (citationObsLabels[item.citation_observation_status] ??
                      item.citation_observation_status)
                    : '未填写'}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant={item.mentioned_brand ? 'success' : 'secondary'}>
                  品牌提及：{item.mentioned_brand ? '是' : '否'}
                </Badge>
                <Badge variant={item.mentioned_product ? 'success' : 'secondary'}>
                  产品提及：{item.mentioned_product ? '是' : '否'}
                </Badge>
                <Badge variant={item.recommended === true ? 'success' : 'secondary'}>
                  明确推荐：
                  {item.recommended === true ? '是' : item.recommended === false ? '否' : '未知'}
                </Badge>
              </div>

              {item.error_code && (
                <InlineBanner tone="danger">
                  采集异常（{item.error_code}）：{item.error_summary ?? '未提供详情'}
                </InlineBanner>
              )}

              {item.answer_text ? (
                <div className="max-h-60 overflow-y-auto rounded-md border border-border-subtle bg-surface-panel p-3 text-xs leading-relaxed whitespace-pre-wrap text-text-primary">
                  {item.answer_text}
                </div>
              ) : (
                <p className="text-xs text-text-tertiary">暂无文本回答快照。</p>
              )}

              {item.citation_links.length > 0 && (
                <div className="space-y-1.5 border-t border-border-subtle pt-2">
                  <p className="text-xs font-medium text-text-secondary">引用与文章台账归因</p>
                  <ul className="space-y-1 text-xs">
                    {item.citation_links.map((link) => (
                      <li
                        className="flex flex-wrap items-center justify-between gap-2 rounded bg-surface-panel px-2.5 py-1.5"
                        key={link.id}
                      >
                        <div className="min-w-0">
                          <span className="font-medium text-text-primary">
                            {link.article_title ?? link.citation_url}
                          </span>
                          {link.platform_name && (
                            <span className="ml-1.5 text-text-tertiary">({link.platform_name})</span>
                          )}
                        </div>
                        <Badge
                          variant={
                            link.link_status === 'AUTO_EXACT' || link.link_status === 'CONFIRMED'
                              ? 'success'
                              : link.link_status === 'CANDIDATE'
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {linkStatusLabels[link.link_status] ?? link.link_status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
