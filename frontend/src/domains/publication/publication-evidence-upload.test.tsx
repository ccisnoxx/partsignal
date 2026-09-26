import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { createAppQueryClient } from '@/app/query-client';
import { PublicationEvidenceUpload } from './publication-evidence-upload';

describe('Publication evidence upload', () => {
  it('保留可访问的 publication 证据选择入口', () => {
    const queryClient = createAppQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <PublicationEvidenceUpload csrfToken="csrf" onBusyChange={() => undefined} onUploaded={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('上传发布证据截图')).toBeEnabled();
  });
});
