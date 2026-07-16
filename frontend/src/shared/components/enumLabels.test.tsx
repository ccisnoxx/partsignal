/** 验证共享枚举只翻译显示文本，不改变提交给 API 的机器值。 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusTag } from './StatusTag';
import { evidenceTypeLabel, evidenceTypeOptions } from './enumLabels';

describe('中文枚举显示', () => {
  it('统一显示内容来源与业务状态', () => {
    render(<><StatusTag status="AI" /><StatusTag status="PENDING_REVIEW" /></>);

    expect(screen.getByText('AI 生成')).toBeInTheDocument();
    expect(screen.getByText('待审核')).toBeInTheDocument();
  });

  it('保留证据类型机器值', () => {
    expect(evidenceTypeLabel('TEST_REPORT')).toBe('测试报告');
    expect(evidenceTypeOptions.map((item) => item.value)).toEqual([
      'DATASHEET',
      'TEST_REPORT',
      'APPLICATION_NOTE',
      'CUSTOMER_AUTHORIZATION',
      'OTHER',
    ]);
  });
});
