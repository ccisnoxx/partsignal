import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { PageHeader } from '@/design-system/layout/page-header';
import { Button } from '@/design-system/primitives/button';
import {
  campaignKeys,
  campaignOptionsQueryOptions,
  createContentCampaign,
} from './campaign.api';
import { CampaignForm } from './campaign-form';
import {
  defaultCampaignFormValues,
  toCampaignCreatePayload,
  type CampaignFormValues,
} from './campaign.model';

type NewCampaignPageProps = {
  csrfToken: string | null;
  currentUserId: string;
  onCancel: () => void;
  onCreated: (campaignId: string) => void;
};

function NewCampaignPage({
  csrfToken,
  currentUserId,
  onCancel,
  onCreated,
}: NewCampaignPageProps) {
  const queryClient = useQueryClient();
  const options = useQuery(campaignOptionsQueryOptions());
  const [serverError, setServerError] = useState<string>();
  const create = useMutation({
    mutationFn: (values: CampaignFormValues) =>
      createContentCampaign(toCampaignCreatePayload(values), csrfToken),
  });

  async function handleSubmit(values: CampaignFormValues) {
    setServerError(undefined);
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      const created = await create.mutateAsync(values);
      if (!continuation.isCurrent()) return;
      await queryClient.invalidateQueries({ queryKey: campaignKeys.lists() });
      if (!continuation.isCurrent()) return;
      onCreated(created.id);
    } catch (error) {
      if (!continuation.isCurrent()) return;
      setServerError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="max-w-4xl space-y-6" aria-labelledby="new-campaign-title">
      <PageHeader
        description="创建草稿态内容活动，规划目标产品、问题主题、平台与 GEO 监测计划。"
        title="新建内容活动"
        titleId="new-campaign-title"
      />

      {options.isPending && (
        <div className="rounded-xl border border-border-subtle p-4 text-sm text-text-secondary" aria-busy="true">
          正在加载活动范围选项…
        </div>
      )}

      {options.isError && (
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4" role="alert">
          <p className="text-sm">{options.error instanceof Error ? options.error.message : String(options.error)}</p>
          <Button onClick={() => void options.refetch()} type="button" variant="outline">重试</Button>
        </div>
      )}

      {options.data && (
        <CampaignForm
          initialValues={defaultCampaignFormValues(currentUserId)}
          onCancel={onCancel}
          onSubmit={handleSubmit}
          options={options.data}
          pending={create.isPending}
          serverError={serverError}
          submitLabel="创建草稿活动"
        />
      )}
    </section>
  );
}

export { NewCampaignPage };
export type { NewCampaignPageProps };
