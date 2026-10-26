import { z } from 'zod';
import type { components } from '@/shared/api/generated/schema';

type ManualDraft = components['schemas']['GeoManualObservationDraft'];
type ManualSubmit = components['schemas']['GeoManualObservationSubmit'];
type ManualContext = components['schemas']['GeoManualEntryContext'];

const noNul = (value: string) => !value.includes('\0');
const source = (limit: number) => z.string().max(limit, `最多 ${limit} 字符`).refine(noNul, '不能包含空字符');
const explicitTimestamp = z.iso.datetime({ offset: true });
const manualFormSchema = z
  .object({
    answer_text: z.string().max(1048576, '回答超过长度上限').refine(noNul, '不能包含空字符'),
    answer_format: z.enum(['TEXT', 'MARKDOWN', 'HTML_TEXT']),
    source_product: source(160),
    source_model: source(200),
    source_version: source(200),
    web_search_observed: z.enum(['UNKNOWN', 'YES', 'NO']),
    citation_observation_status: z.enum(['UNRECORDED', 'COMPLETE', 'NONE', 'PARTIAL', 'UNKNOWN']),
    citation_missing_reason: z.string(),
    collected_at: z
      .string()
      .refine(
        (value) => value === '' || explicitTimestamp.safeParse(value).success,
        '请输入带时区的 ISO 采集时间，如 2026-10-02T10:30:00+08:00',
      ),
    screenshot_file_id: z.uuid().nullable(),
    raw_payload_file_id: z.uuid().nullable(),
    citations: z
      .array(
        z.object({
          original_url: z.string().min(1, '请输入引用 URL').max(2083, 'URL 超过长度上限'),
          title: z.string().max(2000, '标题最多 2000 字符'),
          position: z.number().int('位置必须为整数').min(1, '位置从 1 开始').max(1000, '位置不得超过 1000'),
        }),
      )
      .max(1000, '最多 1000 条引用'),
  })
  .superRefine((values, context) => {
    const status = values.citation_observation_status;
    if (['PARTIAL', 'UNKNOWN'].includes(status)) {
      if (!values.citation_missing_reason.trim())
        context.addIssue({ code: 'custom', path: ['citation_missing_reason'], message: '请说明引用缺失或无法判断的原因' });
      if (values.citation_missing_reason.length > 2000 || !noNul(values.citation_missing_reason))
        context.addIssue({ code: 'custom', path: ['citation_missing_reason'], message: '原因最多 2000 字符，不能包含空字符' });
    }
    if (status === 'COMPLETE' && !values.citations.length)
      context.addIssue({ code: 'custom', path: ['citation_observation_status'], message: '完整记录需要至少一条引用；确认没有请选“确认无引用”' });
    if (['NONE', 'UNKNOWN'].includes(status) && values.citations.length)
      context.addIssue({ code: 'custom', path: ['citation_observation_status'], message: '已有引用，请选择完整记录或部分缺失；不会自动删除引用' });
    const positions = new Set<number>();
    values.citations.forEach((citation, index) => {
      if (positions.has(citation.position))
        context.addIssue({ code: 'custom', path: ['citations', index, 'position'], message: '引用位置不能重复' });
      positions.add(citation.position);
    });
  });
type ManualValues = z.infer<typeof manualFormSchema>;

function manualValues(draft?: ManualDraft | null): ManualValues {
  return {
    answer_text: draft?.answer_text ?? '',
    answer_format: draft?.answer_format ?? 'TEXT',
    source_product: draft?.source_product ?? '',
    source_model: draft?.source_model ?? '',
    source_version: draft?.source_version ?? '',
    web_search_observed: draft?.web_search_observed == null ? 'UNKNOWN' : draft.web_search_observed ? 'YES' : 'NO',
    citation_observation_status: draft?.citation_observation?.status ?? 'UNRECORDED',
    citation_missing_reason: draft?.citation_observation?.missing_reason ?? '',
    collected_at: draft?.collected_at ?? '',
    screenshot_file_id: draft?.screenshot_file_id ?? null,
    raw_payload_file_id: draft?.raw_payload_file_id ?? null,
    citations: (draft?.citations ?? []).map((citation) => ({
      original_url: citation.original_url,
      title: citation.title ?? '',
      position: citation.position,
    })),
  };
}
function manualDraft(values: ManualValues, retained?: ManualDraft | null): ManualDraft {
  return {
    citation_observation: values.citation_observation_status === 'UNRECORDED' ? null : {
      status: values.citation_observation_status,
      missing_reason: ['PARTIAL', 'UNKNOWN'].includes(values.citation_observation_status)
        ? values.citation_missing_reason : null,
    },
    answer_text: values.answer_text,
    answer_format: values.answer_format,
    source_product: values.source_product.trim() || null,
    source_model: values.source_model.trim() || null,
    source_version: values.source_version.trim() || null,
    web_search_observed: values.web_search_observed === 'UNKNOWN' ? null : values.web_search_observed === 'YES',
    collected_at: values.collected_at || null,
    screenshot_file_id: values.screenshot_file_id,
    raw_payload_file_id: values.raw_payload_file_id,
    // 更换或移除文件后不沿用旧摘要；省略时由协议恢复默认未知摘要。
    raw_payload_summary: values.raw_payload_file_id === (retained?.raw_payload_file_id ?? null)
      ? retained?.raw_payload_summary : undefined,
    citations: values.citations.map((citation) => ({
      ...citation,
      title: citation.title || null,
      extraction_source: 'MANUAL',
    })),
  };
}
function manualSubmit(values: ManualValues, revision: number, retained?: ManualDraft | null): ManualSubmit {
  return { ...manualDraft(values, retained), collected_at: values.collected_at, expected_draft_revision: revision };
}
function manualSubmissionIssues(values: ManualValues, requireScreenshot: boolean) {
  const issues: { field: 'answer_text' | 'collected_at' | 'screenshot_file_id' | 'citation_observation_status'; message: string }[] = [];
  if (!values.answer_text.trim()) issues.push({ field: 'answer_text', message: '正式提交必须包含非空回答' });
  if (!values.collected_at) issues.push({ field: 'collected_at', message: '请明确填写实际采集时间及其时区' });
  if (!values.screenshot_file_id && (requireScreenshot || !values.raw_payload_file_id))
    issues.push({
      field: 'screenshot_file_id',
      message: requireScreenshot ? '冻结配置要求截图，请先上传并完成校验' : '正式提交需要截图或原始文本证据',
    });
  if (values.citation_observation_status === 'UNRECORDED')
    issues.push({ field: 'citation_observation_status', message: '正式提交前请明确选择引用观察状态' });
  return issues;
}
function shouldBlockManualNavigation(
  current: { pathname: string; search: unknown },
  next: { pathname: string; search: unknown },
) {
  const currentSearch = current.search as Record<string, unknown>;
  const nextSearch = next.search as Record<string, unknown>;
  return (
    current.pathname !== next.pathname ||
    currentSearch.run_id !== nextSearch.run_id ||
    currentSearch.edit !== nextSearch.edit
  );
}
function screenshotIssue(file: Pick<File, 'type' | 'size'>) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return '截图仅支持 PNG、JPEG、WEBP';
  if (file.size === 0 || file.size > 10 * 1024 * 1024) return '截图大小必须大于 0 且不超过 10 MiB';
  return undefined;
}
function rawTextIssue(file: Pick<File, 'type' | 'size'>) {
  if (file.type !== 'text/plain') return '原始文本证据仅支持 text/plain 纯文本文件';
  if (file.size === 0 || file.size > 50 * 1024 * 1024) return '原始文本证据大小必须大于 0 且不超过 50 MiB';
  return undefined;
}

export {
  manualDraft,
  manualFormSchema,
  manualSubmissionIssues,
  manualSubmit,
  manualValues,
  screenshotIssue,
  rawTextIssue,
  shouldBlockManualNavigation,
};
export type { ManualContext, ManualDraft, ManualSubmit, ManualValues };
