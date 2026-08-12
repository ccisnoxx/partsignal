import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import { PublishedContentIssueWorkspacePage } from './published-content-issue-workspace-page';
import {
  issueIds,
  issueWorkspace,
  repairContext,
} from './published-content-issue.test-fixtures';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

afterEach(() => vi.restoreAllMocks());

function response(value: unknown, status = 200) {
  return {
    data: status < 400 ? value : undefined,
    error: status >= 400 ? value : undefined,
    response: Response.json(value, { status }),
  } as never;
}

function renderWorkspace() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PublishedContentIssueWorkspacePage
        csrfToken="csrf-token-for-issue-workspace-tests"
        issueId={issueIds.issue}
        onContentProjectionChange={vi.fn()}
        onSectionChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('PublishedContentIssueWorkspacePage', () => {
  it('首屏只读取一个 Context，修复选项直到动作打开才请求', async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/published-content-issues/{issue_id}/workspace-context') {
        return response(issueWorkspace);
      }
      if (path === '/api/v1/published-content-issues/{issue_id}/repair-context') {
        return response(repairContext);
      }
      throw new Error(`未声明 GET：${path}`);
    });
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: issueWorkspace.issue.actual_title })).toBeInTheDocument();
    expect(screen.getByLabelText('内容问题关联的发布来源 Markdown')).toHaveTextContent('典型工作电压为 3.3 V');
    expect(get).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: '创建修复任务' }));
    expect(await screen.findByText('修复依据')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenLastCalledWith(
      '/api/v1/published-content-issues/{issue_id}/repair-context',
      { params: { path: { issue_id: issueIds.issue } } },
    );
  });

  it('resolve 精确提交 outcome/comment/revision 与 CSRF', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'GET').mockResolvedValue(response(issueWorkspace));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response({
      ...issueWorkspace.issue,
      status: 'RESOLVED',
      available_actions: [],
    }));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '解决内容问题' }));
    await user.type(screen.getByRole('textbox', { name: '解决说明' }), '公开页面已恢复。');
    await user.click(screen.getByRole('button', { name: '确认解决' }));

    expect(post).toHaveBeenCalledWith('/api/v1/published-content-issues/{issue_id}/resolve', {
      body: { outcome: 'RESTORED', comment: '公开页面已恢复。', expected_revision: 0 },
      params: {
        header: { 'X-CSRF-Token': 'csrf-token-for-issue-workspace-tests' },
        path: { issue_id: issueIds.issue },
      },
    });
  });
});
