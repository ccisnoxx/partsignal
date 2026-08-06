/** 验证 GEO 问题删除只消费服务端权限与引用投影。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import { setCsrfToken } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { QueryTopic } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';
import { GeoTopicsPage } from './GeoTopicsPage';

const baseTopic: QueryTopic = {
  id: '11111111-1111-4111-8111-111111111111',
  canonical_question: '如何选择测试器件？',
  intent_type: 'PRODUCT',
  variants: ['测试器件选型'],
  available_actions: ['UPDATE', 'DELETE'],
  deletion: { blockers: [] },
  primary_task: 'USE_FOR_OBSERVATION',
  revision: 2,
  created_at: '2026-08-06T00:00:00Z',
};

function renderPage() {
  return render(
    <ThemeProvider>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter><GeoTopicsPage /></MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  setCsrfToken('x'.repeat(32));
});

afterEach(() => {
  setCsrfToken(null);
  vi.restoreAllMocks();
});

test('ADMIN 确认后携带 revision 删除并刷新全部问题选项', async () => {
  const user = userEvent.setup();
  let deleted = false;
  let deleteRequest: Request | undefined;
  queryClient.setQueryData(queryKeys.geo.insights, { items: [] });
  mockFetch((request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/query-topics') {
      return { body: { items: deleted ? [] : [baseTopic] } };
    }
    if (request.method === 'DELETE' && url.pathname === `/api/v1/query-topics/${baseTopic.id}`) {
      deleteRequest = request;
      deleted = true;
      return { status: 204, body: undefined };
    }
    throw new Error(`未声明测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  await user.click(await screen.findByRole('button', { name: `更多操作：${baseTopic.canonical_question}` }));
  await user.click(screen.getByRole('menuitem', { name: '删除' }));
  const dialog = await screen.findByRole('dialog', { name: `删除 GEO 问题“${baseTopic.canonical_question}”？` });
  expect(within(dialog).getByText(/不会删除任何内容任务、GEO 优化来源或观测历史/)).toBeInTheDocument();
  expect(deleteRequest).toBeUndefined();
  await user.click(within(dialog).getByRole('button', { name: /删\s*除/ }));

  await waitFor(() => expect(deleteRequest).toBeDefined());
  const url = new URL(deleteRequest!.url);
  expect(url.searchParams.get('expected_revision')).toBe('2');
  expect(deleteRequest!.headers.get('X-CSRF-Token')).toBe('x'.repeat(32));
  await waitFor(() => expect(screen.queryByText(baseTopic.canonical_question)).not.toBeInTheDocument());
  expect(queryClient.getQueryState(queryKeys.geo.insights)?.isInvalidated).toBe(true);
});

test('被引用问题显示三类精确阻断且不发送删除请求', async () => {
  const user = userEvent.setup();
  let deleteCount = 0;
  const blocked: QueryTopic = {
    ...baseTopic,
    available_actions: ['UPDATE'],
    deletion: {
      blockers: [
        { type: 'CONTENT_TASK', count: 2 },
        { type: 'GEO_OPTIMIZATION_SOURCE', count: 3 },
        { type: 'GEO_OBSERVATION', count: 4 },
      ],
    },
  };
  mockFetch((request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/query-topics') {
      return { body: { items: [blocked] } };
    }
    if (request.method === 'DELETE') deleteCount += 1;
    throw new Error(`未声明测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  await user.click(await screen.findByRole('button', { name: `更多操作：${blocked.canonical_question}` }));
  expect(screen.queryByRole('menuitem', { name: '删除' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('menuitem', { name: '查看删除条件' }));
  expect(await screen.findByText('内容任务：2')).toBeInTheDocument();
  expect(screen.getByText('GEO 优化来源：3')).toBeInTheDocument();
  expect(screen.getByText('GEO 观测：4')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看历史' })).toHaveAttribute(
    'href',
    `/observations?query_topic_id=${blocked.id}&all_time=true&include_history=true`,
  );
  expect(deleteCount).toBe(0);
});

test('ENGINEER 的 deletion=null 不展示删除相关入口', async () => {
  const engineerTopic: QueryTopic = {
    ...baseTopic,
    available_actions: ['UPDATE'],
    deletion: null,
  };
  mockFetch((request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/query-topics') {
      return { body: { items: [engineerTopic] } };
    }
    throw new Error(`未声明测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  await screen.findByText(engineerTopic.canonical_question);
  expect(screen.queryByRole('button', { name: `更多操作：${engineerTopic.canonical_question}` })).not.toBeInTheDocument();
});

test('并发引用冲突保留问题并展示服务端结构化原因', async () => {
  const user = userEvent.setup();
  mockFetch((request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/query-topics') {
      return { body: { items: [baseTopic] } };
    }
    if (request.method === 'DELETE' && url.pathname === `/api/v1/query-topics/${baseTopic.id}`) {
      return {
        status: 409,
        body: {
          error: {
            code: 'QUERY_TOPIC_IN_USE',
            message: '目标问题仍被以下对象引用：GEO 观测（1）',
            details: { references: [{ type: 'GEO_OBSERVATION', count: 1 }] },
          },
        },
      };
    }
    throw new Error(`未声明测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  await user.click(await screen.findByRole('button', { name: `更多操作：${baseTopic.canonical_question}` }));
  await user.click(screen.getByRole('menuitem', { name: '删除' }));
  const dialog = await screen.findByRole('dialog', { name: `删除 GEO 问题“${baseTopic.canonical_question}”？` });
  await user.click(within(dialog).getByRole('button', { name: /删\s*除/ }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('目标问题仍被以下对象引用：GEO 观测（1）');
  expect(alert).toHaveTextContent('GEO 观测：1');
  expect(screen.getByText(baseTopic.canonical_question)).toBeInTheDocument();
});
