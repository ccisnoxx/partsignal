# Publishing Work 缓存刷新失败保留投影

## 目标与用户价值

关闭 `/publishing/work` 的缓存刷新一致性缺口：运营摘要、Ready Queue 或发布工作列表已经成功加载后，窗口聚焦等后台刷新若失败，页面必须保留该区块最后一次成功的服务端投影，并明确提示数据可能陈旧和提供独立重试；不得把仍可阅读、导航和由服务端最终校验的工作入口替换成空白错误态。

## 已确认事实

- 页面由三个相互独立的 TanStack Query read model 组成：`publication-workbench-summary`、`publication-ready-items` 和带当前 URL 筛选/分页参数的 `publication-works`；三个 query 均配置 `refetchOnWindowFocus: 'always'`、`retry: false`、`retryOnMount: false` 与 30 秒 `staleTime`。
- 当前 Summary、Ready Queue 和 Work List 均在 `query.error` 时优先渲染整块错误态，即使 TanStack Query 仍保留 `query.data`；Work List 的分页也因 `works.error` 被隐藏。
- 当前初始失败、空态、loading、START 409、URL 和响应式行为已有 component / production-artifact Playwright 覆盖，但不存在“先成功缓存、再后台刷新失败”的回归测试。
- Publication fixture 已能分别切换三个 endpoint 的 `success / empty / error / loading` 模式并记录请求，无需新增测试专用 API 或放宽未声明请求、runtime error 失败边界。
- 同域 Published Article / Published Content Issue 与 Publication Workspace 已采用“`error && !data` 才替换内容，已有 data 时保留当前投影并提示刷新失败”的既定模式。
- Ready Queue 的 `START` 与 Work List 的导航/动作来自服务端 read model；服务端继续在命令边界最终校验权限、revision、引用和状态。缓存告警不等于刷新成功，也不把前端动作投影提升为授权边界。
- 基线审计将该问题定级为 P2，并指定独立 Task `publishing-work-cached-refetch-error`；该修复不需要公共合同变化。

## 需求

### R1：区分初始失败与缓存刷新失败

- 每个 read model 独立判断自身状态；`error && !data` 继续使用现有初始错误 surface，`data && error` 则保留最后一次成功数据。
- 一个区块的错误不得隐藏、重置或伪装另外两个区块的数据与状态。
- `isPending` 只负责无数据的首次加载；后台 fetching/error 不得把已有投影切回 skeleton 或空态。

### R2：保留三个当前投影

- Summary 缓存刷新失败时继续显示四项最后成功指标。
- Ready Queue 缓存刷新失败时继续显示最后成功的内容卡片、账号信息和服务端 `available_actions` 投影出的 START/不可开始状态。
- Work List 缓存刷新失败时继续显示最后成功的行、筛选结果、分页总数和页码；不得把表格替换为 `EmptyTable` 或隐藏分页。
- 保留的是 TanStack Query 当前 exact key 的最后成功数据；不得扫描其他筛选/分页 cache、合并 sibling query、猜测默认值或建立第二份 canonical 状态。

### R3：明确陈旧状态与独立恢复

- `data && error` 时，在对应区块显示可感知的 `role="alert"` 告警，说明后台刷新失败且当前展示为已保留数据，并保留真实结构化错误与 `request_id`。
- 每个区块只提供一个清晰的重试入口；重试只调用该区块自身 query 的 `refetch()`，不得联动刷新 sibling read model。
- 重试成功后该区块采用新响应并移除陈旧告警；失败则继续保留旧投影和告警。

### R4：动作与业务边界

- stale/error 状态下保留缓存投影中的阅读、导航、筛选、分页及 START 入口，不因一次后台读取失败擅自推导或撤销服务端动作。
- START mutation 仍沿用既有 CSRF、稳定 idempotency key、409 不自动重放与服务端最终校验；本任务不改变命令错误恢复语义。
- 不修改 query key、缓存时长、focus refetch 策略、backend、`contracts/openapi.yaml`、generated client、数据库合同、权限或业务状态转换。
- 不创建、启动或吸收 `integrity-error-domain-mapping`。

## 验收标准

- [x] AC1：三个 read model 初始失败时仍各自显示完整 structured error 和 `request_id`，且不显示不存在的缓存内容。
- [x] AC2：三个 read model 已成功加载后，任一区块后台刷新失败只在该区块显示陈旧数据告警，并保留该区块最后成功的内容。
- [x] AC3：Summary 四指标、Ready Queue 卡片与 START/不可开始投影、Work List 行与分页在各自缓存刷新失败时仍可见；一个区块失败不改变其余区块。
- [x] AC4：三个告警均保留真实错误信息与 `request_id`；每个重试只发起对应 endpoint 请求，成功后只清除该区块告警并采用新响应；重试再次失败仍保留旧投影和告警。
- [x] AC5：缓存错误期间的筛选、分页、内容/产品/工作导航及 START 既有语义无回归；START 仍由服务端最终校验，409 不自动 replay；切换到无缓存 exact key 的初始失败不会回退旧 key 数据。
- [x] AC6：production artifact 下通过窗口 `hidden -> visible` 触发真实 focus refetch，证明首次成功后错误响应不会隐藏三个投影；375/768/1024/1440 页面根无新增横向溢出，键盘和错误告警可感知。
- [x] AC7：只修改 Publishing Work 前端页面、定向 component/E2E 测试及本 Task 文档；backend、OpenAPI、generated client、数据库、Makefile、CI 和 `integrity-error-domain-mapping` 均无变化。

## 范围外

- 修改服务端 read model、publication lifecycle、权限、revision、事务、HTTP 错误码或 ErrorEnvelope。
- 统一改造仓库内所有 cached refetch error surface，或抽取跨领域通用错误状态框架。
- 改变 Query 默认 retry、staleTime、focus refetch、GC 或全局 QueryClient 配置。
- 为 stale 数据增加本地更新时间、持久化副本、离线模式或跨 query 聚合状态。
- `integrity-error-domain-mapping`。

## 技术约束

- 修复放在拥有三个 surface 分支的 `publication-work-page.tsx`，沿用现有 query data 与 structured error 格式；不在 API 层制造 fallback。
- 可以添加页面内局部的重复 UI helper，但不得为三个简单 surface 引入新全局组件、store 或抽象层。
- production-artifact E2E 使用现有 Publication fixture 的 mode setter 和项目既有 synthetic `visibilitychange` 模式；不得用页面 reload 代替后台 refetch 场景。
- 所有阻断性产品、范围、UX、兼容性和风险决策均已由现有合同与用户目标确定；不存在待实施前回答的开放问题。
