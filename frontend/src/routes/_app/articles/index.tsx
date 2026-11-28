import { createFileRoute } from '@tanstack/react-router';

import { ArticlesListPage } from '@/domains/articles/articles-list-page';

export const Route = createFileRoute('/_app/articles/')({
  component: ArticlesIndexRoute,
});

function ArticlesIndexRoute() {
  const { auth } = Route.useRouteContext();
  const canOperate = auth.user?.account_type === 'ADMIN' || auth.user?.account_type === 'ENGINEER';
  return <ArticlesListPage canOperate={canOperate} csrfToken={auth.csrfToken} />;
}
