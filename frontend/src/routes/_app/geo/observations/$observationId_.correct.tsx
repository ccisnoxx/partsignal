import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { RouteError } from '@/design-system/workspace/route-error';
import {
  GeoRequestError,
  geoObservationCorrectionContextQueryOptions,
} from '@/domains/geo/geo.api';
import {
  GeoObservationCorrectionPage,
  GeoObservationCorrectionSkeleton,
} from '@/domains/geo/geo-observation-correction-page';

export const Route = createFileRoute('/_app/geo/observations/$observationId_/correct')({
  staticData: { breadcrumb: '更正 Observation' },
  head: ({ params }) => ({
    meta: [{ title: `更正 GEO Observation ${params.observationId} | PartSignal` }],
  }),
  beforeLoad: ({ params }) => {
    if (!z.uuid().safeParse(params.observationId).success) {
      throw new Error(`GEO Observation ID 不是有效 UUID：${params.observationId}`);
    }
  },
  loader: async ({ context, params }) => {
    const correction = await context.queryClient.ensureQueryData(
      geoObservationCorrectionContextQueryOptions(params.observationId),
    );
    if (correction.detail.chain_tail_id !== params.observationId) {
      throw redirect({
        to: '/geo/observations/$observationId/correct',
        params: { observationId: correction.detail.chain_tail_id },
        replace: true,
      });
    }
  },
  pendingComponent: GeoObservationCorrectionPending,
  errorComponent: ({ error, reset }) => (
    <RouteError
      error={error}
      onRetry={reset}
      title={correctionErrorTitle(error)}
    />
  ),
  component: GeoObservationCorrectionRoute,
});

function GeoObservationCorrectionPending() {
  const { observationId } = Route.useParams();
  return <GeoObservationCorrectionSkeleton observationId={observationId} />;
}

function GeoObservationCorrectionRoute() {
  const { observationId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <GeoObservationCorrectionPage
      csrfToken={auth.csrfToken}
      observationId={observationId}
      onCancel={(targetId) => void navigate({
        to: '/geo/observations/$observationId',
        params: { observationId: targetId },
      })}
      onCanonicalChange={(targetId) => navigate({
        ignoreBlocker: true,
        to: '/geo/observations/$observationId/correct',
        params: { observationId: targetId },
        replace: true,
      })}
      onCreated={(createdId) => void navigate({
        to: '/geo/observations/$observationId',
        params: { observationId: createdId },
      })}
    />
  );
}

function correctionErrorTitle(error: Error) {
  if (!(error instanceof GeoRequestError)) return 'GEO Correction Workspace 发生意外错误';
  if (error.status === 404) return '未找到可更正的 GEO Observation';
  if (error.status === 403) return '当前账号不能更正该 GEO Observation';
  if (error.status === 409) return 'GEO Observation 当前不能进入更正工作台';
  return 'GEO Correction Workspace 加载失败';
}
