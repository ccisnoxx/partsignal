import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { catalogKeys } from './catalog.api';
import { aliasId, catalogFailure, catalogResponse, catalogSubject, domainId, mockCatalogReads, openCatalogAction, productId, renderCatalog, subjectId } from './catalog.test-support';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true, media: '', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })) });
});
afterEach(() => vi.restoreAllMocks());

describe('Catalog 创建和确认命令', () => {
  it.each([['OWN_BRAND', '自有品牌'], ['COMPETITOR_BRAND', '竞品品牌'], ['COMPETITOR_PRODUCT', '竞品产品'], ['REFERENCE_PART', '参考型号']] as const)('从 %s 创建表单提交，成功后 URL 进入详情', async (type, label) => {
    mockCatalogReads();
    const post = vi.spyOn(api, 'POST').mockResolvedValue(catalogResponse(catalogSubject({ subject_type: type, canonical_name: 'PS-New', display_name: '新监测身份' })));
    const { router } = renderCatalog('/configuration/geo-entities?new=1');
    const driver = userEvent.setup();
    await driver.click(await screen.findByRole('combobox', { name: '对象类型' }));
    await driver.click(await screen.findByRole('option', { name: label }));
    await driver.type(screen.getByRole('textbox', { name: '规范名称' }), 'PS-New');
    await driver.type(screen.getByRole('textbox', { name: '显示名称' }), '新监测身份');
    await driver.click(screen.getByRole('button', { name: '创建监测对象' }));
    await waitFor(() => expect(router.state.location.search.subject_id).toBe(subjectId));
    expect(router.state.location.search.new).toBeUndefined();
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { subject_type: type, canonical_name: 'PS-New', display_name: '新监测身份', description: '', parent_subject_id: null } });
  });

  it('自有产品新建只提交现有产品 ID，搜索选项来自现有 Products API', async () => {
    const get = mockCatalogReads();
    const product = { id: productId, part_number: 'PS-NEW', brand: 'PartSignal', category: '芯片', status: 'ACTIVE', workflow_stage: 'FACTS_EMPTY', primary_task: 'ENTER_FACTS', available_actions: [], deletion: null, revision: 1, created_at: '2026-10-02T08:00:00Z', updated_at: '2026-10-02T08:00:00Z', fact_status: 'NOT_ENTERED', current_fact: null } satisfies components['schemas']['ProductListItem'];
    get.mockImplementation(async (path) => path === '/api/v1/products' ? catalogResponse({ items: [product], total: 1, page: 1, page_size: 10 }) : path === '/api/v1/geo/subjects' ? catalogResponse({ items: [], total: 0, page: 1, page_size: 20 }) : catalogResponse(catalogSubject()));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(catalogResponse(catalogSubject({ subject_type: 'OWN_PRODUCT', product_id: productId, product: { id: productId, part_number: product.part_number, brand: product.brand, category: product.category, revision: 1 } })));
    renderCatalog('/configuration/geo-entities?new=1');
    const driver = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('combobox', { name: '现有产品' })).toBeEnabled());
    await driver.click(screen.getByRole('combobox', { name: '现有产品' }));
    await driver.click(await screen.findByRole('option', { name: 'PartSignal PS-NEW' }));
    await driver.click(screen.getByRole('button', { name: '创建监测对象' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { subject_type: 'OWN_PRODUCT', product_id: productId, parent_subject_id: null, description: '' } });
  });

  it('Alias 创建采用完整聚合，成功后关闭表单并展示服务端规范值', async () => {
    mockCatalogReads();
    const post = vi.spyOn(api, 'POST').mockResolvedValue(catalogResponse(catalogSubject({ revision: 8, aliases: [{ ...catalogSubject().aliases[0]!, alias: '服务端规范别名' }] })));
    renderCatalog();
    const driver = userEvent.setup();
    await driver.click(await screen.findByRole('button', { name: '新增别名' }));
    await driver.type(screen.getByRole('textbox', { name: '别名文本' }), '输入别名');
    await driver.click(screen.getByRole('button', { name: '保存别名' }));
    expect(await screen.findByText('服务端规范别名')).toBeVisible();
    expect(screen.queryByRole('form', { name: '新增别名' })).not.toBeInTheDocument();
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 7, alias: '输入别名', language_code: null, is_active: true } });
  });

  it.each([['删除别名', 'PS', aliasId, 'alias_id'], ['删除域名', 'example.com', domainId, 'domain_id']] as const)('%s 需确认并携带父 revision，成功采用新的字典聚合', async (label, object, id, key) => {
    mockCatalogReads();
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue(catalogResponse(catalogSubject({ revision: 8, aliases: key === 'alias_id' ? [] : catalogSubject().aliases, domains: key === 'domain_id' ? [] : catalogSubject().domains })));
    renderCatalog();
    const driver = await openCatalogAction(label, object);
    expect(remove).not.toHaveBeenCalled();
    await driver.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(remove.mock.calls[0]?.[1]).toMatchObject({ params: { path: { subject_id: subjectId, [key]: id }, query: { expected_revision: 7 }, header: { 'X-CSRF-Token': 'catalog-csrf' } } });
    expect(await screen.findByText(key === 'alias_id' ? '尚无别名。' : '尚无域名。')).toBeVisible();
  });

  it('停用确认保留打开时 revision，不随后台刷新升级，冲突必须重新确认', async () => {
    let current = catalogSubject();
    mockCatalogReads(() => current);
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(catalogFailure()).mockResolvedValueOnce(catalogResponse(catalogSubject({ revision: 9, is_active: false, workflow_stage: 'DISABLED', primary_task: 'ENABLE_SUBJECT', available_actions: ['UPDATE', 'ENABLE', 'CREATE_ALIAS', 'CREATE_DOMAIN'] })));
    const { queryClient } = renderCatalog();
    const driver = await openCatalogAction('停用对象');
    await act(async () => { current = catalogSubject({ revision: 8 }); queryClient.setQueryData(catalogKeys.detail(subjectId), current); });
    await driver.click(screen.getByRole('button', { name: '确认操作' }));
    expect(await screen.findByText(/catalog-request-test/)).toBeVisible();
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 7 } });
    expect(screen.getByRole('button', { name: '确认操作' })).toBeDisabled();
    await driver.click(screen.getByRole('button', { name: '重新读取并重新确认' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认操作' })).toBeEnabled());
    expect(post).toHaveBeenCalledOnce();
    await driver.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toMatchObject({ body: { expected_revision: 8 } });
    expect(await screen.findByText('停用对象已完成。')).toBeVisible();
  });

  it('Subject 删除遇到新引用时显示409，刷新后资格撤回，不再发送删除', async () => {
    let current = catalogSubject({ available_actions: ['DELETE'], deletion: { blockers: [] } });
    mockCatalogReads(() => current);
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue(catalogFailure('GEO_SUBJECT_IN_USE'));
    renderCatalog();
    const driver = await openCatalogAction('删除对象');
    await driver.click(screen.getByRole('button', { name: '确认操作' }));
    expect(await screen.findByText(/catalog-request-test/)).toBeVisible();
    current = catalogSubject();
    await driver.click(screen.getByRole('button', { name: '重新读取并重新确认' }));
    expect(await screen.findByText('服务端当前未提供该动作，请关闭或重新读取。')).toBeVisible();
    expect(screen.getByRole('button', { name: '确认操作' })).toBeDisabled();
    expect(remove).toHaveBeenCalledOnce();
  });

  it.each(['create', 'delete'] as const)('%s 等待期间的新筛选意图在命令完成后继续保留', async (kind) => {
    mockCatalogReads(() => kind === 'delete' ? catalogSubject({ available_actions: ['DELETE'], deletion: { blockers: [] } }) : catalogSubject());
    let resolve!: (value: never) => void;
    const mutation = kind === 'create'
      ? vi.spyOn(api, 'POST').mockImplementation(() => new Promise((done) => { resolve = done; }))
      : vi.spyOn(api, 'DELETE').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const entry = kind === 'create' ? '/configuration/geo-entities?new=1&q=A' : `/configuration/geo-entities?subject_id=${subjectId}&q=A`;
    const { router } = renderCatalog(entry);
    const driver = userEvent.setup();
    if (kind === 'create') {
      await driver.click(await screen.findByRole('combobox', { name: '对象类型' }));
      await driver.click(await screen.findByRole('option', { name: '自有品牌' }));
      await driver.type(screen.getByRole('textbox', { name: '规范名称' }), '名称');
      await driver.type(screen.getByRole('textbox', { name: '显示名称' }), '名称');
      await driver.click(screen.getByRole('button', { name: '创建监测对象' }));
    } else {
      await openCatalogAction('删除对象');
      await driver.click(screen.getByRole('button', { name: '确认操作' }));
    }
    await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
    await act(() => router.navigate({ to: '/configuration/geo-entities', search: { ...router.state.location.search, q: 'B', sort: 'UPDATED_DESC', page: 2 } }));
    await act(async () => resolve(kind === 'create' ? catalogResponse(catalogSubject()) : { response: new Response(null, { status: 204 }) } as never));
    await waitFor(() => expect(router.state.location.search.subject_id).toBe(kind === 'create' ? subjectId : undefined));
    expect(router.state.location.search).toMatchObject({ q: 'B', sort: 'UPDATED_DESC', page: 2 });
    expect(router.state.location.search.new).toBeUndefined();
  });
});
