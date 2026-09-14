import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';
import { ContentRequestError } from './content.api';

type ContentEditorContext = components['schemas']['ContentEditorContext'];
type ContentRevisionCreate = components['schemas']['ContentRevisionCreate'];
type ContentDraftUpdate = components['schemas']['ContentDraftUpdate'];
type CommandRequest = components['schemas']['CommandRequest'];
type ContentVersion = components['schemas']['ContentVersion'];
type EditorFormMode = 'manual' | 'edit' | 'revision' | 'readonly';
type EditorMutationAction =
  | 'CREATE_MANUAL_VERSION'
  | 'CREATE_REVISION'
  | 'SAVE'
  | 'SUBMIT_REVIEW'
  | 'DELETE'
  | 'ABANDON';
type ContentEditorBlockerKind = 'revision' | 'content-review-pending';

const nonBlank = (message: string) => z.string().refine(
  (value) => value.trim().length > 0,
  message,
);

const contentDocumentFormSchema = z.object({
  title: nonBlank('标题不能为空'),
  summary: nonBlank('摘要不能为空'),
  body_markdown: nonBlank('Markdown 正文不能为空'),
  tags_text: z.string().refine((value) => parseTags(value).length > 0, '至少填写一个标签'),
});

const contentEditorFormSchema = contentDocumentFormSchema.extend({
  change_summary: nonBlank('创建首稿或修订时必须填写变更说明'),
});

const contentDraftFormSchema = contentDocumentFormSchema.extend({
  change_summary: z.string(),
});

type ContentEditorFormValues = z.input<typeof contentDraftFormSchema>;
type ContentEditorField = keyof ContentEditorFormValues;

const editorFields = new Set<ContentEditorField>([
  'title',
  'summary',
  'body_markdown',
  'tags_text',
  'change_summary',
]);

function parseTags(value: string): string[] {
  return value.split('\n').map((tag) => tag.trim()).filter(Boolean);
}

function editorMode(context: ContentEditorContext): EditorFormMode {
  const content = context.current_content;
  if (!content) {
    return context.task.available_actions.includes('CREATE_MANUAL_VERSION')
      ? 'manual'
      : 'readonly';
  }
  if (
    context.task.primary_task === 'REVISE_CONTENT'
    && content.available_actions.includes('CREATE_REVISION')
  ) return 'revision';
  if (content.available_actions.includes('SAVE')) return 'edit';
  return 'readonly';
}

function editorFormValues(
  content: ContentVersion | null,
): ContentEditorFormValues {
  return {
    title: content?.title ?? '',
    summary: content?.summary ?? '',
    body_markdown: content?.body_markdown ?? '',
    tags_text: content?.tags.join('\n') ?? '',
    change_summary: '',
  };
}

function toContentRevisionCreate(values: ContentEditorFormValues): ContentRevisionCreate {
  const parsed = contentEditorFormSchema.parse(values);
  return {
    title: parsed.title,
    summary: parsed.summary,
    body_markdown: parsed.body_markdown,
    tags: parseTags(parsed.tags_text),
    change_summary: parsed.change_summary,
  } satisfies ContentRevisionCreate;
}

function toContentDraftUpdate(
  values: ContentEditorFormValues,
  expectedRevision: number,
): ContentDraftUpdate {
  const parsed = contentDraftFormSchema.parse(values);
  return {
    expected_revision: expectedRevision,
    title: parsed.title,
    summary: parsed.summary,
    body_markdown: parsed.body_markdown,
    tags: parseTags(parsed.tags_text),
  } satisfies ContentDraftUpdate;
}

function toContentCommand(expectedRevision: number, comment = ''): CommandRequest {
  return { expected_revision: expectedRevision, comment } satisfies CommandRequest;
}

function editorActionKeys(
  context: ContentEditorContext,
  mode: EditorFormMode,
): EditorMutationAction[] {
  if (mode === 'manual') return ['CREATE_MANUAL_VERSION'];
  if (mode === 'revision') return ['CREATE_REVISION'];
  const actions = context.current_content?.available_actions ?? [];
  return actions.flatMap((action): EditorMutationAction[] => {
    switch (action) {
      case 'SAVE':
      case 'CREATE_REVISION':
      case 'SUBMIT_REVIEW':
      case 'DELETE':
      case 'ABANDON':
        return [action];
      case 'CREATE_HUMANIZATION_JOB':
      case 'APPROVE':
      case 'REQUEST_CHANGES':
        return [];
      default:
        return assertNever(action);
    }
  });
}

type ContentEditorErrorMapping = {
  fields: Partial<Record<ContentEditorField, string>>;
  formMessage?: string;
  requestId?: string;
  code?: string;
  blockerKind?: ContentEditorBlockerKind;
};

function mapContentEditorError(error: unknown): ContentEditorErrorMapping {
  if (!(error instanceof ContentRequestError) || !error.detail) {
    return {
      fields: {},
      formMessage: error instanceof Error ? error.message : '内容编辑请求失败',
    };
  }
  const detail = error.detail as unknown as Record<string, unknown>;
  const code = typeof detail.code === 'string' ? detail.code : undefined;
  const message = typeof detail.message === 'string'
    ? detail.message
    : error.message || '内容编辑请求失败';
  const requestId = typeof detail.request_id === 'string' ? detail.request_id : undefined;
  const fields: Partial<Record<ContentEditorField, string>> = {};
  let hasUnknownIssue = false;
  const details = detail.details;
  const issues = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).errors
    : undefined;
  const detailsShapeValid = Boolean(
    details
    && typeof details === 'object'
    && !Array.isArray(details)
    && (issues === undefined || Array.isArray(issues)),
  );
  const issuesShapeValid = issues === undefined || (
    Array.isArray(issues)
    && issues.every((issue) => (
      issue !== null
      && typeof issue === 'object'
      && !Array.isArray(issue)
      && 'loc' in issue
      && 'msg' in issue
      && typeof issue.msg === 'string'
    ))
  );
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object') {
        hasUnknownIssue = true;
        continue;
      }
      const loc = 'loc' in issue ? issue.loc : undefined;
      const message = 'msg' in issue ? issue.msg : undefined;
      const rawField = Array.isArray(loc) && loc.length === 2 && loc[0] === 'body'
        ? loc[1]
        : undefined;
      const field = rawField === 'tags' ? 'tags_text' : rawField;
      if (
        typeof field === 'string'
        && editorFields.has(field as ContentEditorField)
        && typeof message === 'string'
      ) {
        fields[field as ContentEditorField] ??= message;
      } else {
        hasUnknownIssue = true;
      }
    }
  }
  return {
    fields,
    formMessage: Object.keys(fields).length === 0 || hasUnknownIssue
      ? message
      : undefined,
    requestId,
    code,
    blockerKind: detailsShapeValid && issuesShapeValid && requestId
      ? code === 'CONTENT_REVIEW_PENDING'
        ? 'content-review-pending'
        : code === 'REVISION_CONFLICT'
          ? 'revision'
          : undefined
      : undefined,
  };
}

function assertNever(value: never): never {
  throw new Error(`内容编辑器收到未处理的合同 token：${String(value)}`);
}

export {
  contentDraftFormSchema,
  contentEditorFormSchema,
  editorActionKeys,
  editorFormValues,
  editorMode,
  mapContentEditorError,
  parseTags,
  toContentCommand,
  toContentDraftUpdate,
  toContentRevisionCreate,
};
export type {
  ContentEditorContext,
  ContentEditorErrorMapping,
  ContentEditorField,
  ContentEditorFormValues,
  ContentEditorBlockerKind,
  EditorFormMode,
  EditorMutationAction,
};
