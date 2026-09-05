# 获批合同与上下文加载路由

## 获批输入

本 implementation child 的业务合同由 `09-05-identity-integrity-error-contract-decision` 冻结，并已完成一次独立 review 与一次 targeted re-review：

- username duplicate：`409 USER_USERNAME_EXISTS`、message `用户名已存在`、details 中唯一 field error loc 为 `body.username`；
- 预检与真实 `23505 + uq_users_username` 除 request ID 外领域响应一致；
- unknown diagnostics 原抛并继续进入默认 500；
- CreateUserDialog 只按 exact code + exact loc 定位字段，保留非敏感草稿、清空 temporary password、聚焦 username、显示 request ID、显式重试，不 reload/replay/invalidate；
- delete user 预检的丰富 `USER_IN_USE` 与 command-scoped 23503 固定 fallback 均保持不变；
- OpenAPI、router metadata、generated client 与通用 error spec 只作零 diff validation target。

若实现证据与上述合同冲突，停止并回到 contract review，不在 implementation 内改变决策。

## 超大稳定规范完整读取

以下稳定规范超过或接近原生上下文注入容量，backend/frontend implement 与 check 子代理必须在修改或检查对应 owner 前从当前工作区完整读取，不得只依赖注入片段：

- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/frontend/state-management.md`

无法完整读取时停止对应支线并报告；本文件只负责路由，不复制或替代稳定规范。

## 规划与执行入口

- 先完整读取本 child 的 `prd.md`、`design.md`、`implement.md`。
- 真实数据库证据、文件边界、required/optional validation、review 与停止条件以这三份 child 文档为执行入口。
- 代码文件不登记进 manifests；实施代理按 `implement.md` 在当前工作区读取完整 authoritative units。

## 实施 scoped baseline

- 用户于最新 child planning summary 后明确批准启动。
- baseline commit：`9effb3bb446fa57b16e3f69752158de9438c6482`。
- 启动前对 `prd.md` 列出的全部允许修改文件和十个只读 owner 执行 `git status --short -- <paths>`，输出为空；这些路径在启动时均相对 baseline clean。
- 工作区其他既有修改和 artifacts 不属于本任务，不得覆盖、还原、提交或归档。
