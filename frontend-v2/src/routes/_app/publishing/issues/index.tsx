import { createFileRoute, redirect } from '@tanstack/react-router';

import { publishedContentIssueListQueryOptions } from '@/domains/publication/publication.api';
import { PublishedContentIssueListPage } from '@/domains/publication/published-content-issue-list-page';
import {
  isCanonicalIssueSearch,
  issueSearchSchema,
} from '@/domains/publication/published-content-issue.model';

export const Route = createFileRoute('/_app/publishing/issues/')({
  validateSearch: issueSearchSchema,
  search: { middlewares: [({ search, next }) => next(issueSearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalIssueSearch(location.search, search)) {
      throw redirect({ to: '/publishing/issues', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = publishedContentIssueListQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: PublishedContentIssuesRoute,
});

function PublishedContentIssuesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PublishedContentIssueListPage
      onSearchChange={(nextSearch) => navigate({ search: nextSearch })}
      search={search}
    />
  );
}
