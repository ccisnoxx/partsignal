import { describe, expect, it } from 'vitest';

import {
  factHistorySearchSchema,
  factHistorySearchToApiParams,
  isCanonicalFactHistorySearch,
} from './fact-history.model';

describe('Fact History search model', () => {
  it('显式映射 canonical URL 分页到 API', () => {
    const search = factHistorySearchSchema.parse({ page: '2', pageSize: '50' });
    expect(search).toEqual({ page: 2, pageSize: 50 });
    expect(factHistorySearchToApiParams(search)).toEqual({ page: 2, page_size: 50 });
    expect(isCanonicalFactHistorySearch({ page: '2', pageSize: '50' }, search)).toBe(true);
  });

  it('非法或额外参数规范化为唯一默认 URL', () => {
    const search = factHistorySearchSchema.parse({ page: 0, pageSize: 999, junk: 'x' });
    expect(search).toEqual({ page: 1, pageSize: 20 });
    expect(isCanonicalFactHistorySearch({ page: 0, pageSize: 999, junk: 'x' }, search)).toBe(false);
    expect(isCanonicalFactHistorySearch({ page: 1, pageSize: 20 }, search)).toBe(true);
  });
});
