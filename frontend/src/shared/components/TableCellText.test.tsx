/** 验证表格省略文本可由鼠标和键盘读取完整原值。 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TableCellText } from './TableCellText';

test('悬停或聚焦时显示完整值', async () => {
  const text = '这是不会因单元格省略而丢失的完整长文本';
  render(<TableCellText text={text} />);
  const cellText = screen.getByLabelText(text);

  fireEvent.mouseEnter(cellText);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(text);
  fireEvent.mouseLeave(cellText);
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());

  fireEvent.focus(cellText);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(text);
});
