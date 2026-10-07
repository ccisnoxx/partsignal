import { z } from 'zod';

import type {
  OverflowRowAction,
  PrimaryRowAction,
} from '@/design-system/data-table/types';
import type { components } from '@/shared/api/generated/schema';

type Product = components['schemas']['Product'];
type ProductListItem = components['schemas']['ProductListItem'];
type ProductProjection = Product | ProductListItem;
type ProductFactStatus = components['schemas']['ProductFactStatus'];
type ProductWorkflowStage = components['schemas']['ProductWorkflowStage'];
type ProductStatus = components['schemas']['ProductStatus'];
type ProductPrimaryTask = Product['primary_task'];
type ProductAvailableAction = Product['available_actions'][number];
type ProductDeletionBlocker = components['schemas']['DeletionBlocker'];
type Confidentiality = components['schemas']['Confidentiality'];
type ProductStatusTone = 'outline' | 'secondary' | 'success' | 'warning' | 'info';

type ProductStatusPresentation = {
  label: string;
  tone: ProductStatusTone;
  description: string;
};

const productFactStatusRegistry = {
  NOT_ENTERED: { label: '未录入', tone: 'outline', description: '尚无不可变事实版本' },
  PENDING_REVIEW: { label: '待审核', tone: 'warning', description: '当前事实版本正在等待审核' },
  CHANGES_REQUESTED: { label: '待修订', tone: 'warning', description: '审核已要求修改当前事实' },
  APPROVED: { label: '已批准', tone: 'success', description: '当前事实版本已经批准' },
  RETIRED: { label: '已停用', tone: 'secondary', description: '产品及其事实已停用' },
} satisfies Record<ProductFactStatus, ProductStatusPresentation>;

const productWorkflowStageRegistry = {
  FACTS_EMPTY: { label: '事实未录入', tone: 'outline', description: '产品尚未开始录入事实' },
  FACTS_EDITING: { label: '事实编辑中', tone: 'info', description: '事实工作区包含尚未提交的修改' },
  FACT_REVIEW_PENDING: { label: '事实待审核', tone: 'warning', description: '事实快照正在等待审核' },
  FACT_CHANGES_REQUESTED: { label: '事实待修订', tone: 'warning', description: '审核已要求修订事实' },
  FACT_APPROVED: { label: '事实已批准', tone: 'success', description: '当前事实已通过审核' },
  RETIRED: { label: '已停用', tone: 'secondary', description: '产品流程已停用' },
} satisfies Record<ProductWorkflowStage, ProductStatusPresentation>;

const productStatusRegistry = {
  ACTIVE: { label: '启用', tone: 'success', description: '产品可继续推进业务流程' },
  RETIRED: { label: '停用', tone: 'secondary', description: '产品已停止推进新业务' },
} satisfies Record<ProductStatus, ProductStatusPresentation>;

const confidentialityRegistry = {
  PUBLIC: '公开',
  INTERNAL: '内部',
  RESTRICTED: '受限',
} satisfies Record<Confidentiality, string>;

const productIdentityField = (label: string) => z.string()
  .trim()
  .min(1, `${label}不能为空`)
  .max(160, `${label}不能超过 160 个字符`);

function resolveProductPrimaryAction(product: ProductProjection): PrimaryRowAction {
  const productId = encodeURIComponent(product.id);
  const action: ProductPrimaryTask = product.primary_task;
  switch (action) {
    case 'ENTER_FACTS':
      return primaryLink(action, '录入事实', `/products/${productId}/facts`);
    case 'SUBMIT_FACT_REVIEW':
      return primaryLink(action, '提交审核', `/products/${productId}/facts`);
    case 'REVIEW_FACT':
      return primaryLink(action, '审核', `/products/${productId}/facts/review`);
    case 'REVISE_FACT':
      return primaryLink(action, '修订', `/products/${productId}/facts`);
    case 'CREATE_CONTENT_TASK':
      return primaryLink(action, '创建内容', `/content/tasks/new?productId=${productId}`);
    case 'VIEW_FACT_HISTORY':
      return primaryLink(action, '查看事实历史', `/products/${productId}/facts/versions?page=1&pageSize=20`);
    default:
      return assertNever(action);
  }
}

function primaryLink(key: ProductPrimaryTask, label: string, href: string): PrimaryRowAction {
  return { key, label, href, intent: 'primary', enabled: true };
}

function resolveProductOverflowActions(
  product: ProductProjection,
  options: { deleting: boolean; surface: 'list' | 'detail' },
): OverflowRowAction[] {
  const actions = product.available_actions.map((action) => (
    resolveAvailableAction(action, product, options)
  ));
  if (product.deletion?.blockers.length && !product.available_actions.includes('DELETE')) {
    actions.push({
      key: 'VIEW_DELETE_CONDITIONS',
      label: '查看删除条件',
      intent: 'secondary',
      enabled: true,
      command: 'view-delete-conditions',
    });
  }
  return actions;
}

function resolveAvailableAction(
  action: ProductAvailableAction,
  product: ProductProjection,
  options: { deleting: boolean; surface: 'list' | 'detail' },
): OverflowRowAction {
  switch (action) {
    case 'UPDATE':
      return options.surface === 'list'
        ? {
            key: action,
            label: '编辑产品',
            intent: 'secondary',
            enabled: true,
            href: `/products/${encodeURIComponent(product.id)}`,
          }
        : {
            key: action,
            label: '编辑产品',
            intent: 'secondary',
            enabled: true,
            command: 'update-product',
          };
    case 'DELETE':
      if (!product.deletion || product.deletion.blockers.length > 0) {
        throw new Error(`Products API 为 ${product.id} 返回了矛盾的 DELETE projection`);
      }
      return {
        key: action,
        label: options.deleting ? '正在删除…' : '删除产品',
        intent: 'danger',
        enabled: !options.deleting,
        command: 'delete-product',
        disabledReason: options.deleting ? '删除请求正在处理' : undefined,
        confirmation: {
          title: `确认删除产品“${product.part_number}”`,
          description: '将删除该产品及当前事实工作区；此操作不可恢复，存在事实版本、内容任务或 GEO 观测引用时服务端会拒绝。',
          confirmLabel: '确认删除',
        },
      };
    default:
      return assertNever(action);
  }
}

function formatRelativeProductTime(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`Products API 返回了非法时间：${value}`);
  const seconds = (timestamp - now) / 1_000;
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(Math.round(seconds), 'second');
  const minutes = seconds / 60;
  if (Math.abs(minutes) < 60) return formatter.format(Math.round(minutes), 'minute');
  const hours = minutes / 60;
  if (Math.abs(hours) < 24) return formatter.format(Math.round(hours), 'hour');
  const days = hours / 24;
  if (Math.abs(days) < 30) return formatter.format(Math.round(days), 'day');
  const months = days / 30;
  if (Math.abs(months) < 12) return formatter.format(Math.round(months), 'month');
  return formatter.format(Math.round(months / 12), 'year');
}

function formatExactProductTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Products API 返回了非法时间：${value}`);
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

function getProductDeletionBlockerLabel(blocker: ProductDeletionBlocker) {
  switch (blocker.type) {
    case 'FACT_VERSION': return '事实版本';
    case 'CONTENT_TASK': return '内容任务';
    case 'GEO_OBSERVATION': return 'GEO 观测';
    default: throw new Error(`Products API 返回了未知删除阻断类型：${blocker.type}`);
  }
}

function assertNever(value: never): never {
  throw new Error(`Products 收到未处理的合同 token：${String(value)}`);
}

export {
  confidentialityRegistry,
  formatExactProductTime,
  formatRelativeProductTime,
  getProductDeletionBlockerLabel,
  productFactStatusRegistry,
  productIdentityField,
  productStatusRegistry,
  productWorkflowStageRegistry,
  resolveProductOverflowActions,
  resolveProductPrimaryAction,
};
export type {
  Product,
  ProductFactStatus,
  ProductListItem,
  ProductProjection,
  ProductStatus,
  ProductWorkflowStage,
};
