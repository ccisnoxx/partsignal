import { createFileRoute } from '@tanstack/react-router';

import { BatchContentTaskPage } from '@/domains/content/batch-content-task-page';
import { batchPlanSearchSchema } from '@/domains/content/content-batch.model';

export const Route = createFileRoute('/_app/content/tasks/batch')({
  staticData: { breadcrumb: '批量任务规划' },
  validateSearch: batchPlanSearchSchema,
  component: BatchContentTaskRoute,
});

function BatchContentTaskRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  return <BatchContentTaskPage csrfToken={auth.csrfToken} search={search} />;
}
