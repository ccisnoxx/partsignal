/** 业务页面统一标题、面包屑和操作区。 */
import { Breadcrumb, Space, Typography, type BreadcrumbProps } from 'antd';
import type { ReactNode } from 'react';

export function PageHeader({ eyebrow, title, description, breadcrumbs, actions }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: BreadcrumbProps['items'];
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {breadcrumbs && <Breadcrumb items={breadcrumbs} className="page-breadcrumb" />}
        {eyebrow && <Typography.Text className="eyebrow">{eyebrow}</Typography.Text>}
        <Typography.Title>{title}</Typography.Title>
        {description && <Typography.Paragraph>{description}</Typography.Paragraph>}
      </div>
      {actions && <Space wrap className="page-actions">{actions}</Space>}
    </header>
  );
}
