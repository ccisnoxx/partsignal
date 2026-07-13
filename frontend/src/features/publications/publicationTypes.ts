/** 发布页面只从 OpenAPI 生成类型派生动作联合，不维护第二套契约。 */
import type { PublicationRecord } from '../../shared/api/types';

export type PublicationAction = PublicationRecord['available_actions'][number];

export const actionLabels: Record<PublicationAction, string> = {
  'mark-platform-review': '提交平台审核',
  'mark-published': '登记已发布',
  verify: '验证正文一致',
  reject: '平台拒绝',
  remove: '标记已移除',
  'mark-verification-failed': '标记验证失败',
};
