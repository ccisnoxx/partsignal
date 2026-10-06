import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { failure, mockSurfaceReads, openAction, profileFixture, profileId, renderSurfaces, response } from './surfaces.test-support';

beforeAll(() => Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, media: '', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })) }));
afterEach(() => vi.restoreAllMocks());
const entry = `/configuration/geo-surfaces?tab=profiles&profile_id=${profileId}`;
function testable() { return profileFixture({ available_actions: ['UPDATE', 'TEST'], workflow_stage: 'BLOCKED', activation_blockers: [{ code: 'ADAPTER_NOT_APPROVED', field: 'adapter_key' }] }); }
describe('API Profile 连接诊断', () => {
  it.each(['PASSED', 'FAILED'] as const)('确认和等待后展示服务端 %s，不发送 enable', async (status) => {
    mockSurfaceReads(undefined, testable);
    let resolve!: (value: ReturnType<typeof response>) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((done) => { resolve = done; }));
    renderSurfaces(entry);
    const driver = await openAction('测试连接', '人工采集配置');
    const dialog = await screen.findByRole('dialog', { name: '确认测试连接' });
    expect(within(dialog).getByText(/不创建业务运行/)).toBeVisible();
    expect(post).not.toHaveBeenCalled();
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    expect(await within(dialog).findByRole('button', { name: '测试中…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    const base = testable();
    await act(async () => resolve(response({ ...base, summary: { ...base.summary, revision: 9, last_test_status: status, last_tested_at: '2026-10-03T10:00:00Z' }, test_error: status === 'FAILED' ? { code: 'AI_PROVIDER_TIMEOUT', summary: '连接测试超时，请检查服务状态后重新测试' } : null })));
    expect(await screen.findByText(status === 'PASSED' ? '连接测试通过，采集配置仍未启用。' : '连接测试失败，请检查错误摘要和当前配置。')).toBeVisible();
    if (status === 'FAILED') expect(screen.getByText(/连接测试错误：连接测试超时/)).toBeVisible();
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0]).toMatchObject(['/api/v1/geo/collection-profiles/{profile_id}/test', { body: { expected_revision: 7 }, params: { path: { profile_id: profileId }, header: { 'X-CSRF-Token': 'surfaces-csrf' } } }]);
  });
  it('409 不重发，显式重读后重新确认使用最新 revision', async () => {
    let current = testable();
    mockSurfaceReads(undefined, () => current);
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(failure()).mockResolvedValueOnce(response(testable()));
    renderSurfaces(entry);
    const driver = await openAction('测试连接', '人工采集配置');
    const dialog = await screen.findByRole('dialog', { name: '确认测试连接' });
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '确认操作' })).toBeDisabled());
    expect(post).toHaveBeenCalledOnce();
    current = { ...current, summary: { ...current.summary, revision: 8 } };
    await driver.click(within(dialog).getByRole('button', { name: '重新读取并重新确认' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '确认操作' })).toBeEnabled());
    expect(post).toHaveBeenCalledOnce();
    await driver.click(within(dialog).getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toMatchObject({ body: { expected_revision: 8 } });
  });
  it('服务端不给 TEST 时只显示诊断阻断，没有测试入口', async () => {
    mockSurfaceReads(undefined, () => profileFixture({ available_actions: ['UPDATE'], test_blockers: [{ code: 'MODEL_NOT_TESTED', field: 'ai_model_id' }] }));
    renderSurfaces(entry);
    await screen.findByRole('heading', { name: '人工采集配置' });
    expect(screen.getByText(/模型尚未通过测试/)).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: '测试连接' })).not.toBeInTheDocument();
  });
});
