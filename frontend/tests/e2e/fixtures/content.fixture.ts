/** Content Tasks 页面 fixture；只声明本页面真实使用的 API。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type ContentTaskListItem = components['schemas']['ContentTaskListItem'];
type ContentTask = components['schemas']['ContentTask'];
type ContentTaskDetail = components['schemas']['ContentTaskDetail'];
type ContentTaskCreate = components['schemas']['ContentTaskCreate'];
type ContentEditorContext = components['schemas']['ContentEditorContext'];
type ContentReviewContext = components['schemas']['ContentReviewContext'];
type ContentVersion = components['schemas']['ContentVersion'];
type ContentVersionDetail = components['schemas']['ContentVersionDetail'];
type ContentRevisionCreate = components['schemas']['ContentRevisionCreate'];
type ContentDraftUpdate = components['schemas']['ContentDraftUpdate'];
type CommandRequest = components['schemas']['CommandRequest'];
type RequestChangesCommand = components['schemas']['RequestChangesCommand'];
type CreationOptions = components['schemas']['ContentTaskCreationOptions'];
type GenerationJob = components['schemas']['GenerationJob'];
type GenerationJobDetail = components['schemas']['GenerationJobDetail'];
type GenerationOptions = components['schemas']['GenerationOptions'];
type HumanizationJobCreate = components['schemas']['HumanizationJobCreate'];
type OriginalGenerationJobCreate = components['schemas']['OriginalGenerationJobCreate'];
type ProductDetail = components['schemas']['ProductDetail'];
type ContentTaskListMode = 'success' | 'empty' | 'error' | 'loading';
type MutationMode = 'success' | 'revision-conflict';
type CreationOptionsMode = 'success' | 'empty' | 'error' | 'loading';
type CreateMode =
  | 'success'
  | 'pending'
  | 'validation'
  | 'fact-not-approved'
  | 'platform-disabled'
  | 'not-found'
  | 'idempotency-conflict'
  | 'forbidden';
type DetailMode = 'success' | 'empty' | 'cancelled' | 'error' | 'loading' | 'not-found' | 'forbidden';
type EditorMode = 'no-current' | 'human-draft' | 'ai-draft' | 'changes-requested' | 'review-pending';
type EditorMutationMode =
  | 'success'
  | 'save-revision-conflict'
  | 'submit-review-revision-conflict';
type ReviewMode = 'review-pending' | 'blocking' | 'approved' | 'changes-requested' | 'readonly' | 'loading' | 'error';
type ReviewMutationMode = 'success' | 'revision-conflict' | 'validation';
type VersionDetailMode = 'success' | 'loading' | 'not-found' | 'forbidden' | 'error';
type AiOutcome = 'success' | 'failure';
type LifecycleBody =
  | components['schemas']['CommandRequest']
  | components['schemas']['RevisionRequest']
  | components['schemas']['ContentTaskPermanentDeleteRequest']
  | null;

type LifecycleRequest = {
  body: LifecycleBody;
  csrfToken: string | null;
  expectedRevision: number | null;
  method: string;
  pathname: string;
};

type CreateRequest = {
  body: ContentTaskCreate;
  csrfToken: string | null;
  idempotencyKey: string | null;
};

type EditorRevisionRequest = {
  body: ContentRevisionCreate;
  csrfToken: string | null;
  contentVersionId: string | null;
  taskId: string | null;
};

type EditorSaveRequest = {
  body: ContentDraftUpdate;
  csrfToken: string | null;
  contentVersionId: string;
};

type EditorCommandRequest = {
  body: CommandRequest;
  csrfToken: string | null;
  command: 'submit-review' | 'abandon';
  contentVersionId: string;
};

type EditorDeleteRequest = {
  csrfToken: string | null;
  contentVersionId: string;
  expectedRevision: number | null;
};

type ReviewCommandRequest = {
  body: CommandRequest | RequestChangesCommand;
  csrfToken: string | null;
  command: 'approve' | 'request-changes';
  contentVersionId: string;
};

type AiJobRequest = {
  body: HumanizationJobCreate | OriginalGenerationJobCreate | null;
  csrfToken: string | null;
  idempotencyKey: string | null;
  kind: 'generate' | 'humanize' | 'retry';
  targetId: string;
};

type ContentApiController = {
  aiJobRequests: AiJobRequest[];
  createRequests: CreateRequest[];
  creationOptionsRequests: URL[];
  detailRequests: URL[];
  editorCommandRequests: EditorCommandRequest[];
  editorContextRequests: URL[];
  editorDeleteRequests: EditorDeleteRequest[];
  editorRevisionRequests: EditorRevisionRequest[];
  editorSaveRequests: EditorSaveRequest[];
  failNextEditorContextRequest: () => void;
  generationJobDetailRequests: URL[];
  generationJobListRequests: URL[];
  generationOptionsRequests: URL[];
  getVersionDetail: () => ContentVersionDetail;
  listRequests: URL[];
  lifecycleRequests: LifecycleRequest[];
  reviewCommandRequests: ReviewCommandRequest[];
  reviewContextRequests: URL[];
  versionDetailRequests: URL[];
  releaseCreate: () => void;
  releaseDetailLoading: () => void;
  releaseLoading: () => void;
  releaseOptionsLoading: () => void;
  releaseReviewLoading: () => void;
  releaseVersionDetailLoading: () => void;
  setCreateMode: (mode: CreateMode) => void;
  setCreationOptionsMode: (mode: CreationOptionsMode) => void;
  setDetailMode: (mode: DetailMode) => void;
  setEditorMode: (mode: EditorMode) => void;
  setEditorMutationMode: (mode: EditorMutationMode) => void;
  setListMode: (mode: ContentTaskListMode) => void;
  setMutationMode: (mode: MutationMode) => void;
  setReviewMode: (mode: ReviewMode) => void;
  setReviewMutationMode: (mode: ReviewMutationMode) => void;
  setVersionDetail: (detail: ContentVersionDetail) => void;
  setVersionDetailMode: (mode: VersionDetailMode) => void;
  setAiOutcome: (outcome: AiOutcome) => void;
};

type ContentFixtures = { contentApi: ContentApiController };

const platformId = '00000000-0000-4000-8000-000000000201';
const secondPlatformId = '00000000-0000-4000-8000-000000000202';
const creationProductId = '10000000-0000-4000-8000-000000000201';
const secondCreationProductId = '10000000-0000-4000-8000-000000000202';
const inactiveProductId = '10000000-0000-4000-8000-000000000203';
const noFactsProductId = '10000000-0000-4000-8000-000000000204';
const creationFactId = '20000000-0000-4000-8000-000000000201';
const secondCreationFactId = '20000000-0000-4000-8000-000000000202';
const createdTaskId = '00000000-0000-4000-8000-999999999998';
const editorTaskId = '00000000-0000-4000-8000-000000000002';
const reviewTaskId = editorTaskId;
const editorContentId = '30000000-0000-4000-8000-000000000002';
const editorPreviousContentId = '30000000-0000-4000-8000-000000000102';
const generationJobId = '40000000-0000-4000-8000-000000000201';
const retryJobId = '40000000-0000-4000-8000-000000000202';
const humanizationJobId = '40000000-0000-4000-8000-000000000203';
const generationModelId = '80000000-0000-4000-8000-000000000201';
const generationChannelId = '80000000-0000-4000-8000-000000000202';
const generationPromptId = '80000000-0000-4000-8000-000000000203';
const contentVersionTaskId = '00000000-0000-4000-8000-000000000001';
const contentVersionDetailId = '30000000-0000-4000-8000-000000000001';

const user = {
  id: '00000000-0000-4000-8000-000000000099',
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-08T00:00:00Z',
} satisfies components['schemas']['User'];

const platform = {
  id: platformId,
  name: '工程师社区',
  slug: 'engineering-community',
  allowed_domains: ['example.com'],
  platform_type_id: null,
  platform_type: null,
  website_url: 'https://example.com',
  logo: null,
  revision: 1,
  is_active: true,
  platform_prompt: null,
  configuration_complete: false,
  platform_account_count: 1,
  enabled_platform_account_count: 1,
  readiness_status: 'MISSING_PROMPT',
  workflow_stage: 'OPERATIONAL',
  primary_task: 'VIEW_PLATFORM_OPERATION',
  available_actions: ['UPDATE', 'DISABLE'],
  deletion: null,
  updated_at: '2026-08-09T00:00:00Z',
} satisfies components['schemas']['PlatformProfile'];

const creationOptions = {
  products: [
    {
      id: creationProductId,
      brand: 'PartSignal',
      part_number: 'PS-CREATE-001',
      approved_fact_versions: [
        { id: creationFactId, version: 3, classification: 'PUBLIC' },
        {
          id: '20000000-0000-4000-8000-000000000211',
          version: 2,
          classification: 'INTERNAL',
        },
      ],
    },
    {
      id: secondCreationProductId,
      brand: 'PartSignal',
      part_number: 'PS-CREATE-002',
      approved_fact_versions: [
        { id: secondCreationFactId, version: 1, classification: 'RESTRICTED' },
      ],
    },
  ],
  platforms: [
    { id: platformId, name: platform.name },
    { id: secondPlatformId, name: '开发者问答' },
  ],
  requested_product: null,
} satisfies CreationOptions;

const generationOptions = {
  platform_profile_id: platformId,
  platform_profile_name: platform.name,
  platform_prompt: {
    id: generationPromptId,
    name: 'Fixture Content Prompt',
    revision: 4,
    template_markdown: '# Fixture Prompt\n\n只能使用已批准事实。',
  },
  humanization_prompt_configured: true,
  models: [{
    id: generationModelId,
    channel_id: generationChannelId,
    channel_name: 'Fixture Channel',
    display_name: 'Fixture Model',
    model_id: 'fixture-model',
  }],
} satisfies GenerationOptions;

const productDetail = {
  product: {
    id: creationProductId,
    part_number: 'PS-CREATE-001',
    brand: 'PartSignal',
    category: 'MCU',
    status: 'ACTIVE',
    workflow_stage: 'FACT_APPROVED',
    primary_task: 'CREATE_CONTENT_TASK',
    available_actions: ['UPDATE'],
    deletion: null,
    revision: 3,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
  },
  approved_fact: {
    id: creationFactId,
    version: 3,
    status: 'APPROVED',
    classification: 'PUBLIC',
    approved_at: '2026-08-10T00:00:00Z',
  },
  pending_fact: null,
  content: { task_count: 0, latest_task: null },
  publishing: { published_article_count: 0, latest: null },
  geo: {
    observation_count: 0,
    article_result_count: 0,
    discovery_rate: null,
    mention_rate: null,
    accuracy_rate: null,
  },
  activity: [],
} satisfies ProductDetail;

function createContentTasks(count = 45): ContentTaskListItem[] {
  const items = Array.from({ length: count }, (_, index): ContentTaskListItem => {
    const ordinal = index + 1;
    const suffix = String(ordinal).padStart(12, '0');
    return {
      id: `00000000-0000-4000-8000-${suffix}`,
      identifier: `CT-${String(ordinal).padStart(8, '0')}`,
      product_id: `10000000-0000-4000-8000-${suffix}`,
      fact_version_id: `20000000-0000-4000-8000-${suffix}`,
      platform_profile_id: platformId,
      query_topic_id: null,
      source_published_content_issue_id: null,
      current_content_version_id: `30000000-0000-4000-8000-${suffix}`,
      workflow_stage: ordinal === 1 ? 'GENERATION_FAILED' : 'DRAFT',
      primary_task: ordinal === 1 ? 'REVIEW_CONTENT' : 'EDIT_AND_SUBMIT_REVIEW',
      available_actions: ordinal === 1
        ? ['CANCEL', 'DELETE', 'CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION']
        : ['CANCEL'],
      deletion: ordinal === 1 ? { blockers: [] } : null,
      status: 'OPEN',
      revision: ordinal,
      created_by: user.id,
      created_at: '2026-08-01T00:00:00Z',
      archived_at: null,
      product: {
        id: `10000000-0000-4000-8000-${suffix}`,
        brand: ordinal === 1 ? 'PartSignal Fixture' : `Brand ${ordinal % 5}`,
        part_number: `PS-${String(ordinal).padStart(4, '0')}`,
      },
      platform: {
        id: platformId,
        name: platform.name,
        website_url: platform.website_url,
        logo: null,
      },
      current_content: { id: `30000000-0000-4000-8000-${suffix}`, version: ordinal, source_type: ordinal % 2 ? 'AI' : 'HUMAN' },
      latest_generation_status: ordinal === 1 ? 'FAILED' : null,
      updated_at: new Date(Date.UTC(2026, 7, 10, 8, 0) - index * 60_000).toISOString(),
    };
  });
  items.push({
    ...items[0],
    id: '00000000-0000-4000-8000-000000000999',
    identifier: 'CT-ARCHIVED',
    product_id: '10000000-0000-4000-8000-000000000999',
    fact_version_id: '20000000-0000-4000-8000-000000000999',
    current_content_version_id: '30000000-0000-4000-8000-000000000999',
    status: 'COMPLETED',
    workflow_stage: 'VERIFIED',
    primary_task: 'VIEW_FULL_LINEAGE',
    available_actions: ['RESTORE', 'PERMANENT_DELETE'],
    deletion: null,
    revision: 99,
    archived_at: '2026-08-10T09:00:00Z',
    product: { ...items[0].product, id: '10000000-0000-4000-8000-000000000999', part_number: 'PS-ARCHIVED' },
    current_content: { id: '30000000-0000-4000-8000-000000000999', version: 9, source_type: 'HUMAN' },
    updated_at: '2026-08-10T09:00:00Z',
  });
  return items;
}

function createdTask(body: ContentTaskCreate): ContentTask {
  return {
    ...body,
    id: createdTaskId,
    query_topic_id: null,
    source_published_content_issue_id: null,
    current_content_version_id: null,
    workflow_stage: 'NO_DRAFT',
    primary_task: 'CREATE_FIRST_DRAFT',
    available_actions: ['CANCEL', 'CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION'],
    deletion: null,
    status: 'OPEN',
    revision: 0,
    created_by: user.id,
    created_at: '2026-08-10T12:00:00Z',
    archived_at: null,
  };
}

function createdListItem(body: ContentTaskCreate): ContentTaskListItem {
  const task = createdTask(body);
  const product = creationOptions.products.find((item) => item.id === body.product_id)
    ?? creationOptions.products[0];
  const targetPlatform = creationOptions.platforms.find(
    (item) => item.id === body.platform_profile_id,
  ) ?? creationOptions.platforms[0];
  return {
    ...task,
    identifier: 'CT-00000000',
    product: {
      id: product.id,
      brand: product.brand,
      part_number: product.part_number,
    },
    platform: {
      id: targetPlatform.id,
      name: targetPlatform.name,
      website_url: null,
      logo: null,
    },
    current_content: null,
    latest_generation_status: null,
    updated_at: task.created_at,
  };
}

function commandResponse(item: ContentTaskListItem): ContentTask {
  return {
    id: item.id,
    product_id: item.product_id,
    fact_version_id: item.fact_version_id,
    platform_profile_id: item.platform_profile_id,
    query_topic_id: item.query_topic_id,
    source_published_content_issue_id: item.source_published_content_issue_id,
    current_content_version_id: item.current_content_version_id,
    workflow_stage: item.workflow_stage,
    primary_task: item.primary_task,
    available_actions: item.available_actions,
    deletion: item.deletion,
    status: item.status,
    revision: item.revision,
    created_by: item.created_by,
    created_at: item.created_at,
    archived_at: item.archived_at,
  };
}

function contentTaskDetail(item: ContentTaskListItem, empty = false): ContentTaskDetail {
  return {
    task: {
      id: item.id,
      identifier: item.identifier,
      status: item.status,
      workflow_stage: item.workflow_stage,
      primary_task: item.primary_task,
      available_actions: item.available_actions,
      deletion: item.deletion,
      revision: item.revision,
      created_by: item.created_by,
      created_at: item.created_at,
      archived_at: item.archived_at,
    },
    product: { ...item.product, status: 'ACTIVE' },
    platform: item.platform,
    fact: {
      id: item.fact_version_id,
      version: 3,
      status: 'APPROVED',
      classification: 'PUBLIC',
    },
    current_content: empty || !item.current_content ? null : {
      ...item.current_content,
      status: 'CHANGES_REQUESTED',
      title: `${item.product.part_number} 选型指南`,
      summary: '基于已批准事实的当前内容摘要',
    },
    generation: empty ? null : {
      id: '40000000-0000-4000-8000-000000000001',
      job_type: 'GENERATE',
      status: 'FAILED',
      attempt_count: 2,
      error_code: 'MODEL_TIMEOUT',
      error_summary: '模型响应超时',
      created_at: '2026-08-10T08:00:00Z',
      started_at: '2026-08-10T08:01:00Z',
      finished_at: '2026-08-10T08:02:00Z',
    },
    review: empty || !item.current_content ? null : {
      content_version_id: item.current_content.id,
      status: 'CHANGES_REQUESTED',
      latest_result: {
        action: 'request-changes',
        actor: { id: user.id, username: user.username, display_name: user.display_name },
        created_at: '2026-08-10T09:00:00Z',
      },
    },
    publishing: empty ? null : {
      work: {
        id: '50000000-0000-4000-8000-000000000001',
        status: 'ACTION_REQUIRED',
        updated_at: '2026-08-10T10:00:00Z',
      },
      result: null,
    },
    source: empty ? null : {
      query_topic: {
        id: '60000000-0000-4000-8000-000000000001',
        canonical_question: `如何选择 ${item.product.part_number}？`,
      },
      geo_optimization: null,
      published_content_issue: null,
    },
    activity: empty ? [] : [
      {
        id: '70000000-0000-4000-8000-000000000001',
        kind: 'TASK',
        timestamp: '2026-08-10T11:00:00Z',
        actor: { id: user.id, username: user.username, display_name: user.display_name },
        summary: '任务进入当前阶段',
        target: { kind: 'CONTENT_TASK', id: item.id, label: item.identifier },
      },
      {
        id: '70000000-0000-4000-8000-000000000002',
        kind: 'GENERATION',
        timestamp: '2026-08-10T10:00:00Z',
        actor: { id: user.id, username: user.username, display_name: user.display_name },
        summary: '生成作业失败',
        target: {
          kind: 'GENERATION_JOB',
          id: '40000000-0000-4000-8000-000000000001',
          label: '原始生成',
        },
      },
    ],
  };
}

function contentVersionDetail(item: ContentTaskListItem): ContentVersionDetail {
  const versionId = item.current_content?.id ?? contentVersionDetailId;
  const reviewRecord = {
    id: '90000000-0000-4000-8000-000000000101',
    target_id: versionId,
    target_version: item.current_content?.version ?? 1,
    action: 'request-changes',
    comment: '请补充平台适配说明',
    actor: { id: user.id, username: user.username, display_name: user.display_name },
    created_at: '2026-08-10T09:00:00Z',
  } satisfies components['schemas']['ReviewRecord'];
  return {
    content: {
      id: versionId,
      task_id: item.id,
      fact_version_id: item.fact_version_id,
      source_job_id: generationJobId,
      based_on_id: null,
      version: item.current_content?.version ?? 1,
      source_type: 'AI',
      status: 'CHANGES_REQUESTED',
      is_current: true,
      title: `${item.product.part_number} 长生命周期器件选型指南`,
      summary: '冻结的 Content Version 摘要。',
      body_markdown: `# Canonical 正文\n\n<script>不得执行</script>\n\n${'长正文与 Markdown 列表。 '.repeat(80)}`,
      tags: ['MCU', '长生命周期', '工程师社区'],
      content_hash: 'a'.repeat(64),
      change_summary: '根据审核意见补充平台适配与来源说明。',
      creator: { id: user.id, username: user.username, display_name: user.display_name },
      created_at: '2026-08-10T08:00:00Z',
      updated_at: '2026-08-10T09:00:00Z',
    },
    fact_version: {
      id: item.fact_version_id,
      product_id: item.product_id,
      version: 3,
      status: 'APPROVED',
      classification: 'PUBLIC',
    },
    generation_lineage: {
      original_generation: {
        job_id: generationJobId,
        job_type: 'GENERATE',
        source_content_version_id: null,
        contract_version: 'content-markdown-v3',
        channel: { id: generationChannelId, name: 'Fixture 渠道' },
        model: { id: generationModelId, display_name: 'Fixture 模型', model_id: 'fixture-model' },
        prompt: {
          kind: 'PLATFORM',
          id: generationPromptId,
          name: 'Fixture 平台 Prompt',
          revision: 3,
          template_markdown: null,
          system_message: 'Fixture system message',
          user_message: 'Fixture user message',
        },
      },
      humanizations: [],
    },
    review_result: reviewRecord,
    review_timeline: [reviewRecord],
  };
}

function editorVersion(taskId: string, mode: EditorMode): ContentVersion | null {
  if (mode === 'no-current') return null;
  const aiDraft = mode === 'ai-draft';
  const changesRequested = mode === 'changes-requested';
  const reviewPending = mode === 'review-pending';
  return {
    id: editorContentId,
    task_id: taskId,
    fact_version_id: '20000000-0000-4000-8000-000000000002',
    source_job_id: aiDraft ? '40000000-0000-4000-8000-000000000002' : null,
    based_on_id: editorPreviousContentId,
    version: 2,
    source_type: aiDraft ? 'AI' : 'HUMAN',
    title: changesRequested ? '待修订内容' : aiDraft ? 'AI 原始草稿' : '当前人工草稿',
    summary: 'Content Editor fixture 摘要',
    body_markdown: '# 当前正文\n\n工作电压为 3.3 V。',
    tags: ['工业,控制', '选型'],
    content_hash: 'a'.repeat(64),
    status: reviewPending ? 'PENDING_REVIEW' : changesRequested ? 'CHANGES_REQUESTED' : 'DRAFT',
    workflow_stage: reviewPending
      ? 'CURRENT_REVIEW_PENDING'
      : changesRequested
        ? 'CURRENT_CHANGES_REQUESTED'
        : 'CURRENT_DRAFT',
    primary_task: reviewPending
      ? 'REVIEW_CONTENT'
      : changesRequested
        ? 'CREATE_REVISION'
        : 'EDIT_AND_SUBMIT_REVIEW',
    available_actions: reviewPending
      ? ['APPROVE', 'REQUEST_CHANGES']
      : changesRequested
        ? ['CREATE_REVISION', 'ABANDON']
        : aiDraft
          ? ['CREATE_REVISION', 'CREATE_HUMANIZATION_JOB', 'SUBMIT_REVIEW', 'ABANDON']
          : ['SAVE', 'DELETE', 'SUBMIT_REVIEW'],
    revision: 2,
    quality_issues: [{ code: 'MISSING_SOURCE', severity: 'WARNING', message: '建议补充来源说明' }],
    created_by: user.id,
    created_at: '2026-08-10T08:00:00Z',
  };
}

function contentEditorContext(item: ContentTaskListItem, mode: EditorMode): ContentEditorContext {
  const current = editorVersion(item.id, mode);
  const aiDraft = mode === 'ai-draft';
  const noCurrent = mode === 'no-current';
  const changesRequested = mode === 'changes-requested';
  const reviewPending = mode === 'review-pending';
  return {
    task: {
      id: item.id,
      identifier: item.identifier,
      status: item.status,
      workflow_stage: noCurrent
        ? 'NO_DRAFT'
        : reviewPending
          ? 'REVIEW_PENDING'
          : changesRequested
            ? 'CHANGES_REQUESTED'
            : 'DRAFT',
      primary_task: noCurrent
        ? 'CREATE_FIRST_DRAFT'
        : reviewPending
          ? 'REVIEW_CONTENT'
          : changesRequested
            ? 'REVISE_CONTENT'
            : 'EDIT_AND_SUBMIT_REVIEW',
      available_actions: noCurrent
        ? ['CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION', 'CANCEL']
        : ['CANCEL'],
      deletion: item.deletion,
      revision: item.revision,
      created_by: item.created_by,
      created_at: item.created_at,
      archived_at: item.archived_at,
    },
    product: { ...item.product, category: 'MCU', status: 'ACTIVE' },
    platform: item.platform,
    locked_fact_version: {
      id: item.fact_version_id,
      version: 3,
      status: 'APPROVED',
      classification: 'PUBLIC',
      body_markdown: '## 锁定事实\n\n- 工作电压：3.3 V\n- 工作温度：-40°C 至 85°C',
    },
    current_content: current,
    comparison_content: current ? {
      id: editorPreviousContentId,
      version: 1,
      source_type: 'AI',
      status: 'DRAFT',
      title: '上一版本',
    } : null,
    diff: current ? {
      left_id: editorPreviousContentId,
      right_id: current.id,
      lines: [
        { kind: 'DELETE', old_line: 1, new_line: null, text: '旧正文' },
        { kind: 'ADD', old_line: null, new_line: 1, text: '当前正文' },
      ],
    } : null,
    latest_generation: aiDraft ? {
      id: '40000000-0000-4000-8000-000000000002',
      job_type: 'GENERATE',
      status: 'SUCCEEDED',
      attempt_count: 1,
      error_code: null,
      error_summary: null,
      created_at: '2026-08-10T07:55:00Z',
      started_at: '2026-08-10T07:56:00Z',
      finished_at: '2026-08-10T07:57:00Z',
    } : null,
    current_lineage: aiDraft ? {
      generation: {
        job_id: '40000000-0000-4000-8000-000000000002',
        contract_version: '2',
        channel: { id: '80000000-0000-4000-8000-000000000001', name: 'Fixture Channel', protocol_type: 'OPENAI_COMPATIBLE' },
        model: { id: '80000000-0000-4000-8000-000000000002', display_name: 'Fixture Model', model_id: 'fixture-model' },
        platform_prompt: { id: '80000000-0000-4000-8000-000000000003', name: 'Content Prompt', revision: 4 },
      },
      humanizations: [],
    } : null,
    source: {
      query_topic: {
        id: '60000000-0000-4000-8000-000000000002',
        canonical_question: `如何选择 ${item.product.part_number}？`,
      },
      geo_optimization: null,
      published_content_issue: null,
    },
  };
}

function contentReviewContext(item: ContentTaskListItem, mode: ReviewMode): ContentReviewContext {
  const base = editorVersion(item.id, 'review-pending');
  if (!base) throw new Error('Content Review fixture 缺少待审核版本');
  const approved = mode === 'approved';
  const changesRequested = mode === 'changes-requested';
  const content: ContentVersion = {
    ...base,
    source_job_id: generationJobId,
    title: 'PS-0002 平台适配指南',
    body_markdown: '# Canonical 内容\n\n工作电压为 3.3 V。',
    status: approved ? 'APPROVED' : changesRequested ? 'CHANGES_REQUESTED' : 'PENDING_REVIEW',
    workflow_stage: approved
      ? 'CURRENT_APPROVED'
      : changesRequested
        ? 'CURRENT_CHANGES_REQUESTED'
        : 'CURRENT_REVIEW_PENDING',
    primary_task: approved
      ? 'START_PUBLICATION'
      : changesRequested
        ? 'CREATE_REVISION'
        : 'REVIEW_CONTENT',
    available_actions: approved
      ? []
      : changesRequested
        ? ['CREATE_REVISION']
        : ['APPROVE', 'REQUEST_CHANGES'],
    quality_issues: [
      ...(mode === 'blocking'
        ? [{ code: 'MISSING_SOURCE', severity: 'BLOCKING' as const, message: '缺少来源说明' }]
        : []),
      { code: 'LONG_TITLE', severity: 'WARNING', message: '标题可能过长' },
    ],
  };
  return {
    content,
    task: {
      ...commandResponse(item),
      current_content_version_id: content.id,
      workflow_stage: approved ? 'APPROVED' : changesRequested ? 'CHANGES_REQUESTED' : 'REVIEW_PENDING',
      primary_task: approved
        ? 'START_PUBLICATION'
        : changesRequested
          ? 'REVISE_CONTENT'
          : 'REVIEW_CONTENT',
    },
    fact_version: {
      id: item.fact_version_id,
      product_id: item.product_id,
      version: 3,
      status: 'APPROVED',
      body_markdown: '## 批准事实\n\n- 工作电压：3.3 V\n- 温度范围：-40°C 至 85°C',
      classification: 'PUBLIC',
      change_summary: '批准公开事实',
      primary_task: 'CREATE_CONTENT_TASK',
      available_actions: ['RETIRE'],
      deletion: null,
      revision: 1,
      created_by: user.id,
      approved_by: user.id,
      created_at: '2026-08-09T06:00:00Z',
      approved_at: '2026-08-09T07:00:00Z',
    },
    diff: {
      left_id: editorPreviousContentId,
      right_id: content.id,
      lines: [
        { kind: 'DELETE', old_line: 1, new_line: null, text: '旧正文' },
        { kind: 'ADD', old_line: null, new_line: 1, text: 'Canonical 内容' },
      ],
    },
    generation_trace: {
      job_id: generationJobId,
      input_snapshot: {
        adapter_name: 'openai-compatible-chat-completions',
        contract_version: 'content-markdown-v3',
        channel: { id: generationChannelId, timeout_seconds: 10 },
        model: { id: generationModelId, model_id: 'fixture-model', request_parameters: {} },
        platform_profile: { id: platformId, name: platform.name, slug: platform.slug },
        platform_prompt: {
          id: generationPromptId,
          name: generationOptions.platform_prompt.name,
          revision: generationOptions.platform_prompt.revision,
        },
        fact_version: {
          id: item.fact_version_id,
          product_id: item.product_id,
          version: 3,
          classification: 'PUBLIC',
        },
        system_message: generationOptions.platform_prompt.template_markdown,
        user_message: '## 锁定事实\n\n- 工作电压：3.3 V',
      },
    },
    humanization_traces: [],
    available_actions: mode === 'review-pending'
      ? ['APPROVE', 'REQUEST_CHANGES']
      : mode === 'blocking'
        ? ['REQUEST_CHANGES']
        : [],
    review_history: [{
      id: '90000000-0000-4000-8000-000000000001',
      target_id: content.id,
      target_version: content.version,
      action: 'submit-review',
      comment: '请审核平台适配',
      actor: { id: user.id, username: user.username, display_name: user.display_name },
      created_at: '2026-08-10T08:30:00Z',
    }],
  };
}

function createdHumanEditorVersion(
  context: ContentEditorContext,
  body: ContentRevisionCreate,
  basedOnId: string | null,
): ContentVersion {
  return {
    id: '30000000-0000-4000-8000-000000000202',
    task_id: context.task.id,
    fact_version_id: context.locked_fact_version.id,
    source_job_id: null,
    based_on_id: basedOnId,
    version: (context.current_content?.version ?? 0) + 1,
    source_type: 'HUMAN',
    title: body.title,
    summary: body.summary,
    body_markdown: body.body_markdown,
    tags: body.tags,
    content_hash: 'b'.repeat(64),
    status: 'DRAFT',
    workflow_stage: 'CURRENT_DRAFT',
    primary_task: 'EDIT_AND_SUBMIT_REVIEW',
    available_actions: ['SAVE', 'DELETE', 'SUBMIT_REVIEW'],
    revision: 0,
    quality_issues: [],
    created_by: user.id,
    created_at: '2026-08-10T12:00:00Z',
  };
}

function generationJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: generationJobId,
    content_task_id: editorTaskId,
    job_type: 'GENERATE',
    source_content_version_id: null,
    status: 'PENDING',
    workflow_stage: 'IN_PROGRESS',
    primary_task: 'VIEW_EXECUTION_PROGRESS',
    available_actions: [],
    attempt_count: 0,
    content_version_id: null,
    retry_of_id: null,
    error_code: null,
    error_summary: null,
    provider_request_id: null,
    response_duration_ms: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    created_at: '2026-08-10T12:00:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

function generationJobDetail(job: GenerationJob): GenerationJobDetail {
  return {
    ...job,
    input_snapshot: {
      adapter_name: 'openai-compatible-chat-completions',
      contract_version: 'content-markdown-v3',
      channel: { id: generationChannelId, timeout_seconds: 10 },
      model: {
        id: generationModelId,
        model_id: 'fixture-model',
        request_parameters: {},
      },
      platform_profile: { id: platformId, name: platform.name, slug: platform.slug },
      platform_prompt: {
        id: generationPromptId,
        name: generationOptions.platform_prompt.name,
        revision: generationOptions.platform_prompt.revision,
      },
      fact_version: {
        id: '20000000-0000-4000-8000-000000000002',
        product_id: '10000000-0000-4000-8000-000000000002',
        version: 3,
        classification: 'PUBLIC',
      },
      system_message: generationOptions.platform_prompt.template_markdown,
      user_message: '## 锁定事实\n\n- 工作电压：3.3 V',
    },
  };
}

function completedAiVersion(
  context: ContentEditorContext,
  job: GenerationJob,
): ContentVersion {
  const source = context.current_content;
  return {
    id: job.content_version_id ?? '30000000-0000-4000-8000-000000000302',
    task_id: context.task.id,
    fact_version_id: context.locked_fact_version.id,
    source_job_id: job.id,
    based_on_id: job.job_type === 'HUMANIZE' ? source?.id ?? null : null,
    version: (source?.version ?? 0) + 1,
    source_type: 'AI',
    title: job.job_type === 'HUMANIZE' ? '自然化后的 AI 草稿' : 'AI 生成首稿',
    summary: '由 fixture Worker 生成的内容摘要',
    body_markdown: '# AI 正文\n\n工作电压为 3.3 V。',
    tags: ['AI', '选型'],
    content_hash: 'c'.repeat(64),
    status: 'DRAFT',
    workflow_stage: 'CURRENT_DRAFT',
    primary_task: 'EDIT_AND_SUBMIT_REVIEW',
    available_actions: [
      'CREATE_REVISION',
      'CREATE_HUMANIZATION_JOB',
      'SUBMIT_REVIEW',
      'ABANDON',
    ],
    revision: 0,
    quality_issues: [],
    created_by: user.id,
    created_at: '2026-08-10T12:00:02Z',
  };
}

function compactGeneration(job: GenerationJob): NonNullable<ContentEditorContext['latest_generation']> {
  return {
    id: job.id,
    job_type: job.job_type,
    status: job.status,
    attempt_count: job.attempt_count,
    error_code: job.error_code ?? null,
    error_summary: job.error_summary ?? null,
    created_at: job.created_at,
    started_at: job.started_at ?? null,
    finished_at: job.finished_at ?? null,
  };
}

function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details: Record<string, unknown> = {},
) {
  return {
    error: { code, message, details, request_id: requestId },
  } satisfies components['schemas']['ErrorEnvelope'];
}

const test = base.extend<ContentFixtures>({
  contentApi: [async ({ page }, use) => {
    const items = createContentTasks();
    let listMode: ContentTaskListMode = 'success';
    let mutationMode: MutationMode = 'success';
    let creationOptionsMode: CreationOptionsMode = 'success';
    let createMode: CreateMode = 'success';
    let detailMode: DetailMode = 'success';
    let editorMode: EditorMode = 'human-draft';
    let editorMutationMode: EditorMutationMode = 'success';
    let failNextEditorContextRequest = false;
    let reviewMode: ReviewMode = 'review-pending';
    let reviewMutationMode: ReviewMutationMode = 'success';
    let versionDetailMode: VersionDetailMode = 'success';
    let aiOutcome: AiOutcome = 'success';
    let generationJobPolls = 0;
    let generationJobs: GenerationJob[] = [];
    let editorContextState = contentEditorContext(
      items.find((item) => item.id === editorTaskId) ?? items[1],
      editorMode,
    );
    let reviewContextState = contentReviewContext(
      items.find((item) => item.id === reviewTaskId) ?? items[1],
      reviewMode,
    );
    let versionDetailState = contentVersionDetail(
      items.find((item) => item.id === contentVersionTaskId) ?? items[0],
    );
    let releaseLoading: (() => void) | undefined;
    let releaseOptionsLoading: (() => void) | undefined;
    let releaseCreate: (() => void) | undefined;
    let releaseDetailLoading: (() => void) | undefined;
    let releaseReviewLoading: (() => void) | undefined;
    let releaseVersionDetailLoading: (() => void) | undefined;
    const creationOptionsRequests: URL[] = [];
    const createRequests: CreateRequest[] = [];
    const detailRequests: URL[] = [];
    const editorContextRequests: URL[] = [];
    const editorDeleteRequests: EditorDeleteRequest[] = [];
    const editorRevisionRequests: EditorRevisionRequest[] = [];
    const editorSaveRequests: EditorSaveRequest[] = [];
    const editorCommandRequests: EditorCommandRequest[] = [];
    const aiJobRequests: AiJobRequest[] = [];
    const generationJobDetailRequests: URL[] = [];
    const generationJobListRequests: URL[] = [];
    const generationOptionsRequests: URL[] = [];
    const listRequests: URL[] = [];
    const lifecycleRequests: LifecycleRequest[] = [];
    const reviewCommandRequests: ReviewCommandRequest[] = [];
    const reviewContextRequests: URL[] = [];
    const versionDetailRequests: URL[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];

    page.on('console', (message) => {
      if ([
        '503 (Service Unavailable)',
        '422 (Unprocessable Entity)',
        '409 (Conflict)',
        '404 (Not Found)',
        '403 (Forbidden)',
      ].some((status) => message.text().includes(status))) return;
      if (message.type() === 'error') runtimeErrors.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`);
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();

      if (method === 'GET' && url.pathname === '/api/v1/auth/me') {
        await route.fulfill({ status: 200, json: user });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/auth/csrf') {
        await route.fulfill({ status: 200, json: { csrf_token: 'content-e2e-csrf' } satisfies components['schemas']['CsrfToken'] });
        return;
      }
      const productDetailMatch = url.pathname.match(/^\/api\/v1\/products\/([^/]+)\/detail$/);
      if (
        method === 'GET'
        && productDetailMatch
        && productDetailMatch[1] === creationProductId
      ) {
        await route.fulfill({ status: 200, json: productDetail });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/platform-profiles') {
        await route.fulfill({
          status: 200,
          json: {
            items: [platform],
            page: 1,
            page_size: 1,
            total: 1,
            summary: { platform_total: 1, enabled_total: 1, missing_prompt_total: 1, configuration_complete_total: 0, readiness_complete_total: 0, missing_account_total: 0 },
            platform_type_options: [],
          } satisfies components['schemas']['PlatformProfileList'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/content-tasks/creation-options') {
        creationOptionsRequests.push(url);
        if (creationOptionsMode === 'loading') {
          await new Promise<void>((resolve) => { releaseOptionsLoading = resolve; });
        }
        if (creationOptionsMode === 'error') {
          await route.fulfill({
            status: 503,
            json: errorEnvelope(
              'CONTENT_TASK_OPTIONS_UNAVAILABLE',
              '创建选项暂不可用',
              'req-content-options',
            ),
          });
          return;
        }
        if (creationOptionsMode === 'empty') {
          await route.fulfill({
            status: 200,
            json: {
              products: [],
              platforms: [],
              requested_product: null,
            } satisfies CreationOptions,
          });
          return;
        }
        const requestedProductId = url.searchParams.get('requested_product_id');
        const eligible = creationOptions.products.find(
          (item) => item.id === requestedProductId,
        );
        const requestedProduct = !requestedProductId
          ? null
          : eligible
            ? {
                product_id: eligible.id,
                brand: eligible.brand,
                part_number: eligible.part_number,
                eligibility: 'ELIGIBLE' as const,
              }
            : requestedProductId === inactiveProductId
              ? {
                  product_id: inactiveProductId,
                  brand: 'PartSignal',
                  part_number: 'PS-INACTIVE',
                  eligibility: 'PRODUCT_INACTIVE' as const,
                }
              : requestedProductId === noFactsProductId
                ? {
                    product_id: noFactsProductId,
                    brand: 'PartSignal',
                    part_number: 'PS-NO-FACTS',
                    eligibility: 'NO_APPROVED_FACTS' as const,
                  }
                : {
                    product_id: requestedProductId,
                    brand: null,
                    part_number: null,
                    eligibility: 'NOT_FOUND' as const,
                  };
        await route.fulfill({
          status: 200,
          json: { ...creationOptions, requested_product: requestedProduct } satisfies CreationOptions,
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/content-tasks') {
        listRequests.push(url);
        if (listMode === 'loading') {
          await new Promise<void>((resolve) => { releaseLoading = resolve; });
        }
        if (listMode === 'error') {
          await route.fulfill({ status: 503, json: errorEnvelope('CONTENT_TASKS_UNAVAILABLE', '内容任务服务暂不可用', 'req-content-list') });
          return;
        }
        const archiveStatus = url.searchParams.get('archive_status') ?? 'ACTIVE';
        const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase('zh-CN');
        const workflowStage = url.searchParams.get('workflow_stage');
        const requestedPlatform = url.searchParams.get('platform_profile_id');
        const filtered = listMode === 'empty' ? [] : items.filter((item) => {
          const archived = item.archived_at !== null;
          return (archiveStatus === 'ALL' || (archiveStatus === 'ARCHIVED' ? archived : !archived))
            && (!query || `${item.identifier} ${item.product.brand} ${item.product.part_number} ${item.platform.name}`.toLocaleLowerCase('zh-CN').includes(query))
            && (!workflowStage || item.workflow_stage === workflowStage)
            && (!requestedPlatform || item.platform_profile_id === requestedPlatform);
        });
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('page_size') ?? 20);
        await route.fulfill({
          status: 200,
          json: {
            items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
            page: pageNumber,
            page_size: pageSize,
            total: filtered.length,
          } satisfies components['schemas']['ContentTaskList'],
        });
        return;
      }
      const generationOptionsMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)\/generation-options$/);
      if (method === 'GET' && generationOptionsMatch) {
        generationOptionsRequests.push(url);
        await route.fulfill({ status: 200, json: generationOptions });
        return;
      }
      const generationJobsMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)\/generation-jobs$/);
      if (method === 'POST' && generationJobsMatch) {
        const body = request.postDataJSON() as OriginalGenerationJobCreate;
        aiJobRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          idempotencyKey: request.headers()['idempotency-key'] ?? null,
          kind: 'generate',
          targetId: generationJobsMatch[1],
        });
        const created = generationJob({ id: generationJobId });
        generationJobs = [created];
        generationJobPolls = 0;
        editorContextState = {
          ...editorContextState,
          task: {
            ...editorContextState.task,
            workflow_stage: 'GENERATING',
            primary_task: 'VIEW_GENERATION_PROGRESS',
            available_actions: ['CREATE_MANUAL_VERSION', 'CANCEL'],
          },
          latest_generation: compactGeneration(created),
        };
        await route.fulfill({ status: 202, json: created });
        return;
      }
      if (method === 'GET' && generationJobsMatch) {
        generationJobListRequests.push(url);
        const latest = generationJobs[0];
        if (latest && (latest.status === 'PENDING' || latest.status === 'RUNNING')) {
          generationJobPolls += 1;
          if (generationJobPolls >= 2) {
            const succeeded = aiOutcome === 'success';
            const terminal = generationJob({
              ...latest,
              status: succeeded ? 'SUCCEEDED' : 'FAILED',
              workflow_stage: succeeded ? 'SUCCEEDED' : 'RETRYABLE_FAILURE',
              primary_task: succeeded ? 'VIEW_GENERATED_CONTENT' : 'HANDLE_FAILURE',
              available_actions: succeeded ? [] : ['RETRY'],
              attempt_count: 1,
              content_version_id: succeeded
                ? '30000000-0000-4000-8000-000000000302'
                : null,
              error_code: succeeded ? null : 'MODEL_TIMEOUT',
              error_summary: succeeded ? null : '模型响应超时',
              started_at: '2026-08-10T12:00:01Z',
              finished_at: '2026-08-10T12:00:02Z',
            });
            generationJobs = [terminal, ...generationJobs.slice(1)];
            const source = editorContextState.current_content;
            editorContextState = {
              ...editorContextState,
              task: {
                ...editorContextState.task,
                workflow_stage: succeeded ? 'DRAFT' : 'GENERATION_FAILED',
                primary_task: succeeded ? 'EDIT_AND_SUBMIT_REVIEW' : 'HANDLE_GENERATION_FAILURE',
                available_actions: succeeded
                  ? ['CANCEL']
                  : ['CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION', 'CANCEL'],
              },
              current_content: succeeded
                ? completedAiVersion(editorContextState, terminal)
                : editorContextState.current_content,
              comparison_content: succeeded && source ? {
                id: source.id,
                version: source.version,
                source_type: source.source_type,
                status: source.status,
                title: source.title,
              } : editorContextState.comparison_content,
              latest_generation: compactGeneration(terminal),
            };
          } else if (latest.status === 'PENDING') {
            const running = generationJob({
              ...latest,
              status: 'RUNNING',
              started_at: '2026-08-10T12:00:01Z',
            });
            generationJobs = [running, ...generationJobs.slice(1)];
            editorContextState = {
              ...editorContextState,
              latest_generation: compactGeneration(running),
            };
          }
        }
        await route.fulfill({
          status: 200,
          json: { items: generationJobs } satisfies components['schemas']['GenerationJobList'],
        });
        return;
      }
      const generationJobDetailMatch = url.pathname.match(/^\/api\/v1\/generation-jobs\/([^/]+)$/);
      if (method === 'GET' && generationJobDetailMatch) {
        generationJobDetailRequests.push(url);
        const target = generationJobs.find((job) => job.id === generationJobDetailMatch[1]);
        if (!target) {
          await route.fulfill({ status: 404, json: errorEnvelope('NOT_FOUND', '生成作业不存在', 'req-generation-job-not-found') });
          return;
        }
        await route.fulfill({ status: 200, json: generationJobDetail(target) });
        return;
      }
      const generationRetryMatch = url.pathname.match(/^\/api\/v1\/generation-jobs\/([^/]+)\/retry$/);
      if (method === 'POST' && generationRetryMatch) {
        aiJobRequests.push({
          body: null,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          idempotencyKey: request.headers()['idempotency-key'] ?? null,
          kind: 'retry',
          targetId: generationRetryMatch[1],
        });
        aiOutcome = 'success';
        const created = generationJob({ id: retryJobId, retry_of_id: generationRetryMatch[1] });
        generationJobs = [created, ...generationJobs];
        generationJobPolls = 0;
        editorContextState = {
          ...editorContextState,
          task: {
            ...editorContextState.task,
            workflow_stage: 'GENERATING',
            primary_task: 'VIEW_GENERATION_PROGRESS',
          },
          latest_generation: compactGeneration(created),
        };
        await route.fulfill({ status: 202, json: created });
        return;
      }
      const humanizationMatch = url.pathname.match(/^\/api\/v1\/content-versions\/([^/]+)\/humanization-jobs$/);
      if (method === 'POST' && humanizationMatch) {
        const body = request.postDataJSON() as HumanizationJobCreate;
        aiJobRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          idempotencyKey: request.headers()['idempotency-key'] ?? null,
          kind: 'humanize',
          targetId: humanizationMatch[1],
        });
        aiOutcome = 'success';
        const created = generationJob({
          id: humanizationJobId,
          job_type: 'HUMANIZE',
          source_content_version_id: humanizationMatch[1],
        });
        generationJobs = [created, ...generationJobs];
        generationJobPolls = 0;
        editorContextState = {
          ...editorContextState,
          latest_generation: compactGeneration(created),
        };
        await route.fulfill({ status: 202, json: created });
        return;
      }
      const versionDetailMatch = url.pathname.match(
        /^\/api\/v1\/content-versions\/([^/]+)\/detail$/,
      );
      if (method === 'GET' && versionDetailMatch) {
        versionDetailRequests.push(url);
        if (versionDetailMode === 'loading') {
          await new Promise<void>((resolve) => { releaseVersionDetailLoading = resolve; });
        }
        if (versionDetailMode === 'error') {
          await route.fulfill({
            status: 503,
            json: errorEnvelope(
              'CONTENT_VERSION_DETAIL_UNAVAILABLE',
              '内容版本详情暂不可用',
              'req-content-version-detail',
            ),
          });
          return;
        }
        if (versionDetailMode === 'not-found' || versionDetailMode === 'forbidden') {
          const forbidden = versionDetailMode === 'forbidden';
          await route.fulfill({
            status: forbidden ? 403 : 404,
            json: errorEnvelope(
              forbidden ? 'PERMISSION_DENIED' : 'NOT_FOUND',
              forbidden ? '没有读取内容版本的权限' : '内容版本不存在',
              forbidden
                ? 'req-content-version-detail-forbidden'
                : 'req-content-version-detail-not-found',
            ),
          });
          return;
        }
        if (versionDetailMatch[1] !== versionDetailState.content.id) {
          await route.fulfill({
            status: 404,
            json: errorEnvelope(
              'NOT_FOUND',
              '内容版本不存在',
              'req-content-version-detail-not-found',
            ),
          });
          return;
        }
        await route.fulfill({ status: 200, json: versionDetailState });
        return;
      }
      const reviewContextMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)\/review-context$/);
      if (method === 'GET' && reviewContextMatch) {
        reviewContextRequests.push(url);
        if (reviewMode === 'loading') {
          await new Promise<void>((resolve) => { releaseReviewLoading = resolve; });
        }
        if (reviewMode === 'error') {
          await route.fulfill({
            status: 503,
            json: errorEnvelope(
              'CONTENT_REVIEW_UNAVAILABLE',
              '内容审核上下文暂不可用',
              'req-content-review-load',
            ),
          });
          return;
        }
        if (reviewContextMatch[1] !== reviewContextState.task.id) {
          await route.fulfill({
            status: 404,
            json: errorEnvelope('NOT_FOUND', '内容任务不存在', 'req-content-review-not-found'),
          });
          return;
        }
        await route.fulfill({ status: 200, json: reviewContextState });
        return;
      }
      const reviewCommandMatch = url.pathname.match(
        /^\/api\/v1\/content-versions\/([^/]+)\/(approve|request-changes)$/,
      );
      if (method === 'POST' && reviewCommandMatch) {
        const command = reviewCommandMatch[2] as ReviewCommandRequest['command'];
        const body = request.postDataJSON() as CommandRequest | RequestChangesCommand;
        reviewCommandRequests.push({
          body,
          command,
          contentVersionId: reviewCommandMatch[1],
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });
        if (reviewMutationMode === 'revision-conflict') {
          reviewContextState = {
            ...reviewContextState,
            content: {
              ...reviewContextState.content,
              revision: reviewContextState.content.revision + 1,
            },
          };
          await route.fulfill({
            status: 409,
            json: errorEnvelope(
              'REVISION_CONFLICT',
              '内容版本已被其他请求修改',
              'req-content-review-conflict',
            ),
          });
          return;
        }
        if (reviewMutationMode === 'validation' && command === 'request-changes') {
          await route.fulfill({
            status: 422,
            json: errorEnvelope(
              'VALIDATION_ERROR',
              '请求数据不符合接口契约',
              'req-content-review-validation',
              { errors: [{ loc: ['body', 'comment'], msg: '审核意见至少需要 5 个字符' }] },
            ),
          });
          return;
        }
        const approved = command === 'approve';
        const canonical: ContentVersion = {
          ...reviewContextState.content,
          status: approved ? 'APPROVED' : 'CHANGES_REQUESTED',
          workflow_stage: approved ? 'CURRENT_APPROVED' : 'CURRENT_CHANGES_REQUESTED',
          primary_task: approved ? 'START_PUBLICATION' : 'CREATE_REVISION',
          available_actions: approved ? [] : ['CREATE_REVISION'],
          revision: reviewContextState.content.revision + 1,
        };
        reviewContextState = {
          ...reviewContextState,
          content: canonical,
          task: {
            ...reviewContextState.task,
            workflow_stage: approved ? 'APPROVED' : 'CHANGES_REQUESTED',
            primary_task: approved ? 'START_PUBLICATION' : 'REVISE_CONTENT',
          },
          available_actions: [],
          review_history: [
            ...reviewContextState.review_history,
            {
              id: approved
                ? '90000000-0000-4000-8000-000000000002'
                : '90000000-0000-4000-8000-000000000003',
              target_id: canonical.id,
              target_version: canonical.version,
              action: command,
              comment: body.comment,
              actor: { id: user.id, username: user.username, display_name: user.display_name },
              created_at: '2026-08-10T09:00:00Z',
            },
          ],
        };
        await route.fulfill({ status: 200, json: canonical });
        return;
      }
      const editorContextMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)\/editor-context$/);
      if (method === 'GET' && editorContextMatch) {
        editorContextRequests.push(url);
        if (failNextEditorContextRequest) {
          failNextEditorContextRequest = false;
          await route.fulfill({
            status: 503,
            json: errorEnvelope(
              'CONTENT_EDITOR_CONTEXT_UNAVAILABLE',
              '内容编辑器上下文暂不可用',
              'req-content-editor-reload',
            ),
          });
          return;
        }
        if (editorContextMatch[1] !== editorContextState.task.id) {
          const item = items.find((candidate) => candidate.id === editorContextMatch[1]);
          if (!item) {
            await route.fulfill({ status: 404, json: errorEnvelope('NOT_FOUND', '内容任务不存在', 'req-content-editor-not-found') });
            return;
          }
          editorContextState = contentEditorContext(item, editorMode);
        }
        await route.fulfill({ status: 200, json: editorContextState });
        return;
      }
      const detailMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)\/detail$/);
      if (method === 'GET' && detailMatch) {
        detailRequests.push(url);
        if (detailMode === 'loading') {
          await new Promise<void>((resolve) => { releaseDetailLoading = resolve; });
        }
        if (detailMode === 'error') {
          await route.fulfill({ status: 503, json: errorEnvelope('CONTENT_TASK_DETAIL_UNAVAILABLE', '内容任务详情暂不可用', 'req-content-detail') });
          return;
        }
        if (detailMode === 'not-found' || detailMode === 'forbidden') {
          const forbidden = detailMode === 'forbidden';
          await route.fulfill({
            status: forbidden ? 403 : 404,
            json: errorEnvelope(
              forbidden ? 'PERMISSION_DENIED' : 'NOT_FOUND',
              forbidden ? '没有读取内容任务详情的权限' : '内容任务不存在',
              forbidden ? 'req-content-detail-forbidden' : 'req-content-detail-not-found',
            ),
          });
          return;
        }
        const item = items.find((candidate) => candidate.id === detailMatch[1]);
        if (!item) {
          await route.fulfill({ status: 404, json: errorEnvelope('NOT_FOUND', '内容任务不存在', 'req-content-detail-not-found') });
          return;
        }
        const response = contentTaskDetail(item, detailMode === 'empty');
        if (detailMode === 'cancelled') {
          response.task = {
            ...response.task,
            status: 'CANCELLED',
            workflow_stage: 'CANCELLED',
            primary_task: 'VIEW_CANCELLATION',
            available_actions: ['DELETE'],
            deletion: { blockers: [] },
          };
        }
        await route.fulfill({ status: 200, json: response });
        return;
      }
      const manualVersionMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)\/manual-versions$/);
      if (method === 'POST' && manualVersionMatch) {
        const body = request.postDataJSON() as ContentRevisionCreate;
        editorRevisionRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          contentVersionId: null,
          taskId: manualVersionMatch[1],
        });
        const current = createdHumanEditorVersion(editorContextState, body, null);
        editorContextState = {
          ...editorContextState,
          task: { ...editorContextState.task, workflow_stage: 'DRAFT', primary_task: 'EDIT_AND_SUBMIT_REVIEW', available_actions: ['CANCEL'] },
          current_content: current,
          comparison_content: null,
          diff: null,
        };
        await route.fulfill({ status: 201, json: current });
        return;
      }
      const revisionMatch = url.pathname.match(/^\/api\/v1\/content-versions\/([^/]+)\/revisions$/);
      if (method === 'POST' && revisionMatch) {
        const body = request.postDataJSON() as ContentRevisionCreate;
        const source = editorContextState.current_content;
        editorRevisionRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          contentVersionId: revisionMatch[1],
          taskId: null,
        });
        const current = createdHumanEditorVersion(editorContextState, body, revisionMatch[1]);
        editorContextState = {
          ...editorContextState,
          task: { ...editorContextState.task, workflow_stage: 'DRAFT', primary_task: 'EDIT_AND_SUBMIT_REVIEW' },
          current_content: current,
          comparison_content: source ? {
            id: source.id,
            version: source.version,
            source_type: source.source_type,
            status: source.status,
            title: source.title,
          } : null,
          diff: source ? {
            left_id: source.id,
            right_id: current.id,
            lines: [{ kind: 'ADD', old_line: null, new_line: 1, text: current.body_markdown }],
          } : null,
        };
        await route.fulfill({ status: 201, json: current });
        return;
      }
      const contentVersionMatch = url.pathname.match(/^\/api\/v1\/content-versions\/([^/]+)$/);
      if (method === 'PUT' && contentVersionMatch) {
        const body = request.postDataJSON() as ContentDraftUpdate;
        editorSaveRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          contentVersionId: contentVersionMatch[1],
        });
        const current = editorContextState.current_content;
        if (!current) {
          await route.fulfill({ status: 409, json: errorEnvelope('NO_CURRENT_CONTENT', '当前没有可保存的内容', 'req-content-editor-empty') });
          return;
        }
        if (editorMutationMode === 'save-revision-conflict') {
          editorContextState = {
            ...editorContextState,
            current_content: { ...current, title: '服务端最新标题', revision: current.revision + 1 },
          };
          await route.fulfill({ status: 409, json: errorEnvelope('REVISION_CONFLICT', '内容版本已被其他请求修改', 'req-content-editor-conflict') });
          return;
        }
        const canonical: ContentVersion = {
          ...current,
          title: body.title,
          summary: body.summary,
          body_markdown: body.body_markdown,
          tags: body.tags,
          revision: current.revision + 1,
        };
        editorContextState = { ...editorContextState, current_content: canonical };
        await route.fulfill({ status: 200, json: canonical });
        return;
      }
      const contentCommandMatch = url.pathname.match(/^\/api\/v1\/content-versions\/([^/]+)\/(submit-review|abandon)$/);
      if (method === 'POST' && contentCommandMatch) {
        const command = contentCommandMatch[2] as EditorCommandRequest['command'];
        const body = request.postDataJSON() as CommandRequest;
        editorCommandRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          command,
          contentVersionId: contentCommandMatch[1],
        });
        const current = editorContextState.current_content;
        if (!current) {
          await route.fulfill({ status: 409, json: errorEnvelope('NO_CURRENT_CONTENT', '当前没有内容版本', 'req-content-editor-empty') });
          return;
        }
        if (
          command === 'submit-review'
          && editorMutationMode === 'submit-review-revision-conflict'
        ) {
          editorContextState = {
            ...editorContextState,
            task: {
              ...editorContextState.task,
              workflow_stage: 'CHANGES_REQUESTED',
              primary_task: 'REVISE_CONTENT',
            },
            current_content: {
              ...current,
              title: '服务端冲突后标题',
              body_markdown: '# 服务端 canonical 正文\n\n冲突后最新版本。',
              status: 'CHANGES_REQUESTED',
              workflow_stage: 'CURRENT_CHANGES_REQUESTED',
              primary_task: 'CREATE_REVISION',
              available_actions: ['CREATE_REVISION', 'ABANDON'],
              revision: current.revision + 1,
            },
          };
          await route.fulfill({
            status: 409,
            json: errorEnvelope(
              'REVISION_CONFLICT',
              '内容版本已被其他请求修改',
              'req-content-editor-submit-conflict',
            ),
          });
          return;
        }
        const canonical: ContentVersion = command === 'submit-review'
          ? {
              ...current,
              status: 'PENDING_REVIEW',
              workflow_stage: 'CURRENT_REVIEW_PENDING',
              primary_task: 'REVIEW_CONTENT',
              available_actions: ['APPROVE', 'REQUEST_CHANGES'],
              revision: current.revision + 1,
            }
          : {
              ...current,
              status: 'ABANDONED',
              workflow_stage: 'HISTORICAL',
              primary_task: 'VIEW_VERSION_HISTORY',
              available_actions: [],
              revision: current.revision + 1,
            };
        if (command === 'submit-review') {
          editorContextState = {
            ...editorContextState,
            task: { ...editorContextState.task, workflow_stage: 'REVIEW_PENDING', primary_task: 'REVIEW_CONTENT' },
            current_content: canonical,
          };
        } else {
          const item = items.find((candidate) => candidate.id === editorTaskId) ?? items[1];
          editorContextState = contentEditorContext(item, 'no-current');
        }
        await route.fulfill({ status: 200, json: canonical });
        return;
      }
      if (method === 'DELETE' && contentVersionMatch) {
        editorDeleteRequests.push({
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          contentVersionId: contentVersionMatch[1],
          expectedRevision: Number(url.searchParams.get('expected_revision')) || null,
        });
        const item = items.find((candidate) => candidate.id === editorTaskId) ?? items[1];
        const restored = contentEditorContext(item, 'ai-draft');
        const restoredContent = restored.current_content;
        if (!restoredContent) throw new Error('DELETE fixture 缺少可恢复的父版本');
        editorContextState = {
          ...restored,
          current_content: {
            ...restoredContent,
            id: editorPreviousContentId,
            based_on_id: null,
            version: 1,
            title: '父级 AI 草稿',
          },
          comparison_content: null,
          diff: null,
        };
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      if (method === 'POST' && url.pathname === '/api/v1/content-tasks') {
        const body = request.postDataJSON() as ContentTaskCreate;
        createRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          idempotencyKey: request.headers()['idempotency-key'] ?? null,
        });
        if (createMode === 'pending') {
          await new Promise<void>((resolve) => { releaseCreate = resolve; });
        }
        const failures = {
          validation: {
            status: 422,
            code: 'VALIDATION_ERROR',
            message: '请求数据不符合接口契约',
            requestId: 'req-content-validation',
            details: {
              errors: [{
                loc: ['body', 'fact_version_id'],
                msg: '事实版本不属于所选产品',
                type: 'value_error',
              }],
            },
          },
          'fact-not-approved': {
            status: 409,
            code: 'FACT_NOT_APPROVED',
            message: '内容任务只能绑定非空的已批准事实版本',
            requestId: 'req-content-fact',
          },
          'platform-disabled': {
            status: 409,
            code: 'PLATFORM_DISABLED',
            message: '所选平台已停用',
            requestId: 'req-content-platform',
          },
          'not-found': {
            status: 404,
            code: 'NOT_FOUND',
            message: '平台配置不存在',
            requestId: 'req-content-not-found',
          },
          'idempotency-conflict': {
            status: 409,
            code: 'IDEMPOTENCY_CONFLICT',
            message: '幂等键已用于另一创建请求',
            requestId: 'req-content-idempotency',
          },
          forbidden: {
            status: 403,
            code: 'PERMISSION_DENIED',
            message: '没有创建内容任务的权限',
            requestId: 'req-content-forbidden',
          },
        } as const;
        if (createMode in failures) {
          const failure = failures[createMode as keyof typeof failures];
          await route.fulfill({
            status: failure.status,
            json: errorEnvelope(
              failure.code,
              failure.message,
              failure.requestId,
              'details' in failure ? failure.details : {},
            ),
          });
          return;
        }
        const response = createdTask(body);
        if (!items.some((item) => item.id === response.id)) items.unshift(createdListItem(body));
        await route.fulfill({ status: 201, json: response });
        return;
      }

      const previewMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)\/permanent-deletion-preview$/);
      if (method === 'GET' && previewMatch) {
        await route.fulfill({
          status: 200,
          json: {
            task_id: previewMatch[1],
            revision: 100,
            counts: {
              content_versions: 9,
              content_review_records: 2,
              generation_jobs: 1,
              publication_works: 1,
              publication_events: 2,
              publication_verifications: 1,
              published_articles: 1,
              published_content_issues: 0,
              geo_article_relations: 0,
              exclusive_geo_observation_chains: 0,
              attachment_relations: 0,
            },
            external_urls: ['https://example.com/published/1'],
            confirmation_text: '永久删除',
          } satisfies components['schemas']['ContentTaskPermanentDeletionPreview'],
        });
        return;
      }

      const lifecycleMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)(?:\/(cancel|archive|restore|permanent-delete))?$/);
      const command = lifecycleMatch?.[2];
      const lifecycleMethodAllowed = lifecycleMatch && (
        (method === 'DELETE' && command === undefined)
        || (method === 'POST' && command !== undefined)
      );
      if (lifecycleMethodAllowed && lifecycleMatch) {
        const body = request.postData() ? request.postDataJSON() as LifecycleBody : null;
        lifecycleRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          expectedRevision: Number(url.searchParams.get('expected_revision')) || null,
          method,
          pathname: url.pathname,
        });
        if (mutationMode === 'revision-conflict') {
          await route.fulfill({ status: 409, json: errorEnvelope('REVISION_CONFLICT', '内容任务已被其他请求修改', 'req-content-conflict') });
          return;
        }
        if (method === 'DELETE' || command === 'permanent-delete') {
          await route.fulfill({ status: 204, body: '' });
          return;
        }
        const item = items.find((candidate) => candidate.id === lifecycleMatch[1]) ?? items[0];
        await route.fulfill({ status: 200, json: commandResponse(item) });
        return;
      }

      unexpectedRequests.push(`${method} ${url.pathname}`);
      await route.fulfill({ status: 501, json: errorEnvelope('CONTENT_FIXTURE_UNEXPECTED_API', 'Content fixture 收到未声明的 API 请求', 'req-content-unexpected') });
    });

    await use({
      aiJobRequests,
      createRequests,
      creationOptionsRequests,
      detailRequests,
      editorCommandRequests,
      editorContextRequests,
      editorDeleteRequests,
      editorRevisionRequests,
      editorSaveRequests,
      failNextEditorContextRequest: () => { failNextEditorContextRequest = true; },
      generationJobDetailRequests,
      generationJobListRequests,
      generationOptionsRequests,
      getVersionDetail: () => versionDetailState,
      listRequests,
      lifecycleRequests,
      reviewCommandRequests,
      reviewContextRequests,
      versionDetailRequests,
      releaseCreate: () => {
        if (!releaseCreate) throw new Error('Content create 请求尚未开始');
        createMode = 'success';
        releaseCreate();
      },
      releaseDetailLoading: () => {
        if (!releaseDetailLoading) throw new Error('Content Detail loading 请求尚未开始');
        detailMode = 'success';
        releaseDetailLoading();
      },
      releaseLoading: () => {
        if (!releaseLoading) throw new Error('Content loading 请求尚未开始');
        listMode = 'success';
        releaseLoading();
      },
      releaseOptionsLoading: () => {
        if (!releaseOptionsLoading) throw new Error('Content options loading 请求尚未开始');
        creationOptionsMode = 'success';
        releaseOptionsLoading();
      },
      releaseReviewLoading: () => {
        if (!releaseReviewLoading) throw new Error('Content Review loading 请求尚未开始');
        reviewMode = 'review-pending';
        releaseReviewLoading();
      },
      releaseVersionDetailLoading: () => {
        if (!releaseVersionDetailLoading) throw new Error('Content Version Detail loading 请求尚未开始');
        versionDetailMode = 'success';
        releaseVersionDetailLoading();
      },
      setCreateMode: (mode) => { createMode = mode; },
      setCreationOptionsMode: (mode) => { creationOptionsMode = mode; },
      setDetailMode: (mode) => { detailMode = mode; },
      setEditorMode: (mode) => {
        editorMode = mode;
        const item = items.find((candidate) => candidate.id === editorTaskId) ?? items[1];
        editorContextState = contentEditorContext(item, mode);
        generationJobs = editorContextState.latest_generation
          ? [generationJob({
              id: editorContextState.latest_generation.id,
              job_type: editorContextState.latest_generation.job_type,
              status: editorContextState.latest_generation.status,
              workflow_stage: 'SUCCEEDED',
              primary_task: 'VIEW_GENERATED_CONTENT',
              content_version_id: editorContextState.current_content?.id ?? null,
              attempt_count: editorContextState.latest_generation.attempt_count,
              started_at: editorContextState.latest_generation.started_at,
              finished_at: editorContextState.latest_generation.finished_at,
            })]
          : [];
        generationJobPolls = 0;
      },
      setEditorMutationMode: (mode) => { editorMutationMode = mode; },
      setListMode: (mode) => { listMode = mode; },
      setMutationMode: (mode) => { mutationMode = mode; },
      setReviewMode: (mode) => {
        reviewMode = mode;
        if (mode === 'loading' || mode === 'error') return;
        const item = items.find((candidate) => candidate.id === reviewTaskId) ?? items[1];
        item.workflow_stage = mode === 'approved'
          ? 'APPROVED'
          : mode === 'changes-requested'
            ? 'CHANGES_REQUESTED'
            : 'REVIEW_PENDING';
        item.primary_task = mode === 'approved'
          ? 'START_PUBLICATION'
          : mode === 'changes-requested'
            ? 'REVISE_CONTENT'
            : 'REVIEW_CONTENT';
        reviewContextState = contentReviewContext(item, mode);
      },
      setReviewMutationMode: (mode) => { reviewMutationMode = mode; },
      setVersionDetail: (detail) => { versionDetailState = detail; },
      setVersionDetailMode: (mode) => { versionDetailMode = mode; },
      setAiOutcome: (outcome) => { aiOutcome = outcome; },
    });

    expect(unexpectedRequests, 'Content Tasks 页面不得依赖未声明的 API').toEqual([]);
    expect(runtimeErrors, 'Content Tasks 页面不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export {
  createdTaskId,
  contentVersionDetailId,
  contentVersionTaskId,
  creationFactId,
  creationProductId,
  editorTaskId,
  expect,
  inactiveProductId,
  noFactsProductId,
  platformId,
  reviewTaskId,
  secondCreationProductId,
  test,
};
