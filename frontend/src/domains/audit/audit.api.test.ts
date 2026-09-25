import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import { auditDetailQueryOptions, auditListQueryOptions } from './audit.api';
import { auditSearchSchema } from './audit.model';

const log = {
  id: '20000000-0000-4000-8000-000000000001',
  actor_id: '10000000-0000-4000-8000-000000000001',
  actor: {
    id: '10000000-0000-4000-8000-000000000001',
    display_name: '系统管理员',
    account_type: 'ADMIN',
  },
  business_module: 'CONFIGURATION',
  action: 'ai_channel.updated',
  target_type: 'AIChannel',
  target_id: '30000000-0000-4000-8000-000000000001',
  outcome: 'SUCCESS',
  primary_task: 'VIEW_LOG_DETAIL',
  request_id: 'req-audit-api',
  created_at: '2026-08-15T08:00:00Z',
} as const;

const detail = {
  ...log,
  changes: [{ field: 'revision', before: 4, after: 5 }],
  facts: { revision: 5 },
  result_message: '渠道配置已更新',
  error_code: null,
  related_entry: { status: 'AVAILABLE', kind: 'AIChannel', parent_id: null },
} as const;

function success(data: unknown) {
  return { data, response: Response.json(data) } as never;
}

function listResponse(overrides: Record<string, unknown> = {}) {
  return { items: [log], page: 1, page_size: 20, total: 1, ...overrides };
}

afterEach(() => vi.restoreAllMocks());

describe('Audit API runtime cache boundary', () => {
  it('初次 list/detail 畸形响应进入 error 且不写入 cache', async () => {
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(success({ items: [{ id: log.id }], page: 1, page_size: 20, total: 1 }))
      .mockResolvedValueOnce(success({ ...detail, raw_json: 'audit-api-secret-sentinel' }));
    const search = auditSearchSchema.parse({
      createdFrom: '2026-08-13T00:00:00.000Z',
      createdTo: '2026-08-16T00:00:00.000Z',
    });
    const listOptions = auditListQueryOptions(search);
    const detailOptions = auditDetailQueryOptions(log.id);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(client.fetchQuery(listOptions)).rejects.toThrow('审计响应安全投影失败');
    expect(client.getQueryData(listOptions.queryKey)).toBeUndefined();
    expect(client.getQueryState(listOptions.queryKey)?.status).toBe('error');

    await expect(client.fetchQuery(detailOptions)).rejects.toThrow('审计响应安全投影失败');
    expect(client.getQueryData(detailOptions.queryKey)).toBeUndefined();
    expect(client.getQueryState(detailOptions.queryKey)?.status).toBe('error');
    expect(String(client.getQueryState(detailOptions.queryKey)?.error)).not.toContain('audit-api-secret-sentinel');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('安全 Detail 已缓存后畸形 refetch 保留旧 data 并记录固定投影错误', async () => {
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(success(detail))
      .mockResolvedValueOnce(success({
        ...detail,
        facts: { reason: { secret: 'audit-api-secret-sentinel' } },
      }));
    const options = auditDetailQueryOptions(log.id);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(client.fetchQuery(options)).resolves.toEqual(detail);
    await expect(client.fetchQuery({ ...options, staleTime: 0 })).rejects.toThrow('审计响应安全投影失败');

    expect(client.getQueryData(options.queryKey)).toEqual(detail);
    expect(client.getQueryState(options.queryKey)).toMatchObject({ status: 'error' });
    expect(client.getQueryState(options.queryKey)?.error?.message).toBe('审计响应安全投影失败');
    expect(JSON.stringify(client.getQueryData(options.queryKey))).not.toContain('audit-api-secret-sentinel');
  });

  it('global list 首次错分页身份不入 cache，stale refetch 保留旧 data 与固定错误', async () => {
    const search = auditSearchSchema.parse({
      createdFrom: '2026-08-13T00:00:00.000Z',
      createdTo: '2026-08-16T00:00:00.000Z',
    });
    const options = auditListQueryOptions(search);
    const get = vi.spyOn(api, 'GET').mockResolvedValue(success(listResponse({ page: 2 })));
    const initialClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(initialClient.fetchQuery(options)).rejects.toThrow('审计响应安全投影失败');
    expect(initialClient.getQueryData(options.queryKey)).toBeUndefined();
    expect(initialClient.getQueryState(options.queryKey)?.status).toBe('error');

    get.mockReset()
      .mockResolvedValueOnce(success(listResponse()))
      .mockResolvedValueOnce(success(listResponse({ page_size: 10, raw_page: 'audit-api-secret-sentinel' })));
    const cachedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await cachedClient.fetchQuery(options);
    const safeData = cachedClient.getQueryData(options.queryKey);
    await expect(cachedClient.fetchQuery({ ...options, staleTime: 0 })).rejects.toThrow('审计响应安全投影失败');

    expect(cachedClient.getQueryData(options.queryKey)).toEqual(safeData);
    expect(cachedClient.getQueryState(options.queryKey)).toMatchObject({ status: 'error' });
    expect(cachedClient.getQueryState(options.queryKey)?.error?.message).toBe('审计响应安全投影失败');
    expect(JSON.stringify(cachedClient.getQueryData(options.queryKey))).not.toContain('audit-api-secret-sentinel');
  });

  it('detail 首次错 logId 不入 cache，stale refetch 保留旧 data 与固定错误', async () => {
    const wrongDetail = {
      ...detail,
      id: '20000000-0000-4000-8000-000000000099',
      result_message: 'audit-api-secret-sentinel',
    };
    const options = auditDetailQueryOptions(log.id);
    const get = vi.spyOn(api, 'GET').mockResolvedValue(success(wrongDetail));
    const initialClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(initialClient.fetchQuery(options)).rejects.toThrow('审计响应安全投影失败');
    expect(initialClient.getQueryData(options.queryKey)).toBeUndefined();
    expect(initialClient.getQueryState(options.queryKey)?.status).toBe('error');

    get.mockReset().mockResolvedValueOnce(success(detail)).mockResolvedValueOnce(success(wrongDetail));
    const cachedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await cachedClient.fetchQuery(options);
    await expect(cachedClient.fetchQuery({ ...options, staleTime: 0 })).rejects.toThrow('审计响应安全投影失败');

    expect(cachedClient.getQueryData(options.queryKey)).toEqual(detail);
    expect(cachedClient.getQueryState(options.queryKey)).toMatchObject({ status: 'error' });
    expect(cachedClient.getQueryState(options.queryKey)?.error?.message).toBe('审计响应安全投影失败');
    expect(JSON.stringify(cachedClient.getQueryData(options.queryKey))).not.toContain('audit-api-secret-sentinel');
  });

  it('actor 三类关系矛盾在 global list/detail cache 边界统一失败', async () => {
    const actorCases = [
      { actor: { ...log.actor, id: '10000000-0000-4000-8000-000000000099' } },
      { actor_id: null },
      { actor: null },
    ];
    const search = auditSearchSchema.parse({
      createdFrom: '2026-08-13T00:00:00.000Z',
      createdTo: '2026-08-16T00:00:00.000Z',
    });
    for (const actorOverride of actorCases) {
      vi.spyOn(api, 'GET').mockResolvedValue(success(listResponse({ items: [{ ...log, ...actorOverride }] })));
      const listOptions = auditListQueryOptions(search);
      const listClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await expect(listClient.fetchQuery(listOptions)).rejects.toThrow('审计响应安全投影失败');
      expect(listClient.getQueryData(listOptions.queryKey)).toBeUndefined();
      vi.restoreAllMocks();

      vi.spyOn(api, 'GET').mockResolvedValue(success({ ...detail, ...actorOverride }));
      const detailOptions = auditDetailQueryOptions(log.id);
      const detailClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await expect(detailClient.fetchQuery(detailOptions)).rejects.toThrow('审计响应安全投影失败');
      expect(detailClient.getQueryData(detailOptions.queryKey)).toBeUndefined();
      vi.restoreAllMocks();
    }
  });

  it('非法 related matrix 含 sentinel 时不进入 detail cache', async () => {
    const sentinel = 'audit-api-secret-sentinel';
    vi.spyOn(api, 'GET').mockResolvedValue(success({
      ...detail,
      related_entry: { status: 'AVAILABLE', kind: sentinel, parent_id: sentinel },
    }));
    const options = auditDetailQueryOptions(log.id);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(client.fetchQuery(options)).rejects.toThrow('审计响应安全投影失败');
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    expect(String(client.getQueryState(options.queryKey)?.error)).not.toContain(sentinel);
  });

  it('原型链 target type 不得伪装 registered related，首次与 stale cache 都安全失败', async () => {
    const sentinel = 'audit-api-secret-sentinel';
    const malformed = {
      ...detail,
      target_type: 'constructor',
      result_message: sentinel,
      related_entry: { status: 'AVAILABLE', kind: 'constructor', parent_id: null },
    };
    const options = auditDetailQueryOptions(log.id);
    const get = vi.spyOn(api, 'GET').mockResolvedValue(success(malformed));
    const initialClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(initialClient.fetchQuery(options)).rejects.toThrow('审计响应安全投影失败');
    expect(initialClient.getQueryData(options.queryKey)).toBeUndefined();
    expect(String(initialClient.getQueryState(options.queryKey)?.error)).not.toContain(sentinel);

    get.mockReset().mockResolvedValueOnce(success(detail)).mockResolvedValueOnce(success(malformed));
    const cachedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await cachedClient.fetchQuery(options);
    await expect(cachedClient.fetchQuery({ ...options, staleTime: 0 })).rejects.toThrow('审计响应安全投影失败');
    expect(cachedClient.getQueryData(options.queryKey)).toEqual(detail);
    expect(cachedClient.getQueryState(options.queryKey)).toMatchObject({ status: 'error' });
    expect(cachedClient.getQueryState(options.queryKey)?.error?.message).toBe('审计响应安全投影失败');
    expect(JSON.stringify(cachedClient.getQueryData(options.queryKey))).not.toContain(sentinel);
  });

  it('AVAILABLE 非法 target UUID 首次不入 cache，stale refetch 保留旧 data 与固定错误', async () => {
    const sentinel = 'audit-api-secret-sentinel';
    const malformed = { ...detail, target_id: sentinel };
    const options = auditDetailQueryOptions(log.id);
    const get = vi.spyOn(api, 'GET').mockResolvedValue(success(malformed));
    const initialClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(initialClient.fetchQuery(options)).rejects.toThrow('审计响应安全投影失败');
    expect(initialClient.getQueryData(options.queryKey)).toBeUndefined();
    expect(String(initialClient.getQueryState(options.queryKey)?.error)).not.toContain(sentinel);

    get.mockReset().mockResolvedValueOnce(success(detail)).mockResolvedValueOnce(success(malformed));
    const cachedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await cachedClient.fetchQuery(options);
    await expect(cachedClient.fetchQuery({ ...options, staleTime: 0 })).rejects.toThrow('审计响应安全投影失败');
    expect(cachedClient.getQueryData(options.queryKey)).toEqual(detail);
    expect(cachedClient.getQueryState(options.queryKey)).toMatchObject({ status: 'error' });
    expect(cachedClient.getQueryState(options.queryKey)?.error?.message).toBe('审计响应安全投影失败');
    expect(JSON.stringify(cachedClient.getQueryData(options.queryKey))).not.toContain(sentinel);
  });
});
