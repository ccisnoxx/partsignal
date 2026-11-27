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
import { Input } from '@/design-system/primitives/input';
import { Textarea } from '@/design-system/primitives/textarea';
import type { components } from '@/shared/api/generated/schema';
import {
  archivePlatformPromptVersion,
  createPlatformPromptVersion,
  platformPromptVersionsQueryOptions,
  promptKeys,
  publishPlatformPromptVersion,
  restorePlatformPromptVersion,
  updatePlatformPromptVersionDraft,
} from './prompt.api';

type PlatformPromptVersionOut = components['schemas']['PlatformPromptVersionOut'];

const statusLabels: Record<
  PlatformPromptVersionOut['status'],
  { label: string; tone: 'secondary' | 'success' | 'warning' }
> = {
  DRAFT: { label: '草稿', tone: 'warning' },
  PUBLISHED: { label: '已发布（不可变）', tone: 'success' },
  ARCHIVED: { label: '已归档', tone: 'secondary' },
};

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '暂无样本';
  return `${Math.round(value * 1000) / 10}%`;
}

function PromptVersionHistoryButton({
  promptId,
  promptName,
  currentMarkdown,
  csrfToken,
  onMutated,
}: {
  promptId: string;
  promptName: string;
  currentMarkdown: string;
  csrfToken: string | null;
  onMutated?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        版本历史与效果
      </Button>
      {open && (
        <PromptVersionHistoryDialog
          csrfToken={csrfToken}
          currentMarkdown={currentMarkdown}
          onClose={() => setOpen(false)}
          onMutated={onMutated}
          promptId={promptId}
          promptName={promptName}
        />
      )}
    </>
  );
}

function PromptVersionHistoryDialog({
  promptId,
  promptName,
  currentMarkdown,
  csrfToken,
  onClose,
  onMutated,
}: {
  promptId: string;
  promptName: string;
  currentMarkdown: string;
  csrfToken: string | null;
  onClose: () => void;
  onMutated?: () => void;
}) {
  const queryClient = useQueryClient();
  const versionsQuery = useQuery(platformPromptVersionsQueryOptions(promptId));
  const [creatingMode, setCreatingMode] = useState<'none' | 'create' | 'edit-draft'>('none');
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState(0);
  const [markdown, setMarkdown] = useState(currentMarkdown);
  const [summary, setSummary] = useState('');
  const [publishNow, setPublishNow] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const createMutation = useMutation({
    mutationFn: () =>
      createPlatformPromptVersion(
        promptId,
        {
          template_markdown: markdown.trim(),
          change_summary: summary.trim(),
          publish_immediately: publishNow,
        },
        csrfToken,
      ),
  });
  const draftMutation = useMutation({
    mutationFn: () =>
      updatePlatformPromptVersionDraft(
        editingVersionId!,
        {
          expected_revision: editingRevision,
          template_markdown: markdown.trim(),
          change_summary: summary.trim(),
        },
        csrfToken,
      ),
  });

  async function runProtected(task: () => Promise<unknown>) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setActionError(undefined);
    setBusy(true);
    let continuation: ReturnType<typeof capturePrincipalContinuation> | undefined;
    try {
      continuation = capturePrincipalContinuation(queryClient);
      await task();
      if (!continuation.isCurrent()) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: promptKeys.versions(promptId) }),
        queryClient.invalidateQueries({ queryKey: promptKeys.detail(promptId) }),
        queryClient.invalidateQueries({ queryKey: promptKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: promptKeys.previewOptions(promptId) }),
      ]);
      if (!continuation.isCurrent()) return;
      setCreatingMode('none');
      setEditingVersionId(null);
      onMutated?.();
    } catch (error) {
      if (continuation && !continuation.isCurrent()) return;
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!continuation || continuation.isCurrent()) {
        submittingRef.current = false;
        setBusy(false);
      }
    }
  }

  async function handleRefreshVersions() {
    setActionError(undefined);
    const refreshed = await versionsQuery.refetch();
    if (creatingMode === 'edit-draft' && editingVersionId && refreshed.data) {
      const latestDraft = refreshed.data.items.find((item) => item.id === editingVersionId);
      if (latestDraft && latestDraft.status === 'DRAFT') {
        setEditingRevision(latestDraft.revision);
      } else {
        setCreatingMode('none');
        setEditingVersionId(null);
      }
    }
  }

  async function handleSubmitVersion() {
    if (!markdown.trim()) {
      setActionError('Prompt 正文不能为空');
      return;
    }
    if (creatingMode === 'edit-draft' && editingVersionId) {
      await runProtected(() => draftMutation.mutateAsync());
      return;
    }
    await runProtected(() => createMutation.mutateAsync());
  }

  const latestPublishedMarkdown =
    versionsQuery.data?.items.find(
      (item) => item.id === versionsQuery.data?.latest_published_version_id,
    )?.template_markdown
    ?? versionsQuery.data?.items.find((item) => item.status === 'PUBLISHED')?.template_markdown
    ?? currentMarkdown;

  return (
    <Dialog onOpenChange={(next) => { if (!next && !busy) onClose(); }} open>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Prompt 不可变版本与效果分析 · {promptName}</DialogTitle>
          <DialogDescription>
            已发布版本正文永久不可变，平台需显式绑定版本并支持随时回滚；效果指标实时统计自生成作业、审核记录与 GEO 观测。
          </DialogDescription>
        </DialogHeader>

        {actionError && (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
            <p>{actionError}</p>
            <Button onClick={() => void handleRefreshVersions()} size="sm" type="button" variant="outline">
              刷新最新版本
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-secondary">
            共 {versionsQuery.data?.items.length ?? 0} 个版本
          </p>
          {creatingMode === 'none' && (
            <Button
              disabled={busy}
              onClick={() => {
                setActionError(undefined);
                setMarkdown(latestPublishedMarkdown);
                setSummary('');
                setPublishNow(false);
                setCreatingMode('create');
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              新建不可变版本
            </Button>
          )}
        </div>

        {creatingMode !== 'none' && (
          <div className="space-y-3 rounded-xl border border-border-subtle bg-surface-raised p-4">
            <h3 className="text-sm font-semibold text-text-primary">
              {creatingMode === 'edit-draft' ? '编辑草稿版本' : '新建版本'}
            </h3>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary" htmlFor="pv-summary">
                变更说明（可选，最多 500 字）
              </label>
              <Input
                disabled={busy}
                id="pv-summary"
                maxLength={500}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="例如：增加选型对比表格结构要求"
                value={summary}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary" htmlFor="pv-markdown">
                Prompt Markdown 正文
              </label>
              <Textarea
                disabled={busy}
                id="pv-markdown"
                onChange={(event) => setMarkdown(event.target.value)}
                rows={6}
                value={markdown}
              />
            </div>
            {creatingMode === 'create' && (
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  checked={publishNow}
                  disabled={busy}
                  onChange={(event) => setPublishNow(event.target.checked)}
                  type="checkbox"
                />
                创建后立即发布并冻结（不自动切换既有平台绑定）
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button disabled={busy} onClick={() => setCreatingMode('none')} size="sm" type="button" variant="outline">
                取消
              </Button>
              <Button disabled={busy} onClick={() => void handleSubmitVersion()} size="sm" type="button">
                {busy ? '保存中…' : creatingMode === 'edit-draft' ? '保存草稿' : publishNow ? '创建并发布' : '创建草稿'}
              </Button>
            </div>
          </div>
        )}

        {versionsQuery.isPending ? (
          <p className="text-sm text-text-secondary" aria-busy="true">正在读取不可变版本与效果指标…</p>
        ) : versionsQuery.isError || !versionsQuery.data ? (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
            <p>{versionsQuery.error instanceof Error ? versionsQuery.error.message : '读取版本历史失败'}</p>
            <Button onClick={() => void versionsQuery.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {versionsQuery.data.items.map((ver) => {
              const badge = statusLabels[ver.status];
              return (
                <li className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" key={ver.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-text-primary">v{ver.version}</span>
                      <Badge variant={badge.tone}>{badge.label}</Badge>
                      {ver.bound_platform_count > 0 && (
                        <Badge variant="info">已绑定 {ver.bound_platform_count} 个平台</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ver.available_actions.includes('UPDATE_DRAFT') && (
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setActionError(undefined);
                            setEditingVersionId(ver.id);
                            setEditingRevision(ver.revision);
                            setMarkdown(ver.template_markdown);
                            setSummary(ver.change_summary);
                            setCreatingMode('edit-draft');
                          }}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          编辑草稿
                        </Button>
                      )}
                      {ver.available_actions.includes('PUBLISH') && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void runProtected(() =>
                              publishPlatformPromptVersion(ver.id, ver.revision, csrfToken),
                            )
                          }
                          size="sm"
                          type="button"
                        >
                          发布冻结
                        </Button>
                      )}
                      {ver.available_actions.includes('ARCHIVE') && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void runProtected(() =>
                              archivePlatformPromptVersion(ver.id, ver.revision, csrfToken),
                            )
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          归档
                        </Button>
                      )}
                      {ver.available_actions.includes('RESTORE') && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void runProtected(() =>
                              restorePlatformPromptVersion(ver.id, ver.revision, csrfToken),
                            )
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          恢复可绑定
                        </Button>
                      )}
                    </div>
                  </div>
                  {ver.change_summary && (
                    <p className="text-xs text-text-secondary">变更说明：{ver.change_summary}</p>
                  )}
                  <dl className="grid grid-cols-2 gap-2 rounded-lg bg-surface-raised p-2.5 text-xs sm:grid-cols-5">
                    <div>
                      <dt className="text-text-muted">生成成功/总数</dt>
                      <dd className="font-mono font-medium text-text-primary">
                        {ver.metrics.succeeded_job_count}/{ver.metrics.generation_job_count}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">首次过审率</dt>
                      <dd className="font-mono font-medium text-text-primary">
                        {formatPercent(ver.metrics.first_pass_approval_rate)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">平均人工修订</dt>
                      <dd className="font-mono font-medium text-text-primary">
                        {ver.metrics.avg_human_revisions === null ? '暂无' : `${ver.metrics.avg_human_revisions} 次`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">已发布文章</dt>
                      <dd className="font-mono font-medium text-text-primary">
                        {ver.metrics.published_article_count}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">GEO 提及/引用</dt>
                      <dd className="font-mono font-medium text-text-primary">
                        {ver.metrics.geo_observation_count > 0
                          ? `${formatPercent(ver.metrics.geo_mention_rate)} / ${formatPercent(ver.metrics.geo_citation_rate)}`
                          : '暂无观测'}
                      </dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button disabled={busy} onClick={onClose} type="button" variant="outline">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { PromptVersionHistoryButton };
