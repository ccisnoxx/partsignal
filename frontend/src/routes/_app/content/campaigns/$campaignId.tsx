import { createFileRoute } from '@tanstack/react-router';

import { CampaignDetailPage } from '@/domains/campaigns/campaign-detail-page';

export const Route = createFileRoute('/_app/content/campaigns/$campaignId')({
  staticData: { breadcrumb: '活动详情' },
  component: CampaignDetailRoute,
});

function CampaignDetailRoute() {
  const { campaignId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <CampaignDetailPage
      campaignId={campaignId}
      csrfToken={auth.csrfToken}
      onDeleted={() => void navigate({ to: '/content/campaigns' })}
    />
  );
}
