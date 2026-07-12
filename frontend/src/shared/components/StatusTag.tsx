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
};

export function StatusTag({ status }: { status: string }) {
  const color = statusColors[status];
  return color ? <Tag color={color}>{statusLabels[status] ?? status}</Tag> : <Tag>{statusLabels[status] ?? status}</Tag>;
}
