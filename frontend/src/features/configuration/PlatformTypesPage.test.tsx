/** 验证平台类型在被具体平台引用时提供删除条件下钻。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import type { Schema } from '../../shared/api/types';
import { PlatformTypesPage } from './PlatformTypesPage';

const apiMocks = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }));

vi.mock('../../shared/api/client', () => ({
  ApiError: class ApiError extends Error {
    details: Record<string, unknown> = {};
  },
  api: apiMocks,
  csrfHeader: () => ({ 'X-CSRF-Token': 'test' }),
  ensureSuccess: (result: { response: Response }) => {
    if (!result.response.ok) throw new Error('请求失败');
  },
  errorMessage: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  unwrap: <T,>(result: { data?: T }) => {
    if (result.data !== undefined) return result.data;
    throw new Error('请求失败');
  },
}));

beforeEach(() => {
  queryClient.clear();
  apiMocks.GET.mockResolvedValue({
    data: {
      items: [{
        id: 'type-1',
        name: '技术社区',
        slug: 'technical-community',
        available_actions: ['UPDATE'],
        deletion: { blockers: [{ type: 'PLATFORM_PROFILE', count: 2 }] },
        primary_task: 'EDIT_CATEGORY',
        revision: 0,
        created_by: 'user-1',
        created_at: '2026-08-04T00:00:00Z',
        updated_at: '2026-08-04T00:00:00Z',
      }],
    } satisfies Schema<'PlatformTypeList'>,
    response: new Response(null, { status: 200 }),
  });
});

test('被引用时显示数量和精确平台筛选，不显示删除命令', async () => {
  const user = userEvent.setup();
  render(
    <ThemeProvider><AntApp><QueryClientProvider client={queryClient}><MemoryRouter><PlatformTypesPage /></MemoryRouter></QueryClientProvider></AntApp></ThemeProvider>,
  );

  await user.click(await screen.findByRole('button', { name: '更多操作：技术社区' }));
  expect(screen.queryByRole('menuitem', { name: '删除' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('menuitem', { name: '查看删除条件' }));
  expect(await screen.findByText('具体平台：2')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看引用' })).toHaveAttribute('href', '/configuration/platforms?platform_type_id=type-1');
});
