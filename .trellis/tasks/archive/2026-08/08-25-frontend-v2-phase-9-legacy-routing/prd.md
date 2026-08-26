# Frontend V2 Phase 9 Legacy Routing

## 状态

- 阶段：实现与 Required Validation 已完成，等待提交授权
- 分支：`codex/frontend-v2-phase-9-legacy-routing`
- 基线：本地 `main` 为 `c91266d93f205655320cd03192bbe5a852ac6978`；`origin/main` 为 `2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9`
- 外部范围：仅仓库实现和本地验证；不部署、不推送、不操作 Staging/production

## 目标

在 V2 TanStack Router 中实现并冻结已登记 V1 URL 到 canonical V2 URL 的确定性 deep-link 合同：显式路径和 query 转换、安全匿名 return-to、既有强制改密与权限行为、浏览器历史语义，以及显式 404。Legacy URL 只承担迁移入口，不成为第二套业务路由。

## 需求

### R1 路由所有权与转换

- 每个登记路径由 `frontend-v2/src/routes/` 中的显式 file route 持有，并用 router `replace` 进入 canonical URL。
- Nginx 只保留 SPA fallback；backend、Nginx 和 V1 不维护重复转换表。
- 不创建通用 redirect engine，不手工编辑生成的 route tree，不对未知路径做首页 fallback。
- `/products/:productId` 保持当前 V2 Product Detail 语义，并可进入 `/products/:productId/facts`；不得恢复或伪装旧 Facts 页面。
- `/content/:versionId` 的参数直接作为 ContentVersion identity；不得查 task/current relation 或猜 editor。
- GEO 静态 legacy route 必须优先于 observation 动态 ID。

### R2 Query 合同

- 以实际 V1 URL 状态与当前 V2 search schema 为依据，逐字段白名单转换。
- 复用 canonical V2 parser/model；只转换 V2/backend 已支持且语义等价的字段。
- 未知、已淘汰或语义不等价的 query 不透传，不做 data lookup，不新增 API，不创建第二套筛选状态。
- ID 原样传递，由 canonical route 执行既有格式或资源校验。
- `/publications` 严格执行详情组合、articles、resolved issues、active work 的优先级；冲突 query 只按该优先级解释。
- V1 默认 `tab=history` 精确转换为 `/publishing/work?status=CLOSED`；为此仅扩展现有 V2 publication work search schema/request owner 接受 backend 已支持的 `CLOSED`，不新增 API、lookup、页面或前端推导状态。

### R3 Return-to 与强制改密

- 匿名访问受保护 legacy deep link 时，`/login` 保存经批准的原始同源站内 URL；登录成功后先 `replace` 回该 legacy URL，再由 legacy route `replace` 到 canonical URL。
- redirect 只接受以单个 `/` 开始的同源绝对路径；拒绝 `//`、scheme/host、反斜杠、编码或重复编码的分隔符绕过、`javascript:`/`data:`、畸形编码和登录页自循环。
- 校验与默认策略只有一个权威 owner；无效值回到既有安全默认 `/`。
- must-change-password 始终先进入 `/account/security`，完成后保持当前回 `/` 合同；本 Task 不增加 pending redirect 状态。

### R4 权限与错误

- ADMIN legacy route 进入对应 canonical 管理页面。
- ENGINEER 先到 canonical 受保护地址，再显示现有 403；不得重定向成 404 或首页，API 权限仍由服务端裁决。
- 根 route 提供显式 404；未登记路径不重定向。
- 已登记资源 URL 的不存在、403 与领域错误继续由现有 canonical 页面处理，保留 request ID/错误码；静态 asset 404 仍由 Nginx/static owner 处理。

### R5 浏览器与回归

- direct、refresh、Back/Forward 均保持 canonical URL；replace 不形成 legacy/canonical loop。
- Playwright 覆盖全部登记 pathname、代表性 query、ID、匿名/恶意 return-to、must-change、ADMIN/ENGINEER、未知 path、资源不存在、移动/桌面代表路径和运行时错误监听。
- 优先抽取并复用现有 auth-session fixture 与 domain fixture；不复制完整业务 fixture，也不为测试创建 redirect 框架。

### R6 文档与交付边界

- 实现后同步更新 `docs/frontend-v2/02-information-architecture-and-routing.md`、`07-migration-plan.md`、`08-testing-quality-and-acceptance.md`，只记录实际实现与本地验证。
- 不修改 backend、OpenAPI、数据库、Nginx/deployment、权限/CSP/Trusted Types 或 V1 资产。
- 不自动 commit/push/merge；提交前单独展示 commit plan 并等待确认。

## 范围外

- Backend、OpenAPI、数据库、Nginx/deployment、权限、CSP、Trusted Types 与 V1 资产变更。
- 数据 lookup/resolver、旧 Products Facts 页面恢复、通用 redirect engine、任意 query passthrough 或第二套筛选状态。
- Staging/production 操作、部署、自动 commit/push/merge，以及下一 Phase 9 Task。

## 验收标准

- [x] `research/audit.md` 的 redirect matrix 与 query 表全部实现，包括 closed work 的 `status=CLOSED` canonical 合同。
- [x] 所有 legacy route 使用 replace，最终地址是唯一 canonical V2 URL，未知路径显示显式 404。
- [x] return-to 只有一个校验 owner，合法 deep link 可恢复，外部及编码绕过被拒绝，must-change 行为不变。
- [x] ADMIN/ENGINEER、资源 404/403/error 保持既有 canonical 行为，无伪成功。
- [x] 必要 route-local unit tests 与 `tests/e2e/legacy-routing.spec.ts` 覆盖本 PRD 的浏览器合同。
- [x] Required Validation 全部通过。
- [x] 三份权威 V2 文档与任务证据一致，并明确 Staging 未验证。

## 已批准决策

### D1 `tab=history` 的 closed work（2026-08-26 已批准）

V1 `tab=history`（非 `status=RESOLVED`）表示 closed publication work。用户批准仅在现有 V2 `/publishing/work` search schema 与列表请求 owner 中加入 backend 已支持的 `CLOSED`；不得扩展 backend、增加数据查询、临时前端推导或新页面。
