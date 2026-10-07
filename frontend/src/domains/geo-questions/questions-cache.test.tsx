import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { questionKeys } from './questions.api';
import { renderQuestions, response, variant } from './questions.test-support';

afterEach(() => vi.restoreAllMocks());
it('问题库写后取消首个无缓存列表 GET，迟到旧响应不能成为当前列表', async () => {
  const old = variant();
  let current = old;
  let listReads = 0;
  let release!: (value: never) => void;
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/geo/prompt-variants') {
      listReads += 1;
      if (listReads === 1) return new Promise<never>((resolve) => { release = resolve; });
      return response({ items: [current], total: 1, page: 1, page_size: 20 });
    }
    if (path === '/api/v1/geo/prompt-variants/{variant_id}') return response(current);
    if (path === '/api/v1/query-topics') return response({ items: [], total: 0 });
    throw new Error(`测试收到未声明 GET：${path}`);
  });
  vi.spyOn(api, 'PATCH').mockImplementation(async () => { current = variant({ prompt_text: '写后规范问题', revision: 8 }); return response(current); });
  const { client, router } = renderQuestions();
  const driver = userEvent.setup();
  await driver.click(await screen.findByRole('button', { name: '编辑变体' }));
  await driver.type(screen.getByRole('textbox', { name: '完整问题文本' }), '修改');
  await driver.click(screen.getByRole('button', { name: '保存变体' }));
  await screen.findByText('已保存 · Revision 8');
  await act(async () => { release(response({ items: [old], total: 1, page: 1, page_size: 20 })); });
  await act(async () => { await router.navigate({ to: '/geo/questions', search: {}, ignoreBlocker: true }); });
  expect(await screen.findByRole('button', { name: '写后规范问题' })).toBeVisible();
  await waitFor(() => expect(listReads).toBe(2));
  expect(client.getQueriesData<components['schemas']['GeoPromptVariantListPage']>({ queryKey: questionKeys.lists() })[0]?.[1]?.items[0]?.revision).toBe(8);
});
