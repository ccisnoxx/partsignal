import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/change-password')({
  beforeLoad: () => {
    throw redirect({ replace: true, to: '/account/security' });
  },
});
