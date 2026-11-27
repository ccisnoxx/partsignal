import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type RefObject } from 'react';

import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { formatPublicationTime } from './published-article.model';

type HealthStatus = components['schemas']['PublishedArticleHealthCheckOut']['status'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

const statusMeta: Record<HealthStatus, { label: string; tone: 'success' | 'warning' | 'destructive' }> = {
  HEALTHY: { label: '健康 (HEALTHY)', tone: 'success' },
  FETCH_BLOCKED: { label: '抓取受阻 (FETCH_BLOCKED · 仅告警)', tone: 'warning' },
  CONFIRMED_ANOMALY: { label: '确认异常 (CONFIRMED_ANOMALY)', tone: 'destructive' },
};

const anomalyReasonLabels: Record<string, string> = {
  HTTP_GONE_OR_NOT_FOUND: '公开页面返回 404 / 410',
  META_OR_HEADER_NOINDEX: '检测到 noindex 阻止索引',
  CANONICAL_DOMAIN_MISMATCH: 'Canonical 指向允许域名以外',
  BODY_SEVERELY_CHANGED: '页面可见正文与已批准版本严重偏离',
};

function extractHealthError(action: string, status: number, rawError: unknown): string {
  const envelope = rawError as ErrorEnvelope | undefined;
  if (envelope?.error?.message) {
    const reqId = envelope.error.request_id;
    return reqId ? `${envelope.error.message}（请求 ID：${reqId}）` : envelope.error.message;
  }
  return `${action}失败（HTTP ${status}）`;
}

function articleHealthChecksQueryOptions(articleId: string) {
  return queryOptions({
    queryKey: ['publication', 'articles', 'health-checks', articleId] as const,
    retry: false,
    queryFn: async () => {
      const result = await api.GET('/api/v1/published-articles/{article_id}/health-checks', {
        params: { path: { article_id: articleId }, query: { limit: 30 } },
      });
      if (result.data) return result.data;
      throw new Error(extractHealthError('读取公开页面健康检查历史', result.response.status, result.error));
    },
  });
}

function ArticleHealthCheckDialogButton({
  articleId,
  csrfToken,
  onIssueAutoOpened,
}: {
  articleId: string;
  csrfToken: string | null;
  onIssueAutoOpened?: () => Promise<unknown>;
}) {
  const [openedForArticleId, setOpenedForArticleId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isOpen = openedForArticleId === articleId;

  return (
    <>
      <Button
        onClick={() => setOpenedForArticleId(articleId)}
        ref={triggerRef}
        size="sm"
        type="button"
        variant="outline"
      >
        公开页面健康检查
      </Button>
      <Dialog
        onOpenChange={(next) => {
          if (!next && !running) setOpenedForArticleId(null);
        }}
        open={isOpen}
      >
        {isOpen && (
          <ArticleHealthCheckDialogBody
            articleId={articleId}
            csrfToken={csrfToken}
            key={articleId}
            onClose={() => setOpenedForArticleId(null)}
            onIssueAutoOpened={onIssueAutoOpened}
            onRunningChange={setRunning}
            running={running}
            triggerRef={triggerRef}
          />
        )}
      </Dialog>
    </>
  );
}

function ArticleHealthCheckDialogBody({
  articleId,
  csrfToken,
  running,
  onRunningChange,
  onClose,
  onIssueAutoOpened,
  triggerRef,
}: {
  articleId: string;
  csrfToken: string | null;
  running: boolean;
  onRunningChange: (nextRunning: boolean) => void;
  onClose: () => void;
  onIssueAutoOpened?: () => Promise<unknown>;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const queryClient = useQueryClient();
  const query = useQuery(articleHealthChecksQueryOptions(articleId));
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const submittingRef = useRef(false);

  async function handleRunCheck() {
    if (submittingRef.current) return;
    if (!csrfToken) {
      setActionError('缺少会话 CSRF Token，请刷新页面后重试。');
      return;
    }
    submittingRef.current = true;
    onRunningChange(true);
    setActionError(undefined);
    setNotice(undefined);
    let continuation: ReturnType<typeof capturePrincipalContinuation> | undefined;
    try {
      continuation = capturePrincipalContinuation(queryClient);
      const result = await api.POST('/api/v1/published-articles/{article_id}/health-checks', {
        params: {
          path: { article_id: articleId },
          header: { 'X-CSRF-Token': csrfToken },
        },
      });
      if (!continuation.isCurrent()) return;
      if (!result.data) {
        throw new Error(extractHealthError('执行公开页面健康检查', result.response.status, result.error));
      }
      const refreshed = await query.refetch();
      if (!continuation.isCurrent()) return;
      if (refreshed.isError) {
        throw refreshed.error instanceof Error
          ? refreshed.error
          : new Error('健康检查已写入，但刷新历史列表失败，请重试刷新。');
      }
      if (result.data.auto_opened_issue_id && onIssueAutoOpened) {
        await onIssueAutoOpened();
        if (!continuation.isCurrent()) return;
      }
      if (result.data.auto_opened_issue_id) {
        setNotice('检查完成：已达到连续确认异常阈值，系统已自动登记发布后内容问题。');
      } else {
        setNotice(`检查完成：当前状态为 ${statusMeta[result.data.status].label}。`);
      }
    } catch (caught) {
      if (continuation && !continuation.isCurrent()) return;
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (!continuation || continuation.isCurrent()) {
        submittingRef.current = false;
        onRunningChange(false);
      }
    }
  }

  const data = query.data;

  return (
    <DialogContent
      className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
      finalFocus={triggerRef}
      showCloseButton={!running}
    >
      <DialogHeader>
        <DialogTitle>公开页面健康检查历史</DialogTitle>
        <DialogDescription>
          只读抓取公开页面检查 HTTP 状态、重定向、标题、正文相似度、noindex 与 canonical；抓取受阻仅告警不自动建单。
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-raised p-3 text-xs">
        <div className="space-y-0.5">
          {data ? (
            <>
              <p className="font-medium text-text-primary">
                平台周期巡检：{data.platform_health_check_enabled ? '已启用' : '未启用（可手动执行）'} · 自动建单阈值：连续 {data.anomaly_threshold} 次确认异常
              </p>
              <p className="text-text-secondary">
                当前连续确认异常：{data.consecutive_confirmed_anomalies} 次
              </p>
            </>
          ) : (
            <p className="text-text-secondary">公开页只读检查</p>
          )}
        </div>
        <Button disabled={running} onClick={() => void handleRunCheck()} size="sm" type="button">
          {running ? '检查中…' : '立即执行公开页健康检查'}
        </Button>
      </div>

      {actionError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive" role="alert">
          {actionError}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-xs text-text-primary" role="status">
          {notice}
        </p>
      )}

      {query.isPending ? (
        <p className="text-sm text-text-secondary" aria-busy="true">正在读取健康检查记录…</p>
      ) : query.isError || !data ? (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
          <p>{query.error instanceof Error ? query.error.message : '读取健康检查历史失败'}</p>
          <Button onClick={() => void query.refetch()} size="sm" type="button" variant="outline">
            重试
          </Button>
        </div>
      ) : data.items.length === 0 ? (
        <p className="rounded-lg border border-border-subtle p-4 text-center text-sm text-text-muted">
          尚无公开页面健康检查记录，可点击上方按钮立即执行一次只读核查。
        </p>
      ) : (
        <ul className="space-y-2 text-xs">
          {data.items.map((item) => {
            const meta = statusMeta[item.status];
            return (
              <li className="space-y-1.5 rounded-lg border border-border-subtle p-3" key={item.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={meta.tone}>{meta.label}</Badge>
                  <time className="text-text-muted" dateTime={item.checked_at}>
                    {formatPublicationTime(item.checked_at)}
                  </time>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-secondary">
                  <span>HTTP：{item.http_status ?? '无响应'}</span>
                  <span>重定向：{item.redirect_count} 次</span>
                  {item.body_similarity != null && (
                    <span>正文相似度：{Math.round(item.body_similarity * 100)}%</span>
                  )}
                  {item.title_matches !== null && (
                    <span>标题匹配：{item.title_matches ? '是' : '否'}</span>
                  )}
                  {item.has_noindex && <span className="font-medium text-destructive">含 noindex</span>}
                  {item.fetch_error_code && (
                    <span className="font-mono text-text-primary">原因：{item.fetch_error_code}</span>
                  )}
                </div>
                {item.anomaly_reasons.length > 0 && (
                  <p className="text-destructive">
                    确认异常原因：{item.anomaly_reasons.map((code) => anomalyReasonLabels[code] ?? code).join('；')}
                  </p>
                )}
                {item.auto_opened_issue_id && (
                  <p>
                    <a
                      className="font-medium text-link hover:underline"
                      href={`/publishing/issues/${item.auto_opened_issue_id}#issue`}
                    >
                      查看系统自动登记的发布后内容问题
                    </a>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <DialogFooter>
        <Button disabled={running} onClick={onClose} type="button" variant="outline">
          关闭
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export { ArticleHealthCheckDialogButton, articleHealthChecksQueryOptions };
