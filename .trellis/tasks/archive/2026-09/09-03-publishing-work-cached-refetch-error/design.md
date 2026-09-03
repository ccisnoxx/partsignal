# Publishing Work 缓存刷新失败保留投影设计

## 1. 设计目标

让 `/publishing/work` 的三个独立 read model 正确表达 TanStack Query 的组合状态：无 data 的首次失败替换区块，有 data 的后台刷新失败保留最后成功投影并增加陈旧告警。各 surface 独立恢复，不改变 publication 命令或权限边界。

## 2. 状态所有权

| 状态 | Owner | 本任务行为 |
| --- | --- | --- |
| Summary data/error/fetching | `publicationSummaryQueryOptions()` | 保留当前 data；错误只影响 Summary 告警与重试 |
| Ready data/error/fetching | `publicationReadyItemsQueryOptions()` | 保留当前 cards/actions；错误只影响 Ready 告警与重试 |
| Work List data/error/fetching | 当前 exact `publicationWorkListQueryOptions(search)` | 保留当前 rows/total/pagination；不读取其他 URL key |
| URL filter/page/pageSize | route search + `onSearchChange` | 既有 canonical URL 行为不变 |
| START 表单与 mutation | `StartPublicationDialog` | 既有 CSRF/idempotency/409 合同不变 |

不新增组件级 data 副本、全局 store、聚合 query、其他分页 cache 扫描或本地权限状态。

## 3. 统一渲染状态矩阵

每个 surface 按以下顺序渲染：

| Query 状态 | 内容 | 错误提示 | 重试 |
| --- | --- | --- | --- |
| `isPending` 且无 data | 既有 skeleton | 无 | 无 |
| `error && !data` | 既有初始错误 surface | structured error + request ID | 当前 query |
| `data && !error` | 当前成功投影或既有空态 | 无 | 无 |
| `data && error` | 最后成功投影或其空态 | 区块级 stale `role="alert"` | 当前 query |
| background fetching + data | 当前投影 | 沿用当前 error 状态；不切 skeleton | 不增加第二状态 owner |

判断以 `data` 是否存在为准，不以 `items.length`、`total` 或 truthy 业务值代替。成功空响应也是可保留的有效投影。

## 4. 页面结构

在页面文件内添加轻量局部 `CachedRefreshAlert`（最终命名可按现有代码约定调整），接收 surface 名称、error 和 `refetch`：

- 使用与现有错误态一致的 destructive token 和 `role="alert"`；
- 明确“后台刷新失败，已保留当前数据”；
- 复用 `errorMessage(error)`，保留服务端 message 与 request ID；
- 提供唯一的“重试刷新”按钮；
- 不处理 data、不调用 sibling query、不吞掉 refetch failure。

三个 surface 的调整：

1. Summary：`error && !data` 才显示原错误段；有 data 时始终渲染四指标，并在指标前显示 stale alert。
2. Ready Queue：`error && !data` 才显示原错误段；有 data 时渲染 cards 或有效空态，并在其前显示 stale alert。卡片继续消费缓存行的 `available_actions`。
3. Work List：错误提示放在表格区域之前或列表 section 内，不把 alert 塞进 table 结构；`error && !data` 才显示 `EmptyTable`，有 data 时继续渲染 rows/空态。分页条件只排除 pending 或无 data 的初始 error，因此缓存错误仍保留页码、总数和导航。

Header 中现有按任意 error 显示的重试按钮应与 stale alert 合并为每区块一个入口，避免同一错误出现两个重试控件；初始错误 surface 继续保留自身重试。

## 5. 动作与交互边界

- stale Summary 纯只读。
- stale Ready Queue 保留 START/不可开始显示；START 仍携带缓存投影的 canonical ID，服务端在 POST 时最终校验当前资格和冲突。
- stale Work List 保留筛选、分页和链接。更改筛选/页码会切换 exact key；若新 key 无缓存且请求失败，则自然进入该 key 的初始错误态，不回退显示旧 key 数据。
- 每个 stale alert 的 retry 只执行自己的 `query.refetch()`。成功时 TanStack Query 写入新 data 并清 error；失败时旧 data 和 error 自然保留。
- 不增加自动 replay、自动 retry、全局刷新或隐藏错误 fallback。

## 6. 测试设计

### Component

- 保留并加强现有三个 GET 初始失败测试，确认无缓存时仍有三个独立 alert/request ID。
- 新增缓存刷新失败测试：先让三个 query 成功，再使三个 GET 返回各自 structured error，并通过 QueryClient 对 exact key 执行 refetch；断言四指标、Ready cards/START、Work rows 与分页仍在，同时出现三个带 request ID 的 stale alert。
- 点击各 alert 的重试前记录请求数，切回对应成功响应后断言只调用相应 endpoint、只清除对应 alert。测试实现可按可读性拆成逐 surface cases，避免一个超长断言块。
- 保留成功、空态、START 409、pending、URL callback 与焦点测试。

### Production-artifact Playwright

- 首次进入 canonical URL 并等待三个成功投影。
- 将 fixture 三个 mode 切为 error，模拟 `hidden -> visible` 触发真实 focus refetch，并以请求数组确认三个 endpoint 均发生第二次请求。
- 断言四指标、Ready card/START、Work rows、pagination 仍可见，三个 stale alert 分别显示 `req-summary`、`req-ready`、`req-works`。
- 逐个恢复 fixture mode 并点击该区块 retry，确认只增加相应请求、该告警消失且其他两区块仍保持数据与告警。
- 在 mobile/desktop 两个 foundation project 复用既有 375/768/1024/1440 根宽度与键盘可达性检查。

## 7. 兼容性、文档与回滚

- 产品代码预计只修改 `publication-work-page.tsx`；component 与 E2E spec 增加回归。现有 fixture 已满足场景，除非实施中发现请求控制缺口，否则不修改它。
- 不修改 backend、OpenAPI、generated schema、数据库合同、Makefile、CI 或业务设计文档。
- 稳定 spec 已规定 cached refetch error 保留投影与服务端动作权威；本任务是实现漂移修复，预计无需更新 spec。若实施发现规范缺口，先报告并回到规划，不顺手扩域。
- 回滚只需撤销页面与定向测试变更，无迁移、持久化数据或部署状态需要恢复。
