# I02-1 E2E 数据库运行隔离

## Goal

修复 E2E 数据库随机命名与可验证运行所有权，补齐碰撞和失败清理反例，并同步稳定隔离合同。

## Requirements

- 只在候选工作区修改 E2E 数据库命名、所有权校验、生命周期 harness、直接 Python unit 与稳定隔离规范；不进入 I02-2 的 Makefile 门禁接入，也不运行完整 `make verify`。
- 数据库名包含至少 128 bit 随机 run ID，不依赖宿主 PID 的全局唯一性。
- 数据库删除必须由 PostgreSQL 中可查询、与本运行随机 token 精确匹配的所有权标记授权；一次 create 尝试本身不授予删除权。
- duplicate create 不得修改或删除预先存在的同名数据库；本运行完成创建并写入所有权标记后，即使 create 客户端随后非零退出，cleanup 仍删除该数据库。
- 保留精确名称 allowlist、强制断开删除、失败 cleanup、原始失败码优先和显式错误。

## Acceptance Criteria

- [x] 数据库名 allowlist 与生成逻辑接受 `partsignal_e2e_YYYYMMDD_<32 lowercase hex>`，拒绝旧 PID-only、Unicode 日期及越界名称。
- [x] create 在成功建库后写入本运行 owner token；drop 仅在 owner token 匹配时执行 `DROP DATABASE ... WITH (FORCE)`，不存在时保持幂等。
- [x] lifecycle harness 确定性证明 duplicate 不删除、已拥有数据库的 post-create client failure 仍清理、drop 失败不假成功，以及 setup/handler 恢复信号路径保持退出码并清理。
- [x] 直接相关 Python unit、database lifecycle harness、Ruff、shell syntax 与 `git diff --check` 通过。
- [x] 独立只读高风险复核无阻断；实际修改、测试计数、结论、残余风险和下一任务 I02-2 已写入本任务记录。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i02-full-candidate/`。
- 禁止提交、归档、发布、部署或在原检出区实施。
