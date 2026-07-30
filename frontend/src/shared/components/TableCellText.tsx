/** 为表格长文本提供单行省略和键盘可访问的完整值。 */
import { Tooltip } from 'antd';

export function TableCellText({ text, mono = false }: { text: string; mono?: boolean }) {
  return (
    <Tooltip title={text} trigger={['hover', 'focus']}>
      <span
        className={`table-cell-ellipsis${mono ? ' data-code' : ''}`}
        tabIndex={0}
        aria-label={text}
      >
        {text}
      </span>
    </Tooltip>
  );
}
