# 实现与验收

## 实现
- current_actor.py 维护 User → 当前请求 Session 的命令守卫；Catalog 全部9个服务函数、10个写操作接入同一边界。
- 认证依赖只传递 Session UUID，锁后精确验证会话归属/撤销/存在/到期，提交前数据库时钟复核自然到期。内部 service 无 HTTP 上下文时按权威 User 校验。
- Catalog creator/audit/投影使用锁后 current User；失败由守卫统一 rollback。
- Identity 五个取 User 锁的命令仅增加舍弃 pending heartbeat，消除认证自动 flush 的反向 Session→User。用户状态、权限、revision 和撤销合同不变。
- User FOR SHARE 兼容同用户并行命令与 FK KEY SHARE；阻止身份写入/删除。详见 design.md、contracts/database.md 的 Catalog 权威锁序。

## 先红后绿
首个 PostgreSQL 测试在修复前失败：A 持有旧 ADMIN actor 并等待 Subject，B 使用真实 update_user 提交 ENGINEER，A 仍成功新增 alias（evidence/red.txt）。修复后相同交错在 User 锁等待，B 提交后 A 权限拒绝。补充 ADMIN 停用、重置改密与 A 先取得身份锁时改密/logout 正确等待。

## 验证
- Catalog + Identity 定向单元：151 passed。
- PostgreSQL Catalog：75 passed，含新 current-actor 43 项、既有并发/API/事务/acceptance（evidence/catalog-integration.txt）。
- Identity PostgreSQL：5 passed / 9 deselected，覆盖认证快照、临时密码、删除重置、单个批量状态与成功审计（evidence/identity-integration.txt）。
- make contract-check：FastAPI runtime/OpenAPI 和 frontend api:check 通过；Router、OpenAPI 和前端未改。
- 定向 ruff：通过；mypy 三个直接受影响源文件：通过。
- GEO-1004 范围 diff-check（tracked + baseline/no-index 新源文件）：通过。
- 全仓 git diff --check 已执行，但失败于任务开始前存在的 docs/geo-monitoring/06-reviews/GEO-1001-release-readiness-audit.md 尾随空白；未修改他人评审文档，见 evidence/diff-check-global.txt。

## 交付边界
未运行全仓 verify/E2E：本任务的权限并发/会话与事务合同由真实 Router/API 和 PostgreSQL 定向用例直接覆盖，公共 API/前端行为不变。未提交、未发布、无 schema/迁移变化。独立 critical_reviewer 复核完成，无确认 P1/P2 问题；覆盖限制见 review.md。最终状态 review。
