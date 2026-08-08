# 技术设计

## 职责边界

- Domain 定义 `ColumnDef<T>`、对象链接、URL/search schema、Query、server action token 映射、动作资格和 command/mutation。
- TanStack Table 接收 domain 提供的受控 state，计算 row/header model；demo 使用 `manualSorting`、`manualFiltering`、`manualPagination` 和 `rowCount` 表达 server-controlled 边界。
- Table Kit 渲染语义 table、列角色样式、toolbar/filter/pagination、resolved actions、确认、空态和 skeleton；不获取数据、不访问 Router、不识别 domain。
- 小于 1024px 默认隐藏 `metadata`；小于 768px 默认隐藏 `numeric`/`date`；`primary`/`status`/`actions` 保留。仍放不下时只在 TableShell 内横向滚动。通用 Kit 不自动转换为 List。

## 公共类型

```ts
type ColumnRole =
  | 'primary'
  | 'status'
  | 'metadata'
  | 'numeric'
  | 'date'
  | 'actions';

type ActionTarget =
  | { href: string; command?: never }
  | { href?: never; command: string };

interface ActionConfirmation {
  title: string;
  description: string;
  confirmLabel?: string;
}

type PrimaryRowAction = ActionTarget & {
  key: string;
  label: string;
  intent: 'primary';
  enabled: boolean;
  disabledReason?: string;
  confirmation?: never;
};

type OverflowRowAction =
  | (ActionTarget & {
      key: string;
      label: string;
      intent: 'secondary';
      enabled: boolean;
      disabledReason?: string;
      confirmation?: ActionConfirmation;
    })
  | (ActionTarget & {
      key: string;
      label: string;
      intent: 'danger';
      enabled: boolean;
      disabledReason?: string;
      confirmation: ActionConfirmation;
    });

type RowAction = PrimaryRowAction | OverflowRowAction;

type BulkAction =
  | {
      key: string;
      label: string;
      command: string;
      intent: 'secondary';
      enabled: boolean;
      disabledReason?: string;
      confirmation?: ActionConfirmation;
    }
  | {
      key: string;
      label: string;
      command: string;
      intent: 'danger';
      enabled: boolean;
      disabledReason?: string;
      confirmation: ActionConfirmation;
    };
```

## 最小组件 API

- `TableShell({ regionLabel, children, className, ...tableProps })`：输出带可访问名称、焦点样式和局部横向滚动的 region 与原生 `<table>`；调用方提供 `<thead>/<tbody>` 和表最小宽度。
- `TableToolbar({ children, actions? })`：提供响应式 toolbar 布局槽，不拥有筛选或 selection state。
- `FilterBar({ query, onQueryChange, onSubmit, onReset, filters?, moreFilters?, resetDisabled?, searchLabel?, placeholder? })`：受控搜索与筛选布局；不 debounce、不操作 URL 或页码。
- `ColumnHeader({ role, sortDirection, onSort?, children })`：输出 `<th scope="col">`、`aria-sort` 和可键盘触发的排序按钮；无 `onSort` 时为普通表头。
- `TablePagination({ pageIndex, pageSize, pageCount, totalItems, pageSizeOptions?, onPageIndexChange, onPageSizeChange })`：使用 0-based `pageIndex`，不持有 state。
- `RowActions({ objectLabel, primary?, overflow, onCommand })`：href 使用普通链接，command 交给调用方；组件内部只管理 menu 和 confirmation，不推导 eligibility。
- `BulkActionBar({ selectedCount, actions, onCommand, onClear })`：`selectedCount === 0` 时不渲染；不接收 row IDs。
- `EmptyTable({ kind, title, description, action?, colSpan })`：`kind` 为 `empty | filtered-empty | error`，error 使用 `role="alert"`。
- `TableSkeleton({ columnRoles, rowCount = 5 })`：按列角色输出稳定 skeleton rows。

## 行操作与可访问性

- Primary 为单值属性，overflow 类型只允许 secondary/danger，从类型层阻止多个 Primary 或 danger 直出。
- disabled Primary 使用可聚焦的 `aria-disabled` 控件和 Tooltip；disabled overflow item 保持可聚焦并在菜单内直接展示原因，激活不执行 command。
- danger action 必须携带 `confirmation`；确认 Dialog 使用现有 Base UI primitive 的 focus trap、Escape 和触发器焦点恢复。
- RowActions 根和交互控件阻止 click 冒泡。普通对象链接位于 primary cell，Table Kit 不注册 row click handler。
- `data-column-role` 驱动 alignment、nowrap/truncation、responsive priority 和 144px sticky action zone，不创建第二套 token。

## Demo 数据流

Story/test 内的 `ServerTableDemo` 持有 query、sorting、pagination、rowSelection 和 resolved actions。fixture 先按 query/sorting 计算全部结果，再按 pagination 切片并传入 `useReactTable`；Table 实例只接收当前页 rows 和受控 state。筛选变化由 demo 将 `pageIndex` 设为 0。该逻辑仅用于展示 engine 边界，不导出为生产 hook 或 adapter。

## 兼容与回滚

- 不改变现有 primitives API、routes、OpenAPI 类型或 App Shell。
- 新增依赖只通过 npm 更新 `package.json`/lockfile。
- 回滚按依赖、结构/类型、actions/state、demo/story/test 四个边界反向撤销当前 Task 文件；不得 reset 或回退本地 `main`。
