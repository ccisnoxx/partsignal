/** 展示服务端权威的物理删除引用冲突与下钻入口。 */
import { Alert, Button, Modal, Space, Typography } from 'antd';
import { ApiError, errorMessage } from '../api/client';

const referenceLabels: Record<string, string> = {
  FACT_VERSION: '事实版本',
  CONTENT_TASK: '内容任务',
  CONTENT_VERSION: '内容版本',
  GENERATION_JOB: '生成作业',
  GEO_OBSERVATION: 'GEO 观测',
  PLATFORM_PROFILE_VERSION: '平台规则版本',
  PLATFORM_PROFILE: '具体平台',
  PLATFORM_ACCOUNT: '平台账号',
  PUBLICATION_WORK: '发布工作',
  PROTECTED_CONTENT_VERSION: '已批准内容历史',
  PUBLISHED_CONTENT_ISSUE: '发布问题修复来源',
  GEO_OPTIMIZATION_SOURCE: 'GEO 优化来源',
  USER_BUSINESS_HISTORY: '业务历史',
};

export type DeletionBlocker = { type: string; count: number };
export type DeletionReferenceLink = { href: string; label: '查看引用' | '查看历史' };

type LinkResolver = (blocker: DeletionBlocker) => DeletionReferenceLink | undefined;

function referencesFromError(error: unknown): DeletionBlocker[] {
  return error instanceof ApiError && Array.isArray(error.details.references)
    ? error.details.references.filter((item): item is { type: string; count: number } => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Record<string, unknown>;
      return typeof value.type === 'string' && Number.isInteger(value.count) && Number(value.count) > 0;
    })
    : [];
}

function DeletionBlockerList({ blockers, resolveLink }: { blockers: DeletionBlocker[]; resolveLink?: LinkResolver }) {
  return <ul>{blockers.map((blocker) => {
    const link = resolveLink?.(blocker);
    return <li key={blocker.type}><Space size={8}><span>{referenceLabels[blocker.type] ?? blocker.type}：{blocker.count}</span>{link && <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>}</Space></li>;
  })}</ul>;
}

export function DeletionError({ error, resolveLink }: { error: unknown; resolveLink?: LinkResolver }) {
  const references = referencesFromError(error);
  return <Alert role="alert" type="error" showIcon title={errorMessage(error)} description={references.length ? <DeletionBlockerList blockers={references} resolveLink={resolveLink} /> : undefined} />;
}

export function DeletionGuidanceModal({
  open,
  resourceLabel,
  blockers,
  refreshing = false,
  resolveLink,
  onClose,
  onRefresh,
}: {
  open: boolean;
  resourceLabel: string;
  blockers: DeletionBlocker[];
  refreshing?: boolean;
  resolveLink: LinkResolver;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
}) {
  return <Modal
    title={`${resourceLabel}暂时不能删除`}
    open={open}
    onCancel={onClose}
    footer={<Space><Button onClick={onClose}>关闭</Button><Button type="primary" loading={refreshing} onClick={() => void onRefresh()}>重新检查</Button></Space>}
    destroyOnHidden
  >
    <Alert type="warning" showIcon title="请先处理以下直接引用" description={<DeletionBlockerList blockers={blockers} resolveLink={resolveLink} />} />
    <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
      跳转目标会按自身规则继续显示可处理操作；不可变历史只能查看，系统不会级联或强制删除。
    </Typography.Paragraph>
  </Modal>;
}
