import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { advancePrincipalEpoch, beginPrincipalCommandBarrier } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { catalogKeys } from './catalog.api';
import { aliasId, catalogFailure, catalogResponse, catalogSubject, mockCatalogReads, openCatalogAction, productId, renderCatalog, subjectId } from './catalog.test-support';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true, media: '', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })) });
});
afterEach(() => vi.restoreAllMocks());

describe('GEO Catalog 工作台与表单', () => {
  it('ENGINEER 的详情和 new URL 只读，子资源也没有写入口', async () => {
    const readonly = catalogSubject({ available_actions: [], deletion: null, aliases: [], domains: [] });
    mockCatalogReads(() => readonly);
    const write = vi.spyOn(api, 'POST');
    const { router } = renderCatalog(undefined, true);
    expect(await screen.findByText('当前为只读视图。监测对象、别名和域名由管理员维护。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '新建监测对象' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /更多操作|新增别名|新增域名/ })).not.toBeInTheDocument();
    await act(() => router.navigate({ to: '/configuration/geo-entities', search: { new: 1 } }));
    expect(await screen.findByText('当前账号没有创建监测对象的权限。')).toBeVisible();
    expect(screen.queryByRole('form', { name: '新建监测对象' })).not.toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });

  it('服务端删除阻断和动作决定入口，后台刷新保留草稿和原 revision', async () => {
    mockCatalogReads();
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(catalogFailure());
    const { queryClient } = renderCatalog();
    const driver = await openCatalogAction('编辑对象');
    await driver.clear(screen.getByRole('textbox', { name: '显示名称' }));
    await driver.type(screen.getByRole('textbox', { name: '显示名称' }), '本地新名称');
    await act(async () => { queryClient.setQueryData(catalogKeys.detail(subjectId), catalogSubject({ revision: 8, display_name: '远端新名称' })); });
    expect(screen.getByRole('textbox', { name: '显示名称' })).toHaveValue('本地新名称');
    fireEvent.submit(screen.getByRole('form', { name: '编辑监测对象' }));
    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 7, display_name: '本地新名称' }, params: { header: { 'X-CSRF-Token': 'catalog-csrf' } } });
    expect(await screen.findByText(/本地输入已保留/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: '显示名称' })).toHaveValue('本地新名称');
    expect(screen.getByText(/子对象：1/)).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: '删除对象' })).not.toBeInTheDocument();
  });

  it('409 不重放；显式读取最新版本保留输入，用户再次提交才采用新 revision', async () => {
    let current = catalogSubject();
    mockCatalogReads(() => current);
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValueOnce(catalogFailure()).mockResolvedValueOnce(catalogResponse(catalogSubject({ revision: 10, display_name: '本地名称' })));
    renderCatalog();
    const driver = await openCatalogAction('编辑对象');
    await driver.clear(screen.getByRole('textbox', { name: '显示名称' }));
    await driver.type(screen.getByRole('textbox', { name: '显示名称' }), '本地名称');
    await driver.click(screen.getByRole('button', { name: '保存监测对象' }));
    expect(await screen.findByText(/catalog-request-test/)).toBeVisible();
    expect(screen.getByRole('button', { name: '保存监测对象' })).toBeDisabled();
    current = catalogSubject({ revision: 9, description: '远端说明' });
    await driver.click(screen.getByRole('button', { name: '加载最新版本并保留输入' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存监测对象' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: '显示名称' })).toHaveValue('本地名称');
    expect(screen.getByRole('textbox', { name: '监测说明' })).toHaveValue('原始说明');
    expect(patch).toHaveBeenCalledOnce();
    await driver.click(screen.getByRole('button', { name: '保存监测对象' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls[1]?.[1]).toMatchObject({ body: { expected_revision: 9, display_name: '本地名称', description: '原始说明' } });
  });

  it('后台详情读取失败仍保留成功数据、编辑器和本地草稿', async () => {
    const get = mockCatalogReads();
    const { queryClient } = renderCatalog();
    const driver = await openCatalogAction('编辑对象');
    await driver.type(screen.getByRole('textbox', { name: '监测说明' }), '未保存草稿');
    get.mockResolvedValue(catalogFailure('SERVICE_UNAVAILABLE', 503));
    await act(async () => { await queryClient.refetchQueries({ queryKey: catalogKeys.detail(subjectId) }); });
    expect(await screen.findByText(/后台详情刷新失败，当前编辑输入已保留/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: '监测说明' })).toHaveValue('原始说明未保存草稿');
    expect(screen.getByRole('form', { name: '编辑监测对象' })).toBeVisible();
  });

  it.each(['GEO_SUBJECT_ALIAS_EXISTS', 'REVISION_CONFLICT'])('Alias %s 保留文本与语言，使用父 Subject revision', async (code) => {
    mockCatalogReads();
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(catalogFailure(code));
    renderCatalog();
    const driver = await openCatalogAction('编辑别名', 'PS');
    await driver.clear(screen.getByRole('textbox', { name: '别名文本' }));
    await driver.type(screen.getByRole('textbox', { name: '别名文本' }), '新的缩写');
    await driver.type(screen.getByRole('textbox', { name: '语言标签' }), 'zh-CN');
    await driver.click(screen.getByRole('button', { name: '保存别名' }));
    expect(await screen.findByText(/catalog-request-test/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: '别名文本' })).toHaveValue('新的缩写');
    expect(screen.getByRole('textbox', { name: '语言标签' })).toHaveValue('zh-CN');
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 7, language_code: 'zh-CN' }, params: { path: { subject_id: subjectId, alias_id: aliasId } } });
    expect(patch).toHaveBeenCalledOnce();
  });

  it('Domain 唯一性冲突保留 Unicode 主机名并不执行外部验证', async () => {
    mockCatalogReads();
    const post = vi.spyOn(api, 'POST').mockResolvedValue(catalogFailure('GEO_SUBJECT_DOMAIN_EXISTS'));
    renderCatalog();
    const driver = userEvent.setup();
    await driver.click(await screen.findByRole('button', { name: '新增域名' }));
    await driver.type(screen.getByRole('textbox', { name: '域名' }), '例子.测试');
    await driver.click(screen.getByRole('button', { name: '保存域名' }));
    expect(await screen.findByText(/catalog-request-test/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: '域名' })).toHaveValue('例子.测试');
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 7, hostname: '例子.测试' } });
    expect(post).toHaveBeenCalledOnce();
  });

  it('OWN_PRODUCT 只编辑监测说明和父级，不发送名字/产品绑定/事实', async () => {
    const own = catalogSubject({ subject_type: 'OWN_PRODUCT', product_id: productId, product: { id: productId, brand: 'PS', part_number: 'PS-123', category: '芯片', revision: 12 }, display_name: 'PS PS-123', canonical_name: 'PS-123' });
    mockCatalogReads(() => own);
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(catalogResponse({ ...own, revision: 8 }));
    renderCatalog();
    const driver = await openCatalogAction('编辑对象', 'PS PS-123');
    expect(screen.queryByRole('textbox', { name: '规范名称' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '显示名称' })).not.toBeInTheDocument();
    await driver.type(screen.getByRole('textbox', { name: '监测说明' }), '补充');
    await driver.click(screen.getByRole('button', { name: '保存监测对象' }));
    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    const body = (patch.mock.calls[0]?.[1] as unknown as { body: components['schemas']['GeoSubjectUpdate'] }).body;
    expect(body).toEqual({ subject_type: 'OWN_PRODUCT', expected_revision: 7, parent_subject_id: null, description: '原始说明补充' });
  });

  it('切换对象阻断未保存输入，筛选 URL 更新不会丢弃草稿', async () => {
    mockCatalogReads();
    const { router } = renderCatalog();
    const driver = await openCatalogAction('编辑对象');
    await driver.type(screen.getByRole('textbox', { name: '显示名称' }), '草稿');
    await driver.type(screen.getByRole('textbox', { name: '搜索名称、别名或域名' }), 'PS');
    await driver.click(screen.getByRole('button', { name: '应用搜索' }));
    await waitFor(() => expect(router.state.location.search.q).toBe('PS'));
    expect(screen.getByRole('textbox', { name: '显示名称' })).toHaveValue('测试品牌草稿');
    await driver.click(screen.getByRole('button', { name: '新建监测对象' }));
    const dialog = await screen.findByRole('dialog', { name: '要离开当前页面吗？' });
    await driver.click(within(dialog).getByRole('button', { name: '继续编辑' }));
    expect(router.state.location.search.subject_id).toBe(subjectId);
    expect(screen.getByRole('textbox', { name: '显示名称' })).toHaveValue('测试品牌草稿');
  });

  it('主体切换后丢弃延迟保存 continuation 和 cache 写入', async () => {
    mockCatalogReads();
    let resolve!: (value: never) => void;
    const patch = vi.spyOn(api, 'PATCH').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { queryClient } = renderCatalog();
    const driver = await openCatalogAction('编辑对象');
    await driver.type(screen.getByRole('textbox', { name: '监测说明' }), '草稿');
    await driver.click(screen.getByRole('button', { name: '保存监测对象' }));
    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    await act(async () => { advancePrincipalEpoch(queryClient, 'new-principal'); resolve(catalogResponse(catalogSubject({ revision: 90 }))); });
    expect(queryClient.getQueryData<ReturnType<typeof catalogSubject>>(catalogKeys.detail(subjectId))?.revision).toBe(7);
    expect(screen.queryByText('已保存当前配置；历史快照保持不变。')).not.toBeInTheDocument();
  });

  it('主体切换屏障期间不发送新命令，显示明确错误并保留输入', async () => {
    mockCatalogReads();
    const patch = vi.spyOn(api, 'PATCH');
    const { queryClient } = renderCatalog();
    const driver = await openCatalogAction('编辑对象');
    await driver.type(screen.getByRole('textbox', { name: '监测说明' }), '草稿');
    const barrier = beginPrincipalCommandBarrier(queryClient);
    try {
      await driver.click(screen.getByRole('button', { name: '保存监测对象' }));
      expect(await screen.findByText('认证主体正在切换，已阻止新的业务命令')).toBeVisible();
      expect(patch).not.toHaveBeenCalled();
      expect(screen.getByRole('textbox', { name: '监测说明' })).toHaveValue('原始说明草稿');
    } finally { barrier.release(); }
  });
});
