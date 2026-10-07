// GEO-803测试专用；不登记Registry，不接业务Run/真实平台/证据存储。
export class BrowserContractError extends Error {
  constructor(code, stage, external_call_state) {
    const messages = {
      PROVIDER_RESPONSE_INVALID: '供应商回答格式无效',
      PROVIDER_RESPONSE_TOO_LARGE: '供应商回答超过大小限制',
      PROFILE_NEEDS_REAUTH: '采集会话需要重新认证',
      PROVIDER_AUTH_FAILED: '供应商认证失败',
      PROVIDER_UNAVAILABLE: '供应商服务不可用',
      COLLECTOR_UNKNOWN_OUTCOME: '外部请求结果未知，禁止自动重发',
    };
    super(messages[code]);
    this.name = 'BrowserContractError';
    this.failure = Object.freeze({
      code, stage, external_call_state, provider_status: null, retry_after_seconds: null,
    });
  }
}

export class ReferenceBrowserAdapter {
  constructor(context) { this.context = context; }

  async collect(request, { before_send }) {
    const page = await this.context.newPage();
    let sent = false;
    let authorizationError;
    const started = performance.now();
    const fail = (code, stage, state) => { throw new BrowserContractError(code, stage, state); };
    const guard = async () => {
      if (await page.getByTestId('challenge').isVisible()) {
        fail('PROVIDER_AUTH_FAILED', sent ? 'RECEIVE' : 'CONFIGURATION', sent ? 'UNKNOWN' : 'NOT_STARTED');
      }
      if (await page.getByTestId('login').isVisible()) {
        fail('PROFILE_NEEDS_REAUTH', sent ? 'RECEIVE' : 'CONFIGURATION', sent ? 'UNKNOWN' : 'NOT_STARTED');
      }
    };
    try {
      await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 3000 });
      await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'true', { }, { timeout: 3000 });
      await guard();
      for (const name of ['prompt', 'submit', 'temporary-chat', 'answer-panel', 'answer-text', 'citations', 'loading']) {
        if (await page.getByTestId(name).count() !== 1) fail('PROVIDER_RESPONSE_INVALID', 'CONFIGURATION', 'NOT_STARTED');
      }
      await page.getByTestId('temporary-chat').click();
      if (await page.getByTestId('chat').getAttribute('data-temporary') !== 'true') {
        fail('PROVIDER_RESPONSE_INVALID', 'CONFIGURATION', 'NOT_STARTED');
      }
      await page.getByTestId('prompt').fill(request.prompt_text);
      try { await before_send(); } catch (error) { authorizationError = error; throw error; }
      // 回调之后不做无关I/O；不重试提交，保守标记已经开始发送。
      sent = true;
      await page.getByTestId('submit').click({ timeout: request.timeout_ms });
      const handle = await page.waitForFunction(({ quietMs }) => {
        const get = name => document.querySelector(`[data-testid="${name}"]`);
        if (!get('challenge').hidden) return { failure: 'challenge' };
        if (!get('login').hidden) return { failure: 'login' };
        const panel = get('answer-panel');
        if (!panel || document.querySelectorAll('[data-testid="answer-text"]').length !== 1) {
          return { failure: 'selector' };
        }
        // 同时观察正文、引用与元数据；完成标志本身不能证明DOM已稳定。
        const signature = panel.outerHTML;
        const now = performance.now();
        if (panel.__contractSignature !== signature) {
          panel.__contractSignature = signature;
          panel.__contractChangedAt = now;
        }
        if (panel.dataset.status !== 'complete' || !get('loading').hidden || now - panel.__contractChangedAt < quietMs) return false;
        return {
          answer_text: get('answer-text').textContent,
          source_product: panel.dataset.sourceProduct ?? null,
          source_model: panel.dataset.sourceModel ?? null,
          source_version: panel.dataset.sourceVersion ?? null,
          web_search_observed: panel.dataset.search === undefined ? null : panel.dataset.search === 'true',
          citations: [...get('citations').querySelectorAll('a')].map(link => ({
            url: link.getAttribute('href'), title: link.textContent,
            position: Number(link.dataset.position), extraction_source: 'DOM',
          })),
        };
      }, { quietMs: 140 }, { polling: 'raf', timeout: request.timeout_ms });
      const result = await handle.jsonValue();
      await handle.dispose();
      await guard();
      if (result.failure === 'selector') fail('PROVIDER_RESPONSE_INVALID', 'PARSE', 'COMPLETED');
      if (result.failure) fail('PROVIDER_RESPONSE_INVALID', 'RECEIVE', 'UNKNOWN');
      if (!result.answer_text?.trim()) fail('PROVIDER_RESPONSE_INVALID', 'PARSE', 'COMPLETED');
      if (Buffer.byteLength(result.answer_text) > request.max_response_bytes) {
        fail('PROVIDER_RESPONSE_TOO_LARGE', 'PARSE', 'COMPLETED');
      }
      return Object.freeze({
        ...result, answer_format: 'TEXT', provider_request_id: null, usage: null, cost: null,
        duration_ms: Math.floor(performance.now() - started),
        raw_payload_summary: { schema_version: 1, payload_format: 'DOM', payload_bytes: null, finish_reason: 'STOP' },
        screenshot_bytes: null, raw_payload_bytes: null,
      });
    } catch (error) {
      if (authorizationError === error || error instanceof BrowserContractError) throw error;
      if (sent) fail('COLLECTOR_UNKNOWN_OUTCOME', 'RECEIVE', 'UNKNOWN');
      fail('PROVIDER_UNAVAILABLE', 'CONNECT', 'NOT_STARTED');
    } finally {
      await page.close();
    }
  }
}
