import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/observations/$observationId/correct')({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: `/geo/observations/${encodeURIComponent(params.observationId)}/correct`,
      replace: true,
    });
  },
});
