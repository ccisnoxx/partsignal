import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { PageHeader } from '@/design-system/layout/page-header';
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
import { api } from '@/shared/api/client';
import {
  articleKeys,
  articlesListQueryOptions,
  buildProductPromptCopyBundle,
  createArticle,
  type ArticlesFilterParams,
} from './articles.api';
import {
  articleStatusLabels,
  originLabels,
  splitKeywords,
  type ArticleOriginType,
  type ArticleStatus,
} from './articles.model';

type Props = {
  csrfToken: string | null;
  canOperate: boolean;
};

export function ArticlesListPage({ csrfToken, canOperate }: Props) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ArticlesFilterParams>({ page: 1, page_size: 20 });
  const [pasteOpen, setPasteOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

  const listQuery = useQuery(articlesListQueryOptions(filters));
  const productsQuery = useQuery({
    queryKey: ['products', 'simple-options'],
    queryFn: async () => {
      const res = await api.GET('/api/v1/products', { params: { query: { page: 1, page_size: 100 } } });
      return res.data?.items ?? [];
    },
    staleTime: 30_000,
  });

  const [productId, setProductId] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [originType, setOriginType] = useState<ArticleOriginType>('EXTERNAL_AI');
  const [externalModelName, setExternalModelName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [copyProductId, setCopyProductId] = useState('');
  const [copyGoal, setCopyGoal] = useState('');
  const [copyQuestion, setCopyQuestion] = useState('');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!csrfToken) throw new Error('缺少会话 CSRF 令牌');
      if (!productId) throw new Error('请选择关联产品');
      return createArticle(
        {
          product_id: productId,
          title: title.trim(),
          summary: summary.trim(),
          body_markdown: bodyMarkdown,
          target_keywords: splitKeywords(keywordsText),
          origin_type: originType,
          external_model_name: originType === 'EXTERNAL_AI' ? externalModelName.trim() || null : null,
          status: 'DRAFT',
          change_summary: '初始录入',
        },
        csrfToken,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
      setPasteOpen(false);
      setTitle('');
      setSummary('');
      setBodyMarkdown('');
      setKeywordsText('');
      setExternalModelName('');
      setFormError(null);
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : '录入失败'),
  });

  const bundleMutation = useMutation({
    mutationFn: async () => {
      if (!csrfToken) throw new Error('缺少会话 CSRF 令牌');
      if (!copyProductId) throw new Error('请选择产品');
      return buildProductPromptCopyBundle(
        copyProductId,
        { writing_goal: copyGoal, target_audience: '', target_question: copyQuestion },
        csrfToken,
      );
    },
    onSuccess: async (data) => {
      setCopiedText(data.combined_copy_text);
      setCopyError(null);
      try {
        await navigator.clipboard.writeText(data.combined_copy_text);
        setCopyStatus('已复制到剪贴板，可直接粘贴至外部 AI');
      } catch {
        setCopyStatus('已生成组合文本，请手动复制下方内容');
      }
    },
    onError: (err) => {
      setCopyError(err instanceof Error ? err.message : '生成复制包失败');
      setCopiedText(null);
    },
  });

  const products = productsQuery.data ?? [];
  const items = listQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="文章与发布"
        description="统一管理外部粘贴文章与系统 AI 草稿；一篇文章可登记多个平台发布 URL，并明确区分已人工登记与已核验通过。"
        actions={
          canOperate ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { setCopyError(null); setCopyStatus(null); setCopyOpen(true); }}>
                一键复制提示词与产品资料
              </Button>
              <Button onClick={() => { setFormError(null); setPasteOpen(true); }}>
                粘贴 / 录入文章
              </Button>
            </div>
          ) : undefined
        }
      />

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-surface-panel p-4">
        <Input
          aria-label="搜索文章标题"
          className="max-w-xs"
          placeholder="搜索标题或摘要…"
          value={filters.q ?? ''}
          onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value || undefined, page: 1 }))}
        />
        <select
          aria-label="按来源筛选"
          className="h-9 rounded-md border border-border-default bg-surface-panel px-3 text-sm"
          value={filters.origin_type ?? ''}
          onChange={(e) => setFilters((prev) => ({
            ...prev,
            origin_type: (e.target.value || undefined) as ArticleOriginType | undefined,
            page: 1,
          }))}
        >
          <option value="">全部来源</option>
          {(Object.entries(originLabels) as [ArticleOriginType, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          aria-label="按状态筛选"
          className="h-9 rounded-md border border-border-default bg-surface-panel px-3 text-sm"
          value={filters.status ?? ''}
          onChange={(e) => setFilters((prev) => ({
            ...prev,
            status: (e.target.value || undefined) as ArticleStatus | undefined,
            page: 1,
          }))}
        >
          <option value="">全部状态</option>
          {(Object.entries(articleStatusLabels) as [ArticleStatus, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </section>

      {listQuery.isError && (
        <InlineBanner role="alert" tone="danger">
          {listQuery.error instanceof Error ? listQuery.error.message : '加载文章列表失败'}
        </InlineBanner>
      )}

      <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-panel">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border-subtle bg-surface-muted/40 text-xs text-text-secondary">
            <tr>
              <th className="px-4 py-3">文章标题</th>
              <th className="px-4 py-3">关联产品</th>
              <th className="px-4 py-3">来源</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">发布 URL 数</th>
              <th className="px-4 py-3">维护人</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {listQuery.isLoading ? (
              <tr><td className="px-4 py-8 text-center text-text-muted" colSpan={6}>正在加载文章台账…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-text-muted" colSpan={6}>暂无文章记录，可直接粘贴外部 AI 或人工编写的稿件。</td></tr>
            ) : items.map((art) => (
              <tr key={art.id} className="hover:bg-surface-muted/30">
                <td className="px-4 py-3 font-medium">
                  <Link className="text-primary hover:underline" to="/articles/$articleId" params={{ articleId: art.id }}>
                    {art.title}
                  </Link>
                  {art.summary && <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{art.summary}</p>}
                </td>
                <td className="px-4 py-3 text-text-secondary">{art.product_label}</td>
                <td className="px-4 py-3">
                  <Badge variant="secondary">{originLabels[art.origin_type]}</Badge>
                  {art.external_model_name && (
                    <span className="ml-1.5 text-xs text-text-muted">{art.external_model_name}</span>
                  )}
                </td>
                <td className="px-4 py-3"><Badge variant="secondary">{articleStatusLabels[art.status]}</Badge></td>
                <td className="px-4 py-3 tabular-nums">
                  {art.publication_count} 条
                  {art.verified_publication_count > 0 && (
                    <span className="ml-1 text-xs text-text-muted">（已核验 {art.verified_publication_count}）</span>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">{art.owner_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>粘贴 / 录入文章</DialogTitle>
            <DialogDescription>无需前置事实审批或 Brief，直接录入外部 AI 或人工稿件；系统绝不伪造生成作业。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {formError && <InlineBanner role="alert" tone="danger">{formError}</InlineBanner>}
            <label className="block space-y-1 text-sm">
              <span>关联产品 *</span>
              <select
                aria-label="关联产品"
                className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-3 text-sm"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">请选择产品</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.brand} {p.part_number}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">
                <span>文章来源</span>
                <select
                  aria-label="文章来源"
                  className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-3 text-sm"
                  value={originType}
                  onChange={(e) => setOriginType(e.target.value as ArticleOriginType)}
                >
                  <option value="EXTERNAL_AI">外部 AI 生成</option>
                  <option value="HUMAN">人工编写</option>
                  <option value="OTHER">其他来源</option>
                </select>
              </label>
              {originType === 'EXTERNAL_AI' && (
                <label className="block space-y-1 text-sm">
                  <span>外部模型名称（可选）</span>
                  <Input value={externalModelName} onChange={(e) => setExternalModelName(e.target.value)} placeholder="例如 DeepSeek / Kimi / Claude" />
                </label>
              )}
            </div>
            <label className="block space-y-1 text-sm">
              <span>文章标题 *</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="输入完整标题" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>摘要（可选）</span>
              <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="一句话概述核心观点" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>目标关键词（逗号分隔，可选）</span>
              <Input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} placeholder="例如 低功耗运放, 工业控制" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>正文（Markdown） *</span>
              <textarea
                aria-label="正文（Markdown）"
                className="min-h-40 w-full rounded-md border border-border-default bg-surface-panel p-2.5 font-mono text-sm"
                value={bodyMarkdown}
                onChange={(e) => setBodyMarkdown(e.target.value)}
                placeholder="直接粘贴文章正文 Markdown…"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteOpen(false)}>取消</Button>
            <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? '保存中…' : '保存文章'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>一键复制提示词与产品资料</DialogTitle>
            <DialogDescription>仅组合已标为 PUBLIC 的产品资料并自动剥离内部溯源字段，可粘贴到您常用的外部 AI。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {copyError && <InlineBanner role="alert" tone="danger">{copyError}</InlineBanner>}
            {copyStatus && <InlineBanner role="status" tone="info">{copyStatus}</InlineBanner>}
            <label className="block space-y-1 text-sm">
              <span>选择产品 *</span>
              <select
                aria-label="复制包产品"
                className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-3 text-sm"
                value={copyProductId}
                onChange={(e) => setCopyProductId(e.target.value)}
              >
                <option value="">请选择产品</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.brand} {p.part_number}</option>
                ))}
              </select>
            </label>
            <Input value={copyGoal} onChange={(e) => setCopyGoal(e.target.value)} placeholder="写作目的（可选，如：知乎选型对比）" />
            <Input value={copyQuestion} onChange={(e) => setCopyQuestion(e.target.value)} placeholder="要回答的核心问题（可选）" />
            {copiedText && (
              <textarea
                readOnly
                className="min-h-48 w-full rounded-md border border-border-default bg-surface-muted/40 p-2.5 font-mono text-xs"
                value={copiedText}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>关闭</Button>
            <Button disabled={bundleMutation.isPending} onClick={() => bundleMutation.mutate()}>
              {bundleMutation.isPending ? '生成中…' : '生成并复制'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
