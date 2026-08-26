import { createFileRoute, redirect } from '@tanstack/react-router';

import { contentTasksLegacyHref } from '../../-legacy-routing.model';

export const Route = createFileRoute('/_app/tasks/')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: contentTasksLegacyHref(location.search), replace: true });
  },
});
