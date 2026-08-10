import { createFileRoute } from '@tanstack/react-router';

import { NewContentTaskPage } from '@/domains/content/new-content-task-page';
import { newContentTaskSearchSchema } from '@/domains/content/new-content-task.model';

export const Route = createFileRoute('/_app/content/tasks/new')({
  staticData: { breadcrumb: '创建内容任务' },
  validateSearch: newContentTaskSearchSchema,
  component: NewContentTaskRoute,
});

function NewContentTaskRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <NewContentTaskPage
      csrfToken={auth.csrfToken}
      onCancel={() => void navigate({ to: '/content/tasks' })}
      onCreated={(taskId) => void navigate({
        to: '/content/tasks',
        state: (previous) => ({ ...previous, contentTaskCreated: taskId }),
      })}
      onProductIdChange={(productId) => void navigate({
        search: { productId },
      })}
      search={search}
    />
  );
}

declare module '@tanstack/history' {
  interface HistoryState {
    contentTaskCreated?: string;
  }
}
