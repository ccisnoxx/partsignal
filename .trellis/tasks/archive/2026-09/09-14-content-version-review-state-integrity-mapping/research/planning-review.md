# 独立 Planning Review

- Reviewer：独立只读 `reviewer` agent
- 日期：2026-09-14
- 范围：`prd.md`、`design.md`、`implement.md`、两个 manifest、三份 research，并对照父任务、合同决策任务、相关稳定 spec、实际 service/router 和公共合同边界。
- 限制：本轮仅审查 planning；未运行 PostgreSQL、backend/frontend 测试，也未修改 production/test/spec/docs。

## Full review 结论

pending/approved 核心合同、事务回滚、前端恢复、公共合同边界和一 Task 一目标没有 material drift。发现并修复两项中等规划问题：

1. `implement.md` 的数据库 schema 零 diff 命令最初漏掉 `backend/app/migration_schema_v1.py`；该文件持有 approved partial unique 的 frozen bootstrap 定义。已将其加入 zero-diff gate，并继续保留 models、Alembic 和未跟踪文件检查。
2. PRD/design 最初把权限误写成 `transition_content_version` 内部 precheck。实际 submit 角色依赖和 approve router account-type 检查均在 command 调用前拒绝。现已统一明确：service 只维持 revision/current version/state/comment/quality gate precheck；权限以 HTTP 403 且 command/flush/commit 未调用验收，不向 service 复制权限判断。

非阻塞 caveat：approved late-failure 的具体测试装置必须在实施阶段基于真实 PostgreSQL 收敛。独立连接插入 competitor 可能等待当前事务对旧 approved index 项的未提交变更，因此不得用无界等待或 `sleep` 充当证据；无法在不改 schema/锁的前提下稳定命中 exact constraint 时必须 scope stop。

## Targeted re-review

唯一一次 targeted re-review 已通过：

- `implement.md` 的 zero-diff gate 已覆盖 `backend/app/migration_schema_v1.py`。
- `prd.md`、`design.md`、`implement.md` 对权限 owner、调用顺序和验收方式已经一致。
- 修复没有改变 IntegrityError catch、root rollback、unknown 原抛或 allowed/read-only owner。
- 未发现新增 material issue。

## Planning gate 证据

- `task.py validate` 通过；两个 manifest 均为有效 JSONL，所列路径存在。
- `.trellis/spec/backend/database-guidelines.md` 和 `.trellis/spec/frontend/state-management.md` 超过 32 KiB 注入上限；`implement.md` 已要求实施/复核时分块完整读取，不能以截断注入代替。
- 当前 Task、父任务和合同决策任务均保持 `planning`。
- planning 目录与父任务 child bookkeeping 的 `git diff --check` 通过。
- 指定 production/test/spec/docs/contract/generated/schema owner 在 planning 阶段保持零 diff。
