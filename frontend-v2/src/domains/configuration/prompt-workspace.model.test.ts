import { describe, expect, it } from 'vitest';

import { PromptRequestError } from './prompt.api';
import {
  canonicalPromptWorkspaceSearchRecord,
  isCanonicalPromptWorkspaceSearch,
  mapPromptFormError,
  promptFormSchema,
  promptFormValues,
  promptWorkspaceSearchSchema,
  resolvePromptActions,
  shouldBlockPromptWorkspaceNavigation,
  toPlatformPromptCreate,
  toPlatformPromptUpdate,
  type PlatformPromptDetail,
} from './prompt-workspace.model';

const prompt: PlatformPromptDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '技术文章 Prompt',
  template_markdown: '# 写作约束',
  revision: 4,
  updated_at: '2026-08-12T00:00:00Z',
  updated_by: '00000000-0000-4000-8000-000000000002',
  created_at: '2026-08-01T00:00:00Z',
  bound_platform_count: 1,
  bound_platforms: [{
    id: '00000000-0000-4000-8000-000000000003',
    name: '工程师社区',
    slug: 'engineer-community',
  }],
  available_actions: ['UPDATE', 'DELETE'],
};

describe('Prompt Workspace model', () => {
  it('规范化 q/promptId/new，并由 new 覆盖 promptId', () => {
    const parsed = promptWorkspaceSearchSchema.parse({
      q: '  技术  ',
      promptId: prompt.id.toLocaleUpperCase(),
      new: '1',
      ignored: 'x',
    });
    expect(parsed).toEqual({ q: '技术', new: 1 });
    expect(canonicalPromptWorkspaceSearchRecord(parsed)).toEqual({ q: '技术', new: 1 });
    expect(isCanonicalPromptWorkspaceSearch({ q: '技术', new: 1 }, parsed)).toBe(true);
    expect(isCanonicalPromptWorkspaceSearch({ q: ' 技术 ', new: '1' }, parsed)).toBe(false);

    expect(promptWorkspaceSearchSchema.parse({
      q: 'x'.repeat(201),
      promptId: 'not-a-uuid',
      new: 'yes',
    })).toEqual({});
  });

  it('dirty 时只允许同路径、同编辑身份的 q-only 导航', () => {
    const current = { pathname: '/settings/prompts', search: { promptId: prompt.id, q: 'a' } };
    expect(shouldBlockPromptWorkspaceNavigation(current, {
      pathname: current.pathname,
      search: { promptId: prompt.id, q: 'b' },
    })).toBe(false);
    expect(shouldBlockPromptWorkspaceNavigation(current, {
      pathname: current.pathname,
      search: { new: '1', q: 'b' },
    })).toBe(true);
    expect(shouldBlockPromptWorkspaceNavigation(current, {
      pathname: '/products',
      search: {},
    })).toBe(true);
  });

  it('表单只提交 canonical Markdown 与当前 revision', () => {
    expect(promptFormValues(prompt)).toEqual({
      name: prompt.name,
      template_markdown: prompt.template_markdown,
    });
    const values = promptFormSchema.parse({ name: '  新 Prompt  ', template_markdown: '  # 正文  ' });
    expect(toPlatformPromptCreate(values)).toEqual({ name: '新 Prompt', template_markdown: '# 正文' });
    expect(toPlatformPromptUpdate(values, 4)).toEqual({
      name: '新 Prompt',
      template_markdown: '# 正文',
      expected_revision: 4,
    });
    expect(promptFormSchema.safeParse({ name: '', template_markdown: '  ' }).success).toBe(false);
  });

  it('动作严格拒绝重复和未知 token', () => {
    expect(resolvePromptActions(prompt)).toEqual({ canDelete: true, canUpdate: true });
    expect(() => resolvePromptActions({
      ...prompt,
      available_actions: ['UPDATE', 'UPDATE'],
    })).toThrow('重复动作');
    expect(() => resolvePromptActions({
      ...prompt,
      available_actions: ['UNKNOWN' as never],
    })).toThrow('未知动作');
  });

  it('服务端字段错误与 name conflict 精确映射，revision conflict 保留 code', () => {
    expect(mapPromptFormError(new PromptRequestError('重复', 409, {
      code: 'PLATFORM_PROMPT_NAME_EXISTS',
      message: 'Prompt 名称已存在',
      details: {},
      request_id: 'req-name',
    }))).toMatchObject({
      code: 'PLATFORM_PROMPT_NAME_EXISTS',
      fields: { name: 'Prompt 名称已存在' },
      requestId: 'req-name',
    });
    expect(mapPromptFormError(new PromptRequestError('冲突', 409, {
      code: 'REVISION_CONFLICT',
      message: 'Prompt 已变化',
      details: {},
      request_id: 'req-revision',
    }))).toMatchObject({
      code: 'REVISION_CONFLICT',
      formMessage: 'Prompt 已变化',
      requestId: 'req-revision',
    });
  });
});
