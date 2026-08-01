/** 验证浮层关闭只恢复仍连接的原触发元素。 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useFocusReturn } from './useFocusReturn';

function Probe() {
  const [showTrigger, setShowTrigger] = useState(true);
  const { focusReturnTargetProps, restoreFocus } = useFocusReturn();
  return <>
    {showTrigger && <button {...focusReturnTargetProps} type="button">更多操作</button>}
    <button type="button" onClick={restoreFocus}>恢复焦点</button>
    <button type="button" onClick={() => setShowTrigger(false)}>移除触发器</button>
  </>;
}

test('键盘和指针入口都返回原触发器且不滚动', async () => {
  const user = userEvent.setup();
  render(<Probe />);
  const trigger = screen.getByRole('button', { name: '更多操作' });
  const restore = screen.getByRole('button', { name: '恢复焦点' });
  const focus = vi.spyOn(trigger, 'focus');

  await user.tab();
  expect(trigger).toHaveFocus();
  await user.click(restore);
  expect(trigger).toHaveFocus();
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });

  await user.click(trigger);
  await user.click(restore);
  expect(trigger).toHaveFocus();
});

test('原触发器已卸载时安全结束', async () => {
  const user = userEvent.setup();
  render(<Probe />);
  await user.click(screen.getByRole('button', { name: '更多操作' }));
  await user.click(screen.getByRole('button', { name: '移除触发器' }));
  const restore = screen.getByRole('button', { name: '恢复焦点' });
  await user.click(restore);
  expect(restore).toHaveFocus();
});
