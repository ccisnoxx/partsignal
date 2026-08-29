import { createFileRoute, redirect } from '@tanstack/react-router';

import { platformsLegacyHref } from '../../-legacy-routing.model';

export const Route = createFileRoute('/_app/configuration/platforms')({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: platformsLegacyHref(location.search, 'platform'),
      replace: true,
    });
  },
});
