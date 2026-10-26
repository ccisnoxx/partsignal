import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { CitationObservationSummary } from './citation-observation';
import { context, draftOut, initialDraft, renderEditor, response, failure, runId } from './manual.test-support';

import { runKeys } from './runs.api';

afterEach(() => vi.restoreAllMocks());
describe('引用观察事实', () => {
  it('旧记录明确未记录，缺失原因按原文只读呈现', () => {
    const { rerender } = render(<CitationObservationSummary observation={null} />);
    expect(screen.getByText('引用观察状态：未记录')).toBeVisible();
    expect(screen.getByText(/不能据引用数量推测/)).toBeVisible();
    rerender(<CitationObservationSummary observation={{ status: 'PARTIAL', missing_reason: '<script>未展开来源</script>' }} />);
    expect(screen.getByText('引用缺失原因：<script>未展开来源</script>')).toBeVisible();
    expect(document.querySelector('script')).toBeNull();
  });
  it('已展开的引用选择在后台读取失败后停止接受更改', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const { client } = renderEditor();
    const user = userEvent.setup();
    const status = await screen.findByLabelText('引用观察状态');
    await user.click(status);
    const option = await screen.findByRole('option', { name: '引用部分缺失' });
    get.mockResolvedValue(failure('FORBIDDEN', 403));
    await act(async () => { await client.refetchQueries({ queryKey: runKeys.manual(runId), exact: true }); });
    expect(status).toBeDisabled();
    if (option.isConnected) await user.click(option);
    expect(status).toHaveTextContent('确认无引用');
    expect(screen.queryByLabelText('引用缺失原因')).not.toBeInTheDocument();
  });
  it('旧草稿不会自动确认无引用，提交前必须选择，保存保留缺失原因及证据', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context({ draft: draftOut({ ...initialDraft, citation_observation: null }) })));
    const post = vi.spyOn(api, 'POST');
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(response(draftOut(initialDraft, 4)));
    renderEditor();
    const user = userEvent.setup();
    const status = await screen.findByLabelText('引用观察状态');
    expect(status).toHaveTextContent('未记录');
    await user.click(screen.getByRole('button', { name: '正式提交人工观测' }));
    expect(await screen.findAllByText('正式提交前请明确选择引用观察状态')).not.toHaveLength(0);
    expect(post).not.toHaveBeenCalled();
    await user.click(status);
    await user.click(await screen.findByRole('option', { name: '引用部分缺失' }));
    await user.type(screen.getByLabelText('引用缺失原因'), '来源面板只显示部分');
    await user.click(screen.getByRole('button', { name: '保存人工草稿' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/api/v1/geo/observation-runs/{run_id}/manual-draft', expect.objectContaining({
      body: expect.objectContaining({ draft: expect.objectContaining({
        citation_observation: { status: 'PARTIAL', missing_reason: '来源面板只显示部分' },
        screenshot_file_id: initialDraft.screenshot_file_id,
        raw_payload_file_id: initialDraft.raw_payload_file_id,
      }) }),
    }));
  });
});
