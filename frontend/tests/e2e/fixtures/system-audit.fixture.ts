/** System Audit production artifact fixture；只允许认证与三个只读 Audit GET。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type AccountType = components['schemas']['AccountType'];
type AuditLog = components['schemas']['AuditLog'];
type AuditLogDetail = components['schemas']['AuditLogDetail'];

type AuditRequest = { path: string; query: Record<string, string>; status: number };
type AuditApiController = {
  allowHttpError: (status: number) => void;
  failNextList: () => void;
  requests: AuditRequest[];
  setAccountType: (value: AccountType) => void;
  setProjectionFailure: (value: boolean) => void;
};

type AuditFixtures = { systemAuditApi: AuditApiController };

const actorId = '10000000-0000-4000-8000-000000000001';
const channelId = '30000000-0000-4000-8000-000000000001';
const secretSentinel = 'system-audit-secret-sentinel';
const unknownAction = 'audit.action.unknown.sentinel';

function auditLogs(): AuditLog[] {
  return Array.from({ length: 23 }, (_, index) => {
    const log = {
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      actor_id: index === 1 ? null : actorId,
      actor: index === 1 ? null : { id: actorId, display_name: '系统管理员', account_type: 'ADMIN' },
      business_module: index % 3 === 0 ? 'CONFIGURATION' : index % 3 === 1 ? 'IDENTITY' : 'PUBLICATION',
      action: index === 2 ? unknownAction : index % 3 === 0 ? 'ai_channel.updated' : index % 3 === 1 ? 'user.updated' : 'publication_work.completed',
      target_type: index % 3 === 0 ? 'AIChannel' : index % 3 === 1 ? 'User' : 'PublicationWork',
      target_id: index % 3 === 0 ? channelId : `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      outcome: index % 3 === 0 ? 'SUCCESS' : index % 3 === 1 ? 'FAILED' : 'DENIED',
      primary_task: 'VIEW_LOG_DETAIL',
      request_id: `req-system-audit-${index + 1}`,
      created_at: new Date(Date.UTC(2026, 7, 15, 12) - index * 60_000).toISOString(),
    } satisfies AuditLog;
    if (index === 2) Object.assign(log, { change_summary: secretSentinel, raw_json: secretSentinel });
    return log;
  });
}

function detailFor(log: AuditLog): AuditLogDetail {
  const related = log.target_type === 'AIChannel'
    ? { status: 'AVAILABLE' as const, kind: 'AIChannel', parent_id: null }
    : log.target_type === 'User'
      ? { status: 'MISSING' as const, kind: 'User', parent_id: null }
      : { status: 'UNSUPPORTED' as const, kind: 'PublicationWork', parent_id: null };
  return {
    ...log,
    changes: [{ field: 'revision', before: null, after: 5 }],
    facts: { configured: true, bound_platform_ids: ['平台甲', '平台乙'] },
    result_message: '审计操作已完成',
    error_code: log.outcome === 'SUCCESS' ? null : 'AUDIT_SAMPLE_RESULT',
    related_entry: related,
  };
}

function errorBody(code: string, message: string, requestId: string) {
  return { error: { code, message, details: {}, request_id: requestId } };
}

const test = base.extend<AuditFixtures>({
  systemAuditApi: [async ({ page }, use) => {
    let accountType: AccountType = 'ADMIN';
    let listFailure = false;
    let projectionFailure = false;
    const logs = auditLogs();
    const requests: AuditRequest[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];
    const allowedHttpErrors: number[] = [];

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const index = allowedHttpErrors.findIndex((status) => message.text().includes(`status of ${status}`));
      if (index >= 0) allowedHttpErrors.splice(index, 1);
      else runtimeErrors.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`);
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/me') {
        await route.fulfill({ status: 200, json: {
          id: actorId, username: 'admin', display_name: '系统管理员', account_type: accountType,
          is_active: true, must_change_password: false, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_USER',
          available_actions: [], deletion: null, revision: 1, created_at: '2026-08-15T00:00:00Z',
        } satisfies components['schemas']['User'] });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/csrf') {
        await route.fulfill({ status: 200, json: { csrf_token: 'audit-fixture-csrf' } });
        return;
      }
      const approved = request.method() === 'GET' && (
        url.pathname === '/api/v1/audit-logs'
        || url.pathname === '/api/v1/audit-logs/filter-options'
        || /^\/api\/v1\/audit-logs\/[^/]+$/.test(url.pathname)
      );
      if (!approved) {
        unexpectedRequests.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({ status: 501, json: errorBody('AUDIT_FIXTURE_UNEXPECTED_API', '系统审计发起了未声明的 API 请求', 'req-audit-unexpected') });
        return;
      }
      if (accountType !== 'ADMIN') {
        requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), status: 403 });
        await route.fulfill({ status: 403, json: errorBody('FORBIDDEN', '仅管理员可访问', 'req-audit-forbidden') });
        return;
      }
      if (url.pathname === '/api/v1/audit-logs/filter-options') {
        const body = { actions: ['ai_channel.updated', unknownAction, 'publication_work.completed', 'user.updated'], target_types: ['AIChannel', 'PublicationWork', 'User'] };
        requests.push({ path: url.pathname, query: {}, status: 200 });
        await route.fulfill({ status: 200, json: body });
        return;
      }
      if (url.pathname === '/api/v1/audit-logs') {
        if (listFailure) {
          listFailure = false;
          requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), status: 503 });
          await route.fulfill({ status: 503, json: errorBody('AUDIT_LIST_FAILED', '审计列表暂时不可用', 'req-audit-list-failed') });
          return;
        }
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('page_size') ?? 20);
        const filtered = logs.filter((log) => (
          (!url.searchParams.get('actor_id') || log.actor_id === url.searchParams.get('actor_id'))
          && (!url.searchParams.get('business_module') || log.business_module === url.searchParams.get('business_module'))
          && (!url.searchParams.get('action') || log.action === url.searchParams.get('action'))
          && (!url.searchParams.get('target_type') || log.target_type === url.searchParams.get('target_type'))
          && (!url.searchParams.get('target_id') || log.target_id === url.searchParams.get('target_id'))
          && (!url.searchParams.get('outcome') || log.outcome === url.searchParams.get('outcome'))
          && (!url.searchParams.get('request_id') || log.request_id === url.searchParams.get('request_id'))
          && (!url.searchParams.get('keyword') || `${log.actor?.display_name ?? ''} ${log.action} ${log.target_type} ${log.request_id}`.includes(url.searchParams.get('keyword')!))
        ));
        const body = { items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), page: pageNumber, page_size: pageSize, total: filtered.length } satisfies components['schemas']['AuditLogList'];
        requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), status: 200 });
        await route.fulfill({ status: 200, json: body });
        return;
      }
      const id = url.pathname.split('/').at(-1)!;
      if (projectionFailure) {
        requests.push({ path: url.pathname, query: {}, status: 409 });
        await route.fulfill({ status: 409, json: errorBody('AUDIT_PROJECTION_FAILED', '该审计详情当前无法安全展示', 'req-audit-projection-failed') });
        return;
      }
      const log = logs.find((item) => item.id === id);
      if (!log) {
        requests.push({ path: url.pathname, query: {}, status: 404 });
        await route.fulfill({ status: 404, json: errorBody('AUDIT_LOG_NOT_FOUND', '审计日志不存在', 'req-audit-detail-404') });
        return;
      }
      const body = detailFor(log);
      requests.push({ path: url.pathname, query: {}, status: 200 });
      await route.fulfill({ status: 200, json: body });
    });

    await use({
      allowHttpError: (status) => allowedHttpErrors.push(status),
      failNextList: () => { listFailure = true; },
      requests,
      setAccountType: (value) => { accountType = value; },
      setProjectionFailure: (value) => { projectionFailure = value; },
    });
    expect(unexpectedRequests, 'System Audit 不得请求 Users 或业务详情 API').toEqual([]);
    expect(runtimeErrors, 'System Audit 不得产生未批准的浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { actorId, channelId, expect, secretSentinel, test, unknownAction };
