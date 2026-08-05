/** 验证受约束删除向导展示当前阻断、下钻和服务端重新检查入口。 */
import { App as AntApp } from 'antd';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DeletionGuidanceModal } from './DeletionError';

test('引用下钻在新标签打开，并明确由服务端重新校验', async () => {
  const refresh = vi.fn();
  const user = userEvent.setup();
  render(
    <AntApp>
      <DeletionGuidanceModal
        open
        resourceLabel="测试记录"
        blockers={[
          { type: 'CONTENT_TASK', count: 2 },
          { type: 'PUBLICATION_WORK', count: 1 },
        ]}
        resolveLink={(blocker) => blocker.type === 'CONTENT_TASK'
          ? { href: '/tasks?filter_product_id=product-1', label: '查看引用' }
          : { href: '/publications?content_task_id=task-1', label: '查看历史' }}
        onClose={() => undefined}
        onRefresh={refresh}
      />
    </AntApp>,
  );

  expect(screen.getByText('内容任务：2')).toBeInTheDocument();
  expect(screen.getByText('发布工作：1')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看引用' })).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('link', { name: '查看历史' })).toHaveAttribute('href', '/publications?content_task_id=task-1');
  expect(screen.getByText(/不会绕过服务端的引用和权限校验/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '重新检查' }));
  expect(refresh).toHaveBeenCalledOnce();
});
