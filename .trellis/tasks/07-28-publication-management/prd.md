# 完善发布管理流程

## Goal

把“人工发布”工作台收敛为命名清晰、列表可靠、操作完整且异常入口可发现的“发布管理”，同时保留发布事实和状态事件的历史审计。

## Confirmed Facts

- 左侧导航当前显示“人工发布”，路由和页面主体已使用 `/publications`（`frontend/src/app/AppLayout.tsx:24`、`frontend/src/app/App.tsx:54-55`）。
- 工作台同时读取候选、OPEN 关注事项、摘要和发布记录；发布记录行当前只渲染 `available_actions[0]`，可能隐藏同一状态下的其他服务端动作（`frontend/src/features/publications/PublicationWorkspace.tsx:75-100,430-460`）。
- `PublicationRecord` 通过追加式状态事件流转；“标记已移除”是 `remove` 状态命令，不是删除记录（`backend/app/services/publication_queries.py:66-83`）。
- `REMOVED` 和 `VERIFICATION_FAILED` 会创建唯一 OPEN `PublicationAttention`；关注事项只能显式解决，不能删除（`contracts/database.md:97-105`）。
- 发布记录、状态事件、关注事项和附件均受 `RESTRICT` 或追加式历史约束；当前 OpenAPI 没有发布记录 DELETE（`contracts/openapi.yaml:1631-1700`）。
- “发布需关注”统计 OPEN 关注事项，工作台已有对应 Tab，但总览文案没有解释触发条件（`frontend/src/features/dashboard/DashboardPage.tsx:37-48,82`、`frontend/src/features/publications/PublicationWorkspace.tsx:263,488-503`）。
- Playwright CLI 登录 500 已定位为当前 Vite 进程使用默认代理 8000、实际后端运行在 18000 的启动参数不一致；直连后端登录成功。

## Requirements

- 左侧导航、页面标题、面包屑及相关入口统一使用“发布管理”，不修改稳定路由 `/publications`。
- 修复发布记录表格的字段宽度、展示顺序和操作呈现；所有操作只消费服务端 `available_actions`，不得猜测状态。
- 每行保留“登记发布结果”或“查看记录”作为高频主入口，其余服务端动作全部进入 Ant Design 更多菜单；危险操作必须确认。
- “发布需关注”必须说明由已移除或验证失败触发；总览直接链接到 `tab=attentions`，工作台提供查看上下文、创建修复任务和显式解决入口。
- 服务端只在记录从未出现 `PUBLISHED` 或 `VERIFIED` 事件，且没有 GEO 观测、关注事项、修复任务等下游引用时返回 `DELETE` 动作。
- 曾真实发布的记录不提供删除动作；`remove` 明确显示为“标记已移除”，不得错标为物理删除或破坏历史发布统计。
- 只完善已有真实业务能力，不凭空增加未定义的“其他功能”或自动发布。

## Acceptance Criteria

- [x] 所有用户可见的“人工发布”页面级命名统一为“发布管理”，人工发布仍作为具体流程动作保留。
- [x] 发布记录列表在桌面与窄屏下列宽合理，标题等长字段吸收剩余宽度，操作列保持可用且不制造页面级横向滚动。
- [x] 同一记录的全部服务端可用动作均可发现，页面不再只显示 `available_actions[0]`；危险操作有影响说明、确认流程及中文结果反馈。
- [x] 未真实发布且无下游引用的记录可以物理删除；事件、附件关系和记录在同一事务内清理，独占文件在提交后进入统一清理流程。
- [x] 已出现 `PUBLISHED` 或 `VERIFIED` 历史的记录在任何当前状态下都不显示删除动作，直接调用 DELETE 也返回明确冲突。
- [x] “发布需关注”空态、计数、筛选、详情、修复入口和解决入口使用同一 OPEN attention 口径。
- [x] 后续 `REMOVED` 或 `VERIFICATION_FAILED` 不会从历史发布 cohort 中抹除已发生的发布与验证事件。
- [x] 前端组件测试覆盖动作菜单、URL 恢复和关注事项入口；Playwright CLI 使用真实 API 验证 1536×1024、1024px、375×812 的关键流程并检查 console/requests。

## Out of Scope

- 不实现自动发布或一键发布。
- 不把本任务扩展为全站所有表格的删除入口改造。
- 不新增前端状态枚举、统计缓存或第二套关注事项模型。

## Key Decisions

- 发布删除按历史事实而不是当前状态判断：任何 `PUBLISHED` 或 `VERIFIED` 事件都永久关闭物理删除资格。
- 从未真实发布的记录仍须在没有 GEO 观测、关注事项、修复任务等下游引用时才能删除。
- 删除只级联聚合内部的状态事件和附件关系；审计日志及外部业务历史不得级联删除或改写。
- Playwright 登录 500 已定位为当前 Vite 进程默认代理 `localhost:8000`、实际后端运行于 `127.0.0.1:18000` 的启动参数不一致；验收时使用项目配置显式设置 `VITE_API_PROXY_TARGET`，不把本地端口差异编码进产品代码。

## Constraints

- PostgreSQL 发布记录、状态事件、关注事项和附件是唯一业务来源。
- 前端不得从分页数据重算全量指标，动作必须来自服务端 `available_actions`。
- 已发布后下线仍是历史事实，未经明确契约批准不得物理擦除。
