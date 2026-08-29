import { createFileRoute } from '@tanstack/react-router';

import { WorkbenchPage } from '@/domains/workbench/workbench-page';
import { workbenchQueryOptions } from '@/domains/workbench/workbench.api';

export const Route = createFileRoute('/_app/')({
  staticData: { navId: 'workbench', breadcrumb: '工作台' },
  loader: ({ context }) => {
    const options = workbenchQueryOptions();
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: WorkbenchPage,
});
