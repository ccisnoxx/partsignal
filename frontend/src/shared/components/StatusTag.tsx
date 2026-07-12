/** 将后端状态枚举映射为统一的中文视觉标签。 */
import { Tag } from 'antd';

const statusLabels: Record<string, string> = {
  ACTIVE: '启用', RETIRED: '已停用', DRAFT: '草稿', PENDING_REVIEW: '待审核',
  CHANGES_REQUESTED: '需修改', APPROVED: '已批准', SUPERSEDED: '已取代',
  OPEN: '进行中', COMPLETED: '已完成', CANCELLED: '已取消',
  PENDING: '排队中', RUNNING: '生成中', SUCCEEDED: '成功', FAILED: '失败',
  PENDING_MANUAL_PUBLISH: '待人工发布', PLATFORM_REVIEW: '平台审核中',
  PUBLISHED: '已发布', VERIFIED: '已验证', REJECTED: '已拒绝', REMOVED: '已下线',
  VERIFICATION_FAILED: '验证失败', ABORTED: '已中止',
  RESOLVED: '已解决',
  submit: '提交审核', 'submit-review': '提交审核', approve: '批准',
  'request-changes': '退回修改', retire: '停用',
  ADMIN: '管理员', ENGINEER: '工程师',
  PUBLIC: '公开', INTERNAL: '内部', RESTRICTED: '受限', URL_ONLY: '仅 URL',
  UNTESTED: '未测试', PASSED: '已通过', WARNING: '警告', BLOCKING: '阻断',
  NONE: '未推荐', CANDIDATE: '候选', RECOMMENDED: '已推荐',
  ACCURATE: '准确', PARTIAL: '部分准确', INCORRECT: '不准确', UNJUDGEABLE: '无法判断',
  FUNCTIONALLY_SIMILAR: '功能相近', PARAMETER_COMPATIBLE: '参数兼容', PIN_COMPATIBLE: '引脚兼容',
  PIN_TO_PIN: 'Pin-to-Pin', PROTOTYPE_VALIDATED: '样板验证', TEMPERATURE_VALIDATED: '温度验证', MASS_PRODUCTION_VALIDATED: '量产验证',
  SUBMIT: '提交审核', SUBMIT_REVIEW: '提交审核', APPROVE: '批准', REQUEST_CHANGES: '退回修改', RETIRE: '停用',
};

const statusColors: Record<string, string> = {
  ACTIVE: 'green', APPROVED: 'green', VERIFIED: 'green', SUCCEEDED: 'green',
  PENDING_REVIEW: 'gold', PENDING: 'gold', PENDING_MANUAL_PUBLISH: 'gold', PLATFORM_REVIEW: 'gold',
  RUNNING: 'blue', PUBLISHED: 'blue', OPEN: 'blue', DRAFT: 'default',
  FAILED: 'red', REJECTED: 'red', VERIFICATION_FAILED: 'red', CHANGES_REQUESTED: 'orange',
  RETIRED: 'default', SUPERSEDED: 'default', CANCELLED: 'default', REMOVED: 'default', ABORTED: 'default',
  RESOLVED: 'green',
  submit: 'blue', 'submit-review': 'blue', approve: 'green',
  'request-changes': 'orange', retire: 'default',
  PUBLIC: 'green', INTERNAL: 'blue', RESTRICTED: 'red', URL_ONLY: 'default',
  PASSED: 'green', UNTESTED: 'default', WARNING: 'gold', BLOCKING: 'red',
  NONE: 'default', CANDIDATE: 'gold', RECOMMENDED: 'green',
  ACCURATE: 'green', PARTIAL: 'gold', INCORRECT: 'red', UNJUDGEABLE: 'default',
  ADMIN: 'blue', ENGINEER: 'default', SUBMIT: 'blue', SUBMIT_REVIEW: 'blue',
  APPROVE: 'green', REQUEST_CHANGES: 'orange', RETIRE: 'default',
};

export function StatusTag({ status }: { status: string }) {
  const color = statusColors[status];
  return color ? <Tag className="status-tag" color={color}>{statusLabels[status] ?? status}</Tag> : <Tag className="status-tag">{statusLabels[status] ?? status}</Tag>;
}
