import { createFileRoute, redirect } from '@tanstack/react-router';
import { questionDetailOptions, questionListOptions } from '@/domains/geo-questions/questions.api';
import { QuestionsPage } from '@/domains/geo-questions/questions-page';
import { isCanonicalQuestionSearch, questionSearchSchema } from '@/domains/geo-questions/questions.model';

export const Route = createFileRoute('/_app/geo/questions')({
  staticData: { navId: 'geo-questions', breadcrumb: '问题库' },
  validateSearch: questionSearchSchema,
  search: { middlewares: [({ search, next }) => next(questionSearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => { if (!isCanonicalQuestionSearch(location.search, search)) throw redirect({ to: '/geo/questions', search, replace: true }); },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(questionListOptions(deps));
    const id = deps.selected ?? deps.copy;
    if (id) void context.queryClient.prefetchQuery(questionDetailOptions(id));
  },
  component: QuestionsRoute,
});
function QuestionsRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return <QuestionsPage csrfToken={auth.csrfToken} onSearchChange={(next, replace, ignoreBlocker) => void navigate({ search: next, replace, ignoreBlocker })} search={search} />;
}
