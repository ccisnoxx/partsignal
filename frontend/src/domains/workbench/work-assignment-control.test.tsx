import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { WorkAssignmentDialogButton } from './work-assignment-control';

const detail: components['schemas']['WorkAssignmentDetail'] = {
  target_type: 'ContentTask',
  target_id: '10000000-0000-4000-8000-000000000010',
  revision: 2,
  editable: true,
  priority_mutable: true,
  assignment: {
    assignee: {
      id: '20000000-0000-4000-8000-000000000001',
      username: 'alice',
      display_name: 'Alice',
    },
    priority: 'MEDIUM',
    due_at: null,
    blocked_reason: null,
    assigned_by: {
      id: '20000000-0000-4000-8000-000000000002',
      username: 'admin',
      display_name: 'Admin',
    },
    assigned_at: '2026-11-27T08:00:00Z',
    is_overdue: false,
  },
};

const assignees: components['schemas']['WorkAssigneeOptionList'] = {
  items: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      username: 'alice',
      display_name: 'Alice',
      account_type: 'ENGINEER',
    },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('WorkAssignmentDialogButton', () => {
  it('懒加载分派详情并提交 expected_revision 乐观锁更新', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/workbench/assignees') {
        return { data: assignees, response: Response.json(assignees) } as never;
      }
      return { data: detail, response: Response.json(detail) } as never;
    });
    const updated: components['schemas']['WorkAssignmentDetail'] = {
      ...detail,
      revision: 3,
      assignment: { ...detail.assignment, blocked_reason: '等待 FAE 确认' },
    };
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue({
      data: updated,
      response: Response.json(updated),
    } as never);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onUpdated = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <WorkAssignmentDialogButton
          csrfToken="csrf-2d"
          onUpdated={onUpdated}
          targetId={detail.target_id}
          targetType="ContentTask"
        />
      </QueryClientProvider>,
    );

    expect(get).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '分派与 SLA' }));
    expect(await screen.findByText('当前版本 r2')).toBeInTheDocument();

    const reasonInput = screen.getByLabelText(/阻塞原因/);
    await userEvent.type(reasonInput, '等待 FAE 确认');
    await userEvent.click(screen.getByRole('button', { name: '保存分派' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith(
      '/api/v1/content-tasks/{content_task_id}/assignment',
      expect.objectContaining({
        body: expect.objectContaining({
          expected_revision: 2,
          blocked_reason: '等待 FAE 确认',
        }),
      }),
    ));
    expect(onUpdated).toHaveBeenCalledOnce();
  });

  it('已冻结对象隐藏保存按钮', async () => {
    const frozen: components['schemas']['WorkAssignmentDetail'] = {
      ...detail,
      target_type: 'GeoOpportunity',
      editable: false,
      priority_mutable: false,
    };
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/workbench/assignees') {
        return { data: assignees, response: Response.json(assignees) } as never;
      }
      return { data: frozen, response: Response.json(frozen) } as never;
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkAssignmentDialogButton
          csrfToken="csrf-2d"
          targetId={frozen.target_id}
          targetType="GeoOpportunity"
        />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: '分派与 SLA' }));
    expect(await screen.findByText('已终态/归档冻结')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存分派' })).not.toBeInTheDocument();
  });

  it('未修改截止时间时保留原始精确秒级 due_at，且成员加载失败时展示显式错误而非历史保留', async () => {
    const preciseDueAt = '2026-11-28T09:15:42Z';
    const withSeconds: components['schemas']['WorkAssignmentDetail'] = {
      ...detail,
      assignment: { ...detail.assignment, due_at: preciseDueAt },
    };
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/workbench/assignees') {
        return {
          error: {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: '成员目录暂不可用',
              details: {},
              request_id: 'req-assignees',
            },
          },
          response: new Response(null, { status: 503 }),
        } as never;
      }
      return { data: withSeconds, response: Response.json(withSeconds) } as never;
    });
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue({
      data: { ...withSeconds, revision: 3 },
      response: Response.json({ ...withSeconds, revision: 3 }),
    } as never);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkAssignmentDialogButton
          csrfToken="csrf-2d"
          targetId={withSeconds.target_id}
          targetType="ContentTask"
        />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: '分派与 SLA' }));
    expect(await screen.findByText(/可分派成员加载失败/)).toBeInTheDocument();
    expect(screen.queryByText(/历史保留/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '保存分派' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(
      '/api/v1/content-tasks/{content_task_id}/assignment',
      expect.objectContaining({
        body: expect.objectContaining({
          due_at: preciseDueAt,
        }),
      }),
    ));
  });
});
