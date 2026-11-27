import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import type { components } from '@/shared/api/generated/schema';
import { publicationKeys, publicationPackageQueryOptions } from './publication.api';

type PublicationWorkspaceContext = components['schemas']['PublicationWorkspaceContext'];

function checklistTone(status: 'PASS' | 'WARNING' | 'BLOCKING') {
  if (status === 'BLOCKING') return 'destructive' as const;
  if (status === 'WARNING') return 'warning' as const;
  return 'success' as const;
}

function PublicationPackageDialogButton({
  contentVersionId,
  contentHash,
  workId,
  workRevision,
  disabled,
}: {
  contentVersionId: string;
  contentHash?: string;
  workId?: string;
  workRevision?: number;
  disabled?: boolean;
}) {
  const [openedForWorkId, setOpenedForWorkId] = useState<string | null>(null);
  const currentWorkKey = workId ?? '__standalone__';
  const isOpen = !disabled && openedForWorkId === currentWorkKey;

  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => setOpenedForWorkId(currentWorkKey)}
        size="sm"
        type="button"
        variant="outline"
      >
        查看分区发布包
      </Button>
      {isOpen && (
        <PublicationPackageDialog
          contentHash={contentHash}
          contentVersionId={contentVersionId}
          disabled={disabled}
          key={contentVersionId}
          onClose={() => setOpenedForWorkId(null)}
          workId={workId}
          workRevision={workRevision}
        />
      )}
    </>
  );
}

function PublicationPackageDialog({
  contentVersionId,
  contentHash,
  workId,
  workRevision,
  disabled,
  onClose,
}: {
  contentVersionId: string;
  contentHash?: string;
  workId?: string;
  workRevision?: number;
  disabled?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const pkgQuery = useQuery(publicationPackageQueryOptions(contentVersionId));
  const [copiedKey, setCopiedKey] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  const copyEpochRef = useRef(0);

  async function copySection(key: string, text: string) {
    if (disabled) return;
    setCopyError(undefined);
    const currentPkg = pkgQuery.data;
    if (!currentPkg) return;
    if (
      currentPkg.content_version_id !== contentVersionId
      || (contentHash !== undefined && currentPkg.content_hash !== contentHash)
    ) {
      setCopyError('发布包与当前工作台内容版本或哈希不一致，已阻止复制；请关闭弹窗后重新核对。');
      return;
    }
    if (workId !== undefined) {
      const latest = queryClient.getQueryData<PublicationWorkspaceContext>(
        publicationKeys.workspaceContext(workId),
      );
      if (
        latest
        && (
          latest.work.id !== workId
          || (workRevision !== undefined && latest.work.revision !== workRevision)
          || latest.content.id !== contentVersionId
          || (contentHash !== undefined && latest.content.content_hash !== contentHash)
        )
      ) {
        setCopyError('工作台上下文已更新或切换版本，本次未写入剪贴板；请重载确认后再复制。');
        return;
      }
    }
    if (!navigator.clipboard?.writeText) {
      setCopyError('当前浏览器上下文不支持剪贴板 API，请手动复制所需内容。');
      return;
    }
    const epoch = ++copyEpochRef.current;
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      await navigator.clipboard.writeText(text);
      if (!continuation.isCurrent() || copyEpochRef.current !== epoch) return;
      setCopiedKey(key);
    } catch (error) {
      if (!continuation.isCurrent() || copyEpochRef.current !== epoch) return;
      setCopyError(error instanceof Error ? error.message : '写入剪贴板失败');
    }
  }

  const pkg = pkgQuery.data;

  return (
    <Dialog onOpenChange={(next) => { if (!next) onClose(); }} open>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>增强发布包与分区复制</DialogTitle>
          <DialogDescription>
            由已批准 Markdown 实时派生富文本 HTML、纯文本、字符数统计、链接/图片校验与平台发布检查清单，不保存可独立编辑的 HTML 副本。
          </DialogDescription>
        </DialogHeader>

        {copyError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive" role="alert">
            {copyError}
          </p>
        )}

        {pkgQuery.isPending ? (
          <p className="text-sm text-text-secondary" aria-busy="true">正在实时派生发布包…</p>
        ) : pkgQuery.isError || !pkg ? (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
            <p>{pkgQuery.error instanceof Error ? pkgQuery.error.message : '读取发布包失败'}</p>
            <Button onClick={() => void pkgQuery.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 rounded-xl bg-surface-raised p-3 text-xs sm:grid-cols-5">
              <div>
                <dt className="text-text-muted">版本号</dt>
                <dd className="font-mono font-semibold text-text-primary">v{pkg.version}</dd>
              </div>
              <div>
                <dt className="text-text-muted">总字符 / 去空白</dt>
                <dd className="font-mono font-semibold text-text-primary">
                  {pkg.character_stats.total_chars} / {pkg.character_stats.non_whitespace_chars}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">纯文本字数</dt>
                <dd className="font-mono font-semibold text-text-primary">
                  {pkg.character_stats.plain_text_chars}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">段落 / 标题</dt>
                <dd className="font-mono font-semibold text-text-primary">
                  {pkg.character_stats.paragraph_count} / {pkg.character_stats.heading_count}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">预计阅读</dt>
                <dd className="font-mono font-semibold text-text-primary">
                  约 {pkg.character_stats.estimated_read_minutes} 分钟
                </dd>
              </div>
            </dl>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-text-primary">分区一键复制</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { key: 'title', label: '复制标题', value: pkg.title, preview: pkg.title },
                  { key: 'summary', label: '复制摘要', value: pkg.summary, preview: pkg.summary },
                  {
                    key: 'markdown',
                    label: '复制 Markdown 正文',
                    value: pkg.body_markdown,
                    preview: `${pkg.body_markdown.slice(0, 72)}…`,
                  },
                  {
                    key: 'plain',
                    label: '复制纯文本正文',
                    value: pkg.body_text,
                    preview: `${pkg.body_text.slice(0, 72)}…`,
                  },
                  {
                    key: 'html',
                    label: '复制富文本 HTML',
                    value: pkg.body_html,
                    preview: `${pkg.body_html.slice(0, 72)}…`,
                  },
                  {
                    key: 'tags',
                    label: '复制标签与推荐话题',
                    value: [...pkg.tags, ...pkg.recommended_topics]
                      .filter((v, idx, arr) => arr.indexOf(v) === idx)
                      .map((item) => `#${item}`)
                      .join(' '),
                    preview: pkg.tags.join('、') || '无标签',
                  },
                  {
                    key: 'hash',
                    label: '复制版本号与内容 Hash',
                    value: `v${pkg.version} | ${pkg.content_hash}`,
                    preview: `v${pkg.version} · ${pkg.content_hash.slice(0, 16)}…`,
                  },
                ].map((section) => (
                  <div
                    className="flex items-start justify-between gap-2 rounded-lg border border-border-subtle p-2.5 text-xs"
                    key={section.key}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium text-text-primary">{section.label}</p>
                      <p className="truncate text-text-muted">{section.preview}</p>
                    </div>
                    <Button
                      onClick={() => void copySection(section.key, section.value)}
                      size="sm"
                      type="button"
                      variant={copiedKey === section.key ? 'secondary' : 'outline'}
                    >
                      {copiedKey === section.key ? '已复制' : '复制'}
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            {pkg.recommended_topics.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-text-primary">推荐话题</h3>
                <div className="flex flex-wrap gap-1.5">
                  {pkg.recommended_topics.map((topic) => (
                    <Badge key={topic} variant="outline">#{topic}</Badge>
                  ))}
                </div>
              </section>
            )}

            {(pkg.links.length > 0 || pkg.images.length > 0) && (
              <section className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-text-primary">链接与锚文本（{pkg.links.length}）</h3>
                  {pkg.links.length === 0 ? (
                    <p className="text-xs text-text-muted">正文不含外部链接</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {pkg.links.map((link, idx) => (
                        <li className="flex items-center justify-between gap-2 rounded border border-border-subtle p-2" key={`${link.href}-${idx}`}>
                          <span className="truncate text-text-primary">{link.text} ({link.href})</span>
                          <Badge variant={link.is_valid ? 'success' : 'warning'}>
                            {link.is_valid ? '有效' : '格式异常'}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-text-primary">图片与 Alt 文本（{pkg.images.length}）</h3>
                  {pkg.images.length === 0 ? (
                    <p className="text-xs text-text-muted">正文不含 Markdown 图片</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {pkg.images.map((img, idx) => (
                        <li className="flex items-center justify-between gap-2 rounded border border-border-subtle p-2" key={`${img.src}-${idx}`}>
                          <span className="truncate text-text-primary">{img.alt || '（缺少 Alt）'} · {img.src}</span>
                          <Badge variant={!img.missing_alt && img.is_valid_src ? 'success' : 'warning'}>
                            {img.missing_alt && !img.is_valid_src
                              ? '缺 Alt 且地址异常'
                              : img.missing_alt
                                ? '缺 Alt'
                                : img.is_valid_src
                                  ? '完整'
                                  : '地址异常'}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-text-primary">平台发布检查清单</h3>
              <ul className="space-y-1.5 text-xs">
                {pkg.platform_checklist.map((item) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle p-2.5"
                    key={item.code}
                  >
                    <div>
                      <p className="font-medium text-text-primary">{item.label}</p>
                      <p className="text-text-secondary">{item.detail}</p>
                    </div>
                    <Badge variant={checklistTone(item.status)}>{item.status}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { PublicationPackageDialogButton };
