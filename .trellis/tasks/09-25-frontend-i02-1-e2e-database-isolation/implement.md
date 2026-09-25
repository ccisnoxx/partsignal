# I02-1 实施记录

## 执行顺序

1. 更新数据库 helper 的名称/token allowlist、owner marker 写入与校验删除。
2. 更新 shell 命名和 lifecycle 状态，补齐两个反例。
3. 同步 `.trellis/spec/infra/e2e-isolation.md`。
4. 运行限定的 Python unit、database lifecycle harness、Ruff、shell syntax、diff check。
5. 安排独立只读高风险复核，修复阻断后记录结果并停止。

## 结果

- 数据库名由日期与 128 bit 随机 run ID 组成，owner token 另行独立生成；ASCII allowlist 固定合法名称为 56 字节，拒绝旧 PID-only、Unicode 日期、额外后缀与注入式名称。
- create 成功后以 PostgreSQL database shared-object comment 写入 owner marker；drop 先读取并精确匹配 marker，匹配后才执行 `DROP DATABASE ... WITH (FORCE)`。不存在保持幂等，duplicate 或 marker mismatch 显式拒绝删除。
- shell 将 cleanup 尝试与删除权分离，显式传播 drop 非零；原始 create/客户端失败优先。COMMENT 未确认时不执行未经验证的补偿删除；marker 已写入但客户端随后失败时仍由 cleanup 验证并删除。
- setup 的 INT/TERM 统一转成 130/143 后进入 EXIT cleanup；Playwright/scan 临时信号 handler 在最终信号状态判定前恢复调用方 handler，避免取消信号误报成功。
- 稳定合同已同步到 `.trellis/spec/infra/e2e-isolation.md`。

## 定向验证

- `backend/.venv/bin/pytest -q backend/tests/unit/test_e2e_database_script.py`：17 passed。
- `deploy/scripts/test-e2e-database-lifecycle.sh`：5 个确定性场景通过，覆盖 collision、post-create failure、drop failure、pre-Playwright TERM 和 handler 恢复入口 TERM。
- `backend/.venv/bin/ruff check deploy/scripts/e2e-database.py backend/tests/unit/test_e2e_database_script.py`：通过。
- `sh -n`：`e2e-local.sh`、`e2e-database-lifecycle.sh`、`e2e-run-lifecycle.sh`、`test-e2e-database-lifecycle.sh` 通过。
- `python -m py_compile deploy/scripts/e2e-database.py` 与 `git diff --check`：通过。
- 按任务约束未运行完整 `make verify`、真实 PostgreSQL 集成或其他 lifecycle harness。

## 独立复核

- 四轮 fresh `critical_reviewer` 只读高风险复核逐步发现并关闭：drop 失败假成功、COMMENT 异常未经 marker 验证删除、setup 信号跳过 cleanup、Unicode 名称截断，以及 handler 恢复窗口丢失退出码。
- 最终闭环复核结论：无阻断；未发现误删数据库、伪造 cleanup 成功、丢失信号退出码或跨入 I02-2/I02-3/I03 的范围扩张。

## 残余风险与后继

- owner marker 查询与 DROP 是两个 autocommit 语句；具备同等 PostgreSQL 管理权限的非合作外部进程理论上可在两者之间主动替换对象。当前合同只覆盖合作式并行 E2E runner，128 bit 随机名称与独立 token 已满足该边界。
- `mktemp` 成功至 EXIT/INT/TERM trap 安装之间仍有极窄窗口，最多遗留尚未包含数据库、凭据或服务的空临时目录；不构成本项阻断。
- 本轮未在真实 PostgreSQL 上执行 COMMENT 查询、权限和 FORCE DROP；该环境级证据留给父 I02 后续门禁。
- 下一任务为 I02-2：将数据库与进程 lifecycle harness 接入 `make verify` 必经目标。本会话不创建、不实施 I02-2。
