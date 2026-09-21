# T5-I6 实施验证记录

- 日期：2026-09-21
- 状态：`in_progress`，未提交、归档、push、部署或发布
- 数据库：在独立 Colima 临时容器 `codex-t5-i6-pg` 内运行 PostgreSQL 16；测试使用独立 `partsignal_test` 管理库，每个 integration case 由 `temporary_database()` 创建并删除迁移到 current head 的临时数据库。不使用项目 `.env` 的业务数据库。
- 下述“通过”是命令实际退出码 0；完整 suite 的收集失败单独列出，不视为测试通过。

## 必需门禁

| 命令/范围 | 实际结果 | 证据边界 |
| --- | --- | --- |
| `pytest`：`test_geo_observation_correction.py`、`test_geo_observation_detail.py`、`test_geo_observation_deletion.py -q -ra` | exit 0，40 passed，无 skip；随后删除文件加强 catalog/data 回滚断言并单独重跑，exit 0，12 passed | 主代理终端 session 86653、98902；含真实 PostgreSQL 双连接锁集合变化、事务局部 DDL/SQL、HTTP 409/500 |
| `pytest test_publication_workflow.py -q -ra` | exit 0，81 passed，无 skip | 实现代理最终 session 77776；主代理只在其后恢复既有段落无关换行，无语义修改 |
| `pytest test_contract.py test_runtime_response_metadata.py -q` | exit 0，401 passed | 主代理终端 session 81609 |
| `ruff check`：production GEO 服务与 4 个 integration test 文件 | exit 0，`All checks passed!` | 主代理最终 scoped 命令；不含无关文件 |
| `mypy --config-file backend/pyproject.toml backend/app` | exit 0，80 source files 无问题 | 主代理终端输出 |
| `task.py validate` 当前任务 | exit 0；两个 JSONL 各 9 条 | 4 份大文档仅有自动注入截断 warning，实施时已按相关节直接读取 |
| `git diff --check` 当前 allowlist 与父 task | exit 0 | 当前源码/文档/task 文件；新文件另由 `ruff check` 与测试覆盖 |

先期诊断中的一个 GEO HTTP fixture 因使用已有 successor 的 root 而触发真实 partial unique；修正为从链尾追加跨产品节点后目标测试通过。未修改 production 约束或 mapper。

## 可选检查与限制

- frontend GEO probe：指定 `geo.api`、Correction、Detail 的三个 Vitest 文件，exit 0，23 passed；它只是 T6-G 前兼容性探针，不证明前端已经支持新 code。
- 完整 `pytest backend/tests -q -ra` 按规划仅运行一次，exit 2，收集阶段即因 `backend/tests/integration/test_geo_insights.py` 与 `backend/tests/unit/test_geo_insights.py` 同名模块 import mismatch 中断；没有执行全套用例。未清缓存、未改 pytest import mode/config、未重跑或越界修复。
- producer 2、5、6 在 current-head `UNION` CTE、快照和类型投影合同下无真实 PostgreSQL 可达构造；测试明确使用 synthetic 注入仅证明防御分支的精确 AppError，不把它写成真实数据库或 HTTP 损坏证据。其他可达 read/create/delete/shared owner 场景使用真实临时 PostgreSQL。
- Preflight 记录了 scoped `git status --short`，但未保存 protected-owner 的独立文件指纹；最终 scoped status 中仅 `backend/app/schemas/configuration.py` 有与本任务无关的预存/并发格式差异，T5-I6 实施者没有修改该文件。不能把缺失的前置指纹写成已验证的 fingerprint gate；独立 reviewer 须把这一覆盖缺口计入结论。
- 首轮独立高风险 full review 发现删除坏链 fixture 对 DDL 回滚的 catalog 比较不完整（未覆盖约束及触发器启用状态）。已进行一次定点修正：复用共享 catalog helper，比较全部约束、索引、非内部触发器定义与 `tgenabled`，并在 fresh Session 比较已登记业务表数据。删除文件 12 例重跑通过；一次新的独立定点复核确认该 P2 已关闭且未发现新阻断。定点 reviewer 未重跑测试，也不替代首轮 full review。

## 发布边界

T5-I6 只完成 backend code 与稳定合同/测试；frontend production/tests 没有纳入本轮。T5-I6 backend code 必须等待 T6-G 与 T6-C 完成同一 release-atomic train，当前不可单独部署或发布。
