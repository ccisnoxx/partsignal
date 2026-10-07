import { describe, expect, it } from 'vitest';
import {
  manualDraft,
  manualFormSchema,
  manualSubmissionIssues,
  manualSubmit,
  manualValues,
  screenshotIssue,
  shouldBlockManualNavigation,
  type ManualDraft,
} from './manual.model';

describe('人工采集表单模型', () => {
  it('未知来源、搜索和时间保持未知，转换保留只读原始证据与摘要', () => {
    const retained: ManualDraft = {
      answer_text: '已有回答',
      answer_format: 'HTML_TEXT',
      raw_payload_file_id: '10000000-0000-4000-8000-000000000001',
      raw_payload_summary: { schema_version: 1, payload_format: 'TEXT', payload_bytes: 12, finish_reason: null },
    };
    const values = manualValues(retained);
    expect(values.web_search_observed).toBe('UNKNOWN');
    expect(values.collected_at).toBe('');
    values.answer_text = '最后一次编辑';
    expect(manualDraft(values, retained)).toMatchObject({
      answer_text: '最后一次编辑',
      source_product: null,
      web_search_observed: null,
      collected_at: null,
      raw_payload_file_id: retained.raw_payload_file_id,
      raw_payload_summary: retained.raw_payload_summary,
    });
    expect(manualSubmit({ ...values, collected_at: '2026-10-02T10:30:00+08:00' }, 7, retained)).toMatchObject({
      expected_draft_revision: 7,
      answer_text: '最后一次编辑',
      collected_at: '2026-10-02T10:30:00+08:00',
    });
  });
  it('草稿时间可空，填写时必须是有效 ISO 带时区；正式提交显式要求采集事实', () => {
    const values = manualValues();
    expect(manualFormSchema.safeParse(values).success).toBe(true);
    for (const collected_at of ['2026-10-02T10:30', '2026-02-30T10:30:00Z', '随便'])
      expect(manualFormSchema.safeParse({ ...values, collected_at }).success).toBe(false);
    expect(manualFormSchema.safeParse({ ...values, collected_at: '2026-10-02T10:30:00+08:00' }).success).toBe(true);
    expect(manualSubmissionIssues(values, true).map((issue) => issue.field)).toEqual([
      'answer_text',
      'collected_at',
      'screenshot_file_id',
    ]);
  });
  it('引用保留原 URL 和实际位置，重复实际位置在表单边界显式失败', () => {
    const values = {
      ...manualValues(),
      citations: [
        { original_url: 'https://example.com/?utm_source=source', title: '', position: 5 },
        { original_url: 'https://example.com/', title: '同一来源', position: 2 },
      ],
    };
    expect(manualDraft(values).citations).toEqual([
      { ...values.citations[0], title: null, extraction_source: 'MANUAL' },
      { ...values.citations[1], extraction_source: 'MANUAL' },
    ]);
    expect(
      manualFormSchema.safeParse({
        ...values,
        citations: values.citations.map((citation) => ({ ...citation, position: 2 })),
      }).success,
    ).toBe(false);
  });
  it('筛选导航不改变编辑身份，run、edit、pathname 变化需要保护', () => {
    const current = { pathname: '/geo/runs', search: { run_id: 'one', edit: 1, q: '旧筛选' } };
    expect(shouldBlockManualNavigation(current, { ...current, search: { run_id: 'one', edit: 1, q: '新筛选' } })).toBe(
      false,
    );
    expect(shouldBlockManualNavigation(current, { ...current, search: { run_id: 'two', edit: 1 } })).toBe(true);
    expect(shouldBlockManualNavigation(current, { ...current, search: { run_id: 'one' } })).toBe(true);
    expect(shouldBlockManualNavigation(current, { ...current, pathname: '/geo/plans' })).toBe(true);
  });
  it('截图类型和大小严格限制在实际支持的边界', () => {
    expect(screenshotIssue(new File(['proof'], 'proof.png', { type: 'image/png' }))).toBeUndefined();
    expect(screenshotIssue(new File(['<svg/>'], 'proof.svg', { type: 'image/svg+xml' }))).toContain('仅支持');
    expect(screenshotIssue(new File([], 'empty.png', { type: 'image/png' }))).toContain('大于 0');
    expect(screenshotIssue({ type: 'image/webp', size: 10 * 1024 * 1024 + 1 } as File)).toContain('10 MiB');
  });
});
