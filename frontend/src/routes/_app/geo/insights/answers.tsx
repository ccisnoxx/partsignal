import { createFileRoute, redirect } from '@tanstack/react-router';
import { AnswerInsightsPage } from '@/domains/geo-insights/insights-page';
import { answerInsightOptions } from '@/domains/geo-insights/insights.api';
import { insightSearchSchema, isCanonicalInsightSearch } from '@/domains/geo-insights/drilldown.model';

export const Route = createFileRoute('/_app/geo/insights/answers')({
  staticData: { navId: 'geo-answer-insights', breadcrumb: '回答洞察' },
  validateSearch: insightSearchSchema,
  search: { middlewares: [({ search, next }) => next(insightSearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalInsightSearch(location.search, search)) throw redirect({ to: '/geo/insights/answers', search, replace: true });
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => { void context.queryClient.prefetchQuery(answerInsightOptions(deps)); },
  component: AnswerInsightsRoute,
});
function AnswerInsightsRoute() {
  const navigate = Route.useNavigate();
  return <AnswerInsightsPage search={Route.useSearch()} onSearchChange={(search, replace) => void navigate({ search, replace })}/>;
}
