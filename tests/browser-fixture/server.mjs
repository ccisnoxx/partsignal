import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

export const MODES = Object.freeze([
  'streaming', 'paused-stream', 'early-complete', 'no-citations', 'unknown-metadata',
  'authenticated', 'expired-login', 'selector-changed', 'answer-selector-changed',
  'challenge', 'challenge-after-send', 'login-after-send', 'timeout', 'empty-answer',
  'duplicate-answer', 'sensitive-ui', 'external-resource',
]);

// 金标为人工指定虚构原文与实际位置；不由适配器或提取算法生成。
export const ANSWER = '凌川 LC-803 是虚构测试器件。\n需核对公开规格与替代条件。';
export const CITATIONS = Object.freeze([
  { url: 'https://owned.geo-fixture.invalid/spec', title: '虚构规格', position: 1, extraction_source: 'DOM' },
  { url: 'https://industry.geo-fixture.invalid/review', title: '虚构评测', position: 2, extraction_source: 'DOM' },
  { url: 'https://owned.geo-fixture.invalid/spec', title: '再次引用', position: 3, extraction_source: 'DOM' },
]);

/** 测试实例只拥有脚本化场景及低敏感观测；没有业务状态或真实账号。 */
export async function startBrowserFixture(sensitiveValues) {
  const [html, script] = await Promise.all([
    readFile(new URL('./index.html', import.meta.url)),
    readFile(new URL('./fixture.js', import.meta.url)),
  ]);
  const cases = new Map();
  let origin;
  const server = createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'",
    };
    const send = (status, type, body) => {
      response.writeHead(status, { ...headers, 'Content-Type': type });
      response.end(body);
    };
    if (request.headers.host !== new URL(origin).host) return send(400, 'text/plain', '请求无效');
    if (request.method === 'GET' && request.url === '/fixture.js') {
      return send(200, 'text/javascript; charset=utf-8', script);
    }
    const match = /^\/(chat|scenario|submit)\/([a-f0-9-]{36})$/.exec(request.url ?? '');
    const item = match && cases.get(match[2]);
    if (!item) return send(404, 'text/plain', '场景不存在');
    if (request.method === 'GET' && match[1] === 'chat') {
      return send(200, 'text/html; charset=utf-8', html);
    }
    if (request.method === 'GET' && match[1] === 'scenario') {
      return send(200, 'application/json', JSON.stringify({
        mode: item.mode, answer: ANSWER,
        citations: item.mode === 'no-citations' ? [] : CITATIONS,
        sensitiveValues,
      }));
    }
    if (request.method !== 'POST' || match[1] !== 'submit' || request.headers.origin !== origin) {
      return send(405, 'text/plain', '操作无效');
    }
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 32768) return send(413, 'text/plain', '请求过大');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const payload = JSON.parse(body.toString('utf8'));
      if (Object.keys(payload).length !== 1 || typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
        return send(400, 'text/plain', '请求无效');
      }
      // 重复请求如实追加；不以fake去重冒充at-most-once。
      item.requests.push({
        prompt_sha256: createHash('sha256').update(payload.prompt).digest('hex'),
        prompt_bytes: Buffer.byteLength(payload.prompt),
      });
      return send(200, 'application/json', '{"accepted":true}');
    } catch {
      return send(400, 'text/plain', '请求无效');
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    configure(runId, mode) {
      if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId) || !MODES.includes(mode) || cases.has(runId)) {
        throw new Error('BROWSER_FIXTURE_CONFIGURATION_INVALID');
      }
      cases.set(runId, { mode, requests: [] });
      return `${origin}/chat/${runId}`;
    },
    stats(runId) {
      const item = cases.get(runId);
      if (!item) throw new Error('BROWSER_FIXTURE_CASE_MISSING');
      return { count: item.requests.length, requests: structuredClone(item.requests) };
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      cases.clear();
    },
  };
}
