import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/content/$versionId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: `/content/versions/${encodeURIComponent(params.versionId)}`,
      replace: true,
    });
  },
});
