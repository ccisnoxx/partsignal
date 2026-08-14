import { describe, expect, it } from 'vitest';

import {
  aiChannelSearchSchema,
  aiChannelSearchToApiParams,
  canonicalAIChannelSearchRecord,
  isCanonicalAIChannelSearch,
  resolveAIChannelOverflowActions,
  resolveAIChannelPrimaryAction,
  type AIChannelSummary,
} from './ai-channel-list.model';

function channel(overrides: Partial<AIChannelSummary> = {}): AIChannelSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: '生产 OpenAI',
    description: '内容生成主渠道',
    protocol_type: 'openai-compatible-chat-completions',
    provider_brand: 'OPENAI',
    is_enabled: true,
    api_key_configured: true,
    header_count: 1,
    model_count: 3,
    enabled_model_count: 2,
    latest_test_status: 'PASSED',
    last_tested_at: '2026-08-14T08:00:00Z',
    configuration_status: 'READY',
    workflow_stage: 'RUNNING',
    primary_task: 'VIEW_RUNTIME',
    available_actions: [
      'UPDATE', 'REPLACE_API_KEY', 'DISABLE', 'DELETE', 'DISCOVER_MODELS',
      'CREATE_HEADER', 'CREATE_MODEL',
    ],
    revision: 4,
    ...overrides,
  };
}

describe('AI 渠道列表 URL 与动作模型', () => {
  it('生成显式分页并把 URL provider/pageSize 映射到 API 参数', () => {
    const defaults = aiChannelSearchSchema.parse({});
    expect(defaults).toEqual({ page: 1, pageSize: 20 });
    expect(canonicalAIChannelSearchRecord(defaults)).toEqual({ page: 1, pageSize: 20 });

    const parsed = aiChannelSearchSchema.parse({
      q: '  OpenAI  ',
      status: 'ENABLED',
      provider: 'OPENAI',
      sort: 'NAME_ASC',
      page: '2',
      pageSize: '50',
    });
    expect(aiChannelSearchToApiParams(parsed)).toEqual({
      q: 'OpenAI',
      status: 'ENABLED',
      provider_brand: 'OPENAI',
      sort: 'NAME_ASC',
      page: 2,
      page_size: 50,
    });
  });

  it('非法值和未知参数需要 canonical replace', () => {
    const parsed = aiChannelSearchSchema.parse({
      status: 'UNKNOWN', provider: 'UNKNOWN', sort: 'UNKNOWN', page: '-1', pageSize: '100',
    });
    expect(parsed).toEqual({ page: 1, pageSize: 20 });
    expect(isCanonicalAIChannelSearch({ page: '-1', extra: 'x' }, parsed)).toBe(false);
    expect(isCanonicalAIChannelSearch({ page: '1', pageSize: '20' }, parsed)).toBe(true);
  });

  it('穷尽映射 primary/overflow 并过滤重复启用动作', () => {
    expect(resolveAIChannelPrimaryAction(channel())).toMatchObject({
      label: '查看运行',
      href: '/settings/ai/00000000-0000-4000-8000-000000000001?tab=usage',
    });
    const disabled = channel({
      is_enabled: false,
      workflow_stage: 'READY_TO_ENABLE',
      primary_task: 'ENABLE_CHANNEL',
      available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
    });
    expect(resolveAIChannelPrimaryAction(disabled)).toMatchObject({
      label: '启用渠道', command: 'enable-channel',
    });
    expect(resolveAIChannelOverflowActions(disabled, false).map((action) => action.key))
      .toEqual(['UPDATE', 'DELETE']);
  });

  it('未知服务端 token 明确失败', () => {
    expect(() => resolveAIChannelPrimaryAction(channel({
      primary_task: 'UNKNOWN' as AIChannelSummary['primary_task'],
    }))).toThrow('未处理的合同 token');
    expect(() => resolveAIChannelOverflowActions(channel({
      available_actions: ['UNKNOWN' as AIChannelSummary['available_actions'][number]],
    }), false)).toThrow('未处理的合同 token');
    expect(() => resolveAIChannelPrimaryAction(channel({
      is_enabled: false,
      primary_task: 'ENABLE_CHANNEL',
      available_actions: ['UPDATE'],
    }))).toThrow('矛盾的 ENABLE projection');
    expect(() => resolveAIChannelOverflowActions(channel({
      is_enabled: true,
      available_actions: ['ENABLE'],
    }), false)).toThrow('矛盾的 ENABLE projection');
  });
});
