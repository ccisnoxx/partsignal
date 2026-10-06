import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/configuration/ai/channels/$channelId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: `/settings/ai/${encodeURIComponent(params.channelId)}?tab=basic`,
      replace: true,
    });
  },
});
