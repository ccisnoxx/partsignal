import { describe, expect, it } from 'vitest';
import {
  manualDraft,
  manualFormSchema,
  manualSubmissionIssues,
  manualSubmit,
  manualValues,
  screenshotIssue,
  rawTextIssue,
  shouldBlockManualNavigation,
  type ManualDraft,
} from './manual.model';

describe('人工采集表单模型', () => {
  it('未知来源、搜索和时间保持未知，未变更的原始证据与摘要保留', () => {
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
  it('新文本关联和显式移除使用本地值，不把旧文件摘要带给新文件', () => {
    const retained: ManualDraft = {
      answer_text: '',
      answer_format: 'TEXT',
      raw_payload_file_id: '10000000-0000-4000-8000-000000000001',
      raw_payload_summary: { schema_version: 1, payload_format: 'JSON', payload_bytes: 99, finish_reason: 'LENGTH' },
    };
    const values = manualValues(retained);
    values.raw_payload_file_id = '10000000-0000-4000-8000-000000000002';
    expect(manualDraft(values, retained).raw_payload_file_id).toBe(values.raw_payload_file_id);
    expect(manualDraft(values, retained).raw_payload_summary).toBeUndefined();
    values.raw_payload_file_id = null;
    expect(manualSubmit(values, 3, retained)).toMatchObject({ raw_payload_file_id: null });
    expect(manualDraft(values, retained).raw_payload_summary).toBeUndefined();
  });
  it('新文本可满足无强制截图的证据要求，移除旧文本不再满足；强制截图不变', () => {
    const values = manualValues({ answer_text: '', answer_format: 'TEXT', raw_payload_file_id: '10000000-0000-4000-8000-000000000001' });
    const fileIssues = (required: boolean) => manualSubmissionIssues(values, required).filter((issue) => issue.field === 'screenshot_file_id');
    expect(fileIssues(false)).toHaveLength(0);
    expect(fileIssues(true)).toHaveLength(1);
    values.raw_payload_file_id = null;
    expect(fileIssues(false)).toHaveLength(1);
    values.raw_payload_file_id = '10000000-0000-4000-8000-000000000002';
    expect(fileIssues(false)).toHaveLength(0);
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
      'citation_observation_status',
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
  it('显式观察声明校验数量与原因，未知草稿保持未知', () => {
    const values = manualValues();
    expect(values.citation_observation_status).toBe('UNRECORDED');
    expect(manualDraft(values).citation_observation).toBeNull();
    expect(manualFormSchema.safeParse({ ...values, citation_observation_status: 'COMPLETE' }).success).toBe(false);
    expect(manualFormSchema.safeParse({ ...values, citation_observation_status: 'PARTIAL' }).success).toBe(false);
    const partial = { ...values, citation_observation_status: 'PARTIAL' as const, citation_missing_reason: '列表未展开' };
    expect(manualFormSchema.safeParse(partial).success).toBe(true);
    expect(manualDraft(partial).citation_observation).toEqual({ status: 'PARTIAL', missing_reason: '列表未展开' });
    const none = { ...partial, citation_observation_status: 'NONE' as const };
    expect(manualDraft(none).citation_observation).toEqual({ status: 'NONE', missing_reason: null });
    // 切换为无引用后，隐藏的原因保留在本地但不会随命令发送或阻止提交。
    expect(manualFormSchema.safeParse({ ...none, citation_missing_reason: '\0' + 'x'.repeat(2001) }).success).toBe(true);
    expect(manualFormSchema.safeParse({ ...partial, citation_missing_reason: 'x'.repeat(2001) }).success).toBe(false);
    expect(manualFormSchema.safeParse({ ...none, citations: [{ original_url: 'https://example.test/a', title: '', position: 1 }] }).success).toBe(false);
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
  it('原始文本要求显式text/plain和1..50MiB，不按后缀猜类型', () => {
    expect(rawTextIssue({ type: 'text/plain', size: 1 })).toBeUndefined();
    expect(rawTextIssue({ type: 'text/plain', size: 50 * 1024 * 1024 })).toBeUndefined();
    expect(rawTextIssue({ type: 'text/plain', size: 0 })).toContain('大于 0');
    expect(rawTextIssue({ type: 'text/plain', size: 50 * 1024 * 1024 + 1 })).toContain('50 MiB');
    expect(rawTextIssue(new File(['body'], 'raw.txt', { type: '' }))).toContain('text/plain');
    expect(rawTextIssue({ type: 'application/json', size: 5 })).toContain('text/plain');
  });
});
