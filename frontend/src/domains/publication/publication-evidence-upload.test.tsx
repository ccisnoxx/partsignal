import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PublicationEvidenceUpload } from './publication-evidence-upload';

describe('Publication evidence upload', () => {
  it('保留可访问的 publication 证据选择入口', () => {
    render(<PublicationEvidenceUpload csrfToken="csrf" onUploaded={() => undefined} />);
    expect(screen.getByLabelText('上传发布证据截图')).toBeEnabled();
  });
});
