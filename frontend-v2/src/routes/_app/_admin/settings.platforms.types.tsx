import { createFileRoute } from '@tanstack/react-router';

import { platformTypeListQueryOptions } from '@/domains/configuration/platform.api';
import { PlatformTypesPage } from '@/domains/configuration/platform-types-page';
import { RouteError } from '@/design-system/workspace/route-error';

export const Route = createFileRoute('/_app/_admin/settings/platforms/types')({
  staticData: { navId: 'platforms', breadcrumb: '平台类型' },
  loader: ({ context }) => {
    const options = platformTypeListQueryOptions();
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="平台类型设置发生意外错误" />
  ),
  component: PlatformTypesRoute,
});

function PlatformTypesRoute() {
  const { auth } = Route.useRouteContext();
  return <PlatformTypesPage csrfToken={auth.csrfToken} />;
}
