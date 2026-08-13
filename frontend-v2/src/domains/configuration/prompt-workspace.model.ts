import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';
import { PromptRequestError } from './prompt.api';

type PlatformPromptCreate = components['schemas']['PlatformPromptCreate'];
type PlatformPromptDetail = components['schemas']['PlatformPromptDetail'];
type PlatformPromptUpdate = components['schemas']['PlatformPromptUpdate'];

function normalizedSearchText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}

function normalizedPromptId(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return z.uuid().safeParse(trimmed).success ? trimmed.toLocaleLowerCase() : undefined;
}

const promptWorkspaceSearchSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const q = normalizedSearchText(raw.q);
  const promptId = normalizedPromptId(raw.promptId);
  const creating = raw.new === 1 || raw.new === '1';
  return {
    ...(q ? { q } : {}),
    ...(creating ? { new: 1 } : promptId ? { promptId } : {}),
  };
}, z.object({
  q: z.string().max(200).optional(),
  promptId: z.uuid().optional(),
  new: z.literal(1).optional(),
}));

type PromptWorkspaceSearch = z.output<typeof promptWorkspaceSearchSchema>;

function canonicalPromptWorkspaceSearchRecord(
  search: PromptWorkspaceSearch,
): Record<string, string | number> {
  return {
    ...(search.q ? { q: search.q } : {}),
    ...(search.new === 1
      ? { new: 1 }
      : search.promptId ? { promptId: search.promptId } : {}),
  };
}

function isCanonicalPromptWorkspaceSearch(
  raw: Record<string, unknown>,
  search: PromptWorkspaceSearch,
) {
  const expected = canonicalPromptWorkspaceSearchRecord(search);
  const keys = Object.keys(expected);
  return Object.keys(raw).length === keys.length
    && keys.every((key) => raw[key] === expected[key]);
}

function promptEditorIdentity(search: Pick<PromptWorkspaceSearch, 'new' | 'promptId'>) {
  if (search.new === 1) return 'new';
  return search.promptId ? `prompt:${search.promptId}` : 'none';
}

function shouldBlockPromptWorkspaceNavigation(
  current: { pathname: string; search: unknown },
  next: { pathname: string; search: unknown },
) {
  if (current.pathname !== next.pathname) return true;
  const currentSearch = promptWorkspaceSearchSchema.parse(current.search);
  const nextSearch = promptWorkspaceSearchSchema.parse(next.search);
  return promptEditorIdentity(currentSearch) !== promptEditorIdentity(nextSearch);
}

const promptFormSchema = z.object({
  name: z.string().trim().min(1, '请输入 Prompt 名称').max(300, 'Prompt 名称不能超过 300 个字符'),
  template_markdown: z.string().refine((value) => value.trim().length > 0, '请输入非空 Markdown'),
});

type PromptFormValues = z.infer<typeof promptFormSchema>;

function promptFormValues(prompt?: PlatformPromptDetail): PromptFormValues {
  return {
    name: prompt?.name ?? '',
    template_markdown: prompt?.template_markdown ?? '',
  };
}

function toPlatformPromptCreate(values: PromptFormValues): PlatformPromptCreate {
  return {
    name: values.name.trim(),
    template_markdown: values.template_markdown.trim(),
  };
}

function toPlatformPromptUpdate(
  values: PromptFormValues,
  expectedRevision: number,
): PlatformPromptUpdate {
  return { ...toPlatformPromptCreate(values), expected_revision: expectedRevision };
}

function resolvePromptActions(prompt: PlatformPromptDetail) {
  let canUpdate = false;
  let canDelete = false;
  const seen = new Set<string>();
  for (const action of prompt.available_actions as string[]) {
    if (seen.has(action)) throw new Error(`Platform Prompt API 返回重复动作：${action}`);
    seen.add(action);
    if (action === 'UPDATE') canUpdate = true;
    else if (action === 'DELETE') canDelete = true;
    else throw new Error(`Platform Prompt API 返回未知动作：${action}`);
  }
  return { canDelete, canUpdate };
}

function mapPromptFormError(error: unknown) {
  if (!(error instanceof PromptRequestError) || !error.detail) {
    return { fields: {}, formMessage: error instanceof Error ? error.message : 'Prompt 请求失败' };
  }
  const fields: Partial<Record<keyof PromptFormValues, string>> = {};
  const issues = error.detail.details.errors;
  let unknownIssue = false;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object') {
        unknownIssue = true;
        continue;
      }
      const loc = 'loc' in issue ? issue.loc : undefined;
      const message = 'msg' in issue ? issue.msg : undefined;
      const field = Array.isArray(loc) && loc.length === 2 && loc[0] === 'body' ? loc[1] : undefined;
      if (field === 'name' && typeof message === 'string') fields.name ??= message;
      else if (field === 'template_markdown' && typeof message === 'string') {
        fields.template_markdown ??= message;
      } else {
        unknownIssue = true;
      }
    }
  }
  if (error.detail.code === 'PLATFORM_PROMPT_NAME_EXISTS' && !fields.name) {
    fields.name = error.detail.message;
  }
  return {
    code: error.detail.code,
    fields,
    formMessage: Object.keys(fields).length === 0 || unknownIssue ? error.detail.message : undefined,
    requestId: error.detail.request_id,
  };
}

function promptDetailErrorKind(error: unknown): 'not-found' | 'forbidden' | 'generic' {
  if (!(error instanceof PromptRequestError)) return 'generic';
  if (error.status === 404) return 'not-found';
  if (error.status === 403) return 'forbidden';
  return 'generic';
}

export {
  canonicalPromptWorkspaceSearchRecord,
  isCanonicalPromptWorkspaceSearch,
  mapPromptFormError,
  promptDetailErrorKind,
  promptEditorIdentity,
  promptFormSchema,
  promptFormValues,
  promptWorkspaceSearchSchema,
  resolvePromptActions,
  shouldBlockPromptWorkspaceNavigation,
  toPlatformPromptCreate,
  toPlatformPromptUpdate,
};
export type { PlatformPromptDetail, PromptFormValues, PromptWorkspaceSearch };
