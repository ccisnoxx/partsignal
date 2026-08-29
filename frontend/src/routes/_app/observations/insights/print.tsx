import { createFileRoute, redirect } from '@tanstack/react-router';

import { geoInsightsLegacyHref } from '../../../-legacy-routing.model';

export const Route = createFileRoute('/_app/observations/insights/print')({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: geoInsightsLegacyHref(location.search, '/geo/insights/print'),
      replace: true,
    });
  },
});
