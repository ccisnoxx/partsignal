import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import { publishedContentIssueWorkspaceQueryOptions } from './publication.api';
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
  return queryClient;
}

const resolvedWorkspace = {
  ...issueWorkspace,
  issue: {
    ...issueWorkspace.issue,
    status: 'RESOLVED' as const,
    workflow_stage: 'RESOLVED' as const,
    primary_task: 'VIEW_RESOLUTION' as const,
    available_actions: [],
    resolution_outcome: 'RESTORED' as const,
    resolution_comment: '公开页面已恢复。',
    resolved_at: '2026-08-12T03:00:00Z',
    resolved_by: issueWorkspace.issue.opened_by,
    revision: 1,
  },
};

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
        if (workspaceReads === 1) return response(issueWorkspace);
        if (workspaceReads === 2) return response(latestWorkspace);
        return response({
          ...latestWorkspace,
          issue: {
            ...latestIssue,
            workflow_stage: 'REPAIRING',
            primary_task: 'CONTINUE_REPAIR',
            available_actions: ['RESOLVE'],
            repair_task_id: repairTask.id,
          },
          repair_task: repairTask,
        });
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

    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '显式重载最新问题' }));
    await waitFor(() => {
      expect(workspaceReads).toBe(2);
      expect(repairReads).toBe(2);
    });
    await user.click(screen.getByRole('button', { name: '创建修复任务' }));

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
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '创建修复任务' }))
      .not.toBeInTheDocument());
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

  it('409 后关闭弹窗仍可显式重载并恢复保留的解决说明', async () => {
    const user = userEvent.setup();
    let reads = 0;
    vi.spyOn(api, 'GET').mockImplementation(async () => {
      reads += 1;
      return response(reads === 1 ? issueWorkspace : {
        ...issueWorkspace,
        issue: { ...issueWorkspace.issue, revision: 1 },
      });
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(errorResponse(409));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '解决内容问题' }));
    await user.type(screen.getByRole('textbox', { name: '解决说明' }), '公开页面已恢复。');
    await user.click(screen.getByRole('button', { name: '确认解决' }));
    expect(await screen.findByText('请求 ID：req-issue-409')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.getByRole('button', { name: '解决内容问题' }))
      .toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: '显式重载最新问题' }));
    await waitFor(() => expect(reads).toBe(2));
    await user.click(screen.getByRole('button', { name: '解决内容问题' }));
    expect(screen.getByRole('textbox', { name: '解决说明' })).toHaveValue('公开页面已恢复。');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('Fact 候选资格 409 且 Issue revision 未变时，关闭弹窗后的重载读取新候选', async () => {
    const user = userEvent.setup();
    const nextFactId = 'e0000000-0000-4000-8000-00000000000e';
    const previous = repairContext.fact_candidates[0]!;
    const nextRepair = {
      ...repairContext,
      fact_candidates: [{
        version: { ...previous.version, id: nextFactId, version: 3 },
        difference: { ...previous.difference, to_id: nextFactId },
      }],
    };
    let repairReads = 0;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/published-content-issues/{issue_id}/workspace-context') {
        return response(issueWorkspace);
      }
      if (path === '/api/v1/published-content-issues/{issue_id}/repair-context') {
        repairReads += 1;
        return response(repairReads === 1 ? repairContext : nextRepair);
      }
      throw new Error(`未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(errorResponse(409));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '创建修复任务' }));
    await user.click(await screen.findByRole('combobox', { name: '修复依据' }));
    await user.click(await screen.findByRole('option', { name: /FactVersion v2/ }));
    await user.click(screen.getByRole('button', { name: '确认创建' }));
    expect(await screen.findByText('请求 ID：req-issue-409')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '显式重载最新问题' }));
    await waitFor(() => expect(repairReads).toBe(2));
    await user.click(screen.getByRole('button', { name: '创建修复任务' }));
    await user.click(screen.getByRole('button', { name: '确认创建' }));

    expect(await screen.findByText('所选 Fact Version 已不在最新候选中，请重新选择'))
      .toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('后台撤销 RESOLVE 动作时保留打开的草稿并冻结提交', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'GET').mockResolvedValue(response(issueWorkspace));
    const post = vi.spyOn(api, 'POST');
    const queryClient = renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '解决内容问题' }));
    await user.type(screen.getByRole('textbox', { name: '解决说明' }), '待确认的解决说明');
    queryClient.setQueryData(
      publishedContentIssueWorkspaceQueryOptions(issueIds.issue).queryKey,
      resolvedWorkspace,
    );

    expect(screen.getByRole('dialog', { name: '解决内容问题' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '解决说明' })).toHaveValue('待确认的解决说明');
    await waitFor(() => expect(screen.getByRole('button', { name: '确认解决' })).toBeDisabled());
    expect(post).not.toHaveBeenCalled();
  });

  it('解决命令成功但 Context 读取失败时冻结重复提交，显式重载后显示解决记录', async () => {
    const user = userEvent.setup();
    let reads = 0;
    vi.spyOn(api, 'GET').mockImplementation(async () => {
      reads += 1;
      if (reads === 2) return errorResponse(500);
      return response(reads === 1 ? issueWorkspace : resolvedWorkspace);
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(resolvedWorkspace.issue));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '解决内容问题' }));
    await user.type(screen.getByRole('textbox', { name: '解决说明' }), '公开页面已恢复。');
    await user.click(screen.getByRole('button', { name: '确认解决' }));
    expect(await screen.findByText(/命令已提交，但最新工作区未能确认/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认解决' })).toBeDisabled();
    const form = screen.getByRole('button', { name: '确认解决' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(post).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '显式重载最新问题' }));
    expect(await screen.findByText('公开页面已恢复。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解决内容问题' })).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('POST 已返回而完整 Context 尚未读取时禁止重复解决', async () => {
    const user = userEvent.setup();
    let releaseRead = () => {};
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let reads = 0;
    vi.spyOn(api, 'GET').mockImplementation(async () => {
      reads += 1;
      if (reads > 1) await readGate;
      return response(reads === 1 ? issueWorkspace : resolvedWorkspace);
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(resolvedWorkspace.issue));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '解决内容问题' }));
    await user.type(screen.getByRole('textbox', { name: '解决说明' }), '公开页面已恢复。');
    await user.click(screen.getByRole('button', { name: '确认解决' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '正在提交…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: '正在提交…' }).closest('form')!);
    expect(post).toHaveBeenCalledTimes(1);

    releaseRead();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '解决内容问题' }))
      .not.toBeInTheDocument());
  });
});
