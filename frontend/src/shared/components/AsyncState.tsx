/** 为查询失败和空结果提供一致且可访问的反馈。 */
import { Alert, Empty, Skeleton } from 'antd';
import { errorMessage } from '../api/client';

export function QueryFailure({ error }: { error: unknown }) {
  return <Alert type="error" showIcon message="加载失败" description={errorMessage(error)} />;
}

export function QueryLoading() {
  return <Skeleton active paragraph={{ rows: 6 }} />;
}

export function NoData({ description = '暂无数据' }: { description?: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}
