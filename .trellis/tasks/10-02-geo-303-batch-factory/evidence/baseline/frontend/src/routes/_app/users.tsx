import { createFileRoute, redirect } from '@tanstack/react-router';

import { usersLegacyHref } from '../-legacy-routing.model';

export const Route = createFileRoute('/_app/users')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: usersLegacyHref(location.search), replace: true });
  },
});
