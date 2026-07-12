/** 产品入口页，创建与检索事实工作区的业务主对象。 */
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Space, Table } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import type { Product, Schema } from '../../shared/api/types';
import { QueryFailure } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { queryClient } from '../../app/queryClient';

export function ProductsPage() {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const products = useQuery({
    queryKey: ['products', search],
    queryFn: async () => unwrap(await api.GET('/api/v1/products', { params: { query: { page: 1, page_size: 100, ...(search ? { search } : {}) } } })),
  });
  const create = useMutation({
    mutationFn: async (body: Schema<'ProductCreate'>) => unwrap(await api.POST('/api/v1/products', { params: { header: csrfHeader() }, body })),
    onSuccess: async () => { setCreateOpen(false); await queryClient.invalidateQueries({ queryKey: ['products'] }); },
  });

  return (
    <div className="page-stack">
      <PageHeader eyebrow="FACT FOUNDATION" title="产品事实" description="先建立可审核、带证据的事实，再进入内容生成。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增产品</Button>} />
      <Card>
        <Input.Search aria-label="搜索产品" prefix={<SearchOutlined />} allowClear placeholder="搜索型号或品牌" onSearch={setSearch} className="table-search" />
        {products.error ? <QueryFailure error={products.error} onRetry={() => void products.refetch()} /> : <TableRegion label="产品事实列表"><Table<Product> rowKey="id" loading={products.isLoading} dataSource={products.data?.items} pagination={{ pageSize: 20 }} scroll={{ x: 680 }} columns={[
          { title: '型号', dataIndex: 'part_number', render: (value, item) => <Link className="data-code" to={`/products/${item.id}`}><strong>{value}</strong></Link> },
          { title: '品牌', dataIndex: 'brand' }, { title: '类别', dataIndex: 'category' },
          { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
          { title: '操作', render: (_, item) => <Space><Link to={`/products/${item.id}`}>维护事实</Link></Space> },
        ]} /></TableRegion>}
      </Card>
      <Modal title="新增产品" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden>
        {create.error && <Alert className="form-alert" type="error" showIcon message={errorMessage(create.error)} />}
        <Form<Schema<'ProductCreate'>> layout="vertical" onFinish={(values) => create.mutate(values)}>
          <Form.Item name="part_number" label="产品型号" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="brand" label="品牌" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="category" label="类别" rules={[{ required: true }]}><Input /></Form.Item>
          <Button type="primary" htmlType="submit" loading={create.isPending}>创建事实工作区</Button>
        </Form>
      </Modal>
    </div>
  );
}
