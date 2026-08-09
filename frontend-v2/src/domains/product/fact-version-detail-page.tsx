import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { MarkdownPreview } from '@/design-system/editor/markdown-editor';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { Timeline, type TimelineItem } from '@/design-system/workspace/timeline';
import type { components } from '@/shared/api/generated/schema';
import { confidentialityRegistry } from './product-detail.model';
import {
  factVersionQueryOptions,
  ProductRequestError,
} from './product.api';
import { formatExactProductTime, productFactStatusRegistry } from './product.model';

type FactVersion = components['schemas']['FactVersion'];

type FactVersionDetailPageProps = {
  productId: string;
  versionId: string;
};

function FactVersionDetailPage({ productId, versionId }: FactVersionDetailPageProps) {
  const version = useQuery(factVersionQueryOptions(versionId));

  if (version.isPending) {
    return <FactVersionDetailSkeleton productId={productId} />;
  }
  if (!version.data && version.error) {
    return (
      <FactVersionFailure
        error={version.error}
        onRetry={() => void version.refetch()}
        productId={productId}
      />
    );
  }
  if (!version.data) return null;
  if (version.data.product_id.toLowerCase() !== productId.toLowerCase()) {
    return <FactVersionProductMismatch productId={productId} />;
  }

  return (
    <div className="min-w-0 space-y-4">
      {version.error && (
        <FactVersionRefreshFailure
          error={version.error}
          onRetry={() => void version.refetch()}
        />
      )}
      <FactVersionDetailView productId={productId} version={version.data} />
    </div>
  );
}

function FactVersionDetailView({
  productId,
  version,
}: {
  productId: string;
  version: FactVersion;
}) {
  const status = productFactStatusRegistry[version.status];
  const timeline = factVersionTimeline(version);

  return (
    <article aria-labelledby="fact-version-title" className="min-w-0 space-y-4">
      <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="type-label text-text-muted">事实版本快照</p>
          <h1 className="break-words font-mono type-page-title" id="fact-version-title">
            FactVersion v{version.version}
          </h1>
          <p className="text-text-secondary">
            此版本已经冻结；任何修改都必须创建新的事实版本。
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant={status.tone}>{status.label}</Badge>
            <Badge variant="outline">只读 · 不可变快照</Badge>
          </div>
        </div>
        <FactVersionNavigation productId={productId} />
      </header>

      <div className="min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        <DetailSection
          description="Markdown 是该版本冻结时的权威正文，只可阅读。"
          title="事实 Markdown 快照"
        >
          <div className="min-w-0 overflow-hidden rounded-lg border border-border-subtle">
            <MarkdownPreview
              ariaLabel={`事实版本 v${version.version} Markdown 快照`}
              value={version.body_markdown}
            />
          </div>
        </DetailSection>

        <DetailSection title="版本信息">
          <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metadata label="版本" mono value={`v${version.version}`} />
            <Metadata label="状态" value={status.label} />
            <Metadata label="数据级别" value={confidentialityRegistry[version.classification]} />
            <Metadata label="Revision" mono value={String(version.revision)} />
            <Metadata label="事实版本 ID" mono value={version.id} />
            <Metadata label="产品 ID" mono value={version.product_id} />
            <Metadata className="sm:col-span-2 lg:col-span-3" label="变更摘要" value={version.change_summary} />
            <Metadata label="创建人" mono value={version.created_by} />
            <Metadata label="创建时间" value={<FactVersionTime value={version.created_at} />} />
            {version.approved_by && <Metadata label="审批人" mono value={version.approved_by} />}
            {version.approved_at && <Metadata label="审批时间" value={<FactVersionTime value={version.approved_at} />} />}
          </dl>
        </DetailSection>

        <DetailSection
          description="仅展示当前 FactVersion payload 能确定的生命周期事件。"
          title="生命周期"
        >
          <Timeline items={timeline} />
        </DetailSection>
      </div>
    </article>
  );
}

function factVersionTimeline(version: FactVersion): TimelineItem[] {
  const items: TimelineItem[] = [{
    id: `${version.id}-created`,
    title: '事实版本已创建',
    description: `创建人：${version.created_by}`,
    meta: <FactVersionTime value={version.created_at} />,
  }];
  if (version.approved_by && version.approved_at) {
    items.push({
      id: `${version.id}-approved`,
      title: '事实版本已批准',
      description: `审批人：${version.approved_by}`,
      meta: <FactVersionTime value={version.approved_at} />,
    });
  }
  return items;
}

function FactVersionNavigation({ productId }: { productId: string }) {
  const encodedProductId = encodeURIComponent(productId);
  return (
    <nav aria-label="事实版本返回导航" className="flex flex-wrap gap-2 sm:justify-end">
      <a
        className="inline-flex min-h-11 items-center rounded-md border border-border-default px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href={`/products/${encodedProductId}`}
      >
        返回产品详情
      </a>
      <a
        className="inline-flex min-h-11 items-center rounded-md border border-border-default px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href={`/products/${encodedProductId}/facts`}
      >
        返回事实工作台
      </a>
    </nav>
  );
}

function FactVersionDetailSkeleton({ productId }: { productId: string }) {
  return (
    <article aria-busy="true" aria-labelledby="fact-version-loading-title" className="min-w-0 space-y-4">
      <header className="space-y-2">
        <p className="type-label text-text-muted">事实版本快照</p>
        <h1 className="type-page-title" id="fact-version-loading-title">正在加载事实版本</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{productId}</p>
      </header>
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        <div className="space-y-3 p-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-80" />
        </div>
        <div className="grid gap-3 border-t border-border-subtle p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
    </article>
  );
}

function FactVersionProductMismatch({ productId }: { productId: string }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">未找到该产品的事实版本</h1>
      <p className="text-text-secondary">该版本不存在或不属于当前产品，未展示任何快照内容。</p>
      <FactVersionNavigation productId={productId} />
    </section>
  );
}

function FactVersionFailure({
  error,
  onRetry,
  productId,
}: {
  error: unknown;
  onRetry: () => void;
  productId: string;
}) {
  const kind = factVersionErrorKind(error);
  const requestId = error instanceof ProductRequestError ? error.detail?.request_id : undefined;
  const content = {
    'not-found': ['未找到事实版本', '该事实版本不存在，或已被删除。'],
    forbidden: ['无法访问事实版本', '当前会话不能读取该事实版本。'],
    generic: ['事实版本加载失败', error instanceof Error ? error.message : '读取事实版本时发生未知错误。'],
  }[kind];

  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{content[0]}</h1>
      <p className="text-text-secondary">{content[1]}</p>
      {requestId && <p className="break-all font-mono text-xs text-text-muted">请求 ID：{requestId}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <FactVersionNavigation productId={productId} />
        {kind === 'generic' && <Button onClick={onRetry} type="button">重试</Button>}
      </div>
    </section>
  );
}

function FactVersionRefreshFailure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <div>
        <p className="font-medium text-danger">刷新事实版本失败，已保留当前不可变快照</p>
        <p className="mt-1 text-sm text-text-secondary">{error.message}</p>
      </div>
      <Button onClick={onRetry} type="button" variant="outline">重试刷新</Button>
    </section>
  );
}

function factVersionErrorKind(error: unknown): 'not-found' | 'forbidden' | 'generic' {
  if (!(error instanceof ProductRequestError)) return 'generic';
  if (error.status === 404) return 'not-found';
  if (error.status === 403) return 'forbidden';
  return 'generic';
}

function FactVersionTime({ value }: { value: string }) {
  return <time dateTime={value}>{formatExactProductTime(value)}</time>;
}

function Metadata({
  className,
  label,
  mono = false,
  value,
}: {
  className?: string;
  label: string;
  mono?: boolean;
  value: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className={`mt-1 text-text-primary ${mono ? 'break-all font-mono text-sm' : 'break-words'}`}>
        {value}
      </dd>
    </div>
  );
}

export { FactVersionDetailPage };
export type { FactVersionDetailPageProps };
