/** 在独立弹窗中筛选远端模型，并明确区分已配置与可添加状态。 */
import { Alert, Button, Input, Modal, Space, Table, Typography } from 'antd';
import { useDeferredValue, useState } from 'react';
import type { Schema } from '../../shared/api/types';
import { TableCellText } from '../../shared/components/TableCellText';
import { TableRegion } from '../../shared/components/TableRegion';

type ModelDiscoveryModalProps = {
  open: boolean;
  models: Schema<'DiscoveredModel'>[];
  loading: boolean;
  addingModelId?: string;
  fetchError?: string;
  addError?: string;
  onCancel: () => void;
  onRefresh: () => void;
  onAdd: (modelId: string) => void;
  onViewConfigured: (modelId: string) => void;
};

export function ModelDiscoveryModal({ open, models, loading, addingModelId, fetchError, addError, onCancel, onRefresh, onAdd, onViewConfigured }: ModelDiscoveryModalProps) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const filteredModels = models.filter((item) => item.model_id.toLocaleLowerCase().includes(deferredSearch));

  return <Modal title="获取模型" open={open} onCancel={() => { setSearch(''); onCancel(); }} footer={null} width={760} destroyOnHidden>
    <Space orientation="vertical" size="middle" className="configuration-model-discovery">
      <Space wrap className="configuration-model-discovery-toolbar">
        <Typography.Text type="secondary">从当前渠道读取模型列表，添加后仍需单独测试连接并启用。</Typography.Text>
        <Button onClick={onRefresh} loading={loading}>重新获取</Button>
      </Space>
      {fetchError && <Alert role="alert" type="error" showIcon title={fetchError} />}
      {addError && <Alert role="alert" type="error" showIcon title={addError} />}
      <Input.Search aria-label="筛选远端模型" placeholder="按 model_id 筛选" allowClear value={search} onChange={(event) => setSearch(event.target.value)} />
      <TableRegion label="远端模型列表">
        <Table<Schema<'DiscoveredModel'>>
          rowKey="model_id"
          loading={loading}
          dataSource={filteredModels}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: 610 }}
          locale={{ emptyText: loading ? '正在获取模型' : '渠道未返回可用模型' }}
          columns={[
            { title: 'model_id', dataIndex: 'model_id', width: 380, ellipsis: true, render: (value) => <TableCellText text={value} mono /> },
            { title: '状态', width: 90, render: (_, row) => row.configured ? '已配置' : '未配置' },
            { title: '操作', width: 140, fixed: 'right', render: (_, row) => <Button type="primary" size="small" disabled={!!addingModelId} loading={addingModelId === row.model_id} onClick={() => row.primary_task === 'ADD_MODEL' ? onAdd(row.model_id) : onViewConfigured(row.model_id)}>{row.primary_task === 'ADD_MODEL' ? '添加模型' : '查看已配置模型'}</Button> },
          ]}
        />
      </TableRegion>
    </Space>
  </Modal>;
}
