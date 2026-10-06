import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { RouteError } from '@/design-system/workspace/route-error';
import { geoObservationDetailQueryOptions } from '@/domains/geo/geo.api';
import { GeoObservationDetailPage } from '@/domains/geo/geo-observation-detail-page';

export const Route = createFileRoute('/_app/geo/observations/$observationId')({
  staticData: { breadcrumb: '观测详情' },
  head: ({ params }) => ({
    meta: [{ title: `GEO Observation ${params.observationId} | PartSignal` }],
  }),
  beforeLoad: ({ params }) => {
    if (!z.uuid().safeParse(params.observationId).success) {
      throw new Error(`GEO Observation ID 不是有效 UUID：${params.observationId}`);
    }
  },
  loader: ({ context, params }) => {
    const options = geoObservationDetailQueryOptions(params.observationId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="GEO Observation Detail 发生意外错误" />
  ),
  component: GeoObservationDetailRoute,
});

function GeoObservationDetailRoute() {
  const { observationId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <GeoObservationDetailPage
      csrfToken={auth.csrfToken}
      observationId={observationId}
      onDeleted={() => navigate({
        to: '/geo/observations',
        search: { page: 1, pageSize: 20 },
        replace: true,
      })}
    />
  );
}
