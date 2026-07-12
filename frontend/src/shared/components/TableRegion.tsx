/** 为宽表格提供可聚焦、可感知的横向滚动区域。 */
import type { ReactNode } from 'react';

export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-region" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
