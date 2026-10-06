import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/observations/topics')({
  beforeLoad: () => {
    throw redirect({ replace: true, to: '/geo/topics' });
  },
});
