import { createFileRoute, redirect } from '@tanstack/react-router';

import { platformsLegacyHref } from '../../-legacy-routing.model';

export const Route = createFileRoute('/_app/settings/')({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: platformsLegacyHref(location.search, 'platform_profile_id'),
      replace: true,
    });
  },
});
