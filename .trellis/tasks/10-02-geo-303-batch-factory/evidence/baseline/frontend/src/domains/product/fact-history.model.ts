import { z } from 'zod';

import type { operations } from '@/shared/api/generated/schema';

type FactHistoryApiParams = NonNullable<operations['listProductFactHistory']['parameters']['query']>;

const factHistorySearchSchema = z.object({
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(20), z.literal(50)])).catch(20).default(20),
});

type FactHistorySearch = z.output<typeof factHistorySearchSchema>;

function factHistorySearchToApiParams(search: FactHistorySearch): FactHistoryApiParams {
  return { page: search.page, page_size: search.pageSize };
}

function isCanonicalFactHistorySearch(
  raw: Record<string, unknown>,
  search: FactHistorySearch,
) {
  const keys = Object.keys(raw);
  return keys.length === 2
    && String(raw.page) === String(search.page)
    && String(raw.pageSize) === String(search.pageSize);
}

export {
  factHistorySearchSchema,
  factHistorySearchToApiParams,
  isCanonicalFactHistorySearch,
};
export type { FactHistoryApiParams, FactHistorySearch };
