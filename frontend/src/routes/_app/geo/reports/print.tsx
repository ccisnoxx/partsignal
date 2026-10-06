import { createFileRoute, redirect } from '@tanstack/react-router';
import { ReportPage } from '@/domains/geo-reports/report-page';
import { reportOptions } from '@/domains/geo-reports/reports.api';
import { reportSearchSchema, isCanonicalReportSearch } from '@/domains/geo-reports/reports.model';

export const Route = createFileRoute('/_app/geo/reports/print')({
  staticData: { navId: 'geo-reports', breadcrumb: '打印报告', layout: 'print' },
  validateSearch: reportSearchSchema,
  search: { middlewares: [({ search, next }) => next(reportSearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalReportSearch(location.search, search)) throw redirect({ to: '/geo/reports/print', search, replace: true });
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => { void context.queryClient.prefetchQuery(reportOptions(deps, true)); },
  component: ReportPrintRoute,
});
function ReportPrintRoute() { return <ReportPage search={Route.useSearch()} print/>; }
