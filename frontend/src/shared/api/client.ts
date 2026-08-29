/** 只消费 OpenAPI 生成类型的 V2 HTTP 边界。 */
import createClient from 'openapi-fetch';
import type { paths } from './generated/schema';

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE_URL || globalThis.location.origin,
  credentials: 'include',
});
