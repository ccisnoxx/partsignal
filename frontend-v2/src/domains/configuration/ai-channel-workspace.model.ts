import { z } from 'zod';

import type { OverflowRowAction, PrimaryRowAction } from '@/design-system/data-table/types';
import type { components } from '@/shared/api/generated/schema';
import { AIChannelRequestError } from './ai-channel.api';

type AIChannel = components['schemas']['AIChannel'];
type AIChannelCreate = components['schemas']['AIChannelCreate'];
type AIChannelUpdate = components['schemas']['AIChannelUpdate'];
type AIChannelHeader = components['schemas']['AIChannelHeader'];
type AIModel = components['schemas']['AIModel'];
type AIModelCreate = components['schemas']['AIModelCreate'];
type AIModelUpdate = components['schemas']['AIModelUpdate'];
type AIProviderBrand = components['schemas']['AIProviderBrand'];

const aiChannelWorkspaceTabs = ['basic', 'request', 'models', 'usage', 'logs'] as const;
const aiChannelUsagePeriods = ['7d', '30d', '90d', 'all'] as const;
const aiChannelLogPageSizes = [10, 20, 50] as const;
type AIChannelWorkspaceTab = typeof aiChannelWorkspaceTabs[number];
type AIChannelUsagePeriod = typeof aiChannelUsagePeriods[number];

function normalizeTab(value: unknown): AIChannelWorkspaceTab {
  return typeof value === 'string' && aiChannelWorkspaceTabs.some((tab) => tab === value)
    ? value as AIChannelWorkspaceTab
    : 'basic';
}

function normalizeUsagePeriod(value: unknown): AIChannelUsagePeriod {
  return typeof value === 'string' && aiChannelUsagePeriods.some((period) => period === value)
    ? value as AIChannelUsagePeriod
    : '30d';
}

function normalizePositiveInteger(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

function normalizeLogPageSize(value: unknown): 10 | 20 | 50 {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return aiChannelLogPageSizes.some((size) => size === number) ? number as 10 | 20 | 50 : 20;
}

function normalizeAIChannelWorkspaceSearch(value: unknown) {
  const raw = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const tab = normalizeTab(raw.tab);
  if (tab === 'usage') return { tab, period: normalizeUsagePeriod(raw.period) };
  if (tab === 'logs') {
    return { tab, page: normalizePositiveInteger(raw.page), pageSize: normalizeLogPageSize(raw.pageSize) };
  }
  return { tab };
}

const aiChannelWorkspaceSearchSchema = z.preprocess(
  normalizeAIChannelWorkspaceSearch,
  z.discriminatedUnion('tab', [
    z.object({ tab: z.literal('basic') }),
    z.object({ tab: z.literal('request') }),
    z.object({ tab: z.literal('models') }),
    z.object({ tab: z.literal('usage'), period: z.enum(aiChannelUsagePeriods) }),
    z.object({
      tab: z.literal('logs'),
      page: z.number().int().positive(),
      pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]),
    }),
  ]),
);

type AIChannelWorkspaceSearch = z.output<typeof aiChannelWorkspaceSearchSchema>;

function isCanonicalAIChannelWorkspaceSearch(
  raw: Record<string, unknown>,
  search: AIChannelWorkspaceSearch,
) {
  const canonical = aiChannelWorkspaceSearchForTab(search.tab, search);
  const canonicalRecord = canonical as unknown as Record<string, unknown>;
  const keys = Object.keys(canonical);
  return Object.keys(raw).length === keys.length
    && keys.every((key) => raw[key] === canonicalRecord[key]);
}

function aiChannelWorkspaceSearchForTab(
  tab: AIChannelWorkspaceTab,
  current?: AIChannelWorkspaceSearch,
): AIChannelWorkspaceSearch {
  if (tab === 'usage') {
    return { tab, period: current?.tab === 'usage' ? current.period : '30d' };
  }
  if (tab === 'logs') {
    return current?.tab === 'logs' ? current : { tab, page: 1, pageSize: 20 };
  }
  return { tab };
}

function isDeliveredAIChannelWorkspaceTab(tab: AIChannelWorkspaceTab) {
  return aiChannelWorkspaceTabs.some((item) => item === tab);
}

function shouldBlockAIChannelWorkspaceNavigation(
  current: { pathname: string; search: unknown },
  next: { pathname: string; search: unknown },
) {
  if (current.pathname !== next.pathname) return true;
  const currentTab = aiChannelWorkspaceSearchSchema.parse(current.search).tab;
  const nextTab = aiChannelWorkspaceSearchSchema.parse(next.search).tab;
  const configurationTabs: AIChannelWorkspaceTab[] = ['basic', 'request'];
  return !(configurationTabs.includes(currentTab) && configurationTabs.includes(nextTab));
}

const providerValues = [
  'OPENAI', 'ANTHROPIC', 'GOOGLE', 'AZURE_OPENAI', 'ZHIPU', 'QWEN', 'CUSTOM',
] as const satisfies readonly AIProviderBrand[];

const aiChannelConfigurationFormSchema = z.object({
  name: z.string().trim().min(1, '请输入渠道名称').max(160, '渠道名称不能超过 160 个字符'),
  description: z.string().trim().max(500, '描述不能超过 500 个字符'),
  protocolType: z.literal('openai-compatible-chat-completions'),
  providerBrand: z.enum(providerValues),
  baseUrl: z.string().trim().min(1, '请输入 API 根地址').max(2083, 'API 根地址过长').pipe(z.url('请输入有效 URL')),
  timeoutSeconds: z.number().int('超时时间必须是整数').min(10, '超时时间不能少于 10 秒').max(600, '超时时间不能超过 600 秒'),
});

type AIChannelConfigurationFormValues = z.infer<typeof aiChannelConfigurationFormSchema>;

const aiChannelCreateFormSchema = aiChannelConfigurationFormSchema.extend({
  apiKey: z.string().min(1, '请输入 API Key'),
});

type AIChannelCreateFormValues = z.infer<typeof aiChannelCreateFormSchema>;

const aiChannelApiKeyFormSchema = z.object({
  apiKey: z.string().min(1, '请输入新的 API Key'),
});

type AIChannelApiKeyFormValues = z.infer<typeof aiChannelApiKeyFormSchema>;

const aiChannelHeaderFormSchema = z.object({
  name: z.string().trim().min(1, '请输入 Header 名'),
  value: z.string().min(1, '请输入替换值'),
  isSensitive: z.boolean(),
});

type AIChannelHeaderFormValues = z.infer<typeof aiChannelHeaderFormSchema>;

const reservedModelParameters = new Set(['model', 'messages', 'stream']);

function parseAIModelRequestParameters(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('请求参数必须是有效 JSON');
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('请求参数必须是 JSON 对象');
  }
  const reserved = Object.keys(parsed).filter((key) => reservedModelParameters.has(key));
  if (reserved.length > 0) throw new Error(`请求参数包含系统保留字段：${reserved.sort().join(', ')}`);
  return parsed as Record<string, unknown>;
}

const aiModelFormSchema = z.object({
  displayName: z.string().trim().min(1, '请输入显示名称'),
  modelId: z.string().trim().min(1, '请输入 Model ID'),
  requestParametersJson: z.string().superRefine((value, context) => {
    try {
      parseAIModelRequestParameters(value);
    } catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '请求参数无效' });
    }
  }),
});

type AIModelFormValues = z.infer<typeof aiModelFormSchema>;

function aiChannelConfigurationFormValues(channel: AIChannel): AIChannelConfigurationFormValues {
  return {
    name: channel.name,
    description: channel.description,
    protocolType: channel.protocol_type,
    providerBrand: channel.provider_brand,
    baseUrl: channel.base_url,
    timeoutSeconds: channel.timeout_seconds,
  };
}

function aiChannelCreateFormValues(): AIChannelCreateFormValues {
  return {
    name: '',
    description: '',
    protocolType: 'openai-compatible-chat-completions',
    providerBrand: 'CUSTOM',
    baseUrl: '',
    timeoutSeconds: 30,
    apiKey: '',
  };
}

function aiChannelHeaderFormValues(header?: AIChannelHeader): AIChannelHeaderFormValues {
  return { name: header?.name ?? '', value: '', isSensitive: header?.is_sensitive ?? false };
}

function aiModelFormValues(model?: AIModel, discoveredModelId = ''): AIModelFormValues {
  const modelId = model?.model_id ?? discoveredModelId;
  return {
    displayName: model?.display_name ?? modelId,
    modelId,
    requestParametersJson: JSON.stringify(model?.request_parameters ?? {}, null, 2),
  };
}

function toAIModelCreate(values: AIModelFormValues): AIModelCreate {
  return {
    display_name: values.displayName.trim(),
    model_id: values.modelId.trim(),
    request_parameters: parseAIModelRequestParameters(values.requestParametersJson),
  };
}

function toAIModelUpdate(values: AIModelFormValues, expectedRevision: number): AIModelUpdate {
  return { ...toAIModelCreate(values), expected_revision: expectedRevision };
}

function toAIChannelCreate(values: AIChannelCreateFormValues): AIChannelCreate {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    protocol_type: values.protocolType,
    provider_brand: values.providerBrand,
    base_url: values.baseUrl.trim(),
    api_key: values.apiKey,
    timeout_seconds: values.timeoutSeconds,
  };
}

function toAIChannelUpdate(
  values: AIChannelConfigurationFormValues,
  expectedRevision: number,
): AIChannelUpdate {
  return {
    expected_revision: expectedRevision,
    name: values.name.trim(),
    description: values.description.trim(),
    protocol_type: values.protocolType,
    provider_brand: values.providerBrand,
    base_url: values.baseUrl.trim(),
    timeout_seconds: values.timeoutSeconds,
  };
}

function toAIChannelHeaderInput(values: AIChannelHeaderFormValues) {
  return {
    name: values.name.trim(),
    value: values.value,
    is_sensitive: values.isSensitive,
  };
}

function resolveAIChannelWorkspaceActions(channel: AIChannel): {
  canCreateHeader: boolean;
  canCreateModel: boolean;
  canDiscoverModels: boolean;
  canReplaceApiKey: boolean;
  canUpdate: boolean;
  overflow: OverflowRowAction[];
  primary: PrimaryRowAction;
} {
  let canCreateHeader = false;
  let canCreateModel = false;
  let canDiscoverModels = false;
  let canReplaceApiKey = false;
  let canUpdate = false;
  const overflow: OverflowRowAction[] = [];
  const seen = new Set<string>();
  for (const action of channel.available_actions as string[]) {
    if (seen.has(action)) throw new Error(`AI 渠道 ${channel.id} 返回重复动作：${action}`);
    seen.add(action);
    if (action === 'UPDATE') canUpdate = true;
    else if (action === 'REPLACE_API_KEY') canReplaceApiKey = true;
    else if (action === 'CREATE_HEADER') canCreateHeader = true;
    else if (action === 'CREATE_MODEL') canCreateModel = true;
    else if (action === 'DISCOVER_MODELS') canDiscoverModels = true;
    else if (action === 'ENABLE' || action === 'DISABLE' || action === 'DELETE') {
      if (action === 'ENABLE' && channel.is_enabled) throw new Error(`AI 渠道 ${channel.id} 返回矛盾的 ENABLE 动作`);
      if (action === 'DISABLE' && !channel.is_enabled) throw new Error(`AI 渠道 ${channel.id} 返回矛盾的 DISABLE 动作`);
      if (action === 'ENABLE' && channel.primary_task === 'ENABLE_CHANNEL') continue;
      const label = action === 'ENABLE' ? '启用渠道' : action === 'DISABLE' ? '停用渠道' : '删除渠道';
      overflow.push({
        key: action,
        label,
        intent: action === 'DELETE' ? 'danger' : 'secondary',
        enabled: true,
        command: action === 'ENABLE' ? 'enable-channel' : action === 'DISABLE' ? 'disable-channel' : 'delete-channel',
        confirmation: {
          title: `${label}“${channel.name}”？`,
          description: action === 'DELETE'
            ? '渠道、Header 与模型会被删除；历史业务快照保持不变。'
            : action === 'DISABLE'
              ? '停用后新的 AI 调用不会再选择该渠道。'
              : '服务端会重新校验模型测试结果与当前修订。',
          confirmLabel: label,
          intent: action === 'DELETE' ? 'destructive' : 'default',
        },
      });
    } else {
      throw new Error(`AI 渠道 ${channel.id} 返回未知动作：${action}`);
    }
  }
  const primaryTask = channel.primary_task as string;
  let primary: PrimaryRowAction;
  if (primaryTask === 'COMPLETE_CONFIGURATION') {
    primary = { key: primaryTask, label: '完成配置', intent: 'primary', enabled: true, command: 'show-basic' };
  } else if (primaryTask === 'ENABLE_CHANNEL') {
    if (channel.is_enabled || !seen.has('ENABLE')) throw new Error(`AI 渠道 ${channel.id} 返回矛盾的 ENABLE projection`);
    primary = { key: primaryTask, label: '启用渠道', intent: 'primary', enabled: true, command: 'enable-channel' };
  } else if (primaryTask === 'TEST_MODEL') {
    primary = { key: primaryTask, label: '测试模型', intent: 'primary', enabled: true, command: 'show-models' };
  } else if (primaryTask === 'VIEW_RUNTIME') {
    primary = { key: primaryTask, label: '查看运行', intent: 'primary', enabled: true, command: 'show-usage' };
  } else {
    throw new Error(`AI 渠道 ${channel.id} 返回未知主任务：${primaryTask}`);
  }
  return {
    canCreateHeader,
    canCreateModel,
    canDiscoverModels,
    canReplaceApiKey,
    canUpdate,
    overflow,
    primary,
  };
}

function resolveAIModelActions(model: AIModel): {
  overflow: OverflowRowAction[];
  primary: PrimaryRowAction;
} {
  const seen = new Set<string>();
  const overflow: OverflowRowAction[] = [];
  const primaryTask = model.primary_task;
  const primaryCommand = {
    TEST_CONNECTION: 'test-model',
    VIEW_FAILURE_AND_RETRY: 'test-model',
    ENABLE_MODEL: 'enable-model',
    ENABLE_CHANNEL: 'enable-channel',
    VIEW_MODEL_RUNTIME: 'view-runtime',
  }[primaryTask];
  const primaryLabels = {
    TEST_CONNECTION: '测试连接',
    VIEW_FAILURE_AND_RETRY: '查看失败并重试',
    ENABLE_MODEL: '启用模型',
    ENABLE_CHANNEL: '启用所属渠道',
    VIEW_MODEL_RUNTIME: '查看运行',
  } satisfies Record<AIModel['primary_task'], string>;
  if (!primaryCommand) throw new Error(`AI 模型 ${model.id} 返回未知主任务：${String(primaryTask)}`);

  for (const action of model.available_actions as string[]) {
    if (seen.has(action)) throw new Error(`AI 模型 ${model.id} 返回重复动作：${action}`);
    seen.add(action);
    if (action === 'ENABLE' && model.is_enabled) throw new Error(`AI 模型 ${model.id} 返回矛盾的 ENABLE 动作`);
    if (action === 'DISABLE' && !model.is_enabled) throw new Error(`AI 模型 ${model.id} 返回矛盾的 DISABLE 动作`);
    if (
      (action === 'TEST' && primaryCommand === 'test-model')
      || (action === 'ENABLE' && primaryCommand === 'enable-model')
    ) continue;
    if (action === 'UPDATE') {
      overflow.push({ key: action, label: '编辑模型', intent: 'secondary', enabled: true, command: 'edit-model' });
    } else if (action === 'TEST') {
      overflow.push({ key: action, label: '测试连接', intent: 'secondary', enabled: true, command: 'test-model', confirmation: 'custom' });
    } else if (action === 'ENABLE' || action === 'DISABLE') {
      const label = action === 'ENABLE' ? '启用模型' : '停用模型';
      overflow.push({
        key: action,
        label,
        intent: 'secondary',
        enabled: true,
        command: action === 'ENABLE' ? 'enable-model' : 'disable-model',
        confirmation: {
          title: `${label}“${model.display_name}”？`,
          description: action === 'ENABLE' ? '服务端会重新校验当前测试结论与修订。' : '停用后新的 AI 调用不会再选择该模型。',
          confirmLabel: label,
        },
      });
    } else if (action === 'DELETE') {
      overflow.push({
        key: action,
        label: '删除模型',
        intent: 'danger',
        enabled: true,
        command: 'delete-model',
        confirmation: {
          title: `删除模型“${model.display_name}”？`,
          description: '模型配置会被删除；历史业务快照保持不变。',
          confirmLabel: '删除模型',
          intent: 'destructive',
        },
      });
    } else {
      throw new Error(`AI 模型 ${model.id} 返回未知动作：${action}`);
    }
  }

  if (primaryCommand === 'enable-model' && !seen.has('ENABLE')) {
    throw new Error(`AI 模型 ${model.id} 的 ENABLE_MODEL 缺少 ENABLE 动作`);
  }
  if (primaryCommand === 'test-model' && !seen.has('TEST')) {
    throw new Error(`AI 模型 ${model.id} 的测试主任务缺少 TEST 动作`);
  }
  return {
    overflow,
    primary: { key: primaryTask, label: primaryLabels[primaryTask], intent: 'primary', enabled: true, command: primaryCommand },
  };
}

/** 这是显示完整性边界；服务端 CONFIGURATION whitelist 仍是脱敏权威。 */
const auditActionLabels = {
  'ai_channel.created': '创建渠道',
  'ai_channel.updated': '更新渠道',
  'ai_channel.deleted': '删除渠道',
  'ai_channel.api_key_replaced': '替换 API Key',
  'ai_channel.enabled': '启用渠道',
  'ai_channel.disabled': '停用渠道',
  'ai_channel_header.created': '创建 Header',
  'ai_channel_header.updated': '更新 Header',
  'ai_channel_header.deleted': '删除 Header',
  'ai_model.created': '创建模型',
  'ai_model.updated': '更新模型',
  'ai_model.deleted': '删除模型',
  'ai_model.enabled': '启用模型',
  'ai_model.disabled': '停用模型',
} as const;

const auditFactLabels = {
  account_count: '账号数量',
  allowed_domain_count: '允许域名数量',
  channel_id: '渠道 ID',
  configured: '配置状态',
  header_name: 'Header 名',
  is_active: '启用状态',
  is_sensitive: '敏感状态',
  model_count: '模型数量',
  platform_profile_id: '平台配置 ID',
  platform_type_id: '平台类型 ID',
  previous_active_version_id: '原活动版本 ID',
  protocol_type: '协议类型',
  provider_brand: 'Provider',
  reason: '原因',
  reference_count: '引用数量',
  replacement_version_id: '替代版本 ID',
  revision: '修订号',
  status: '状态',
  test_status: '测试状态',
  version: '版本',
} as const;

const auditChangeLabels = {
  allowed_domain_count: '允许域名数量',
  is_active: '启用状态',
  is_configured: '配置状态',
  logo_configured: 'Logo 配置状态',
  platform_type_id: '平台类型 ID',
  revision: '修订号',
  status: '状态',
  website_configured: '网站配置状态',
} as const;

type AIChannelAuditDisplayItem = { field: string; label: string; value: string };
type AIChannelAuditDisplayChange = {
  after: string;
  before: string;
  field: string;
  label: string;
};

function aiChannelAuditActionLabel(action: string) {
  const label = auditActionLabels[action as keyof typeof auditActionLabels];
  if (!label) throw new Error(`渠道审计返回未知动作：${action}`);
  return label;
}

function formatAIChannelAuditValue(value: unknown): string {
  if (value === null) return '空';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((item) => (
    item === null || typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number'
  ))) {
    return value.map(formatAIChannelAuditValue).join('、');
  }
  throw new Error('渠道审计返回不支持的字段值，已停止安全投影');
}

function projectAIChannelAuditFacts(facts: Record<string, unknown>): AIChannelAuditDisplayItem[] {
  return Object.entries(facts).map(([field, value]) => {
    const label = auditFactLabels[field as keyof typeof auditFactLabels];
    if (!label) throw new Error(`渠道审计返回未登记事实字段：${field}`);
    return { field, label, value: formatAIChannelAuditValue(value) };
  });
}

function projectAIChannelAuditChanges(
  changes: Array<{ field: string; before?: unknown; after?: unknown }>,
): AIChannelAuditDisplayChange[] {
  return changes.map((change) => {
    const label = auditChangeLabels[change.field as keyof typeof auditChangeLabels];
    if (!label) throw new Error(`渠道审计返回未登记变更字段：${change.field}`);
    return {
      field: change.field,
      label,
      before: Object.hasOwn(change, 'before') ? formatAIChannelAuditValue(change.before) : '历史未记录',
      after: Object.hasOwn(change, 'after') ? formatAIChannelAuditValue(change.after) : '历史未记录',
    };
  });
}

function projectAIChannelAuditSummary(summary: Record<string, unknown>) {
  const { changes, ...facts } = summary;
  if (changes !== undefined && !Array.isArray(changes)) {
    throw new Error('渠道审计变更摘要格式无效，已停止安全投影');
  }
  return {
    changes: projectAIChannelAuditChanges((changes ?? []) as Array<{ field: string; before?: unknown; after?: unknown }>),
    facts: projectAIChannelAuditFacts(facts),
  };
}

function resolveAIChannelHeaderActions(header: AIChannelHeader) {
  let canUpdate = false;
  let canDelete = false;
  const seen = new Set<string>();
  for (const action of header.available_actions as string[]) {
    if (seen.has(action)) throw new Error(`AI Header ${header.id} 返回重复动作：${action}`);
    seen.add(action);
    if (action === 'UPDATE') canUpdate = true;
    else if (action === 'DELETE') canDelete = true;
    else throw new Error(`AI Header ${header.id} 返回未知动作：${action}`);
  }
  if (!canUpdate) throw new Error(`AI Header ${header.id} 的 primary_task 缺少 UPDATE 动作`);
  if (header.primary_task === 'EDIT_HEADER' && header.is_sensitive) {
    throw new Error(`AI Header ${header.id} 返回矛盾的 EDIT_HEADER projection`);
  }
  if (header.primary_task === 'RECONFIGURE_HEADER' && !header.is_sensitive) {
    throw new Error(`AI Header ${header.id} 返回矛盾的 RECONFIGURE_HEADER projection`);
  }
  return { canDelete, primaryLabel: header.primary_task === 'EDIT_HEADER' ? '编辑 Header' : '重新配置 Header' };
}

function isAIChannelRevisionConflict(error: unknown) {
  return error instanceof AIChannelRequestError && error.detail?.code === 'REVISION_CONFLICT';
}

function aiChannelDetailErrorKind(error: unknown): 'not-found' | 'forbidden' | 'generic' {
  if (!(error instanceof AIChannelRequestError)) return 'generic';
  if (error.status === 404) return 'not-found';
  if (error.status === 403) return 'forbidden';
  return 'generic';
}

export {
  aiChannelApiKeyFormSchema,
  aiChannelConfigurationFormSchema,
  aiChannelConfigurationFormValues,
  aiChannelCreateFormSchema,
  aiChannelCreateFormValues,
  aiChannelDetailErrorKind,
  aiChannelHeaderFormSchema,
  aiChannelHeaderFormValues,
  aiChannelAuditActionLabel,
  aiChannelWorkspaceSearchForTab,
  aiChannelWorkspaceSearchSchema,
  aiChannelWorkspaceTabs,
  aiModelFormSchema,
  aiModelFormValues,
  isAIChannelRevisionConflict,
  isCanonicalAIChannelWorkspaceSearch,
  isDeliveredAIChannelWorkspaceTab,
  providerValues,
  projectAIChannelAuditChanges,
  projectAIChannelAuditFacts,
  projectAIChannelAuditSummary,
  resolveAIChannelHeaderActions,
  resolveAIModelActions,
  resolveAIChannelWorkspaceActions,
  shouldBlockAIChannelWorkspaceNavigation,
  toAIChannelCreate,
  toAIChannelHeaderInput,
  toAIChannelUpdate,
  toAIModelCreate,
  toAIModelUpdate,
};
export type {
  AIChannel,
  AIChannelApiKeyFormValues,
  AIChannelConfigurationFormValues,
  AIChannelCreateFormValues,
  AIChannelHeader,
  AIChannelHeaderFormValues,
  AIChannelAuditDisplayChange,
  AIChannelAuditDisplayItem,
  AIModel,
  AIModelFormValues,
  AIChannelWorkspaceSearch,
  AIChannelWorkspaceTab,
  AIChannelUsagePeriod,
};
