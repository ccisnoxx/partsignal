/** 在独立弹窗中筛选远端模型，并明确区分已配置与可添加状态。 */
import { Alert, Button, Input, Modal, Space, Table, Typography } from 'antd';
import { useDeferredValue, useState } from 'react';
import { TableCellText } from '../../shared/components/TableCellText';
import { TableRegion } from '../../shared/components/TableRegion';

type ModelDiscoveryModalProps = {
  open: boolean;
  modelIds: string[];
  configuredModelIds: string[];
  loading: boolean;
  addingModelId?: string;
  fetchError?: string;
  addError?: string;
  onCancel: () => void;
  onRefresh: () => void;
  onAdd: (modelId: string) => void;
};

export function ModelDiscoveryModal({ open, modelIds, configuredModelIds, loading, addingModelId, fetchError, addError, onCancel, onRefresh, onAdd }: ModelDiscoveryModalProps) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const configured = new Set(configuredModelIds);
  const filteredModels = modelIds
    .filter((modelId) => modelId.toLocaleLowerCase().includes(deferredSearch))
    .map((modelId) => ({ modelId }));

  return <Modal title="获取模型" open={open} onCancel={() => { setSearch(''); onCancel(); }} footer={null} width={760} destroyOnHidden>
    <Space orientation="vertical" size="middle" className="configuration-model-discovery">
      <Space wrap className="configuration-model-discovery-toolbar">
        <Typography.Text type="secondary">从当前渠道读取模型列表，添加后仍需单独测试连接并启用。</Typography.Text>
        <Button onClick={onRefresh} loading={loading}>重新获取</Button>
      </Space>
      {fetchError && <Alert role="alert" type="error" showIcon message={fetchError} />}
      {addError && <Alert role="alert" type="error" showIcon message={addError} />}
      <Input.Search aria-label="筛选远端模型" placeholder="按 model_id 筛选" allowClear value={search} onChange={(event) => setSearch(event.target.value)} />
      <TableRegion label="远端模型列表">
        <Table<{ modelId: string }>
          rowKey="modelId"
          loading={loading}
          dataSource={filteredModels}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: 620 }}
          locale={{ emptyText: loading ? '正在获取模型' : '渠道未返回可用模型' }}
          columns={[
            { title: 'model_id', dataIndex: 'modelId', width: 380, ellipsis: true, render: (value) => <TableCellText text={value} mono /> },
            { title: '状态', width: 120, render: (_, row) => configured.has(row.modelId) ? '已配置' : '未配置' },
            { title: '操作', width: 120, fixed: 'right', render: (_, row) => <Button type="link" disabled={configured.has(row.modelId) || !!addingModelId} loading={addingModelId === row.modelId} onClick={() => onAdd(row.modelId)}>{configured.has(row.modelId) ? '已添加' : '添加'}</Button> },
          ]}
        />
      </TableRegion>
    </Space>
  </Modal>;
}
