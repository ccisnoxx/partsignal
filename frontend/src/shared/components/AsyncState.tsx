/** 为查询失败、无权限和空结果提供一致且可恢复的反馈。 */
import { Alert, Button, Empty, Skeleton, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import { ApiError, errorMessage } from '../api/client';

export function QueryFailure({ error, onRetry, actions }: { error: unknown; onRetry?: () => void; actions?: ReactNode }) {
  const apiError = error instanceof ApiError ? error : undefined;
  const action = onRetry || actions ? <Space wrap>{onRetry && <Button onClick={onRetry}>重试</Button>}{actions}</Space> : undefined;
  return <Alert role="alert" type="error" showIcon title="加载失败" description={<Space orientation="vertical" size={4}><span>{errorMessage(error)}</span>{apiError && <Typography.Text className="data-code" type="secondary">错误码：{apiError.code}{apiError.requestId ? ` · 请求 ID：${apiError.requestId}` : ''}</Typography.Text>}</Space>} action={action} />;
}

export function PermissionDenied() {
  return <Alert role="alert" type="warning" showIcon title="无权访问" description="当前账号没有查看或操作此资源的权限。" />;
}

export function QueryLoading({ label = '正在加载内容' }: { label?: string }) {
  return <div aria-busy="true" aria-label={label}><Skeleton active paragraph={{ rows: 6 }} /></div>;
}

export function NoData({ description = '暂无数据', action }: { description?: ReactNode; action?: ReactNode }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>{action}</Empty>;
}
