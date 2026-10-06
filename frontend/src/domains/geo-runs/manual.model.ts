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
    collected_at: z
      .string()
      .refine(
        (value) => value === '' || explicitTimestamp.safeParse(value).success,
        '请输入带时区的 ISO 采集时间，如 2026-10-02T10:30:00+08:00',
      ),
    screenshot_file_id: z.uuid().nullable(),
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
    collected_at: draft?.collected_at ?? '',
    screenshot_file_id: draft?.screenshot_file_id ?? null,
    citations: (draft?.citations ?? []).map((citation) => ({
      original_url: citation.original_url,
      title: citation.title ?? '',
      position: citation.position,
    })),
  };
}
function manualDraft(values: ManualValues, retained?: ManualDraft | null): ManualDraft {
  return {
    answer_text: values.answer_text,
    answer_format: values.answer_format,
    source_product: values.source_product.trim() || null,
    source_model: values.source_model.trim() || null,
    source_version: values.source_version.trim() || null,
    web_search_observed: values.web_search_observed === 'UNKNOWN' ? null : values.web_search_observed === 'YES',
    collected_at: values.collected_at || null,
    screenshot_file_id: values.screenshot_file_id,
    raw_payload_file_id: retained?.raw_payload_file_id,
    raw_payload_summary: retained?.raw_payload_summary,
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
function manualSubmissionIssues(values: ManualValues, requireScreenshot: boolean, retained?: ManualDraft | null) {
  const issues: { field: 'answer_text' | 'collected_at' | 'screenshot_file_id'; message: string }[] = [];
  if (!values.answer_text.trim()) issues.push({ field: 'answer_text', message: '正式提交必须包含非空回答' });
  if (!values.collected_at) issues.push({ field: 'collected_at', message: '请明确填写实际采集时间及其时区' });
  if (!values.screenshot_file_id && (requireScreenshot || !retained?.raw_payload_file_id))
    issues.push({
      field: 'screenshot_file_id',
      message: requireScreenshot ? '冻结配置要求截图，请先上传并完成校验' : '正式提交需要截图或已有原始证据',
    });
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
function screenshotIssue(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return '截图仅支持 PNG、JPEG、WEBP';
  if (file.size === 0 || file.size > 10 * 1024 * 1024) return '截图大小必须大于 0 且不超过 10 MiB';
  return undefined;
}

export {
  manualDraft,
  manualFormSchema,
  manualSubmissionIssues,
  manualSubmit,
  manualValues,
  screenshotIssue,
  shouldBlockManualNavigation,
};
export type { ManualContext, ManualDraft, ManualSubmit, ManualValues };
