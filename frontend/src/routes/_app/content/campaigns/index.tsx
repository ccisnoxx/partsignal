import { createFileRoute } from '@tanstack/react-router';

import { CampaignListPage } from '@/domains/campaigns/campaign-list-page';
import { campaignsSearchSchema } from '@/domains/campaigns/campaign.model';

export const Route = createFileRoute('/_app/content/campaigns/')({
  validateSearch: campaignsSearchSchema,
  component: CampaignsIndexRoute,
});

function CampaignsIndexRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CampaignListPage
      onSearchChange={(next) => navigate({ search: next })}
      search={search}
    />
  );
}
