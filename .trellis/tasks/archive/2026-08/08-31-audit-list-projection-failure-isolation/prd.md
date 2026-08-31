# Audit 列表投影失败隔离

## Task 关系与唯一目标

- Parent：`08-30-frontend-v2-functional-contract-conformance-baseline`
- 独立可评审目标：未知或未登记 Audit action 的失败不得逃出其最小列表投影边界。
- 当前阶段：规划已获人工批准，`task.py start` 已执行，限定范围实现和 required validation 已完成；Task 在提交确认前保持 `in_progress`。

## 问题陈述

`AuditLog.action` 与 `AuditLogFilterOptions.actions[]` 在 OpenAPI 中都是开放字符串。前端 `auditActionLabels` 则是严格 allowlist，`auditActionLabel()` 在收到未登记 action 时抛出异常。当前 `/system/audit` 在 React render 阶段分别为每条 `AuditRow` 和每个动作筛选项直接调用该函数，因此 API 返回中的一个未知 action 会越过 list、filter-options、detail 三个 query 已有的独立网络错误表面，进入路由级 `errorComponent`，击穿整个页面。

该问题不是放宽 label registry 的理由。未知 action 仍必须显式失败，并且不能以原始 token、`String(action)`、`label ?? action`、泛化成功标签、raw JSON、`change_summary` 或其他未登记字段作为展示 fallback。

## 功能要求

1. Audit domain 必须继续以唯一严格 allowlist 解析 action。已登记 action 返回正式中文标签；未知 action 返回可判别的失败结果，失败结果不得携带可供 UI 展示的原始 token。
2. 列表行与动作筛选项是两个彼此独立的最小投影边界：一个坏行只影响自身，一个坏筛选项只影响动作筛选控件的局部反馈；二者都不得触发 route-level error。
3. mixed `AuditLogList` 中所有合法记录必须继续按服务端顺序展示，并保持既有 click、Enter、Space、URL `logId`、lazy detail、Pane/Sheet 和焦点恢复行为。
4. 未知 action 记录必须仍占据一个七列表格行。除 action token 外，可继续展示 `AuditLog` metadata-only 合同已经批准的时间、操作者、模块、对象类型/ID、结果和 Request ID；动作单元格只显示明确、通用且不泄漏 token 的“无法安全投影”状态。
5. 未知 action 行不得成为新的 Detail 触发器：不响应 click、Enter 或 Space，不写入 `logId`，不发起 detail GET。该决定来自现有 strict Detail 合同——详情只允许登记 action/field/value；列表已经确定 action 未登记时，组件不得猜测详情仍可安全展示。
6. direct/off-page `logId`、已经打开的合法详情以及共享 `AuditDetailContent` 继续由现有 strict Detail owner 处理。本 Task 不改详情 registry、详情 query、详情局部失败、服务端 `409 AUDIT_PROJECTION_FAILED` 或 AI Channel Runtime 对该 owner 的复用。
7. filter-options 中的已登记 action 继续作为可选项显示正式中文标签。未登记 action 不得成为可选择的业务项；动作筛选控件附近必须显示可访问、局部且不含 token 的失败反馈，其他筛选项和列表继续工作。
8. 当前 canonical URL 已带未知 `action` 时，页面不得崩溃或伪装为“全部动作”。UI 必须以不暴露 token 的“当前动作无法安全投影”状态表示该既有筛选，并允许用户明确清除或改选已登记 action；用户未改变该筛选时，现有 URL/API server-side filter 语义保持不变。
9. list、filter-options、detail 三个 query key、retry/stale-data、分页、canonical URL、服务端筛选和权限边界保持不变。`logId` 仍不得进入 list key；一个 projection failure 不得被伪装成 query transport failure。
10. 如果合法详情已经打开，随后 list refresh 得到含未知 action 的 mixed rows 或 stale refresh 失败，已打开详情和旧列表数据不得被局部投影失败卸载。
11. 七列顺序和原生 table 语义保持不变。合法行继续保持现有键盘详情入口和 `aria-label`；失败行不制造失效 tab stop，局部失败文字必须由辅助技术读取。移动端、桌面端和 `TableShell` 局部横向滚动合同保持不变。
12. 解决方案限于 Audit domain 的局部判别式 projection result 及其两个消费者，不新增全站 ErrorBoundary、通用投影框架、宽松 registry、全局 Store、第二套 query 或跨域 wrapper。

## 已确认安全与必须隐藏的字段

未知 action 行仍可展示以下现有 `AuditLog` metadata-only 字段，因为它们已经由 OpenAPI 列表合同批准并由正常行展示：

- `created_at`
- `actor`，或既有 deleted-actor 文案
- `business_module` 的登记中文标签
- `target_type` 与 nullable `target_id`
- `outcome` 的登记中文标签
- `request_id`

以下内容必须在局部失败表面隐藏：

- 未知 `action` token 及其任何字符串化形式
- `change_summary`
- raw response / raw JSON
- 未登记 `facts`、`changes`、field 或 value shape
- fixture sentinel 或其他仅用于证明不泄漏的测试载荷
- 由未知 action 推导的详情入口或业务链接

## 明确排除

- 为未知 action 增加新的业务中文标签。
- 扩大 OpenAPI enum、修改 generated client、后端 action 生成逻辑或数据库。
- 修改 Audit Detail facts/changes registry、共享 detail renderer 或服务端 `AUDIT_PROJECTION_FAILED`。
- 创建 raw JSON viewer、展示 `change_summary` 或未知 facts/changes。
- 新增全局 React ErrorBoundary、通用 projection framework 或宽松 action registry。
- 重做 Audit API、权限、分页、筛选、URL 或 stale-data 语义。
- 重构 AI Channel Runtime；本 Task 只用其调用关系确认共享 owner 不受影响。
- 视觉风格、品牌、配色、动效优化或无关重构。
- 生产数据写入、现有脏文件清理、提交或推送。

## 精确验收标准

- [x] mixed `AuditLogList` 同时包含至少两个已登记 action 和一个未知 action 时，`/system/audit` 仍显示页面标题、筛选区、七列表格和分页，不进入“系统审计发生意外错误”。
- [x] 所有合法记录继续显示正确中文动作标签，并分别证明 click、Enter、Space、URL `logId` 和 lazy detail 行为不变。
- [x] 未知记录只在自身动作单元格显示“无法安全投影”状态；同一行其余 approved metadata 仍可读。
- [x] 未知记录不具有可执行的 click/Enter/Space 详情入口，不写 `logId`，不发送 detail GET。
- [x] 局部失败表面和浏览器 DOM 不显示未知 action 原文、raw JSON、`change_summary` 或 fixture sentinel。
- [x] 未知 action 不被加入 `auditActionLabels`，不存在 `label ?? action`、`String(action)`、模板字符串 token 或其他宽松展示 fallback。
- [x] filter-options 同时返回合法与未知 action 时，合法选项仍可选择，未知项不成为可选业务项，动作筛选控件附近出现可访问且不含 token 的局部反馈，页面和列表不崩溃。
- [x] canonical URL 中已有未知 `action` 时，页面显示通用的当前筛选失败状态，不把它显示为“全部动作”，并允许清除或改选；未改动时 URL 与 server-side filter 参数保持原值。
- [x] 一个坏行或坏筛选项不影响正常分页、page-size、canonical URL、target/module/outcome 等其他筛选项、列表 server order、stale-data 保留或越界页规范化。
- [x] 已打开的合法详情在 list refresh 出现坏行或 stale refresh 失败时继续显示；关闭、Escape、Back/Forward 和焦点恢复保持不变。
- [x] 现有 Detail 对未知 action/field/value shape 的 strict local failure 和服务端 `409 AUDIT_PROJECTION_FAILED` 行为保持不变。
- [x] ADMIN-only 权限、ENGINEER 403、deleted actor、SUCCESS/FAILED/DENIED、related entry AVAILABLE/MISSING/UNSUPPORTED 三态保持不变。
- [x] 七列表格列顺序、`TableShell` region、移动/桌面 Pane/Sheet、375/768/1024/1440 无页面级横向溢出和现有 ARIA 语义保持不变。
- [x] model 测试证明判别式结果：已登记 action 为成功结果，未知 action 为不含原 token 的失败结果；原严格 `auditActionLabel()` 合同没有被改成宽松 fallback。
- [x] component 测试覆盖 mixed rows、unknown filter option、unknown current URL action、合法详情保持和坏行无 detail request。
- [x] Playwright fixture 实际向 list 与 filter-options 注入未知 action，并向未登记载荷注入 sentinel；E2E 断言没有 `pageerror`、没有未允许的 `console.error`、合法行仍可用且 DOM/URL/可见错误不泄漏未登记内容。
- [x] OpenAPI、generated client、backend、数据库、Audit action registry 合同和 AI Channel Runtime 生产代码均无变更。

## Review Gate

本 PRD、`design.md` 和 `implement.md` 已获人工批准，以下命令已执行：

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-31-audit-list-projection-failure-isolation
```

`08-30-v2-live-readonly-acceptance` 与 parent baseline Task 均未归档、未修改；本 Task 在提交确认前保持 `in_progress`。
