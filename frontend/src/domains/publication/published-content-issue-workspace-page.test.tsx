import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import { PublishedContentIssueWorkspacePage } from './published-content-issue-workspace-page';
import {
  issueIds,
  issueWorkspace,
  repairContext,
  repairTask,
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

function errorResponse(status: number) {
  return response({
    error: {
      code: `PUBLICATION_${status}`,
      message: '内容问题请求失败',
      details: {},
      request_id: `req-issue-${status}`,
    },
  }, status);
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

  it('repair 409 显式重载 Workspace 与 repair context 后使用最新 revision/candidate', async () => {
    const user = userEvent.setup();
    const latestFactId = 'e0000000-0000-4000-8000-00000000000e';
    const latestIssue = { ...issueWorkspace.issue, revision: 1 };
    const latestWorkspace = { ...issueWorkspace, issue: latestIssue };
    const previousCandidate = repairContext.fact_candidates[0]!;
    const latestRepair = {
      ...repairContext,
      issue: latestIssue,
      fact_candidates: [{
        version: {
          ...previousCandidate.version,
          id: latestFactId,
          version: previousCandidate.version.version + 1,
          change_summary: '最新批准修复依据',
        },
        difference: {
          ...previousCandidate.difference,
          to_id: latestFactId,
        },
      }],
    };
    let workspaceReads = 0;
    let repairReads = 0;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/published-content-issues/{issue_id}/workspace-context') {
        workspaceReads += 1;
        return response(workspaceReads === 1 ? issueWorkspace : latestWorkspace);
      }
      if (path === '/api/v1/published-content-issues/{issue_id}/repair-context') {
        repairReads += 1;
        return response(repairReads === 1 ? repairContext : latestRepair);
      }
      throw new Error(`未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST')
      .mockResolvedValueOnce(errorResponse(409))
      .mockResolvedValueOnce(response(repairTask, 201));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '创建修复任务' }));
    await user.click(await screen.findByRole('combobox', { name: '修复依据' }));
    await user.click(await screen.findByRole('option', { name: /FactVersion v2/ }));
    await user.click(screen.getByRole('button', { name: '确认创建' }));

    expect(await screen.findByText('请求 ID：req-issue-409')).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '显式重载最新问题' }));
    await waitFor(() => {
      expect(workspaceReads).toBe(2);
      expect(repairReads).toBe(2);
    });

    await user.click(screen.getByRole('button', { name: '确认创建' }));
    expect(await screen.findByText('所选 Fact Version 已不在最新候选中，请重新选择'))
      .toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('combobox', { name: '修复依据' }));
    await user.click(await screen.findByRole('option', { name: /FactVersion v3/ }));
    await user.click(screen.getByRole('button', { name: '确认创建' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith(
      '/api/v1/published-content-issues/{issue_id}/repair-task',
      {
        body: { fact_version_id: latestFactId, expected_issue_revision: 1 },
        params: {
          header: { 'X-CSRF-Token': 'csrf-token-for-issue-workspace-tests' },
          path: { issue_id: issueIds.issue },
        },
      },
    );
  });

  it('RESOLVED 缺少 resolution outcome 时显式失败，不猜测为已退役', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      ...issueWorkspace,
      issue: {
        ...issueWorkspace.issue,
        status: 'RESOLVED',
        workflow_stage: 'RESOLVED',
        primary_task: 'VIEW_RESOLUTION',
        available_actions: [],
        resolution_outcome: null,
        resolved_at: '2026-08-12T03:00:00Z',
        resolved_by: issueWorkspace.issue.opened_by,
      },
    }));
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: '内容问题上下文不完整' }))
      .toBeInTheDocument();
    expect(screen.getByText(/缺少明确的 resolution outcome/)).toBeInTheDocument();
    expect(screen.queryByText('已退役')).not.toBeInTheDocument();
  });
});
