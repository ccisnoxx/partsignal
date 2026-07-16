/** 验证删除冲突只展示服务端返回的真实引用类型和数量。 */
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ApiError } from '../api/client';
import { DeletionError } from './DeletionError';

test('展示结构化删除引用，不解析错误文案', () => {
  render(<DeletionError error={new ApiError('产品仍被引用', 'PRODUCT_IN_USE', 'req-1', {
    references: [
      { type: 'FACT_VERSION', count: 2 },
      { type: 'CONTENT_VERSION', count: 3 },
      { type: 'GEO_OBSERVATION', count: 1 },
    ],
  })} />);

  expect(screen.getByRole('alert')).toHaveTextContent('事实版本：2');
  expect(screen.getByRole('alert')).toHaveTextContent('内容版本：3');
  expect(screen.getByRole('alert')).toHaveTextContent('GEO 观测：1');
});
