import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { publishedArticleQueryOptions } from '@/domains/publication/publication.api';
import { PublishedArticleDetailPage } from '@/domains/publication/published-article-detail-page';

export const Route = createFileRoute('/_app/publishing/articles/$articleId')({
  staticData: { breadcrumb: '成果详情' },
  head: ({ params }) => ({
    meta: [{ title: `发布成果 ${params.articleId} | PartSignal` }],
  }),
  beforeLoad: ({ params }) => {
    if (!z.uuid().safeParse(params.articleId).success) {
      throw new Error(`发布成果 ID 不是有效 UUID：${params.articleId}`);
    }
  },
  loader: ({ context, params }) => {
    const options = publishedArticleQueryOptions(params.articleId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: PublishedArticleRoute,
});

function PublishedArticleRoute() {
  const { articleId } = Route.useParams();
  return <PublishedArticleDetailPage articleId={articleId} />;
}
