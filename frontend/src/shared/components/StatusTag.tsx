/** 将后端状态枚举映射为统一的中文标签与语义色阶。 */
import { CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import type { ReactNode } from 'react';

const statusLabels: Record<string, string> = {
  ENABLED: '已启用', DISABLED: '已停用', ACTIVE: '启用', RETIRED: '已停用', DRAFT: '草稿', PENDING_REVIEW: '待审核',
  CHANGES_REQUESTED: '需修改', APPROVED: '已批准', SUPERSEDED: '已取代',
  OPEN: '进行中', COMPLETED: '已完成', CANCELLED: '已取消',
  PENDING: '排队中', RUNNING: '生成中', SUCCEEDED: '成功', SUCCESS: '成功', FAILED: '失败', DENIED: '被拒绝',
  PREPARING: '准备发布', PLATFORM_REVIEW: '平台审核中', AWAITING_VERIFICATION: '待核验',
  ACTION_REQUIRED: '需处理', CLOSED: '已关闭',
  PAGE_UNAVAILABLE: '页面不可用', CONTENT_CHANGED: '内容已变化',
  PLATFORM_REJECTED: '平台拒绝', BUSINESS_CANCELLED: '业务取消',
  RESTORED: '已恢复', RESOLVED: '已解决', ABORTED: '已中止',
  submit: '提交审核', 'submit-review': '提交审核', approve: '批准',
  'request-changes': '退回修改', retire: '停用', ADMIN: '管理员', ENGINEER: '工程师',
  PUBLIC: '公开', INTERNAL: '内部', RESTRICTED: '受限', URL_ONLY: '仅 URL',
  AI: 'AI 生成', HUMAN: '人工编辑',
  UNTESTED: '未测试', PASSED: '已通过', WARNING: '警告', BLOCKING: '阻断',
  NONE: '未推荐', CANDIDATE: '候选', RECOMMENDED: '已推荐',
  NOT_RECOMMENDED: '未推荐', MENTIONED: '已提及', NOT_MENTIONED: '未提及',
  HAS_CITATION: '有引用', NO_CITATION: '无引用',
  OFFICIAL: '官方来源', EXTERNAL_COMPANY: '外部企业', OTHER: '其他来源',
  ACCURATE: '准确', PARTIAL: '部分准确', INCORRECT: '不准确', UNJUDGEABLE: '无法判断',
  MANUAL_ARTICLE_SEARCH: '人工文章搜索', LEGACY_MODEL_RESULT: '历史模型观测',
  CURRENT: '当前记录', HISTORICAL: '历史记录', UPLOADED: '已上传', MISSING_EVIDENCE: '缺少证据',
  FUNCTIONALLY_SIMILAR: '功能相近', PARAMETER_COMPATIBLE: '参数兼容', PIN_COMPATIBLE: '引脚兼容',
  PIN_TO_PIN: 'Pin-to-Pin', PROTOTYPE_VALIDATED: '样板验证', TEMPERATURE_VALIDATED: '温度验证', MASS_PRODUCTION_VALIDATED: '量产验证',
  SUBMIT: '提交审核', SUBMIT_REVIEW: '提交审核', APPROVE: '批准', REQUEST_CHANGES: '退回修改', RETIRE: '停用',
  HIGH: '高优先级', MEDIUM: '中优先级', LOW: '低优先级',
  STABLE: '稳定覆盖', OCCASIONAL: '偶尔命中', UNCOVERED: '尚未覆盖', INSUFFICIENT_DATA: '数据不足',
  PROMPT_CONFIGURED: '配置完整', PROMPT_MISSING: '缺少 Prompt', ACTIVE_RULE_MISSING: '无有效规则',
};

type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'admin';

const statusTones: Record<string, StatusTone> = {
  ENABLED: 'success', ACTIVE: 'success', APPROVED: 'success', VERIFIED: 'success', SUCCEEDED: 'success', SUCCESS: 'success', RESOLVED: 'success', COMPLETED: 'success',
  PASSED: 'success', RECOMMENDED: 'success', MENTIONED: 'success', HAS_CITATION: 'success', ACCURATE: 'success', UPLOADED: 'success', CURRENT: 'success', approve: 'success', APPROVE: 'success', PUBLIC: 'success',
  RUNNING: 'info', PUBLISHED: 'info', OPEN: 'info', INTERNAL: 'info', ENGINEER: 'info', MANUAL_ARTICLE_SEARCH: 'info', submit: 'info', 'submit-review': 'info', SUBMIT: 'info', SUBMIT_REVIEW: 'info',
  ADMIN: 'admin',
  PENDING_REVIEW: 'warning', PENDING: 'warning', PREPARING: 'warning', PLATFORM_REVIEW: 'warning', AWAITING_VERIFICATION: 'warning', ACTION_REQUIRED: 'danger', WARNING: 'warning', DENIED: 'warning',
  CANDIDATE: 'warning', PARTIAL: 'warning', HISTORICAL: 'warning', CHANGES_REQUESTED: 'warning', 'request-changes': 'warning', REQUEST_CHANGES: 'warning',
  DISABLED: 'neutral', FAILED: 'danger', REJECTED: 'danger', VERIFICATION_FAILED: 'danger', RESTRICTED: 'danger', BLOCKING: 'danger', INCORRECT: 'danger', MISSING_EVIDENCE: 'danger',
  HIGH: 'danger', MEDIUM: 'warning', LOW: 'info', STABLE: 'success', OCCASIONAL: 'warning', UNCOVERED: 'danger', INSUFFICIENT_DATA: 'neutral',
  PROMPT_CONFIGURED: 'success', PROMPT_MISSING: 'warning', ACTIVE_RULE_MISSING: 'danger',
};

const toneIcons: Partial<Record<StatusTone, ReactNode>> = {
  success: <CheckCircleOutlined />, info: <InfoCircleOutlined />, warning: <ExclamationCircleOutlined />, danger: <CloseCircleOutlined />,
};

export function StatusTag({ status, compact = false }: { status: string; compact?: boolean }) {
  const tone = statusTones[status] ?? 'neutral';
  return <Tag className={`status-tag status-tag-${tone}${compact ? ' status-tag-compact' : ''}`} icon={compact ? undefined : toneIcons[tone]}>{statusLabels[status] ?? status}</Tag>;
}
