/** 跨页面复用的稳定业务枚举显示文本；机器值始终原样提交。 */
import type { Schema } from '../api/types';

export const evidenceTypeOptions: Array<{ label: string; value: Schema<'EvidenceType'> }> = [
  { label: '数据手册', value: 'DATASHEET' },
  { label: '测试报告', value: 'TEST_REPORT' },
  { label: '应用说明', value: 'APPLICATION_NOTE' },
  { label: '客户授权', value: 'CUSTOMER_AUTHORIZATION' },
  { label: '其他', value: 'OTHER' },
];

const evidenceTypeLabels = new Map(evidenceTypeOptions.map((item) => [item.value, item.label]));

export function evidenceTypeLabel(value: Schema<'EvidenceType'>): string {
  return evidenceTypeLabels.get(value) ?? value;
}
