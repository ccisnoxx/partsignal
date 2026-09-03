# Publishing Work 缓存刷新失败现状核对

## 1. 问题来源

- `08-30-frontend-v2-functional-contract-conformance-baseline` 的 route conformance matrix 在 Publishing Work 行记录 P2：Summary、Ready Queue、Work List 在已有缓存时后台刷新失败仍会隐藏当前投影。
- 同一矩阵给出的独立修复边界是“保留三个区块已有 data 并提示后台失败”，且明确“无合同变更”。

## 2. 当前实现证据

### 查询边界

- `publication-work-page.tsx:67-69` 分别读取 Summary、Ready 和 Work List，没有浏览器 join 或共享错误总开关。
- `publication.api.ts:83-127` 为三者配置同一组 query 行为：focus 始终刷新、失败不自动 retry、30 秒 staleTime；Work List key 还包含当前 URL 搜索参数。

### 错误覆盖缓存的根因

- Summary 在 `publication-work-page.tsx:175-191` 先判断 `query.error`，因此 `data + error` 时指标分支不可达。
- Ready Queue 在 `publication-work-page.tsx:219-245` 使用同样顺序，因此卡片和 START 投影被替换。
- Work List 在 `publication-work-page.tsx:371-399` 使用同样顺序，因此行被 `EmptyTable` 替换；页面 `:143-154` 还在任何 `works.error` 时隐藏分页。
- 这不是 cache 丢失或 endpoint 合同错误，而是 view state 条件把“首次失败”和“缓存刷新失败”合并处理。

## 3. 正确模式证据

- `publication-workspace-page.tsx` 已明确区分 Context 初始失败与有缓存时刷新失败：后者保留整个工作台、dirty guard 和重试入口。
- Published Article、Published Content Issue 及 GEO 列表使用 `error && !data` 作为替换内容条件，并在 `data && error` 时显示告警。
- `.trellis/spec/frontend/state-management.md` 多处要求已有 data 的后台刷新失败保留当前只读投影；Publication Workspace 专节也规定初始失败才显示整页错误。

## 4. 动作安全边界

- Ready Item 与 Work List Item 的 `available_actions` 是服务端投影；`.trellis/spec/backend/available-actions-contract.md` 规定它用于 UI 呈现，不替代服务端最终权限和业务校验。
- `StartPublicationDialog` 已处理 CSRF、稳定 idempotency key、pending 去重及 409 人工重试；保留 cached START 不会绕过服务端。
- 本任务因此保留 cached projection 中的操作，不添加按 error 自行禁用动作的第二套权限判断；陈旧告警明确数据并非新鲜成功。

## 5. 测试能力与缺口

- Component test 已覆盖成功、空态、初始三个 GET error、START 409 与 pending，但没有先成功再 refetch 失败。
- `publication.fixture.ts` 已提供 `setSummaryMode`、`setReadyMode`、`setWorkMode` 和三个请求数组，可在首次成功后切换 error；不需要改 fixture contract。
- `publication-work-list.spec.ts` 已覆盖 production artifact、两项目 viewport、URL、loading/empty/initial error 与焦点返回，但当前用 `page.reload()` 制造初始错误，不能证明 TanStack Query 保留缓存时的分支。
- 仓库既有 E2E 使用 synthetic `document.visibilityState` 与 `visibilitychange` 触发 `refetchOnWindowFocus: 'always'`，本任务应沿用该模式。

## 6. 结论

权威修复点是 `PublicationWorkPage` 的三个渲染分支和 Work List 分页条件。无需修改 API query options、fixture 能力、公共合同、generated client、backend、数据库或稳定业务设计；测试只需证明首次成功后的真实 focus refetch 失败与逐区块恢复。
