import { createFileRoute, redirect } from '@tanstack/react-router';
import { InsightFilters } from '@/domains/geo-insights/insight-filters';
import { ReportPage } from '@/domains/geo-reports/report-page';
import { reportOptions } from '@/domains/geo-reports/reports.api';
import { reportSearchSchema, isCanonicalReportSearch } from '@/domains/geo-reports/reports.model';

export const Route = createFileRoute('/_app/geo/reports/')({
  staticData: { navId: 'geo-reports', breadcrumb: '报告' },
  validateSearch: reportSearchSchema,
  search: { middlewares: [({ search, next }) => next(reportSearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalReportSearch(location.search, search)) throw redirect({ to: '/geo/reports', search, replace: true });
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => { void context.queryClient.prefetchQuery(reportOptions(deps)); },
  component: ReportRoute,
});
function ReportRoute() {
  const search = Route.useSearch(); const navigate = Route.useNavigate();
  return <div className="min-w-0 space-y-5"><InsightFilters key={JSON.stringify(search)} search={search} onApply={(next) => void navigate({ search: next })}/><ReportPage search={search}/></div>;
}
