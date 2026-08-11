import { describe, expect, it } from 'vitest';

import { mapPublicationStartError, PublicationRequestError } from './publication.api';

describe('Publication API errors', () => {
  it.each([403, 404, 409, 422])('保留 HTTP %s structured error 与 request ID', (status) => {
    const detail = {
      code: `PUBLICATION_${status}`,
      message: '发布命令失败',
      details: {},
      request_id: `req-publication-${status}`,
    };
    expect(mapPublicationStartError(new PublicationRequestError(detail.message, status, detail)))
      .toEqual({
        message: detail.message,
        requestId: detail.request_id,
        code: detail.code,
        status,
      });
  });
});
