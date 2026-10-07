import { createFileRoute, redirect } from '@tanstack/react-router';

import {
  auditFilterOptionsQueryOptions,
  auditListQueryOptions,
} from '@/domains/audit/audit.api';
import {
  auditSearchSchema,
  isCanonicalAuditSearch,
} from '@/domains/audit/audit.model';
import { SystemAuditPage } from '@/domains/audit/system-audit-page';
import { RouteError } from '@/design-system/workspace/route-error';

export const Route = createFileRoute('/_app/_admin/system/audit')({
  staticData: { navId: 'audit', breadcrumb: '系统审计' },
  validateSearch: auditSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(auditSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalAuditSearch(location.search, search)) {
      throw redirect({ to: '/system/audit', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const list = auditListQueryOptions(deps);
    const options = auditFilterOptionsQueryOptions();
    if (!context.queryClient.getQueryState(list.queryKey)) void context.queryClient.prefetchQuery(list);
    if (!context.queryClient.getQueryState(options.queryKey)) void context.queryClient.prefetchQuery(options);
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="系统审计发生意外错误" />
  ),
  component: SystemAuditRoute,
});

function SystemAuditRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SystemAuditPage
      onSearchChange={(nextSearch, replace) => void navigate({ search: nextSearch, replace })}
      search={search}
    />
  );
}
