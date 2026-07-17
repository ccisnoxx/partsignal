/** React Query 键的唯一注册表；工厂返回值与既有数组语义完全一致。 */
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: ['auth', 'me'] as const,
    csrf: ['auth', 'csrf'] as const,
  },
  aiChannels: {
    all: ['ai-channels'] as const,
    detail: (id: string) => ['ai-channel', id] as const,
    models: (id: string) => ['ai-models', id] as const,
  },
  platformTypes: {
    all: ['platform-types'] as const,
  },
  queryTopics: ['query-topics'] as const,
  platformProfiles: {
    all: ['platform-profiles'] as const,
    prompt: (id: string | undefined) => ['platform-prompt', id] as const,
  },
  contentHumanizationPrompt: ['content-humanization-prompt'] as const,
  platformProfileVersions: {
    all: ['platform-profile-versions'] as const,
  },
  platformAccounts: ['platform-accounts'] as const,
  auditLogs: ['audit-logs'] as const,
  contentTasks: {
    all: ['content-tasks'] as const,
    optionsAll: ['generation-options'] as const,
    detail: (id: string) => ['content-task', id] as const,
    versions: (id: string) => ['content-versions', id] as const,
    jobs: (id: string) => ['generation-jobs', id] as const,
    options: (id: string) => ['generation-options', id] as const,
  },
  contentVersions: {
    detail: (id: string) => ['content-version', id] as const,
    review: (id: string) => ['content-review-context', id] as const,
  },
  generationJob: (id: string | undefined) => ['generation-job', id] as const,
  products: {
    all: ['products'] as const,
    list: (search: string) => ['products', { search }] as const,
    detail: (id: string) => ['product', id] as const,
    draft: (id: string) => ['facts-draft', id] as const,
    factVersions: (id: string | undefined) => ['fact-versions', id] as const,
    factReview: (id: string | undefined) => ['fact-review-context', id] as const,
  },
  publications: {
    candidates: ['publication-candidates'] as const,
    records: ['publication-records'] as const,
    package: (id: string) => ['publication-package', id] as const,
    record: (id: string) => ['publication-record', id] as const,
    attentions: ['publication-attentions'] as const,
    attentionList: (status: string) => ['publication-attentions', status] as const,
    attention: (id: string) => ['publication-attention', id] as const,
    repair: (id: string) => ['publication-repair-context', id] as const,
  },
  dashboard: ['dashboard'] as const,
  geo: {
    metrics: ['geo-metrics'] as const,
    observations: ['geo-observations'] as const,
  },
  users: ['users'] as const,
};
