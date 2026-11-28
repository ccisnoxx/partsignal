import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { PageHeader } from '@/design-system/layout/page-header';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  articleDetailQueryOptions,
  articleKeys,
  createArticlePublication,
  updateArticle,
  updateArticlePublication,
} from './articles.api';
import {
  articleStatusLabels,
  originLabels,
  verificationStatusMeta,
  type ArticleStatus,
} from './articles.model';

type Props = {
  articleId: string;
  csrfToken: string | null;
  canOperate: boolean;
};

export function ArticleDetailPage({ articleId, csrfToken, canOperate }: Props) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery(articleDetailQueryOptions(articleId));

  const [platformName, setPlatformName] = useState('');
  const [actualTitle, setActualTitle] = useState('');
  const [finalUrl, setFinalUrl] = useState('');
  const [publishedAt, setPublishedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState('');
  const [pubError, setPubError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const registerPub = useMutation({
    mutationFn: async () => {
      if (!csrfToken) throw new Error('缺少 CSRF 令牌');
      const isoPublished = new Date(publishedAt).toISOString();
      return createArticlePublication(
        articleId,
        {
          platform_name: platformName.trim(),
          actual_title: actualTitle.trim() || detailQuery.data?.title || '',
          final_url: finalUrl.trim(),
          published_at: isoPublished,
          notes: notes.trim(),
        },
        csrfToken,
      );
    },
    onSuccess: async () => {
      setPlatformName('');
      setActualTitle('');
      setFinalUrl('');
      setNotes('');
      setPubError(null);
      await queryClient.invalidateQueries({ queryKey: articleKeys.detail(articleId) });
      await queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
    },
    onError: (err) => setPubError(err instanceof Error ? err.message : '登记发布 URL 失败'),
  });

  const statusMutation = useMutation({
    mutationFn: async (nextStatus: ArticleStatus) => {
      if (!csrfToken || !detailQuery.data) throw new Error('缺少上下文');
      return updateArticle(
        articleId,
        {
          expected_revision: detailQuery.data.revision,
          status: nextStatus,
          change_summary: '更新文章状态',
        },
        csrfToken,
      );
    },
    onSuccess: async () => {
      setStatusError(null);
      await queryClient.invalidateQueries({ queryKey: articleKeys.detail(articleId) });
      await queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
    },
    onError: (err) => setStatusError(err instanceof Error ? err.message : '状态更新失败'),
  });

  const removePubMutation = useMutation({
    mutationFn: async (pub: { id: string; revision: number }) => {
      if (!csrfToken) throw new Error('缺少 CSRF 令牌');
      return updateArticlePublication(
        pub.id,
        { expected_revision: pub.revision, registration_status: 'REMOVED', comment: '人工标记下架/移除' },
        csrfToken,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: articleKeys.detail(articleId) });
    },
  });

  if (detailQuery.isLoading) {
    return <p className="text-sm text-text-muted">正在加载文章详情…</p>;
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <InlineBanner role="alert" tone="danger">
        {detailQuery.error instanceof Error ? detailQuery.error.message : '文章不存在或加载失败'}
      </InlineBanner>
    );
  }

  const art = detailQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={art.title}
        description={`${art.product_label} · ${originLabels[art.origin_type]}${art.external_model_name ? ` (${art.external_model_name})` : ''} · 当前版本 v${art.current_revision}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{articleStatusLabels[art.status]}</Badge>
            {canOperate && art.status === 'DRAFT' && (
              <Button size="sm" variant="outline" onClick={() => statusMutation.mutate('READY')}>标记为可发布</Button>
            )}
            <Link className="text-sm text-primary hover:underline" to="/articles">返回文章列表</Link>
          </div>
        }
      />

      {statusError && <InlineBanner role="alert" tone="danger">{statusError}</InlineBanner>}

      <section className="space-y-4 rounded-xl border border-border-subtle bg-surface-panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">多平台发布位置台账（{art.publications.length} 条）</h2>
            <p className="text-xs text-text-secondary">
              同一篇文章可登记多个平台发布 URL；“已人工登记（未核验）”与“已核验通过”明确分离，用于后续引用精确匹配。
            </p>
          </div>
        </div>

        {canOperate && (
          <div className="grid gap-3 rounded-lg border border-border-subtle bg-surface-muted/30 p-3 md:grid-cols-2 lg:grid-cols-5">
            <Input aria-label="发布平台名称" placeholder="平台（如 知乎 / 微信公众号）" value={platformName} onChange={(e) => setPlatformName(e.target.value)} />
            <Input aria-label="发布实际标题" placeholder="实际发布标题（留空同主标题）" value={actualTitle} onChange={(e) => setActualTitle(e.target.value)} />
            <Input aria-label="发布链接 URL" placeholder="https://..." value={finalUrl} onChange={(e) => setFinalUrl(e.target.value)} />
            <Input aria-label="发布时间" type="datetime-local" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} />
            <Button disabled={registerPub.isPending} onClick={() => registerPub.mutate()}>
              {registerPub.isPending ? '登记中…' : '登记发布 URL'}
            </Button>
            {pubError && <div className="md:col-span-2 lg:col-span-5"><InlineBanner role="alert" tone="danger">{pubError}</InlineBanner></div>}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-subtle text-xs text-text-secondary">
              <tr>
                <th className="py-2 pr-3">平台</th>
                <th className="py-2 pr-3">实际标题与 URL</th>
                <th className="py-2 pr-3">核验状态</th>
                <th className="py-2 pr-3">发布时间</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {art.publications.length === 0 ? (
                <tr><td className="py-4 text-text-muted" colSpan={5}>尚未登记外部发布 URL。</td></tr>
              ) : art.publications.map((pub) => {
                const verMeta = verificationStatusMeta[pub.verification_status];
                return (
                  <tr key={pub.id}>
                    <td className="py-2.5 pr-3 font-medium">{pub.platform_name_snapshot}</td>
                    <td className="py-2.5 pr-3">
                      <p>{pub.actual_title}</p>
                      <a className="break-all font-mono text-xs text-primary hover:underline" href={pub.final_url} rel="noreferrer" target="_blank">
                        {pub.final_url}
                      </a>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={verMeta.tone}>{verMeta.label}</Badge>
                      {pub.registration_status === 'REMOVED' && <Badge className="ml-1" variant="secondary">已移除</Badge>}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-text-secondary tabular-nums">
                      {new Date(pub.published_at).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                    <td className="py-2.5">
                      {canOperate && pub.registration_status === 'REGISTERED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removePubMutation.mutate({ id: pub.id, revision: pub.revision })}
                        >
                          标记移除
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-5">
        <h2 className="text-base font-semibold">文章正文（Markdown）</h2>
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted/40 p-4 font-mono text-sm">
          {art.body_markdown}
        </pre>
      </section>

      <section className="space-y-2 rounded-xl border border-border-subtle bg-surface-panel p-5">
        <h2 className="text-base font-semibold">修订历史（{art.revisions.length} 版）</h2>
        <ul className="space-y-2 text-sm">
          {art.revisions.map((rev) => (
            <li key={rev.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-2 last:border-b-0">
              <span>v{rev.revision_no} · {rev.change_summary || '正文更新'}（{rev.created_by_name || '系统'}）</span>
              <span className="font-mono text-xs text-text-muted">{new Date(rev.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
