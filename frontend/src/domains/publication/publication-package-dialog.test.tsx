import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { PublicationPackageDialogButton } from './publication-package-dialog';
import { PreRegisterCheckPanel } from './publication-precheck-panel';

const writeText = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

const enhancedPackage: components['schemas']['PublicationPackage'] = {
  content_version_id: '10000000-0000-4000-8000-000000000001',
  fact_version_id: '20000000-0000-4000-8000-000000000001',
  version: 2,
  title: 'TPS5430 工业降压选型指南',
  summary: '梳理 5.5V-36V 与 3A 连续输出选型要点。',
  body_markdown: '## 选型要点\n\n支持 5.5V-36V 输入。',
  body_html: '<h2>选型要点</h2><p>支持 5.5V-36V 输入。</p>',
  body_text: '选型要点\n支持 5.5V-36V 输入。',
  tags: ['工业电源', 'TPS5430'],
  recommended_topics: ['工业电源', '降压芯片'],
  links: [{ text: '数据手册', href: 'https://example.com/ds', is_valid: true }],
  images: [
    { alt: '', src: 'https://example.com/a.png', missing_alt: true, is_valid_src: true },
    { alt: '', src: '//evil.example/b.png', missing_alt: true, is_valid_src: false },
  ],
  character_stats: {
    total_chars: 120,
    non_whitespace_chars: 112,
    plain_text_chars: 100,
    paragraph_count: 2,
    heading_count: 1,
    estimated_read_minutes: 1,
  },
  platform_checklist: [
    {
      code: 'FORBIDDEN_EXPRESSIONS_CLEAN',
      label: '禁止表达与边界合规',
      status: 'PASS',
      detail: '未检测到禁止公开表达',
    },
  ],
  content_hash: 'a'.repeat(64),
};

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  writeText.mockClear();
  vi.restoreAllMocks();
});

describe('Slice 3C publication package & pre-register check UI', () => {
  it('懒加载增强发布包并支持分区复制与双异常图片标识', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: enhancedPackage,
      response: Response.json(enhancedPackage),
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PublicationPackageDialogButton
          contentHash={enhancedPackage.content_hash}
          contentVersionId={enhancedPackage.content_version_id}
        />
      </QueryClientProvider>,
    );

    expect(get).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '查看分区发布包' }));
    expect(await screen.findByText('禁止表达与边界合规')).toBeInTheDocument();
    expect(screen.getByText('缺 Alt')).toBeInTheDocument();
    expect(screen.getByText('缺 Alt 且地址异常')).toBeInTheDocument();

    const copyButtons = screen.getAllByRole('button', { name: '复制' });
    await userEvent.click(copyButtons[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(enhancedPackage.title));
  });

  it('发布前检查面板提交表单值，且表单签名变化后自动清空过期报告', async () => {
    const report: components['schemas']['PublicationPreRegisterCheckOut'] = {
      publication_work_id: '30000000-0000-4000-8000-000000000001',
      content_version_id: enhancedPackage.content_version_id,
      can_register: false,
      blocking_count: 2,
      warning_count: 0,
      checks: [
        {
          code: 'URL_DOMAIN_ALLOWED',
          label: 'URL 域名归属目标平台',
          status: 'BLOCKING',
          detail: '域名不属于平台允许范围',
        },
        {
          code: 'PUBLISH_META_COMPLETE',
          label: '发布时间与操作说明完整',
          status: 'BLOCKING',
          detail: '缺少必填项：发布操作说明',
        },
      ],
    };
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: report,
      response: Response.json(report),
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <PreRegisterCheckPanel
          contextSignature="sig-1"
          csrfToken="csrf-3c"
          getValues={() => ({
            actualTitle: '实际发布标题',
            finalUrl: 'https://bad.invalid/post',
            publishedAt: '2026-11-27T10:00',
            comment: '',
          })}
          workId={report.publication_work_id}
        />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: '执行发布前检查' }));
    expect(await screen.findByText(/存在 2 项阻断问题/)).toBeInTheDocument();
    expect(screen.getByText('域名不属于平台允许范围')).toBeInTheDocument();
    expect(post).toHaveBeenCalledOnce();

    rerender(
      <QueryClientProvider client={client}>
        <PreRegisterCheckPanel
          contextSignature="sig-2"
          csrfToken="csrf-3c"
          getValues={() => ({
            actualTitle: '修改后的标题',
            finalUrl: 'https://bad.invalid/post',
            publishedAt: '2026-11-27T10:00',
            comment: '补充说明',
          })}
          workId={report.publication_work_id}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/存在 2 项阻断问题/)).not.toBeInTheDocument();
  });
});
