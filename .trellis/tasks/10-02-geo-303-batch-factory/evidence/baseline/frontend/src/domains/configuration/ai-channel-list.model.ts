import { z } from 'zod';

import type { OverflowRowAction, PrimaryRowAction } from '@/design-system/data-table/types';
import type { components, operations } from '@/shared/api/generated/schema';

type AIChannelSummary = components['schemas']['AIChannelSummary'];
type AIChannelList = components['schemas']['AIChannelList'];
type AIChannelStatus = components['schemas']['AIChannelStatus'];
type AIChannelSort = components['schemas']['AIChannelSort'];
type AIProviderBrand = components['schemas']['AIProviderBrand'];
type AIChannelPrimaryTask = AIChannelSummary['primary_task'];
type AIChannelAvailableAction = AIChannelSummary['available_actions'][number];
type AIChannelListApiParams = NonNullable<operations['listAIChannels']['parameters']['query']>;
type AIChannelCommand = 'enable-channel' | 'disable-channel' | 'delete-channel';
type BadgeTone = 'secondary' | 'success' | 'warning' | 'destructive';

const statusValues = ['ENABLED', 'DISABLED'] as const satisfies readonly AIChannelStatus[];
const providerValues = [
  'OPENAI', 'ANTHROPIC', 'GOOGLE', 'AZURE_OPENAI', 'ZHIPU', 'QWEN', 'CUSTOM',
] as const satisfies readonly AIProviderBrand[];
const sortValues = [
  'CREATED_DESC', 'NAME_ASC', 'NAME_DESC', 'UPDATED_DESC', 'LAST_TESTED_DESC',
] as const satisfies readonly AIChannelSort[];

const providerRegistry = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  GOOGLE: 'Google',
  AZURE_OPENAI: 'Azure OpenAI',
  ZHIPU: '智谱 AI',
  QWEN: '通义千问',
  CUSTOM: '自定义',
} satisfies Record<AIProviderBrand, string>;

const channelStatusRegistry = {
  ENABLED: { label: 'Enabled', tone: 'success' },
  DISABLED: { label: 'Disabled', tone: 'secondary' },
} satisfies Record<AIChannelStatus, { label: string; tone: BadgeTone }>;

const connectionStatusRegistry = {
  PASSED: { label: 'Passed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'destructive' },
  UNTESTED: { label: 'Untested', tone: 'secondary' },
} satisfies Record<AIChannelSummary['latest_test_status'], { label: string; tone: BadgeTone }>;

const configurationStatusRegistry = {
  READY: { label: 'Ready', tone: 'success' },
  NEEDS_SETUP: { label: 'Needs setup', tone: 'warning' },
} satisfies Record<AIChannelSummary['configuration_status'], { label: string; tone: BadgeTone }>;

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}

function normalizeEnum<T extends string>(value: unknown, values: readonly T[]) {
  return typeof value === 'string' && values.some((item) => item === value)
    ? value
    : undefined;
}

const aiChannelSearchSchema = z.object({
  q: z.preprocess(normalizeText, z.string().max(200).optional()),
  status: z.preprocess((value) => normalizeEnum(value, statusValues), z.enum(statusValues).optional()),
  provider: z.preprocess(
    (value) => normalizeEnum(value, providerValues),
    z.enum(providerValues).optional(),
  ),
  sort: z.preprocess((value) => normalizeEnum(value, sortValues), z.enum(sortValues).optional()),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .catch(20)
    .default(20),
});

type AIChannelSearch = z.output<typeof aiChannelSearchSchema>;

function aiChannelSearchToApiParams(search: AIChannelSearch): AIChannelListApiParams {
  return {
    q: search.q,
    status: search.status,
    provider_brand: search.provider,
    sort: search.sort,
    page: search.page,
    page_size: search.pageSize,
  };
}

function canonicalAIChannelSearchRecord(search: AIChannelSearch): Record<string, string | number> {
  const record: Record<string, string | number> = { page: search.page, pageSize: search.pageSize };
  if (search.q) record.q = search.q;
  if (search.status) record.status = search.status;
  if (search.provider) record.provider = search.provider;
  if (search.sort) record.sort = search.sort;
  return record;
}

function isCanonicalAIChannelSearch(raw: Record<string, unknown>, search: AIChannelSearch) {
  const expected = canonicalAIChannelSearchRecord(search);
  return Object.keys(raw).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => String(raw[key]) === String(value));
}

function hasAIChannelFilters(search: AIChannelSearch) {
  return Boolean(search.q || search.status || search.provider || search.sort);
}

function normalizeAIChannelPageSize(value: number): AIChannelSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`AI 渠道列表收到未知分页大小：${value}`);
}

function aiChannelWorkspaceHref(channelId: string, tab: 'basic' | 'request' | 'models' | 'usage') {
  return `/settings/ai/${encodeURIComponent(channelId)}?tab=${tab}`;
}

function resolveAIChannelPrimaryAction(channel: AIChannelSummary): PrimaryRowAction {
  switch (channel.primary_task) {
    case 'COMPLETE_CONFIGURATION': return primaryLink(channel.primary_task, '完成配置', channel.id, 'basic');
    case 'TEST_MODEL': return primaryLink(channel.primary_task, '测试模型', channel.id, 'models');
    case 'ENABLE_CHANNEL':
      if (channel.is_enabled || !channel.available_actions.includes('ENABLE')) {
        throw new Error(`AI 渠道 ${channel.id} 返回了矛盾的 ENABLE projection`);
      }
      return {
        key: channel.primary_task,
        label: '启用渠道',
        intent: 'primary',
        enabled: true,
        command: 'enable-channel',
      };
    case 'VIEW_RUNTIME': return primaryLink(channel.primary_task, '查看运行', channel.id, 'usage');
    default: return assertNever(channel.primary_task);
  }
}

function primaryLink(
  key: AIChannelPrimaryTask,
  label: string,
  channelId: string,
  tab: 'basic' | 'models' | 'usage',
): PrimaryRowAction {
  return { key, label, intent: 'primary', enabled: true, href: aiChannelWorkspaceHref(channelId, tab) };
}

function resolveAIChannelOverflowActions(
  channel: AIChannelSummary,
  pending: boolean,
): OverflowRowAction[] {
  return channel.available_actions.flatMap((action) => {
    if (action === 'ENABLE' && channel.primary_task === 'ENABLE_CHANNEL') return [];
    return [resolveAvailableAction(action, channel, pending)];
  });
}

function resolveAvailableAction(
  action: AIChannelAvailableAction,
  channel: AIChannelSummary,
  pending: boolean,
): OverflowRowAction {
  switch (action) {
    case 'UPDATE': return secondaryLink(action, '编辑渠道', channel.id, 'basic');
    case 'REPLACE_API_KEY': return secondaryLink(action, '重新配置 API Key', channel.id, 'request');
    case 'CREATE_HEADER': return secondaryLink(action, '新增 Header', channel.id, 'request');
    case 'DISCOVER_MODELS': return secondaryLink(action, '获取模型', channel.id, 'models');
    case 'CREATE_MODEL': return secondaryLink(action, '新增模型', channel.id, 'models');
    case 'ENABLE':
      if (channel.is_enabled) throw new Error(`AI 渠道 ${channel.id} 返回了矛盾的 ENABLE projection`);
      return commandAction(action, '启用渠道', 'enable-channel', channel, pending);
    case 'DISABLE':
      if (!channel.is_enabled) throw new Error(`AI 渠道 ${channel.id} 返回了矛盾的 DISABLE projection`);
      return commandAction(action, '停用渠道', 'disable-channel', channel, pending);
    case 'DELETE': return commandAction(action, '删除渠道', 'delete-channel', channel, pending);
    default: return assertNever(action);
  }
}

function secondaryLink(
  key: AIChannelAvailableAction,
  label: string,
  channelId: string,
  tab: 'basic' | 'request' | 'models',
): OverflowRowAction {
  return { key, label, intent: 'secondary', enabled: true, href: aiChannelWorkspaceHref(channelId, tab) };
}

function commandAction(
  key: 'ENABLE' | 'DISABLE' | 'DELETE',
  label: string,
  command: AIChannelCommand,
  channel: AIChannelSummary,
  pending: boolean,
): OverflowRowAction {
  return {
    key,
    label: pending ? '正在处理…' : label,
    intent: key === 'DELETE' ? 'danger' : 'secondary',
    enabled: !pending,
    command,
    disabledReason: pending ? '请求正在处理' : undefined,
    confirmation: {
      title: `${label}“${channel.name}”？`,
      description: key === 'DELETE'
        ? '渠道、Header 与模型会被删除；历史业务快照保持不变。'
        : key === 'DISABLE'
          ? '停用后新的 AI 调用不会再选择该渠道。'
          : '服务端会重新校验模型测试结果与当前修订。',
      confirmLabel: label,
      intent: key === 'DELETE' ? 'destructive' : 'default',
    },
  };
}

function assertNever(value: never): never {
  throw new Error(`AI 渠道列表收到未处理的合同 token：${String(value)}`);
}

export {
  aiChannelSearchSchema,
  aiChannelSearchToApiParams,
  aiChannelWorkspaceHref,
  canonicalAIChannelSearchRecord,
  channelStatusRegistry,
  configurationStatusRegistry,
  connectionStatusRegistry,
  hasAIChannelFilters,
  isCanonicalAIChannelSearch,
  normalizeAIChannelPageSize,
  providerRegistry,
  resolveAIChannelOverflowActions,
  resolveAIChannelPrimaryAction,
};
export type {
  AIChannelCommand,
  AIChannelList,
  AIChannelListApiParams,
  AIChannelSearch,
  AIChannelSummary,
  AIProviderBrand,
};
