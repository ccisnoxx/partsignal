import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/tasks/$taskId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: `/content/tasks/${encodeURIComponent(params.taskId)}`,
      replace: true,
    });
  },
});
