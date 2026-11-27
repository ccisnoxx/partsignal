import { createFileRoute } from '@tanstack/react-router';

import { NewCampaignPage } from '@/domains/campaigns/new-campaign-page';

export const Route = createFileRoute('/_app/content/campaigns/new')({
  staticData: { breadcrumb: '新建内容活动' },
  component: NewCampaignRoute,
});

function NewCampaignRoute() {
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const currentUserId = auth.user?.id ?? '';
  return (
    <NewCampaignPage
      csrfToken={auth.csrfToken}
      currentUserId={currentUserId}
      onCancel={() => void navigate({ to: '/content/campaigns' })}
      onCreated={(campaignId) => void navigate({
        to: '/content/campaigns/$campaignId',
        params: { campaignId },
      })}
    />
  );
}
