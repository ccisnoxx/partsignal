# Implementation Log

## 2026-09-16 start and preflight

- 用户明确批准规划并进入实施；`task.py start` 已把本 Task 从 `planning` 切换为 `in_progress`。
- 依赖提交 `43c252da`、`771a5826`、`62bb2360`、`a96f6df2`、`a5469871`、`d5487430`
  均可达；T5-C 与顶层父任务保持 `planning`。
- 仓库启动时已有大量与本 Task 无关的 working-tree/index 修改和删除，全部保留，不纳入本 Task。
  `.trellis/spec/frontend/state-management.md` 的既有 working-tree diff SHA256 为
  `f55d564d7b2e5e5b8291b54db93303d3bd65fbac9ae79da60156dacbc07ea631`，后续仅追加可归因于本 Task
  的合同文字。
- 第一次 hard preflight 在创建临时数据库前失败：本地 `.env` 的 Compose 内部主机名 `postgres` 无法从宿主机
  解析。该失败没有创建或修改业务数据，也没有进入实现。
- 将测试进程内的数据库主机映射为开发容器公开的 `127.0.0.1:55432`（未输出凭据）后，在随机临时数据库升级到
  Alembic head。PostgreSQL 16 catalog 证明 `uq_geo_observations_supersedes_once` 是
  `geo_observations(supersedes_id) WHERE supersedes_id IS NOT NULL` 的独立、即时、valid/ready、无 expression 的
  btree partial unique index，且没有 `pg_constraint` row。
- 合法 predecessor、winner 与 duplicate loser 的真实 INSERT 返回
  `sqlstate=23505`、`diag.constraint_name=uq_geo_observations_supersedes_once`；hard gate 通过，允许进入实现。
- 未执行 Git 提交、归档、push、stash、reset、checkout 或 clean。

## Implementation and required validation

- `create_geo_observation` 的 successor precheck 已统一为
  `409 GEO_OBSERVATION_HAS_SUCCESSOR / 该 GEO 观测已被纠正 / details={}`。
- 新增的 command-local classifier 只接受
  `23505 + uq_geo_observations_supersedes_once`；catch 只包围 root observation 首次 `flush()`，exact 命中后先
  root rollback，再抛稳定 `AppError`。publication/attachment relations 与 commit 保持在 catch 外，unknown 原抛，
  没有 winner requery/replay。
- `test_geo_observation_correction.py` 在 Alembic head 临时库覆盖完整 partial-index catalog、真实 duplicate
  diagnostics、classifier fail-closed、relation/commit catch scope、production row-lock、test-only transaction-ID
  unique race、known/unknown Session reuse、全行原子性快照及 HTTP precheck/exact/request-ID/unknown no-leak。
- 第一轮目标集成测试的 production-lock 与 unique-race 已通过；失败仅来自测试自身的 Python 类体作用域写法和
  HTTP 异常路径读取已失效 detached ORM 对象。修正为实例初始化 diagnostics 并在 rollback 前冻结 winner ID 后，
  目标文件 `20 passed`、0 skip。
- `test_contract.py` 与 `test_runtime_response_metadata.py` 全部通过。
- Ruff 对 GEO service 与目标 integration 文件通过；mypy 对 `backend/app` 的 80 个 source files 通过。
- allowlist `git diff --check`、protected-owner `git diff --exit-code HEAD` 与 Trellis task validate 通过；三个大型
  stable spec 只有已知 context injection truncate warning，实施按源文件直接读取和编辑。
- `.trellis/spec/frontend/state-management.md` 的既有 TanStack Router、React Hook Form、TanStack Table 用户差异
  保持原样；本 Task 只在 GEO Correction/Detail 之间新增独立 stale-state 场景。

## Optional gates

- 前端兼容探针通过：2 个测试文件、14 项测试全部通过；未修改 frontend production/tests。
- 对当前 candidate 按计划只运行一次 `pytest backend/tests -q -ra`，exit 2，collection 阶段未执行测试。
  integration 与 unit 目录各有一个顶层同名 `test_geo_insights.py`，默认 pytest import mode 将前者加载为
  `test_geo_insights` 后，收集后者时报 import file mismatch。未清缓存、未改变 import mode/pytest 配置、未重命名
  文件，也未重跑该一次性 gate。

## Independent high-risk review

- 独立只读 full review 确认 production exact classifier、root flush catch scope、rollback 顺序、unknown 原抛、
  production/test-only 两类并发证据、HTTP 合同与文档边界正确；发现一个 P2 验收覆盖缺口：并发断言整体跳过
  GEO observation/publication/attachment 三张核心表的全行比较，direct/HTTP unknown 也缺少失败前后快照。
- 使用规划允许的唯一一次 targeted repair，只增强目标 integration 测试：按稳定 ID 保留全部旧 GEO 行，精确限制
  唯一 winner observation/relations，逐字段核对 winner facts，并在 known、unknown direct 与三种 HTTP 失败后、健康
  命令前用完整/fresh Session 快照证明零副作用。生产实现未修改。
- targeted repair 后目标 integration 重新 `20 passed`、Ruff 与 diff-check 通过。唯一一次 targeted re-review
  确认原 P2 已关闭且没有残留 material finding；全后端 suite 的既有 collection mismatch 仍是已报告的整体覆盖限制。

## Review and handoff

- 收尾复核确认 AC1–AC13 均有对应实现、测试或明确的 optional gate 记录；没有未关闭的 material finding。
- 实际变更保持在 implementation/task bookkeeping allowlist；OpenAPI、router/schema/runtime metadata、ORM、migration、
  generated client 与 frontend production/tests 没有新增差异。工作区其余大量既有 dirty/staged 修改未被吸收。
- 当前 candidate 已具备提交与归档条件，但尚未获得本轮最终提交/归档确认，因此 Task 保持 `in_progress` 且继续作为
  current task；未运行 `task.py finish`、`task.py archive`、`git add`、`git commit` 或 push。
- 下一步只等待用户确认提交与归档。归档后才能进入 T5-I6；T5-I5 server code 仍不得在 T6 页面投影完成前单独发布。
