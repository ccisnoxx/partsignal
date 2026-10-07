import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { analyzedDetail, analysisId, claimId, factId, reviewReceipt } from './analysis.test-support';
import { detail } from './runs.test-support';
import { RunAnalysis } from './run-analysis';

describe('单 detail 分析可追溯展示', () => {
  it('原机器与有效声明独立显示，FactVersion、摘录、解释和引用分类可追溯', () => {
    const value = analyzedDetail();
    value.analysis.effective_results = { ...value.analysis.effective_results!, claims: [{ ...value.analysis.revisions[0]!.claims[0]!, explanation: '人工修正后的解释', severity: 'MEDIUM' }] };
    render(<RunAnalysis detail={value} />);
    const machine = screen.getByRole('region', { name: '机器声明结果' });
    const effective = screen.getByRole('region', { name: '有效声明结果' });
    expect(machine).toHaveTextContent('额定电压为5V'); expect(machine).toHaveTextContent(factId);
    expect(machine).toHaveTextContent('额定电压为3.3V'); expect(machine).toHaveTextContent('INCORRECT · HIGH');
    expect(machine).toHaveTextContent('回答电压与批准事实不符'); expect(machine).not.toHaveTextContent('人工修正后的解释');
    expect(effective).toHaveTextContent('人工修正后的解释'); expect(effective).toHaveTextContent('MEDIUM');
    expect(screen.getByRole('region', { name: '机器提及结果' })).toHaveTextContent('原文定位：型号A推荐使用');
    expect(screen.getByRole('region', { name: '机器引用分类' })).toHaveTextContent('https://example.test/spec');
  });
  it('历史 analysis/review 只读，当前标识只来自 selection，不以顺序或 is_current 猜测', async () => {
    const value = analyzedDetail(); const current = value.analysis.revisions[0]!;
    value.analysis.revisions.unshift({ ...current, analysis: { ...current.analysis, id: factId, revision: 2 } });
    const review = reviewReceipt().review;
    review.decision = 'CORRECTED'; review.comment = '保留历史修正原因'; review.correction_payload = { schema_version: 1, mentions: [], recommendations: [], claims: [{ claim_assessment_id: claimId, verdict: 'INCORRECT', severity: 'HIGH', explanation: '历史修正的解释' }], citations: [] };
    value.analysis.reviews = [{ review, is_current: true }];
    // 当前 review pointer 为空，历史 item 的展示旗标不得成为另一份 current owner。
    value.analysis.selection.current_review_id = null;
    render(<RunAnalysis detail={value} />);
    expect(screen.getByRole('region', { name: '当前机器分析' })).toHaveTextContent(analysisId);
    const history = screen.getByRole('region', { name: '分析与复核历史，只读' });
    await userEvent.click(within(history).getByText(/复核 CORRECTED · 历史/));
    expect(history).toHaveTextContent('保留历史修正原因'); expect(history).toHaveTextContent('历史修正的解释');
    expect(within(history).queryByRole('button')).not.toBeInTheDocument();
    expect(within(history).queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('没有成功分析时保留真实空状态，不选历史revision代替当前或推断指标', () => {
    const value = detail();
    render(<RunAnalysis detail={value} />);
    expect(screen.getByText(/尚无当前成功分析/)).toBeVisible();
    expect(screen.getByText('尚无分析 revision。')).toBeVisible();
    expect(screen.getByText('尚无人工复核记录。')).toBeVisible();
    expect(screen.queryByRole('region', { name: '当前有效结果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始人工复核' })).not.toBeInTheDocument();
  });
});
