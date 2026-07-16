/** 展示服务端权威的物理删除引用冲突。 */
import { Alert } from 'antd';
import { ApiError, errorMessage } from '../api/client';

const referenceLabels: Record<string, string> = {
  FACT_VERSION: '事实版本',
  CONTENT_TASK: '内容任务',
  CONTENT_VERSION: '内容版本',
  GEO_OBSERVATION: 'GEO 观测',
  PLATFORM_PROFILE_VERSION: '平台规则版本',
  PLATFORM_PROFILE: '具体平台',
  PLATFORM_ACCOUNT: '平台账号',
  PUBLICATION_RECORD: '发布记录',
};

export function DeletionError({ error }: { error: unknown }) {
  const references = error instanceof ApiError && Array.isArray(error.details.references)
    ? error.details.references.filter((item): item is { type: string; count: number } => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Record<string, unknown>;
      return typeof value.type === 'string' && typeof value.count === 'number';
    })
    : [];
  return <Alert role="alert" type="error" showIcon message={errorMessage(error)} description={references.length ? <ul>{references.map((item) => <li key={item.type}>{referenceLabels[item.type] ?? item.type}：{item.count}</li>)}</ul> : undefined} />;
}
