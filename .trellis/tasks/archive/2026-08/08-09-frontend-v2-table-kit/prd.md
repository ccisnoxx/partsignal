# Frontend V2 Table Kit

## 目标

建立供后续 Products List 等 domain 自行组合的最小 Table Kit，统一一般业务表格的语义结构、列角色、受控筛选与分页、行操作、批量操作、空态、加载态、键盘和响应式边界。Table Kit 不获取业务数据、不拥有 URL schema、不识别 domain 状态，也不发展为万能 `DataTable`。

## 已确认事实

- `frontend-v2/` 已具备 React 19、Tailwind CSS 4、Base UI primitives、Storybook 10、Vitest、Testing Library 和 375/768/1024/1440 viewport 配置。
- `@tanstack/react-table` 尚未安装，是本 Task 唯一批准新增的依赖。
- App Shell、tokens、core primitives 及 auth-context 修复均已进入本地 `main`；本地 `main` 领先当前 `origin/main`，不得因此回退、reset 或自动 push。
- 一般业务表格使用 TanStack Table 作为 headless engine；Design System 只提供可组合展示与交互 Pattern。

## 范围

- 添加 `@tanstack/react-table`。
- 实现 `TableShell`、`TableToolbar`、`FilterBar`、`ColumnHeader`、`TablePagination`、`RowActions`、`BulkActionBar`、`EmptyTable`、`TableSkeleton`、`ColumnRole` 和必要公共类型。
- 在 Storybook/test 内提供受控 demo server table；使用本地 fixture 模拟 server-side slicing，不增加生产 route、假后端 adapter 或通用 data-fetch hook。
- 覆盖 0、1、50 rows，以及 loading、error、filtered empty、long title、only overflow、no action、disabled、destructive 和 narrow 场景。
- 验证 375/768/1024/1440、局部横向滚动、键盘顺序、可见焦点、菜单与确认焦点行为。

## 约束

- 每个 domain 自己定义 columns、URL/search schema、query、action registry、业务资格和 mutation。
- Design System 不导入 domain 类型，不从 status、role、workflow stage 或业务字段推导 eligibility。
- 每行最多一个 Primary；secondary/destructive 进入 overflow；action zone 固定为 144px。
- destructive action 必须确认；disabled action 必须能解释原因。
- Primary object cell 使用普通链接。Table Kit 不实现整行导航；checkbox、menu、button 不成为导航入口并阻止行级 click 冒泡。
- `FilterBar` 保持受控，不读写 Router、不拥有 URL schema；筛选后的页码重置由 domain/demo 控制。
- loading、初始 empty、filtered empty、error 显式区分，不通过空数组、静默默认或固定成功路径混淆。
- 复用现有 tokens、Button、IconButton、DropdownMenu、Dialog、Tooltip、Input、Select 和 Skeleton。
- 不修改 Products、Workspace/Form/Editor Kit、旧 `frontend/`、后端、contracts、CI 或部署。
- 不建立稳定 Playwright E2E 基线；本 Task 只使用命名 `playwright-cli` 做临时视觉与交互检查。

## 验收标准

- [x] TanStack Table 只负责受控 sorting/filtering/pagination/selection 和 row model；Table Kit 只负责 markup、视觉角色、交互与状态呈现。
- [x] 所有指定组件和公共类型存在，且没有万能 `DataTable` 或 domain 反向依赖。
- [x] `RowActions` 的 API 结构上最多接收一个 Primary；overflow 类型不接受 Primary。
- [x] action zone 在表头和数据行均为 144px，窄屏仍可达。
- [x] href action 使用普通链接；command action 交由调用方执行；danger command 仅在确认后执行。
- [x] disabled Primary 与 overflow action 均能被键盘用户读取原因，且不可执行。
- [x] `FilterBar`、sorting、pagination 和 selection 均由 demo 父组件受控。
- [x] loading、empty、filtered empty、error 具有不同语义和文案。
- [x] Storybook 覆盖 0/1/50 rows 及全部要求的边界场景。
- [x] 375/768/1024/1440 下页面根无横向溢出；必要滚动限制在 `TableShell` 内。
- [x] targeted component tests、V2 lint/typecheck/full test/build/Storybook build 和 diff 审计通过。
- [x] 最终 diff 不包含旧前端、后端、contracts、CI、部署、生产 demo route 或其他 domain。

## 阻塞规则

若实现必须识别 domain 状态、业务 action token、真实 URL schema 或 API 数据才能继续，则停止并移交对应 domain Task，不把业务知识或兼容逻辑放入 Design System。若依赖出现真实 peer/API 不兼容，保留错误证据并停止，不引入第二个表格库或 adapter。
