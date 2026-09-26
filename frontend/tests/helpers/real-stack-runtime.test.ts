import type { Page, Request, Response } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import {
  createAuthTrafficScope,
  createRealStackRuntimeAudit,
  createSystemTrafficScope,
  trafficExpectationErrors,
} from '../e2e/real-stack-runtime';

const apiOrigin = 'http://127.0.0.1:8000';
const systemTraffic = createSystemTrafficScope(apiOrigin);

describe('真实栈 runtime 审计', () => {
  it('只允许 phase + origin + method + exact pathname + reason 完全匹配的取消', () => {
    const audit = createRealStackRuntimeAudit({
      apiOrigin,
      getPhase: () => 'navigate',
      allowedCancellations: [{
        phase: 'navigate',
        origin: apiOrigin,
        method: 'GET',
        pathname: '/api/v1/workbench',
        reason: 'net::ERR_ABORTED',
      }],
    });
    audit.observeCancellation({
      phase: 'navigate',
      origin: apiOrigin,
      method: 'GET',
      pathname: '/api/v1/workbench',
      reason: 'net::ERR_ABORTED',
    });
    expect(audit.errors).toEqual([]);

    const mismatches = [
      { phase: 'navigate', origin: apiOrigin, method: 'GET', pathname: '/api/v1/users', reason: 'net::ERR_ABORTED' },
      { phase: 'navigate', origin: apiOrigin, method: 'GET', pathname: '/api/v1/workbench', reason: 'net::ERR_FAILED' },
      { phase: 'after-navigation', origin: apiOrigin, method: 'GET', pathname: '/api/v1/workbench', reason: 'net::ERR_ABORTED' },
      { phase: 'navigate', origin: 'http://127.0.0.1:9001', method: 'GET', pathname: '/api/v1/workbench', reason: 'net::ERR_ABORTED' },
      { phase: 'navigate', origin: apiOrigin, method: 'POST', pathname: '/api/v1/workbench', reason: 'net::ERR_ABORTED' },
    ];
    for (const mismatch of mismatches) audit.observeCancellation(mismatch);

    expect(audit.errors).toHaveLength(mismatches.length);
    expect(audit.errors).toEqual(expect.arrayContaining([
      `requestfailed: navigate: GET ${apiOrigin}/api/v1/users net::ERR_ABORTED`,
      `requestfailed: navigate: GET ${apiOrigin}/api/v1/workbench net::ERR_FAILED`,
      `requestfailed: after-navigation: GET ${apiOrigin}/api/v1/workbench net::ERR_ABORTED`,
      'requestfailed: navigate: GET http://127.0.0.1:9001/api/v1/workbench net::ERR_ABORTED',
      `requestfailed: navigate: POST ${apiOrigin}/api/v1/workbench net::ERR_ABORTED`,
    ]));
  });

  it('非预期 401 直接失败，只有声明的 reset /auth/session 401 可通过', () => {
    const audit = createRealStackRuntimeAudit({
      apiOrigin,
      getPhase: () => 'reset',
      allowedHttpErrors: [{
        phase: 'reset',
        origin: apiOrigin,
        method: 'GET',
        pathname: '/api/v1/auth/session',
        status: 401,
      }],
    });
    audit.observeResponse({
      phase: 'reset', origin: apiOrigin, method: 'GET', pathname: '/api/v1/auth/session', status: 401,
    });
    audit.observeResponse({
      phase: 'reset', origin: apiOrigin, method: 'GET', pathname: '/api/v1/auth/me', status: 401,
    });
    expect(audit.errors).toEqual([
      `response: reset: 401 GET ${apiOrigin}/api/v1/auth/me`,
    ]);
  });

  it('分别按 attempt/response 计数并拒绝重复 mutation', () => {
    const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'create' });
    for (let index = 0; index < 2; index += 1) {
      audit.observeAttempt({
        phase: 'create', origin: apiOrigin, method: 'POST', pathname: '/api/v1/users',
      });
    }
    audit.observeResponse({
      phase: 'create', origin: apiOrigin, method: 'POST', pathname: '/api/v1/users', status: 201,
    });

    expect(trafficExpectationErrors(audit.attempts, audit.responses, [{
      phase: 'create',
      origin: apiOrigin,
      method: 'POST',
      pathname: '/api/v1/users',
      status: 201,
      attempts: 1,
      responses: 1,
    }], (traffic) => traffic.origin === apiOrigin && traffic.pathname === '/api/v1/users')).toEqual([
      'create: POST /api/v1/users attempts=2 expected=1',
    ]);
  });

  it('额外成功 Audit detail attempt/response 也会被完整 multiset 拒绝', () => {
    const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'audit' });
    for (const pathname of ['/api/v1/audit-logs', '/api/v1/audit-logs/unexpected-id']) {
      audit.observeAttempt({ phase: 'audit', origin: apiOrigin, method: 'GET', pathname });
      audit.observeResponse({ phase: 'audit', origin: apiOrigin, method: 'GET', pathname, status: 200 });
    }

    expect(trafficExpectationErrors(audit.attempts, audit.responses, [{
      phase: 'audit',
      origin: apiOrigin,
      method: 'GET',
      pathname: '/api/v1/audit-logs',
      status: 200,
      attempts: 1,
      responses: 1,
    }], systemTraffic)).toEqual([
      `unexpected attempt: audit: GET ${apiOrigin}/api/v1/audit-logs/unexpected-id`,
      `unexpected response: audit: 200 GET ${apiOrigin}/api/v1/audit-logs/unexpected-id`,
    ]);
  });

  it('不同 phase 的缺失与额外请求不能相互抵消', () => {
    const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'wrong-phase' });
    audit.observeAttempt({
      phase: 'wrong-phase', origin: apiOrigin, method: 'GET', pathname: '/api/v1/audit-logs',
    });
    audit.observeResponse({
      phase: 'wrong-phase', origin: apiOrigin, method: 'GET', pathname: '/api/v1/audit-logs', status: 200,
    });

    expect(trafficExpectationErrors(audit.attempts, audit.responses, [{
      phase: 'expected-phase',
      origin: apiOrigin,
      method: 'GET',
      pathname: '/api/v1/audit-logs',
      status: 200,
      attempts: 1,
      responses: 1,
    }], systemTraffic)).toEqual([
      'expected-phase: GET /api/v1/audit-logs attempts=0 expected=1',
      'expected-phase: GET /api/v1/audit-logs responses=0 expected=1',
      `unexpected attempt: wrong-phase: GET ${apiOrigin}/api/v1/audit-logs`,
      `unexpected response: wrong-phase: 200 GET ${apiOrigin}/api/v1/audit-logs`,
    ]);
  });

  it('response 与 requestfailed 沿用 request attempt 时捕获的 phase', () => {
    let phase = 'attempt-phase';
    const handlers = new Map<string, Array<(value: never) => void>>();
    const page = {
      on: (event: string, handler: (value: never) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
    } as unknown as Page;
    const request = {
      failure: () => ({ errorText: 'net::ERR_ABORTED' }),
      method: () => 'GET',
      url: () => `${apiOrigin}/api/v1/audit-logs`,
    } as unknown as Request;
    const response = {
      request: () => request,
      status: () => 200,
    } as unknown as Response;
    const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => phase });
    audit.watch(page);

    handlers.get('request')?.[0]?.(request as never);
    phase = 'response-phase';
    handlers.get('response')?.[0]?.(response as never);
    handlers.get('requestfailed')?.[0]?.(request as never);

    expect(audit.responses[0]?.phase).toBe('attempt-phase');
    expect(audit.errors).toContain(
      `requestfailed: attempt-phase: GET ${apiOrigin}/api/v1/audit-logs net::ERR_ABORTED`,
    );
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'Auth scope 拒绝同源未知 2xx %s mutation',
    (method) => {
      const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'auth' });
      audit.observeAttempt({
        phase: 'auth', origin: apiOrigin, method, pathname: '/api/v1/auth/unknown-success',
      });
      audit.observeResponse({
        phase: 'auth',
        origin: apiOrigin,
        method,
        pathname: '/api/v1/auth/unknown-success',
        status: 201,
      });

      expect(trafficExpectationErrors(
        audit.attempts,
        audit.responses,
        [],
        createAuthTrafficScope(apiOrigin),
      )).toEqual([
        `unexpected attempt: auth: ${method} ${apiOrigin}/api/v1/auth/unknown-success`,
        `unexpected response: auth: 201 ${method} ${apiOrigin}/api/v1/auth/unknown-success`,
      ]);
    },
  );

  it('Auth scope 拒绝未知失败 mutation，并排除安全方法与跨 origin mutation', () => {
    const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'auth' });
    audit.observeAttempt({
      phase: 'auth', origin: apiOrigin, method: 'POST', pathname: '/api/v1/auth/unknown-failure',
    });
    audit.observeResponse({
      phase: 'auth',
      origin: apiOrigin,
      method: 'POST',
      pathname: '/api/v1/auth/unknown-failure',
      status: 422,
    });
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      audit.observeAttempt({
        phase: 'auth', origin: apiOrigin, method, pathname: '/api/v1/auth/safe-probe',
      });
    }
    audit.observeAttempt({
      phase: 'auth',
      origin: 'http://127.0.0.1:9001',
      method: 'POST',
      pathname: '/api/v1/auth/cross-origin',
    });

    expect(trafficExpectationErrors(
      audit.attempts,
      audit.responses,
      [],
      createAuthTrafficScope(apiOrigin),
    )).toEqual([
      `unexpected attempt: auth: POST ${apiOrigin}/api/v1/auth/unknown-failure`,
      `unexpected response: auth: 422 POST ${apiOrigin}/api/v1/auth/unknown-failure`,
    ]);
  });

  it('System scope 纳入 filter-options、大写 detail 与所有同源 mutation', () => {
    const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'unexpected' });
    const observations = [
      { method: 'GET', pathname: '/api/v1/audit-logs/filter-options', status: 200 },
      { method: 'GET', pathname: '/api/v1/audit-logs/ABCDEF12-ABCD-ABCD-ABCD-ABCDEF123456', status: 404 },
      { method: 'POST', pathname: '/api/v1/users/unknown-command', status: 201 },
    ] as const;
    for (const observation of observations) {
      audit.observeAttempt({ phase: 'unexpected', origin: apiOrigin, ...observation });
      audit.observeResponse({ phase: 'unexpected', origin: apiOrigin, ...observation });
    }

    const errors = trafficExpectationErrors(audit.attempts, audit.responses, [], systemTraffic);
    expect(errors).toHaveLength(6);
    expect(errors).toEqual(expect.arrayContaining([
      `unexpected attempt: unexpected: GET ${apiOrigin}/api/v1/audit-logs/filter-options`,
      `unexpected response: unexpected: 404 GET ${apiOrigin}/api/v1/audit-logs/ABCDEF12-ABCD-ABCD-ABCD-ABCDEF123456`,
      `unexpected response: unexpected: 201 POST ${apiOrigin}/api/v1/users/unknown-command`,
    ]));
  });

  it('已声明流量的错 phase 与错 status 同时失败', () => {
    const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'wrong-phase' });
    audit.observeAttempt({
      phase: 'wrong-phase', origin: apiOrigin, method: 'POST', pathname: '/api/v1/auth/login',
    });
    audit.observeResponse({
      phase: 'wrong-phase', origin: apiOrigin, method: 'POST', pathname: '/api/v1/auth/login', status: 401,
    });

    expect(trafficExpectationErrors(audit.attempts, audit.responses, [{
      phase: 'login',
      origin: apiOrigin,
      method: 'POST',
      pathname: '/api/v1/auth/login',
      status: 200,
      attempts: 1,
      responses: 1,
    }], createAuthTrafficScope(apiOrigin))).toEqual([
      'login: POST /api/v1/auth/login attempts=0 expected=1',
      'login: POST /api/v1/auth/login responses=0 expected=1',
      `unexpected attempt: wrong-phase: POST ${apiOrigin}/api/v1/auth/login`,
      `unexpected response: wrong-phase: 401 POST ${apiOrigin}/api/v1/auth/login`,
    ]);
  });
});
