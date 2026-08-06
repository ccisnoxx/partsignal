/** 产品入口页，创建与检索事实工作区的业务主对象。 */
import { DownOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Dropdown, Form, Input, Modal, Space, Table, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { productsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Product, Schema } from '../../shared/api/types';
import { QueryFailure } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableCellText } from '../../shared/components/TableCellText';
import { TableRegion } from '../../shared/components/TableRegion';
import { useFocusReturn } from '../../shared/hooks/useFocusReturn';
import { queryClient } from '../../app/queryClient';
import { DeletionError, DeletionGuidanceModal, type DeletionBlocker } from '../../shared/components/DeletionError';

const productTaskLabels: Record<Product['primary_task'], string> = {
  ENTER_FACTS: '录入产品事实',
  SUBMIT_FACT_REVIEW: '提交事实审核',
  REVIEW_FACT: '审核处理',
  REVISE_FACT: '根据意见修订',
  CREATE_CONTENT_TASK: '创建内容任务',
  VIEW_FACT_HISTORY: '查看事实历史',
};

export function ProductsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') ?? '';
  const rawPage = searchParams.get('page');
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  const [createOpen, setCreateOpen] = useState(false);
  const [createDirty, setCreateDirty] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<Product>();
  const [createForm] = Form.useForm<Schema<'ProductCreate'>>();
  const createErrorRef = useRef<HTMLDivElement>(null);
  const [modal, modalContext] = Modal.useModal();
  const { message } = App.useApp();
  const { focusReturnTargetProps, restoreFocus } = useFocusReturn();
  const products = useQuery({
    ...productsQueryOptions(search),
    // “查看引用”会打开新标签页；返回当前页时必须重新读取删除资格。
    refetchOnWindowFocus: 'always',
  });
  const currentDeletionTarget = deletionTarget
    ? products.data?.items.find((item) => item.id === deletionTarget.id)
    : undefined;
  const blockedDeletionTarget = currentDeletionTarget?.deletion?.blockers.length
    ? currentDeletionTarget
    : undefined;
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
  const confirmDelete = (product: Product) => modal.confirm({ title: `删除产品“${product.part_number}”？`, content: '将删除产品及当前事实工作区；如果仍有事实版本、内容任务或 GEO 观测引用，服务端会拒绝。此操作不可恢复。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => remove.mutate(product), afterClose: restoreFocus });
  const deletionLink = (product: Product) => (blocker: DeletionBlocker) => {
    if (blocker.type === 'FACT_VERSION') return { href: `/products/${product.id}`, label: '查看引用' as const };
    if (blocker.type === 'CONTENT_TASK') return { href: `/tasks?filter_product_id=${product.id}`, label: '查看引用' as const };
    if (blocker.type === 'GEO_OBSERVATION') return { href: `/observations?product_id=${product.id}&all_time=true`, label: '查看历史' as const };
    return undefined;
  };
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
        {remove.error && <DeletionError error={remove.error} resolveLink={remove.variables ? deletionLink(remove.variables) : undefined} />}
        <Input.Search key={search} aria-label="搜索产品" prefix={<SearchOutlined />} allowClear placeholder="搜索型号或品牌" defaultValue={search} onSearch={(value) => setView({ q: value.trim(), page: 1 })} className="table-search" />
        {products.error ? <QueryFailure error={products.error} onRetry={() => void products.refetch()} /> : <TableRegion label="产品事实列表"><Table<Product> rowKey="id" loading={products.isLoading} dataSource={products.data?.items} pagination={{ current: page, pageSize: 20, showSizeChanger: false, onChange: (nextPage) => setView({ page: nextPage }) }} sticky={{ offsetHeader: 72 }} scroll={{ x: 860 }} columns={[
          { title: '型号', dataIndex: 'part_number', ellipsis: true, render: (value, item) => <Tooltip title={value} trigger={['hover', 'focus']}><Link className="table-cell-ellipsis data-code" aria-label={value} to={`/products/${item.id}`}>{value}</Link></Tooltip> },
          { title: '品牌', dataIndex: 'brand', width: 140, ellipsis: true, render: (value) => <TableCellText text={value} /> }, { title: '类别', dataIndex: 'category', width: 140, ellipsis: true, render: (value) => <TableCellText text={value} /> },
          { title: '状态', dataIndex: 'status', width: 100, render: (value) => <StatusTag status={value} /> },
          { title: '操作', fixed: 'right', width: 220, render: (_, item) => <Space size={4}>
            <Button type="primary" size="small" onClick={() => navigate(item.primary_task === 'CREATE_CONTENT_TASK' ? `/tasks?product_id=${item.id}` : `/products/${item.id}`)}>{productTaskLabels[item.primary_task]}</Button>
            {(item.available_actions.includes('DELETE') || item.deletion?.blockers.length) && <Dropdown trigger={['click']} menu={{ items: item.available_actions.includes('DELETE') ? [{ key: 'delete', label: '删除', danger: true }] : [{ key: 'conditions', label: '查看删除条件' }], onClick: ({ key }) => key === 'delete' ? confirmDelete(item) : setDeletionTarget(item) }}><Button {...focusReturnTargetProps} size="small" aria-label={`更多操作：${item.part_number}`} loading={remove.isPending && remove.variables?.id === item.id}>更多 <DownOutlined /></Button></Dropdown>}
          </Space> },
        ]} /></TableRegion>}
      </Card>
      <DeletionGuidanceModal open={!!blockedDeletionTarget} resourceLabel={`产品“${blockedDeletionTarget?.part_number ?? ''}”`} blockers={blockedDeletionTarget?.deletion?.blockers ?? []} refreshing={products.isFetching} resolveLink={blockedDeletionTarget ? deletionLink(blockedDeletionTarget) : () => undefined} onClose={() => setDeletionTarget(undefined)} onRefresh={async () => { await products.refetch(); setDeletionTarget(undefined); }} />
      <Modal rootClassName="products-create-dialog" title="新增产品" open={createOpen} onCancel={requestCloseCreate} footer={null} closable={!create.isPending} keyboard={!create.isPending} mask={{ closable: !create.isPending }} destroyOnHidden>
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
