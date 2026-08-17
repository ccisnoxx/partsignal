# Frontend V2 System 抽象回顾与 Phase 7 Exit Gate

## 1. 目标

对 Frontend V2 的 System vertical slice 做最后一次抽象、所有权和验收回顾；只实施审计证据支持的最小修正，并以一次最终 `make verify` 对 Phase 7 作出 `MET` 或 `NOT_MET` 判定。

本任务不是新业务页面开发，也不为 Phase 8/9 预建能力。

## 2. 审计范围

- 路由与壳层：`frontend-v2/src/routes/_app/**`、`frontend-v2/src/app/auth/**`、`frontend-v2/src/app/layout/**`、导航与 QueryClient owner。
- System/Auth domain：`frontend-v2/src/domains/identity/**`、`frontend-v2/src/domains/audit/**`、`frontend-v2/src/domains/auth/**`。
- 共享边界：System/Auth 实际使用的 `frontend-v2/src/design-system/**`、`frontend-v2/src/shared/api/**` 与 generated OpenAPI types。
- 验证：对应 Vitest、strict fixture E2E、real-stack E2E、`frontend-v2/playwright.config.ts` 与 `deploy/scripts/e2e-local.sh`。
- 权威文档：`docs/frontend-v2/README.md`、01、04、05、06、07 Phase 7、08 System 验收、09 System ADR，以及四个已归档前置任务。

## 3. 已验证的共享 invariant

1. 依赖只能沿 `routes → domains → design-system/shared`；Design System 不认识 User、Audit、role、permission 或业务 DTO。
2. 服务端是权限、状态转换、可执行动作、revision 和输入验证的最终权威；前端只消费 canonical projection，并把路由/导航判断限定为 UX。
3. Auth session、CSRF、`must_change_password` 和 auth query cache 由 `AuthProvider` 的 `['auth', 'session']` 唯一拥有。
4. Users 的 action projection、revision、selection scope、批量 partial-success 语义和 list invalidation 由 Identity domain 唯一拥有。
5. Audit 的 canonical URL search、list/detail query identity、lazy detail、安全投影和 immutable-history 展示由 Audit domain 唯一拥有。
6. 密码、CSRF、Cookie 和敏感正文不进入 URL、UI、日志、错误、trace/video/screenshot/attachment 或测试报告。
7. 单元/组件、strict fixture E2E 和 real-stack E2E 各自证明不同边界；不新增第二套 orchestration 或重复场景。
8. 只有至少两个真实消费者已证明稳定的 UI 语义才可进入 Design System/shared；业务语义不得因相似命名被提升。

## 4. In scope

- 修复 System 页面组件测试没有使用 canonical auth session query cache、导致 `make test-unit` 稳定失败的问题。
- 修复 Audit 时间筛选允许空值进入严格转换函数并抛出未捕获异常的问题。
- 删除经全仓搜索确认无消费者的 Audit query-key glue，以及只转发 `<Outlet />` 的 admin route wrapper。
- Required Validation 全绿时更新 Phase 7 migration/acceptance 文档；无论 Gate 结果如何都更新当前 Trellis Task 证据。
- 只在所有独立诊断阶段通过后运行一次最终 `make verify`，并记录 Phase 7 Exit Gate 结果。

## 5. Out of scope

- 新增 System 产品能力、Phase 8 Workbench、Phase 9 Cutover。
- 修改旧 `frontend/`、OpenAPI、数据库、权限合同、公共 API 或服务端业务行为。
- 新建 Admin、CRUD、Permission、Audit、workflow framework，或机械拆分长文件。
- 修改归档任务、复制已有测试、建立第二套 E2E orchestration 或 secret scanner。
- pull、push、PR、历史改写或未经确认的 commit。

若实施证据要求修改合同、数据库、权限或服务端状态机，立即停止本任务并提出独立 blocker Task，不在本任务扩围。

## 6. Findings 分类要求

每个发现必须在 `research/audit.md` 中归入且只能归入以下一类：

- Keep in System/Auth Domain
- Keep in Design System/shared
- Simplify locally
- Promote only after proven consumers
- Confirmed defect requiring change
- Deferred product/UX decision
- Out-of-scope blocker requiring independent Task

## 7. 验收条件

- [x] 当前任务在用户批准后才执行 `task.py start`，并只创建 `codex/frontend-v2-system-abstraction-review` 一个临时分支。
- [x] 两个 System 页面测试基座从 `AuthProvider` 导出的 canonical query key 写入 session，不复制 query key或新增第二个 auth owner；定向 41 条测试全部通过。
- [x] Audit 空时间输入产生可访问的明确校验反馈，不抛未捕获异常，也不改变 canonical URL。
- [x] 删除仅转发 `Outlet` 的 wrapper 和无消费者 query-key glue，不新增替代抽象。
- [x] 静态依赖检查证明 Design System/shared 没有反向导入 System/Auth domain 或业务 DTO。
- [x] Users、Audit、Auth、403、strict fixture 与 real-stack E2E 的职责边界保持互补，没有新增重复编排。
- [ ] 所有 Required Validation 通过；仓库级 unit/E2E 存在独立 blocker，因此按停止条件未运行最终 `make verify`。
- [x] Gate `NOT_MET` 已记录在当前 Task evidence；按批准条件保持 07/08 不变，且无新 ADR/合同事实，不改 01/04/05/06/09、OpenAPI 或 database contract。
- [x] 完整 diff 无新 framework、silent fallback、权限推导、第二来源、敏感产物、无关修改或旧 `frontend/` 修改。

## 8. Phase 7 Exit Gate

### MET

同时满足：

1. 本任务内 P1/P2 confirmed defects 已完成最小修正，System 没有未关闭 P0/P1；任何保留 P2 都有明确 owner、非阻塞证据和用户批准。
2. 上述八项 invariant 仍成立，且没有合同/数据库/权限 blocker。
3. Required Validation（含独立阶段、一次最终 `make verify`、diff/task 校验）全部通过。
4. 文档和 Task evidence 与实际执行一致。

### NOT_MET

任一情况成立即判定：存在未关闭 P0/P1、发现需要独立 blocker 的合同/权限/数据问题、敏感信息泄露、关键 owner 出现第二来源、独立阶段未通过，或最终 `make verify` 非零。

## 9. 当前实施状态

- Task 状态为 `in_progress`，当前分支为 `codex/frontend-v2-system-abstraction-review`。
- 已完成任务内最小修正、独立诊断、自审和 `NOT_MET` 证据记录。
- 因独立 blocker 未运行完整 `make verify`，未更新 07/08；尚未 push、创建 PR、归档或开始 Phase 8。
