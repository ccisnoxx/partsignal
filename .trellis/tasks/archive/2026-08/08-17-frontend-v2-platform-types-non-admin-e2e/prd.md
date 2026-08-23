# Frontend V2 Platform Types 非管理员 E2E

## Goal

关闭 Platform Types production-artifact E2E 的非管理员编排缺口：明确 `_admin` route 与 backend 权限测试的互补所有权，使 ENGINEER direct URL 在业务 loader 请求前稳定显示 403，同时不重复模拟服务端权限验证。

## Background

- Phase 7 System 抽象回顾的独立 `make e2e` 诊断中，`platform-types.spec.ts` 的 mobile/desktop 非管理员场景都等待 Platform Type GET 超时；实际请求数为 0。
- `/_app/_admin` 的 `beforeLoad` 读取 canonical Auth session，ENGINEER 时在 child loader 前抛出 `notFound()`；因此 `/settings/platforms/types` 的 list loader 不应运行。
- 当前 E2E 已正确看到“无权访问系统管理”且没有 Platform Types 页面，失败仅来自随后要求 GET 请求数大于 0 的矛盾断言。
- `backend/tests/integration/test_platform_types.py::test_platform_type_api_is_admin_only_and_supports_contract_crud` 已独立证明 ENGINEER 对 GET/POST/PATCH/DELETE 全部得到真实 403；fixture E2E 不需要再复制这层服务端权限逻辑。

## Requirements

1. 保持 `_admin` route、Platform Types route/loader、Auth session owner、backend `AdminUser`、OpenAPI 和产品 UI 不变；本任务只修正 E2E 编排及其无消费者 fixture glue。
2. 非管理员 production-artifact 场景必须断言：保留原 URL、显示明确 403、Platform Types 页面不渲染、Platform Type GET 请求精确为 0。
3. 不使用 polling 等待一个按设计不会发生的请求；不从 0 放宽为任意数量。
4. backend integration 继续独占真实 server 四接口 403 证据；不在 fixture spec 新增 `fetch`、`page.request`、route loader 绕过或 real-stack 权限场景。
5. 删除只为不可达 ENGINEER list 请求服务的 fixture 403 分支和 `allowHttpError(403)` glue；保留 `setEngineer()` 对 `/auth/me` canonical session 的控制。
6. 不新增权限 helper、角色模型、通用 route harness 或测试 framework；不修改其他 Configuration/System/Auth 测试。
7. 只运行 Platform Types E2E 及必要静态检查；完整 V2 E2E、`make e2e` 和 `make verify` 留给 Phase 7 Exit Gate Recheck。

## Acceptance Criteria

- [x] mobile/desktop 均在 ENGINEER direct URL 展示“无权访问系统管理”，保留 `/settings/platforms/types`，且不渲染“平台类型”页面。
- [x] 两个 project 的 Platform Type GET 请求数都精确为 0，不再等待超时。
- [x] fixture 中不保留无消费者 ENGINEER Platform Type list 403 响应或对应 console allowlist。
- [x] 完整 `platform-types.spec.ts` 两个 project 通过，strict unexpected-request、console、pageerror 和 requestfailed 审计保持有效。
- [x] backend、OpenAPI、权限合同、production route/domain、旧 `frontend/` 与 Phase 7 文档状态无变化。
- [x] Frontend V2 typecheck、受影响文件 ESLint、`git diff --check` 与 Trellis task validation 通过。

## Out of Scope

- 修改 Platform Type 产品能力、角色权限或 route UX。
- 新增真实栈 Platform Types flow，或重复 backend integration 的四接口权限矩阵。
- 修改 System、Auth、Platform List/Workspace、其他 Configuration E2E。
- 运行完整 V2 E2E、`make e2e`、`make verify`，更新 Phase 7 为 `MET`，归档父任务或开始 Phase 8。
