# GEO-1004 Catalog 当前用户权限竞态修复

## 目标与授权
修复所有 Catalog 写命令的当前操作者权限竞态。保持 Router、OpenAPI 与前端行为不变；不提交、不发布。用户要求最终状态 review。

## 验收
- PostgreSQL 先复现：ADMIN A 的旧 actor 进入命令、等待资源，B 降级并提交，A 不得继续写入。
- 权威事务按 User → 当前认证 Session（若为请求）→ Product → 品牌 UUID → Subject → Alias/Domain 顺序锁定；不在 Catalog 锁后追加 User 锁。
- 锁后重读存在、启用、ADMIN、首次改密与当前请求会话资格。Session 撤销、删除、过期和 User revision 边界均有证据。
- 失败不改变 Catalog、revision、关系和 SUCCESS 审计；失败 Session 可复用。
- Catalog 单元、PostgreSQL 并发集成、Identity 定向、contract-check、git diff --check 通过。
- 权限与并发变更取得独立只读复核。

## 范围
当前用户守卫、认证请求上下文和 Catalog 命令入口；不重构其他权限框架。仓库有大量其他任务未提交改动，全部保留。
