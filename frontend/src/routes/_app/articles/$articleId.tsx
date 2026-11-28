import { createFileRoute } from '@tanstack/react-router';

import { ArticleDetailPage } from '@/domains/articles/article-detail-page';

export const Route = createFileRoute('/_app/articles/$articleId')({
  staticData: { breadcrumb: '文章详情' },
  component: ArticleDetailRoute,
});

function ArticleDetailRoute() {
  const { articleId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  const canOperate = auth.user?.account_type === 'ADMIN' || auth.user?.account_type === 'ENGINEER';
  return <ArticleDetailPage articleId={articleId} canOperate={canOperate} csrfToken={auth.csrfToken} />;
}
