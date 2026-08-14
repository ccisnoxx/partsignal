import { describe, expect, it } from 'vitest';

import {
  aiChannelConfigurationFormValues,
  aiChannelWorkspaceSearchSchema,
  isCanonicalAIChannelWorkspaceSearch,
  isDeliveredAIChannelWorkspaceTab,
  resolveAIChannelHeaderActions,
  resolveAIChannelWorkspaceActions,
  shouldBlockAIChannelWorkspaceNavigation,
  toAIChannelUpdate,
  type AIChannel,
} from './ai-channel-workspace.model';

const channel: AIChannel = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '生产 OpenAI',
  description: '内容生成主渠道',
  protocol_type: 'openai-compatible-chat-completions',
  provider_brand: 'OPENAI',
  base_url: 'https://api.example.com/v1',
  timeout_seconds: 60,
  is_enabled: false,
  api_key_configured: true,
  api_key_updated_at: '2026-08-14T08:00:00Z',
  headers: [{
    id: '00000000-0000-4000-8000-000000000002',
    name: 'X-Region',
    is_sensitive: false,
    is_configured: true,
    available_actions: ['UPDATE', 'DELETE'],
    primary_task: 'EDIT_HEADER',
  }],
  enabled_models: [],
  latest_test_status: 'UNTESTED',
  last_tested_at: null,
  workflow_stage: 'UNVERIFIED',
  primary_task: 'TEST_MODEL',
  available_actions: ['UPDATE', 'REPLACE_API_KEY', 'ENABLE', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'],
  revision: 4,
  created_by: '00000000-0000-4000-8000-000000000099',
  created_at: '2026-08-14T08:00:00Z',
  updated_at: '2026-08-14T08:00:00Z',
};

describe('AI Channel Workspace model', () => {
  it('canonical search 保留最终 tab token，但只交付 Basic/Request', () => {
    expect(aiChannelWorkspaceSearchSchema.parse({})).toEqual({ tab: 'basic' });
    expect(aiChannelWorkspaceSearchSchema.parse({ tab: 'models' })).toEqual({ tab: 'models' });
    expect(aiChannelWorkspaceSearchSchema.parse({ tab: 'unknown' })).toEqual({ tab: 'basic' });
    expect(isCanonicalAIChannelWorkspaceSearch({ tab: 'basic' }, { tab: 'basic' })).toBe(true);
    expect(isCanonicalAIChannelWorkspaceSearch({}, { tab: 'basic' })).toBe(false);
    expect(isDeliveredAIChannelWorkspaceTab('request')).toBe(true);
    expect(isDeliveredAIChannelWorkspaceTab('models')).toBe(false);
  });

  it('Basic/Request 共享值生成完整 update 与同一 revision', () => {
    const values = aiChannelConfigurationFormValues(channel);
    expect(toAIChannelUpdate({ ...values, name: '  新名称  ', baseUrl: ' https://new.example.com/v1 ' }, 7)).toEqual({
      expected_revision: 7,
      name: '新名称',
      description: channel.description,
      protocol_type: channel.protocol_type,
      provider_brand: channel.provider_brand,
      base_url: 'https://new.example.com/v1',
      timeout_seconds: channel.timeout_seconds,
    });
  });

  it('脏表单允许 Basic/Request 互切，但阻止离开编辑面', () => {
    const current = { pathname: `/settings/ai/${channel.id}`, search: { tab: 'basic' } };
    expect(shouldBlockAIChannelWorkspaceNavigation(current, { ...current, search: { tab: 'request' } })).toBe(false);
    expect(shouldBlockAIChannelWorkspaceNavigation(current, { ...current, search: { tab: 'models' } })).toBe(true);
    expect(shouldBlockAIChannelWorkspaceNavigation(current, { pathname: '/settings/ai', search: {} })).toBe(true);
  });

  it('动作映射严格拒绝重复、未知与矛盾 projection', () => {
    expect(resolveAIChannelWorkspaceActions(channel)).toMatchObject({
      canCreateHeader: true,
      canReplaceApiKey: true,
      canUpdate: true,
      primary: { key: 'TEST_MODEL', enabled: false },
    });
    expect(resolveAIChannelWorkspaceActions({
      ...channel,
      primary_task: 'ENABLE_CHANNEL',
    })).toMatchObject({
      primary: { command: 'enable-channel', enabled: true },
      overflow: [{ command: 'delete-channel' }],
    });
    expect(resolveAIChannelHeaderActions(channel.headers[0]!)).toEqual({ canDelete: true, primaryLabel: '编辑 Header' });
    expect(() => resolveAIChannelWorkspaceActions({ ...channel, available_actions: ['UPDATE', 'UPDATE'] }))
      .toThrow('重复动作');
    expect(() => resolveAIChannelWorkspaceActions({ ...channel, is_enabled: true }))
      .toThrow('矛盾的 ENABLE');
    expect(() => resolveAIChannelWorkspaceActions({ ...channel, primary_task: 'UNKNOWN' as never }))
      .toThrow('未知主任务');
    expect(() => resolveAIChannelHeaderActions({ ...channel.headers[0]!, is_sensitive: true }))
      .toThrow('矛盾的 EDIT_HEADER');
  });
});
