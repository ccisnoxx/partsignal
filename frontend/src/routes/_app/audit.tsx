import { createFileRoute, redirect } from '@tanstack/react-router';

import { auditLegacyHref } from '../-legacy-routing.model';

export const Route = createFileRoute('/_app/audit')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: auditLegacyHref(location.search), replace: true });
  },
});
