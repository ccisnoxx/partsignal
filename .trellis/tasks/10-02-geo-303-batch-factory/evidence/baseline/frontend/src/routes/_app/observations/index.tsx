import { createFileRoute, redirect } from '@tanstack/react-router';

import { geoObservationsLegacyHref } from '../../-legacy-routing.model';

export const Route = createFileRoute('/_app/observations/')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: geoObservationsLegacyHref(location.search), replace: true });
  },
});
