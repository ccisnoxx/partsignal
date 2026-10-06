import type { Page, Request, Response } from '@playwright/test';

type RuntimePhase = string;

type RuntimeTuple = {
  method: string;
  origin: string;
  pathname: string;
  phase: RuntimePhase;
};

type RuntimeCancellation = RuntimeTuple & {
  reason: string;
};

type RuntimeHttpResponse = RuntimeTuple & {
  status: number;
};

type RuntimeConsoleError = {
  phase: RuntimePhase;
  text: string;
};

type RuntimeTraffic = RuntimeTuple & {
  status?: number;
};

type RuntimeAuditConfig = {
  allowedCancellations?: readonly RuntimeCancellation[];
  allowedConsoleErrors?: readonly RuntimeConsoleError[];
  allowedHttpErrors?: readonly RuntimeHttpResponse[];
  apiOrigin: string;
  getPhase: () => RuntimePhase;
};

type TrafficExpectation = {
  attempts: number;
  method: string;
  origin: string;
  pathname: string;
  phase: RuntimePhase;
  responses: number;
  status?: number;
};

type RuntimeTrafficScope = (traffic: RuntimeTraffic) => boolean;

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function createAuthTrafficScope(apiOrigin: string): RuntimeTrafficScope {
  return (traffic) => (
    traffic.origin === apiOrigin && mutationMethods.has(traffic.method)
  );
}

function createSystemTrafficScope(apiOrigin: string): RuntimeTrafficScope {
  return (traffic) => (
    traffic.origin === apiOrigin
    && (
      mutationMethods.has(traffic.method)
      || traffic.pathname === '/api/v1/audit-logs'
      || traffic.pathname.startsWith('/api/v1/audit-logs/')
    )
  );
}

function sameTuple(actual: RuntimeTuple, expected: RuntimeTuple) {
  return actual.phase === expected.phase
    && actual.origin === expected.origin
    && actual.method === expected.method
    && actual.pathname === expected.pathname;
}

function trafficMatches(
  traffic: RuntimeTraffic,
  expected: Omit<TrafficExpectation, 'attempts' | 'responses'>,
) {
  return traffic.origin === expected.origin
    && traffic.method === expected.method
    && traffic.pathname === expected.pathname
    && traffic.phase === expected.phase
    && (expected.status === undefined || traffic.status === expected.status);
}

function trafficExpectationErrors(
  attempts: readonly RuntimeTraffic[],
  responses: readonly RuntimeTraffic[],
  expectations: readonly TrafficExpectation[],
  isAudited: RuntimeTrafficScope,
) {
  const auditedAttempts = attempts.filter(isAudited);
  const auditedResponses = responses.filter(isAudited);
  const errors = expectations.flatMap((expected) => {
    const attemptCount = attempts.filter((item) => trafficMatches(item, {
      method: expected.method,
      origin: expected.origin,
      pathname: expected.pathname,
      phase: expected.phase,
    })).length;
    const responseCount = responses.filter((item) => trafficMatches(item, expected)).length;
    const label = `${expected.phase}: ${expected.method} ${expected.pathname}`;
    const mismatches: string[] = [];
    if (attemptCount !== expected.attempts) {
      mismatches.push(`${label} attempts=${attemptCount} expected=${expected.attempts}`);
    }
    if (responseCount !== expected.responses) {
      mismatches.push(`${label} responses=${responseCount} expected=${expected.responses}`);
    }
    return mismatches;
  });

  for (const attempt of auditedAttempts) {
    const declared = expectations.some((expected) => trafficMatches(attempt, {
      method: expected.method,
      origin: expected.origin,
      pathname: expected.pathname,
      phase: expected.phase,
    }));
    if (!declared) {
      errors.push(`unexpected attempt: ${attempt.phase}: ${attempt.method} ${attempt.origin}${attempt.pathname}`);
    }
  }
  for (const response of auditedResponses) {
    const declared = expectations.some((expected) => trafficMatches(response, expected));
    if (!declared) {
      errors.push(`unexpected response: ${response.phase}: ${response.status ?? 'missing-status'} ${response.method} ${response.origin}${response.pathname}`);
    }
  }
  return errors;
}

function createRealStackRuntimeAudit(config: RuntimeAuditConfig) {
  const attempts: RuntimeTraffic[] = [];
  const responses: RuntimeTraffic[] = [];
  const rawValues: string[] = [];
  const errors: string[] = [];

  function observeAttempt(observation: RuntimeTuple) {
    attempts.push(observation);
  }

  function observeResponse(observation: RuntimeHttpResponse) {
    responses.push(observation);
    if (observation.origin !== config.apiOrigin || observation.status < 400) return;
    const allowed = config.allowedHttpErrors?.some((item) => (
      sameTuple(observation, item) && observation.status === item.status
    ));
    if (!allowed) {
      errors.push(`response: ${observation.phase}: ${observation.status} ${observation.method} ${observation.origin}${observation.pathname}`);
    }
  }

  function observeCancellation(observation: RuntimeCancellation) {
    const allowed = config.allowedCancellations?.some((item) => (
      sameTuple(observation, item) && observation.reason === item.reason
    ));
    if (!allowed) {
      errors.push(`requestfailed: ${observation.phase}: ${observation.method} ${observation.origin}${observation.pathname} ${observation.reason}`);
    }
  }

  function observeConsoleError(observation: RuntimeConsoleError) {
    rawValues.push(observation.text);
    const allowed = config.allowedConsoleErrors?.some((item) => (
      item.phase === observation.phase && item.text === observation.text
    ));
    if (!allowed) errors.push(`console.error: ${observation.text}`);
  }

  function observePageError(message: string) {
    rawValues.push(message);
    errors.push('pageerror');
  }

  function watch(page: Page) {
    const requestIdentity = new WeakMap<Request, RuntimeTuple>();
    page.on('request', (request: Request) => {
      const url = new URL(request.url());
      const observation = {
        method: request.method(),
        origin: url.origin,
        pathname: url.pathname,
        phase: config.getPhase(),
      };
      requestIdentity.set(request, observation);
      observeAttempt(observation);
    });
    page.on('response', (response: Response) => {
      const identity = requestIdentity.get(response.request());
      if (!identity) {
        errors.push('response-without-request-identity');
        return;
      }
      observeResponse({
        ...identity,
        status: response.status(),
      });
    });
    page.on('requestfailed', (request: Request) => {
      rawValues.push(request.url());
      const identity = requestIdentity.get(request);
      if (!identity) {
        errors.push('requestfailed-without-request-identity');
        return;
      }
      observeCancellation({
        ...identity,
        reason: request.failure()?.errorText ?? 'missing-errorText',
      });
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        observeConsoleError({ phase: config.getPhase(), text: message.text() });
      } else {
        rawValues.push(message.text());
      }
    });
    page.on('pageerror', (error) => observePageError(error.message));
  }

  return {
    attempts,
    errors,
    observeAttempt,
    observeCancellation,
    observeConsoleError,
    observePageError,
    observeResponse,
    rawValues,
    responses,
    watch,
  };
}

export {
  createAuthTrafficScope,
  createRealStackRuntimeAudit,
  createSystemTrafficScope,
  trafficExpectationErrors,
};
export type {
  RuntimeAuditConfig,
  RuntimeCancellation,
  RuntimeConsoleError,
  RuntimeHttpResponse,
  RuntimeTraffic,
  RuntimeTrafficScope,
  RuntimeTuple,
  TrafficExpectation,
};
