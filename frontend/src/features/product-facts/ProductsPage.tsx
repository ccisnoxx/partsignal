/** 产品入口页，创建与检索事实工作区的业务主对象。 */
import { DownOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Dropdown, Form, Input, Modal, Space, Table } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { productsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Product, Schema } from '../../shared/api/types';
import { QueryFailure } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { queryClient } from '../../app/queryClient';
import { useAuth } from '../auth/AuthProvider';
import { DeletionError } from '../../shared/components/DeletionError';

export function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') ?? '';
  const rawPage = searchParams.get('page');
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  const [createOpen, setCreateOpen] = useState(false);
  const [createDirty, setCreateDirty] = useState(false);
  const [createForm] = Form.useForm<Schema<'ProductCreate'>>();
  const createErrorRef = useRef<HTMLDivElement>(null);
  const [modal, modalContext] = Modal.useModal();
  const { message } = App.useApp();
  const auth = useAuth();
  const products = useQuery(productsQueryOptions(search));
  useEffect(() => {
    if ((rawPage !== null && !/^[1-9]\d*$/.test(rawPage)) || (products.data && page > Math.max(1, Math.ceil(products.data.items.length / 20)))) {
      const next = new URLSearchParams(searchParams);
      next.delete('page');
      setSearchParams(next, { replace: true });
    }
  }, [page, products.data, rawPage, searchParams, setSearchParams]);
  const setView = (changes: { q?: string; page?: number }) => {
    const next = new URLSearchParams(searchParams);
    if (changes.q !== undefined) {
      if (changes.q) next.set('q', changes.q); else next.delete('q');
    }
    if (changes.page !== undefined) {
      if (changes.page === 1) next.delete('page'); else next.set('page', String(changes.page));
    }
    setSearchParams(next);
  };
  const create = useMutation({
    mutationFn: async (body: Schema<'ProductCreate'>) => unwrap(await api.POST('/api/v1/products', { params: { header: csrfHeader() }, body })),
    onSuccess: async () => {
      setCreateDirty(false);
      createForm.resetFields();
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
  useEffect(() => {
    if (create.error) createErrorRef.current?.focus();
  }, [create.error]);
  const remove = useMutation({ mutationFn: async (product: Product) => ensureSuccess(await api.DELETE('/api/v1/products/{product_id}', { params: { path: { product_id: product.id }, header: csrfHeader() } })), onSuccess: async () => { message.success('产品已删除'); await queryClient.invalidateQueries({ queryKey: queryKeys.products.all }); } });
  const confirmDelete = (product: Product) => modal.confirm({ title: `物理删除产品“${product.part_number}”？`, content: '只会删除产品及当前事实工作区；存在任何历史引用时服务端会拒绝。此操作不可恢复。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => remove.mutate(product) });
  const openCreate = () => {
    create.reset();
    createForm.resetFields();
    setCreateDirty(false);
    setCreateOpen(true);
  };
  const closeCreate = () => {
    create.reset();
    createForm.resetFields();
    setCreateDirty(false);
    setCreateOpen(false);
  };
  const requestCloseCreate = () => {
    if (create.isPending) return;
    if (!createDirty) {
      closeCreate();
      return;
    }
    modal.confirm({
      title: '放弃未保存的产品信息？',
      content: '关闭后，本次填写的产品型号、品牌和类别不会保留。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: closeCreate,
    });
  };

  return (
    <div className="page-stack products-page">
      {modalContext}
      <PageHeader eyebrow="事实基础" title="产品事实" description="先建立可审核、带证据的事实，再进入内容生成。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增产品</Button>} />
      <Card className="collection-panel">
        {remove.error && <DeletionError error={remove.error} />}
        <Input.Search key={search} aria-label="搜索产品" prefix={<SearchOutlined />} allowClear placeholder="搜索型号或品牌" defaultValue={search} onSearch={(value) => setView({ q: value.trim(), page: 1 })} className="table-search" />
        {products.error ? <QueryFailure error={products.error} onRetry={() => void products.refetch()} /> : <TableRegion label="产品事实列表"><Table<Product> rowKey="id" loading={products.isLoading} dataSource={products.data?.items} pagination={{ current: page, pageSize: 20, showSizeChanger: false, onChange: (nextPage) => setView({ page: nextPage }) }} sticky={{ offsetHeader: 72 }} scroll={{ x: 760 }} columns={[
          { title: '型号', dataIndex: 'part_number', render: (value, item) => <Link className="data-code" to={`/products/${item.id}`}><strong>{value}</strong></Link> },
          { title: '品牌', dataIndex: 'brand', width: 180 }, { title: '类别', dataIndex: 'category', width: 180 },
          { title: '状态', dataIndex: 'status', width: 110, render: (value) => <StatusTag status={value} /> },
          { title: '操作', fixed: 'right', width: 110, render: (_, item) => auth.isAdmin ? <Dropdown trigger={['click']} menu={{ items: [{ key: 'delete', label: '删除', danger: true }], onClick: () => confirmDelete(item) }}><Button size="small" aria-label={`更多操作：${item.part_number}`} loading={remove.isPending && remove.variables?.id === item.id}>更多 <DownOutlined /></Button></Dropdown> : '—' },
        ]} /></TableRegion>}
      </Card>
      <Modal title="新增产品" open={createOpen} onCancel={requestCloseCreate} footer={null} closable={!create.isPending} keyboard={!create.isPending} mask={{ closable: !create.isPending }} destroyOnHidden>
        <div ref={createErrorRef} tabIndex={-1}>
          {create.error && <Alert role="alert" className="form-alert" type="error" showIcon title={errorMessage(create.error)} />}
        </div>
        <Form<Schema<'ProductCreate'>> form={createForm} layout="vertical" disabled={create.isPending} scrollToFirstError={{ behavior: 'smooth', block: 'center', focus: true }} onValuesChange={() => setCreateDirty(true)} onFinish={(values) => create.mutate(values)}>
          <Form.Item name="part_number" label="产品型号" rules={[{ required: true, whitespace: true, message: '请输入产品型号' }]}><Input autoFocus /></Form.Item>
          <Form.Item name="brand" label="品牌" rules={[{ required: true, whitespace: true, message: '请输入品牌' }]}><Input /></Form.Item>
          <Form.Item name="category" label="类别" rules={[{ required: true, whitespace: true, message: '请输入类别' }]}><Input /></Form.Item>
          <Space className="form-dialog-actions">
            <Button onClick={requestCloseCreate}>取消</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}>创建事实工作区</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
