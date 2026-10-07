import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import { aiChannelLogsQueryOptions } from './ai-channel.api';

const channelId = '30000000-0000-4000-8000-000000000001';
const unknownAction = 'runtime.action.unknown.sentinel';
const rawSentinel = 'runtime-log-secret-sentinel';
const log = {
  id: '20000000-0000-4000-8000-000000000001',
  actor_id: '10000000-0000-4000-8000-000000000001',
  actor: {
    id: '10000000-0000-4000-8000-000000000001',
    display_name: '系统管理员',
    account_type: 'ADMIN',
  },
  business_module: 'CONFIGURATION',
  action: unknownAction,
  target_type: 'AIChannel',
  target_id: channelId,
  outcome: 'SUCCESS',
  primary_task: 'VIEW_LOG_DETAIL',
  request_id: 'req-runtime-log',
  created_at: '2026-08-15T08:00:00Z',
} as const;

function success(data: unknown) {
  return { data, response: Response.json(data) } as never;
}

afterEach(() => vi.restoreAllMocks());

describe('AI Channel Runtime logs cache boundary', () => {
  it('入 cache 前剥除 list/row/actor extras，未知 action 仍作为安全字符串保留', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(success({
      items: [{
        ...log,
        actor: { ...log.actor, raw_actor: rawSentinel },
        raw_json: rawSentinel,
      }],
      page: 1,
      page_size: 10,
      total: 1,
      raw_page: rawSentinel,
    }));
    const options = aiChannelLogsQueryOptions(channelId, 1, 10);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await client.fetchQuery(options);
    const cached = client.getQueryData(options.queryKey);
    expect(cached).toEqual({ items: [log], page: 1, page_size: 10, total: 1 });
    expect(JSON.stringify(cached)).not.toContain(rawSentinel);
    expect(cached?.items[0]?.action).toBe(unknownAction);
  });

  it('初次畸形不写 cache；已有安全数据时畸形 refetch 保留旧值与 error', async () => {
    const malformed = {
      items: [{ ...log, actor: { ...log.actor, account_type: 'OWNER' } }],
      page: 1,
      page_size: 10,
      total: 1,
    };
    const get = vi.spyOn(api, 'GET').mockResolvedValue(success(malformed));
    const options = aiChannelLogsQueryOptions(channelId, 1, 10);
    const initialClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(initialClient.fetchQuery(options)).rejects.toThrow('审计响应安全投影失败');
    expect(initialClient.getQueryData(options.queryKey)).toBeUndefined();
    expect(initialClient.getQueryState(options.queryKey)?.status).toBe('error');

    get.mockReset()
      .mockResolvedValueOnce(success({ items: [log], page: 1, page_size: 10, total: 1 }))
      .mockResolvedValueOnce(success(malformed));
    const cachedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await cachedClient.fetchQuery(options);
    const safeData = cachedClient.getQueryData(options.queryKey);
    await expect(cachedClient.fetchQuery({ ...options, staleTime: 0 })).rejects.toThrow('审计响应安全投影失败');

    expect(cachedClient.getQueryData(options.queryKey)).toEqual(safeData);
    expect(cachedClient.getQueryState(options.queryKey)).toMatchObject({ status: 'error' });
    expect(cachedClient.getQueryState(options.queryKey)?.error?.message).toBe('审计响应安全投影失败');
  });

  it('Channel logs 首次错分页身份不入 cache，stale refetch 保留旧 data 与固定错误', async () => {
    const options = aiChannelLogsQueryOptions(channelId, 2, 10);
    const wrongIdentity = {
      items: [log],
      page: 1,
      page_size: 20,
      total: 21,
      raw_page: rawSentinel,
    };
    const get = vi.spyOn(api, 'GET').mockResolvedValue(success(wrongIdentity));
    const initialClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(initialClient.fetchQuery(options)).rejects.toThrow('审计响应安全投影失败');
    expect(initialClient.getQueryData(options.queryKey)).toBeUndefined();
    expect(initialClient.getQueryState(options.queryKey)?.status).toBe('error');

    const safe = { items: [log], page: 2, page_size: 10, total: 21 };
    get.mockReset().mockResolvedValueOnce(success(safe)).mockResolvedValueOnce(success(wrongIdentity));
    const cachedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await cachedClient.fetchQuery(options);
    await expect(cachedClient.fetchQuery({ ...options, staleTime: 0 })).rejects.toThrow('审计响应安全投影失败');

    expect(cachedClient.getQueryData(options.queryKey)).toEqual(safe);
    expect(cachedClient.getQueryState(options.queryKey)).toMatchObject({ status: 'error' });
    expect(cachedClient.getQueryState(options.queryKey)?.error?.message).toBe('审计响应安全投影失败');
    expect(JSON.stringify(cachedClient.getQueryData(options.queryKey))).not.toContain(rawSentinel);
  });

  it('actor 三类关系矛盾在 Channel logs cache 边界统一失败', async () => {
    const actorCases = [
      { actor: { ...log.actor, id: '10000000-0000-4000-8000-000000000099' } },
      { actor_id: null },
      { actor: null },
    ];
    for (const actorOverride of actorCases) {
      vi.spyOn(api, 'GET').mockResolvedValue(success({
        items: [{ ...log, ...actorOverride }],
        page: 1,
        page_size: 10,
        total: 1,
      }));
      const options = aiChannelLogsQueryOptions(channelId, 1, 10);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await expect(client.fetchQuery(options)).rejects.toThrow('审计响应安全投影失败');
      expect(client.getQueryData(options.queryKey)).toBeUndefined();
      vi.restoreAllMocks();
    }
  });
});
