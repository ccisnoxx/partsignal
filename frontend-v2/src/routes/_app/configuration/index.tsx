import { createFileRoute, redirect } from '@tanstack/react-router';

import { aiConfigurationLegacyHref } from '../../-legacy-routing.model';

export const Route = createFileRoute('/_app/configuration/')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: aiConfigurationLegacyHref(location.search), replace: true });
  },
});
