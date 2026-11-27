import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { ContentRequestError } from './content.api';
import {
  contentDuplicationQueryOptions,
  contentQualityKeys,
  createSemanticQualityCheck,
  semanticQualityChecksQueryOptions,
} from './content-quality.api';

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function severityVariant(severity: 'BLOCKING' | 'WARNING' | 'INFORMATION') {
  if (severity === 'BLOCKING') return 'destructive' as const;
  if (severity === 'WARNING') return 'warning' as const;
  return 'secondary' as const;
}

function stableIdempotencyKey(cache: Map<string, string>, signature: string): string {
  const existing = cache.get(signature);
  if (existing) return existing;
  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `semqc-${crypto.randomUUID()}`
      : `semqc-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  cache.set(signature, generated);
  return generated;
}

function ContentDuplicationDialogButton({
  contentVersionId,
  currentContentHash,
  csrfToken,
}: {
  contentVersionId: string;
  currentContentHash?: string;
  csrfToken: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        重复度分析与 AI 深度质检
      </Button>
      {open && (
        <ContentDuplicationDialog
          contentVersionId={contentVersionId}
          csrfToken={csrfToken}
          currentContentHash={currentContentHash}
          key={contentVersionId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ContentDuplicationDialog({
  contentVersionId,
  currentContentHash,
  csrfToken,
  onClose,
}: {
  contentVersionId: string;
  currentContentHash?: string;
  csrfToken: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const dupQuery = useQuery(contentDuplicationQueryOptions(contentVersionId));
  const checksQuery = useQuery(semanticQualityChecksQueryOptions(contentVersionId));
  const [selectedModelId, setSelectedModelId] = useState('');
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);
  const idempotencyKeysRef = useRef<Map<string, string>>(new Map());

  const models = checksQuery.data?.available_models ?? [];
  const effectiveModelId = selectedModelId || models[0]?.id || '';
  const hasActiveJob = (checksQuery.data?.items ?? []).some(
    (job) => job.status === 'PENDING' || job.status === 'RUNNING',
  );

  const triggerMutation = useMutation({
    mutationFn: ({ modelId, key }: { modelId: string; key: string }) =>
      createSemanticQualityCheck(contentVersionId, modelId, csrfToken, key),
  });

  async function handleRunSemanticCheck() {
    if (submittingRef.current || hasActiveJob) return;
    if (!effectiveModelId) {
      setActionError('当前没有可用的已测试 AI 模型');
      return;
    }
    submittingRef.current = true;
    setActionError(undefined);
    setBusy(true);
    const signature = `${contentVersionId}:${effectiveModelId}`;
    const key = stableIdempotencyKey(idempotencyKeysRef.current, signature);
    let continuation: ReturnType<typeof capturePrincipalContinuation> | undefined;
    try {
      continuation = capturePrincipalContinuation(queryClient);
      await triggerMutation.mutateAsync({ modelId: effectiveModelId, key });
      if (!continuation.isCurrent()) return;
      idempotencyKeysRef.current.delete(signature);
      await queryClient.invalidateQueries({
        queryKey: contentQualityKeys.semanticChecks(contentVersionId),
      });
    } catch (error) {
      if (continuation && !continuation.isCurrent()) return;
      if (error instanceof ContentRequestError && error.detail?.code === 'IDEMPOTENCY_CONFLICT') {
        idempotencyKeysRef.current.delete(signature);
      }
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!continuation || continuation.isCurrent()) {
        submittingRef.current = false;
        setBusy(false);
      }
    }
  }

  const modelItems = models.map((item) => ({
    value: item.id,
    label: `${item.display_name}（${item.channel_name}）`,
  }));

  return (
    <Dialog onOpenChange={(next) => { if (!next && !busy) onClose(); }} open>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>内容重复度分析与 AI 语义深度质检</DialogTitle>
          <DialogDescription>
            实时对比同活动（Campaign）与同产品历史内容，识别重复标题与段落；可选发起基于 PUBLIC 事实的异步 AI 深度语义评审。
          </DialogDescription>
        </DialogHeader>

        {dupQuery.isPending ? (
          <p className="text-sm text-text-secondary" aria-busy="true">正在分析同活动与同产品重复度…</p>
        ) : dupQuery.isError || !dupQuery.data ? (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
            <p>{dupQuery.error instanceof Error ? dupQuery.error.message : '读取重复度分析失败'}</p>
            <Button onClick={() => void dupQuery.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-surface-raised p-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-text-muted">同 Campaign 最高相似度</dt>
                <dd className="font-mono text-base font-semibold text-text-primary">
                  {formatPercent(dupQuery.data.same_campaign_max_similarity)}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">同产品历史最高相似度</dt>
                <dd className="font-mono text-base font-semibold text-text-primary">
                  {formatPercent(dupQuery.data.same_product_max_similarity)}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">同活动对比样本</dt>
                <dd className="font-mono text-base font-semibold text-text-primary">
                  {dupQuery.data.compared_campaign_count} 篇
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">同产品对比样本</dt>
                <dd className="font-mono text-base font-semibold text-text-primary">
                  {dupQuery.data.compared_product_count} 篇
                </dd>
              </div>
            </dl>

            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold text-text-primary">差异化改写建议</h3>
              <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
                {dupQuery.data.differentiation_suggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ul>
            </section>

            {dupQuery.data.similar_contents.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-text-primary">高相似内容列表</h3>
                <ul className="space-y-2">
                  {dupQuery.data.similar_contents.map((item) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle p-2.5 text-xs"
                      key={item.content_version_id}
                    >
                      <div className="space-y-0.5">
                        <p className="font-medium text-text-primary">{item.title}</p>
                        <p className="text-text-muted">
                          {item.task_identifier} · {item.platform_name}
                          {item.same_campaign ? ' · 同 Campaign' : ' · 同产品历史'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={item.similarity >= 0.55 ? 'warning' : 'secondary'}>
                          全文 {formatPercent(item.similarity)}
                        </Badge>
                        <Badge variant="outline">标题 {formatPercent(item.title_similarity)}</Badge>
                        {item.shared_paragraph_count > 0 && (
                          <Badge variant="outline">重叠段落 {item.shared_paragraph_count}</Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {dupQuery.data.duplicate_paragraphs.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-text-primary">重复段落对照</h3>
                <ul className="space-y-2">
                  {dupQuery.data.duplicate_paragraphs.slice(0, 5).map((para, idx) => (
                    <li
                      className="space-y-1 rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-xs"
                      key={`${para.target_version_id}-${idx}`}
                    >
                      <p className="font-medium text-text-secondary">
                        与《{para.target_title}》（{para.target_platform_name}）相似度 {formatPercent(para.similarity)}
                      </p>
                      <p className="text-text-primary">当前摘录：{para.source_excerpt}</p>
                      <p className="text-text-muted">相似段落：{para.matched_excerpt}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        <section className="space-y-3 border-t border-border-subtle pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Layer 2 可选 AI 深度语义质量检查</h3>
              <p className="text-xs text-text-muted">
                仅外发已批准 PUBLIC 产品事实与公开摘要；检查结果追加保存，不影响主线正文。
              </p>
            </div>
            <Button onClick={() => void checksQuery.refetch()} size="sm" type="button" variant="outline">
              刷新检查状态
            </Button>
          </div>

          {actionError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive" role="alert">
              {actionError}
            </p>
          )}

          {checksQuery.isPending ? (
            <p className="text-xs text-text-secondary" aria-busy="true">正在读取语义检查记录与可用 AI 模型…</p>
          ) : checksQuery.isError ? (
            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
              <p>{checksQuery.error instanceof Error ? checksQuery.error.message : '读取语义质检记录失败'}</p>
              <Button onClick={() => void checksQuery.refetch()} size="sm" type="button" variant="outline">
                重试加载
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[14rem] flex-1 space-y-1">
                  <label className="text-xs font-medium text-text-secondary" htmlFor="sem-qc-model">
                    选择已测试 AI 模型
                  </label>
                  <Select
                    disabled={busy || hasActiveJob || modelItems.length === 0}
                    items={modelItems}
                    onValueChange={(next) => next && setSelectedModelId(next)}
                    value={effectiveModelId}
                  >
                    <SelectTrigger id="sem-qc-model">
                      <SelectValue placeholder={modelItems.length ? '请选择模型' : '暂无可用模型'} />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {modelItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={busy || hasActiveJob || !effectiveModelId}
                  onClick={() => void handleRunSemanticCheck()}
                  size="sm"
                  type="button"
                >
                  {busy ? '提交中…' : hasActiveJob ? '语义质检进行中…' : '发起 AI 语义质量检查'}
                </Button>
              </div>

              {checksQuery.data.items.length > 0 ? (
                <ul className="space-y-2">
                  {checksQuery.data.items.map((job) => {
                    const isStaleDraft = Boolean(
                      currentContentHash && job.content_hash && job.content_hash !== currentContentHash,
                    );
                    return (
                      <li className="space-y-2 rounded-lg border border-border-subtle p-3 text-xs" key={job.id}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={job.status === 'SUCCEEDED' ? 'success' : job.status === 'FAILED' ? 'destructive' : 'warning'}>
                              {job.status}
                            </Badge>
                            {isStaleDraft && (
                              <Badge variant="outline">基于旧草稿修订，仅供参考</Badge>
                            )}
                          </div>
                          <span className="font-mono text-text-muted">
                            {job.total_tokens !== null ? `${job.total_tokens} tokens` : '等待统计'}
                          </span>
                        </div>
                        {job.error_summary && <p className="text-destructive">{job.error_summary}</p>}
                        {job.findings.length > 0 && (
                          <ul className="space-y-1">
                            {job.findings.map((finding, idx) => (
                              <li className="rounded bg-surface-raised p-2" key={`${finding.code}-${idx}`}>
                                <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>{' '}
                                <span className="font-medium text-text-primary">{finding.message}</span>
                                {finding.suggestion && (
                                  <p className="mt-0.5 text-text-secondary">建议：{finding.suggestion}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {job.differentiation_suggestions.length > 0 && (
                          <p className="text-text-secondary">
                            AI 差异化建议：{job.differentiation_suggestions.join('；')}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-text-muted">尚未发起过 AI 深度语义质量检查。</p>
              )}
            </>
          )}
        </section>

        <DialogFooter>
          <Button disabled={busy} onClick={onClose} type="button" variant="outline">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ContentDuplicationDialogButton };
