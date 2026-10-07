import { createFileRoute, redirect } from '@tanstack/react-router';

import { publicationsLegacyHref } from '../-legacy-routing.model';

export const Route = createFileRoute('/_app/publications')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: publicationsLegacyHref(location.search), replace: true });
  },
});
