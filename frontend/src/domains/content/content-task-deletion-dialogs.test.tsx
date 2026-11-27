import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { initializePrincipalEpoch, advancePrincipalEpoch } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { contentKeys } from './content.api';
import type { ContentTaskActionState } from './content-task-actions';
import { DeletionRecoveryDialog, PermanentDeleteTaskDialog } from './content-task-deletion-dialogs';

type Preview = components['schemas']['ContentTaskPermanentDeletionPreview'];
const task: ContentTaskActionState = {
  id: '00000000-0000-4000-8000-000000000001', identifier: 'CT-RECOVERY', revision: 7,
  primary_task: 'VIEW_FULL_LINEAGE', available_actions: ['PERMANENT_DELETE'], deletion: null,
};
const preview: Preview = {
  task_id: task.id, revision: 7, confirmation_text: '永久删除', external_urls: [],
  counts: { content_versions: 1, content_review_records: 0, generation_jobs: 0, publication_works: 0,
    publication_events: 0, publication_verifications: 0, published_articles: 0,
    published_content_issues: 0, geo_article_relations: 0, exclusive_geo_observation_chains: 0, attachment_relations: 0 },
};
function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  initializePrincipalEpoch(value, 'deletion-test');
  return value;
}
function success(data = preview) { return { data, response: Response.json(data) } as never; }
function failure(code = 'GEO_OBSERVATION_CONTEXT_INCOMPLETE') {
  return { error: { error: { code, message: '删除范围不可读取', details: {}, request_id: 'req-preview-failure' } }, response: Response.json({}, { status: 409 }) } as never;
}
function renderPreview(queryClient = client()) {
  const onSubmit = vi.fn();
  const props = { task, open: true, pending: false, finalFocus: () => null, onClose: vi.fn(), onSubmit };
  const view = render(<QueryClientProvider client={queryClient}><PermanentDeleteTaskDialog {...props} /></QueryClientProvider>);
  return { queryClient, onSubmit, props, ...view };
}
afterEach(() => vi.restoreAllMocks());

it.each(['GEO_OBSERVATION_CONTEXT_INCOMPLETE', 'GEO_OBSERVATION_CHAIN_CHANGED'])(
  'cached preview GET %s 后撤销确认；后台成功不解冻，显式成功后重输', async (code) => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(success());
    const { queryClient, onSubmit } = renderPreview();
    const input = await screen.findByRole('textbox');
    await userEvent.type(input, '永久删除');
    expect(screen.getByRole('button', { name: '永久删除' })).toBeEnabled();
    get.mockResolvedValue(failure(code));
    await act(async () => { await queryClient.invalidateQueries({ queryKey: contentKeys.permanentDeletionPreview(task.id) }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('req-preview-failure');
    expect(screen.getByRole('button', { name: '永久删除' })).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重新读取删除范围' }));
    expect(screen.getByRole('button', { name: '永久删除' })).toBeDisabled();
    get.mockResolvedValue(success());
    await act(async () => { await queryClient.invalidateQueries({ queryKey: contentKeys.permanentDeletionPreview(task.id) }); });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '永久删除' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '重新读取删除范围' }));
    const recovered = await screen.findByRole('textbox');
    expect(recovered).toHaveValue('');
    expect(screen.getByRole('button', { name: '永久删除' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.type(recovered, '永久删除');
    await userEvent.click(screen.getByRole('button', { name: '永久删除' }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(preview, '永久删除');
  },
);

it('预览在途禁止发送，最新范围改变后必须重新输入并提交新 revision', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue(success());
  const { queryClient, onSubmit } = renderPreview();
  await userEvent.type(await screen.findByRole('textbox'), '永久删除');
  let release!: (value: never) => void;
  get.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  let refresh!: Promise<void>;
  await act(async () => { refresh = queryClient.invalidateQueries({ queryKey: contentKeys.permanentDeletionPreview(task.id) }); });
  await waitFor(() => expect(screen.getByRole('button', { name: '永久删除' })).toBeDisabled());
  await userEvent.click(screen.getByRole('button', { name: '永久删除' }));
  expect(onSubmit).not.toHaveBeenCalled();
  const updated = { ...preview, revision: 8, counts: { ...preview.counts, content_versions: 2 } };
  await act(async () => { release(success(updated)); await refresh; });
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  await userEvent.type(screen.getByRole('textbox'), '永久删除');
  await userEvent.click(screen.getByRole('button', { name: '永久删除' }));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(updated, '永久删除');
});

it('同值刷新仍撤销确认，任务切换不继承确认文本', async () => {
  vi.spyOn(api, 'GET').mockResolvedValue(success());
  const { queryClient, onSubmit, props, rerender } = renderPreview();
  await userEvent.type(await screen.findByRole('textbox'), '永久删除');
  await act(async () => { await queryClient.invalidateQueries({ queryKey: contentKeys.permanentDeletionPreview(task.id) }); });
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  await userEvent.type(screen.getByRole('textbox'), '永久删除');
  const other = { ...task, id: '00000000-0000-4000-8000-000000000002', identifier: 'CT-OTHER' };
  vi.mocked(api.GET).mockResolvedValue(success({ ...preview, task_id: other.id }));
  rerender(<QueryClientProvider client={queryClient}><PermanentDeleteTaskDialog {...props} task={other} /></QueryClientProvider>);
  const dialog = await screen.findByRole('dialog', { name: '永久删除任务“CT-OTHER”' });
  expect(await within(dialog).findByRole('textbox')).toHaveValue('');
  expect(onSubmit).not.toHaveBeenCalled();
});

it('点击前缓存已失败但 React 尚未更新时也不发送旧预览', async () => {
  vi.spyOn(api, 'GET').mockResolvedValue(success());
  const { queryClient, onSubmit } = renderPreview();
  await userEvent.type(await screen.findByRole('textbox'), '永久删除');
  const query = queryClient.getQueryCache().find({ queryKey: contentKeys.permanentDeletionPreview(task.id) })!;
  act(() => {
    query.setState({ status: 'error', error: new Error('读取已失败'), errorUpdateCount: 1 });
    screen.getByRole('button', { name: '永久删除' }).click();
  });
  expect(onSubmit).not.toHaveBeenCalled();
});

it('普通删除显式重读失败不恢复；成功后不调用删除', async () => {
  const queryClient = client();
  const get = vi.spyOn(api, 'GET').mockResolvedValue(failure());
  const onRecovered = vi.fn();
  const remove = vi.spyOn(api, 'DELETE');
  render(<QueryClientProvider client={queryClient}><DeletionRecoveryDialog task={task} error={new Error('原链冲突')}
    onClose={vi.fn()} onRecovered={onRecovered} finalFocus={() => null} /></QueryClientProvider>);
  await userEvent.click(screen.getByRole('button', { name: '重新读取删除条件' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('req-preview-failure');
  expect(onRecovered).not.toHaveBeenCalled();
  get.mockResolvedValue({ data: { task }, response: Response.json({ task }) } as never);
  await userEvent.click(screen.getByRole('button', { name: '重新读取删除条件' }));
  await waitFor(() => expect(onRecovered).toHaveBeenCalledOnce());
  expect(remove).not.toHaveBeenCalled();
});

it('显式重读完成前切换主体不会恢复旧删除确认', async () => {
  const queryClient = client();
  vi.spyOn(api, 'GET').mockResolvedValue(failure());
  renderPreview(queryClient);
  await screen.findByRole('alert');
  let release!: (value: never) => void;
  vi.mocked(api.GET).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  await userEvent.click(screen.getByRole('button', { name: '重新读取删除范围' }));
  act(() => advancePrincipalEpoch(queryClient, 'different-principal'));
  await act(async () => { release(success()); });
  expect(screen.getByRole('button', { name: '永久删除' })).toBeDisabled();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
