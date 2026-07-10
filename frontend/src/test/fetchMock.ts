/** 为 OpenAPI 客户端提供显式 HTTP 测试边界，未声明请求会直接失败。 */
import { vi } from 'vitest';

type MockResult = { body: unknown; status?: number };

export function mockFetch(handler: (request: Request) => MockResult) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const result = handler(request);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}
