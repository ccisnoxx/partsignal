import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { NewContentTaskPage } from './new-content-task-page';
import { newContentTaskSearchSchema } from './new-content-task.model';

type CreationOptions = components['schemas']['ContentTaskCreationOptions'];
type ContentTask = components['schemas']['ContentTask'];

const ids = {
  productA: '00000000-0000-4000-8000-000000000001',
  productB: '00000000-0000-4000-8000-000000000002',
  factA1: '00000000-0000-4000-8000-000000000011',
  factA2: '00000000-0000-4000-8000-000000000012',
  factB1: '00000000-0000-4000-8000-000000000021',
  platformA: '00000000-0000-4000-8000-000000000031',
  platformB: '00000000-0000-4000-8000-000000000032',
  task: '00000000-0000-4000-8000-000000000041',
  user: '00000000-0000-4000-8000-000000000051',
} as const;

const baseOptions = {
  products: [
    {
      id: ids.productA,
      brand: 'PartSignal',
      part_number: 'PS-A',
      approved_fact_versions: [
        { id: ids.factA2, version: 2, classification: 'INTERNAL' },
        { id: ids.factA1, version: 1, classification: 'PUBLIC' },
      ],
    },
    {
      id: ids.productB,
      brand: 'PartSignal',
      part_number: 'PS-B',
      approved_fact_versions: [
        { id: ids.factB1, version: 1, classification: 'RESTRICTED' },
      ],
    },
  ],
  platforms: [
    { id: ids.platformA, name: '技术社区' },
    { id: ids.platformB, name: '开发者问答' },
  ],
  requested_product: null,
} satisfies CreationOptions;

const createdTask = {
  product_id: ids.productA,
  fact_version_id: ids.factA2,
  platform_profile_id: ids.platformA,
  id: ids.task,
  query_topic_id: null,
  source_published_content_issue_id: null,
  current_content_version_id: null,
  workflow_stage: 'NO_DRAFT',
  primary_task: 'CREATE_FIRST_DRAFT',
  available_actions: ['CANCEL', 'CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION'],
  deletion: null,
  status: 'OPEN',
  revision: 0,
  created_by: ids.user,
  created_at: '2026-08-10T00:00:00Z',
  archived_at: null,
} satisfies ContentTask;

function mockOptions(options: CreationOptions = baseOptions) {
  return vi.spyOn(api, 'GET').mockImplementation(async (_path, request) => {
    const requestedProductId = (
      request as { params?: { query?: { requested_product_id?: string } } }
    ).params?.query?.requested_product_id;
    const requested = requestedProductId
      ? options.products.find((product) => product.id === requestedProductId)
      : undefined;
    const data = {
      ...options,
      requested_product: requestedProductId
        ? requested
          ? {
              product_id: requested.id,
              brand: requested.brand,
              part_number: requested.part_number,
              eligibility: 'ELIGIBLE' as const,
            }
          : options.requested_product
        : null,
    } satisfies CreationOptions;
    return { data, response: Response.json(data) } as never;
  });
}

async function renderPage(entry = '/content/tasks/new') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const rootRoute = createRootRoute({ component: Outlet });
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/content/tasks/new',
    validateSearch: newContentTaskSearchSchema,
    component: () => {
      const search = newRoute.useSearch();
      const navigate = newRoute.useNavigate();
      return (
        <NewContentTaskPage
          csrfToken="component-csrf"
          onCancel={() => void navigate({ to: '/content/tasks' })}
          onCreated={(taskId) => void navigate({ to: `/content/tasks/${taskId}` })}
          onProductIdChange={(productId) => void navigate({ search: { productId } })}
          search={search}
        />
      );
    },
  });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/content/tasks',
    component: () => <h1>内容任务列表</h1>,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/content/tasks/$taskId',
    component: () => <h1>内容任务详情</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([newRoute, listRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { invalidateQueries, router };
}

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function chooseValidTask() {
  await choose('产品', 'PartSignal · PS-A');
  await choose('已批准事实版本', 'v2 · 内部');
  await choose('目标平台', '技术社区');
}

function errorResult(code: string, message: string, requestId: string, status = 409) {
  return {
    error: {
      error: { code, message, details: {}, request_id: requestId },
    },
    response: Response.json({}, { status }),
  } as never;
}

function createRequest(value: unknown) {
  return value as {
    body?: Record<string, unknown>;
    params?: { header?: { 'Idempotency-Key'?: string } };
  };
}

afterEach(() => vi.restoreAllMocks());

describe('NewContentTaskPage', () => {
  it('验证 productId 资格后预选，更换产品立即清除旧事实并更新 URL', async () => {
    const get = mockOptions();
    const { router } = await renderPage(`/content/tasks/new?productId=${ids.productA}`);

    expect(await screen.findByRole('status')).toHaveTextContent('已根据链接预选产品');
    expect(screen.getByRole('combobox', { name: '产品' })).toHaveTextContent('PS-A');
    await choose('目标平台', '技术社区');
    await choose('已批准事实版本', 'v2 · 内部');
    await choose('产品', 'PartSignal · PS-B');

    expect(screen.getByRole('combobox', { name: '已批准事实版本' })).toHaveTextContent('选择事实版本');
    expect(screen.getByRole('combobox', { name: '目标平台' })).toHaveTextContent('技术社区');
    await waitFor(() => expect(router.state.location.search).toEqual({ productId: ids.productB }));
    expect(get).toHaveBeenLastCalledWith('/api/v1/content-tasks/creation-options', {
      params: { query: { requested_product_id: ids.productB } },
    });
  });

  it('非法和不合格 handoff 明确报告，不静默改选', async () => {
    mockOptions();
    await renderPage('/content/tasks/new?productId=not-a-uuid');
    expect(await screen.findByRole('alert')).toHaveTextContent('productId“not-a-uuid”不是有效 UUID');
    expect(await screen.findByRole('combobox', { name: '产品' })).toHaveTextContent('选择产品');
  });

  it('只提交三字段、CSRF 与 UUID 幂等键，成功失效列表并进入 canonical Detail', async () => {
    mockOptions();
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: createdTask,
      response: Response.json(createdTask, { status: 201 }),
    } as never);
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '10000000-0000-4000-8000-000000000001',
    );
    const { invalidateQueries, router } = await renderPage();
    await chooseValidTask();
    await userEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('heading', { name: '内容任务详情' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/content/tasks/${ids.task}`);
    expect(post).toHaveBeenCalledWith('/api/v1/content-tasks', {
      body: {
        product_id: ids.productA,
        fact_version_id: ids.factA2,
        platform_profile_id: ids.platformA,
      },
      params: {
        header: {
          'X-CSRF-Token': 'component-csrf',
          'Idempotency-Key': '10000000-0000-4000-8000-000000000001',
        },
      },
    });
    expect(Object.keys(createRequest(post.mock.calls[0]![1]).body ?? {})).toHaveLength(3);
    expect(uuid).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['content', 'tasks', 'list'] });
    expect(screen.queryByRole('dialog', { name: '要离开当前页面吗？' })).not.toBeInTheDocument();
  });

  it('失败重试复用同一键，payload 改变后生成新键并保留选择', async () => {
    mockOptions();
    const post = vi.spyOn(api, 'POST')
      .mockResolvedValueOnce(errorResult('FACT_NOT_APPROVED', '事实版本已失效', 'req-one'))
      .mockResolvedValueOnce(errorResult('FACT_NOT_APPROVED', '事实版本已失效', 'req-two'))
      .mockResolvedValueOnce({
        data: { ...createdTask, platform_profile_id: ids.platformB },
        response: Response.json(createdTask, { status: 201 }),
      } as never);
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('20000000-0000-4000-8000-000000000002');
    await renderPage();
    await chooseValidTask();

    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText('事实版本已失效')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '产品' })).toHaveTextContent('PS-A');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const firstKey = createRequest(post.mock.calls[0]![1]).params?.header?.['Idempotency-Key'];
    expect(createRequest(post.mock.calls[1]![1]).params?.header?.['Idempotency-Key']).toBe(firstKey);

    await choose('目标平台', '开发者问答');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(createRequest(post.mock.calls[2]![1]).params?.header?.['Idempotency-Key']).not.toBe(firstKey);
  });

  it('IDEMPOTENCY_CONFLICT 废弃冲突键，下次显式提交生成新键', async () => {
    mockOptions();
    const post = vi.spyOn(api, 'POST')
      .mockResolvedValueOnce(errorResult('IDEMPOTENCY_CONFLICT', '幂等键冲突', 'req-conflict'))
      .mockResolvedValueOnce({
        data: createdTask,
        response: Response.json(createdTask, { status: 201 }),
      } as never);
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('20000000-0000-4000-8000-000000000002');
    await renderPage();
    await chooseValidTask();
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText('幂等键冲突')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(createRequest(post.mock.calls[1]![1]).params?.header?.['Idempotency-Key'])
      .not.toBe(createRequest(post.mock.calls[0]![1]).params?.header?.['Idempotency-Key']);
  });

  it('服务端字段错误回到 FormField 和 ErrorSummary，并保留当前选择', async () => {
    mockOptions();
    vi.spyOn(api, 'POST').mockResolvedValue({
      error: {
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求数据不符合接口契约',
          details: {
            errors: [
              {
                loc: ['body', 'fact_version_id'],
                msg: '事实版本不属于所选产品',
                type: 'value_error',
              },
            ],
          },
          request_id: 'req-field',
        },
      },
      response: Response.json({}, { status: 422 }),
    } as never);
    await renderPage();
    await chooseValidTask();
    await userEvent.click(screen.getByRole('button', { name: '创建' }));

    const summary = await screen.findByRole('alert', { name: '请修正以下问题' });
    expect(within(summary).getByText('事实版本不属于所选产品')).toBeInTheDocument();
    expect(within(summary).getByText('请求 ID：req-field')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '已批准事实版本' }))
      .toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox', { name: '产品' })).toHaveTextContent('PS-A');
  });

  it('pending 期间禁用字段与取消，双击只发送一次创建', async () => {
    mockOptions();
    let resolvePost: ((value: unknown) => void) | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => {
      resolvePost = resolve;
    }) as never);
    await renderPage();
    await chooseValidTask();
    await userEvent.dblClick(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('button', { name: '创建中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '产品' })).toBeDisabled();
    expect(post).toHaveBeenCalledOnce();
    resolvePost?.({ data: createdTask, response: Response.json(createdTask, { status: 201 }) });
    expect(await screen.findByRole('heading', { name: '内容任务详情' })).toBeInTheDocument();
  });

  it('options 加载、失败重试和空状态都可验证', async () => {
    let releaseOptions: ((value: unknown) => void) | undefined;
    const get = vi.spyOn(api, 'GET').mockImplementationOnce(() => new Promise((resolve) => {
      releaseOptions = resolve;
    }) as never);
    await renderPage();
    expect(await screen.findByText('正在读取可选产品、事实版本和平台…')).toHaveAttribute('aria-busy', 'true');
    releaseOptions?.({
      error: { error: { code: 'SERVICE_UNAVAILABLE', message: '读取失败', details: {}, request_id: 'req-options' } },
      response: Response.json({}, { status: 503 }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');

    get.mockResolvedValueOnce({
      data: { products: [], platforms: [], requested_product: null },
      response: Response.json({ products: [], platforms: [], requested_product: null }),
    } as never);
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText(/产品活动且存在/u)).toBeInTheDocument();
    expect(screen.getByText(/没有活动的具体平台/)).toBeInTheDocument();
  });

  it('必填错误完整关联 ErrorSummary，DirtyGuard 覆盖 Cancel', async () => {
    mockOptions();
    await renderPage();
    await screen.findByRole('combobox', { name: '产品' });
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    const summary = await screen.findByRole('alert', { name: '请修正以下问题' });
    expect(within(summary).getByText('请选择产品')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '产品' })).toHaveAttribute('aria-invalid', 'true');

    await choose('产品', 'PartSignal · PS-A');
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    const dialog = await screen.findByRole('dialog', { name: '要离开当前页面吗？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('heading', { name: '创建内容任务' })).toBeInTheDocument();
  });
});
