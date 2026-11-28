import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { LeadershipDashboardPrintPage } from '@/domains/geo-dashboard/leadership-dashboard-print-page';

const printSearchSchema = z.object({
  snapshotId: z.string().optional(),
  period_from: z.string().optional(),
  period_to: z.string().optional(),
  bucket_granularity: z.enum(['DAY', 'WEEK']).optional(),
  product_id: z.string().optional(),
  surface_id: z.string().optional(),
  collection_mode: z.enum(['MANUAL', 'API', 'BROWSER']).optional(),
});

export const Route = createFileRoute('/_app/geo/dashboard_/print')({
  staticData: { navId: 'geo-dashboard', breadcrumb: '看板打印视图', layout: 'print' },
  validateSearch: printSearchSchema,
  component: GeoDashboardPrintRoute,
});

function GeoDashboardPrintRoute() {
  return <LeadershipDashboardPrintPage search={Route.useSearch()} />;
}
