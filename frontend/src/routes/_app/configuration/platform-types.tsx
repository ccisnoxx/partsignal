import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/configuration/platform-types')({
  beforeLoad: () => {
    throw redirect({ replace: true, to: '/settings/platforms/types' });
  },
});
