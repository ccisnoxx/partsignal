import { createFileRoute, redirect } from '@tanstack/react-router';

import { promptsLegacyHref } from '../../-legacy-routing.model';

export const Route = createFileRoute('/_app/configuration/prompts')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: promptsLegacyHref(location.search), replace: true });
  },
});
