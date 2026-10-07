import type { components } from '@/shared/api/generated/schema';

type GeoObservationDetail = components['schemas']['GeoObservationDetail'];
type GeoObservationCorrectionContext = components['schemas']['GeoObservationCorrectionContext'];
type LegacyGeoObservationDetail = components['schemas']['LegacyGeoObservationDetail'];
type ManualGeoObservationDetail = components['schemas']['ManualGeoObservationDetail'];
type ManualHistoryItem = components['schemas']['GeoObservationCorrectionHistoryItem'];

const accuracyLabels = {
  ACCURATE: '准确',
  PARTIAL: '部分准确',
  INCORRECT: '不准确',
  UNJUDGEABLE: '无法判断',
} as const;

const recommendationLabels = {
  NONE: '未推荐',
  CANDIDATE: '候选',
  RECOMMENDED: '已推荐',
} as const;

function sameUuid(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function assertGeoObservationDetail(
  detail: GeoObservationDetail,
  requestedId: string,
): GeoObservationDetail {
  if (detail.observation_kind === 'LEGACY_MODEL_RESULT') {
    if (
      !sameUuid(detail.observation.id, requestedId)
      || detail.observation.product_id !== detail.product.id
      || detail.observation.query_topic_id !== detail.query_topic.id
    ) {
      throw contractMismatch('旧模型记录身份与请求不一致');
    }
    return detail;
  }

  const history = detail.correction_history;
  if (
    !sameUuid(detail.selected_observation_id, requestedId)
    || history.length === 0
    || history[0]?.observation.id !== detail.chain_root_id
    || history.at(-1)?.observation.id !== detail.chain_tail_id
    || history.filter((item) => item.is_original).length !== 1
    || history.filter((item) => item.is_selected).length !== 1
    || history.filter((item) => item.is_chain_tail).length !== 1
  ) {
    throw contractMismatch('人工观测更正链身份不完整');
  }

  history.forEach((item, index) => {
    const previousId = history[index - 1]?.observation.id ?? null;
    if (
      item.observation.product_id !== detail.product.id
      || item.observation.supersedes_id !== previousId
      || item.observation.query_topic_id !== (item.query_topic?.id ?? null)
      || item.observation.is_current !== item.is_chain_tail
      || (!item.is_chain_tail && item.observation.available_actions.length > 0)
      || item.is_original !== (index === 0)
      || item.is_selected !== sameUuid(item.observation.id, requestedId)
      || item.is_chain_tail !== (index === history.length - 1)
    ) {
      throw contractMismatch('人工观测更正链顺序与节点标记不一致');
    }
  });

  const tail = history.at(-1)?.observation;
  if (
    tail?.primary_task === 'CORRECT_OBSERVATION'
    && !tail.available_actions.includes('CORRECT')
  ) {
    throw contractMismatch('服务端 primary task 缺少对应动作资格');
  }
  return detail;
}

function assertGeoObservationCorrectionContext(
  context: GeoObservationCorrectionContext,
  requestedId: string,
): GeoObservationCorrectionContext {
  assertGeoObservationDetail(context.detail, requestedId);
  const tail = tailManualHistory(context.detail);
  const articleIds = context.correction_article_results.map(
    (item) => item.published_article_id,
  );
  const topicIds = context.query_topic_options.map((item) => item.id);
  if (
    !tail.observation.available_actions.includes('CORRECT')
    || new Set(articleIds).size !== articleIds.length
    || new Set(topicIds).size !== topicIds.length
    || (tail.query_topic !== null && context.query_topic_options.length > 0)
  ) {
    throw contractMismatch('更正上下文的动作、候选或 Query Topic 选项不一致');
  }
  return context;
}

function selectedManualHistory(detail: ManualGeoObservationDetail): ManualHistoryItem {
  const selected = detail.correction_history.find((item) => item.is_selected);
  if (!selected) throw contractMismatch('人工观测缺少 selected 节点');
  return selected;
}

function tailManualHistory(detail: ManualGeoObservationDetail): ManualHistoryItem {
  const tail = detail.correction_history.find((item) => item.is_chain_tail);
  if (!tail) throw contractMismatch('人工观测缺少 chain tail');
  return tail;
}

function formatObservationTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatBoolean(value: boolean | null) {
  if (value === null) return '历史未记录';
  return value ? '是' : '否';
}

function formatAccuracy(value: keyof typeof accuracyLabels | null) {
  return value === null ? '未判断' : accuracyLabels[value];
}

function contractMismatch(reason: string) {
  return new Error(`GEO Observation Detail 响应合同不一致：${reason}`);
}

export {
  accuracyLabels,
  assertGeoObservationCorrectionContext,
  assertGeoObservationDetail,
  formatAccuracy,
  formatBoolean,
  formatObservationTime,
  recommendationLabels,
  selectedManualHistory,
  tailManualHistory,
};
export type {
  GeoObservationDetail,
  GeoObservationCorrectionContext,
  LegacyGeoObservationDetail,
  ManualGeoObservationDetail,
  ManualHistoryItem,
};
