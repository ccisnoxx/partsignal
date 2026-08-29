# Production Snapshot Sanitization Execution 本地只读预检

## 边界

- 日期：2026-08-26（Asia/Shanghai）。
- 只读取仓库和本地工具版本；未连接 production/Staging，未 SSH，未创建数据库、role、snapshot、secret 或外部资源。
- 未运行 archived self-check，因为它会创建 disposable PostgreSQL database，超出当前“本地只读准备”授权。
- 未启动 API、Worker、scheduler、frontend、对象服务、容器或浏览器。

## Git 与 Task

| 检查 | 结果 |
| --- | --- |
| primary 开始状态 | clean `main`，HEAD=`af161997` |
| origin 同步 | 未 pull；本地开始时领先 `origin/main` 14 commits |
| 临时分支 | `codex/frontend-v2-phase-9-production-snapshot-sanitization-execution` |
| follow-up Task | `08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution`，status=`in_progress` |
| parent | `08-26-frontend-v2-phase-9-production-like-rehearsal`，status=`planning` |
| sanitizer implementation commit | `217d011c`，当前 HEAD ancestor=PASS |
| sanitizer archive commit | `a56f802e`，当前 HEAD ancestor=PASS |
| context manifests | `implement.jsonl` / `check.jsonl` 各 9 条真实 entry，Trellis validation=PASS |
| planning diff | `git diff --check` PASS |

## Artifact 与 schema

| 检查 | 观察值 | 结果 |
| --- | --- | --- |
| sanitizer SHA-256 | `124c2182ff439c34991506e08a846beaf81b376092472d4f2a470cd7f889fd1d` | 与归档 evidence 一致 |
| matrix SHA-256 | `71c86e68f8127530d6a559c797ce8cf116c98bd2b652a9e051e47b4dc4d638a6` | 与归档 evidence 一致 |
| Alembic head | `0043_geo_platform_identity` | 与脚本预期一致 |
| schema signature 常量 | `90070a89da4ede3edd8f66fc1cc42714a9ef778d0f5c2a85f9142e2c20193a4a` | 脚本、matrix、evidence 一致 |
| Python syntax | `ast.parse` PASS | 未写入 archive `__pycache__` |
| archived self-check | evidence 记录 PASS | 本 Task 未重跑，不冒充 production 证据 |

归档 self-check 已记录：marker/session 清零、全部业务表 row count 保持（仅 `sessions -> 0`）、状态/revision/timestamp/FK 与长度桶保持、约束失败回滚、错误 revision/未知列/constraint/USER trigger drift fail closed、独立 verifier 通过、disposable database 精确删除。

## 本地工具

- 当前 shell 找不到 `pg_dump` 与 `psql`。
- 因此本机不能默认承担 production dump、restore 或 `restore-verify.sh`；后续必须冻结获批准执行 host 的 PostgreSQL server/client 版本和工具路径。
- 未安装依赖或启动 PostgreSQL/容器；不以本地工具缺失猜测外部环境。

## 当前结论

- sanitizer artifact、checksum、0043 revision/signature 与历史 self-check evidence 可追溯，局部只读核验通过。
- 现有 verifier 输出 schema、精确 table counts、安全 checks 与 object payload copied=`0`；完整完成标准还需要任务内显式 aggregate profile 查询覆盖关系、状态、revision、timestamp 与长度桶。
- production source、read-only role/grants、export window、audit owner、execution/quarantine host、run ID、encrypted paths、database/role 与删除目标均未知且未授权。
- 当前 Gate=`NOT_MET`；父任务尚不具备启动条件。

## Profile 合同静态实施（2026-08-26）

本节在用户批准最新规划和 `task.py start` 后完成。`get_context.py` 实际观察到当前 Task
status=`in_progress`。本轮只新增 Task 内 `profile_snapshot.py` 与执行合同；未连接任何数据库，未运行
archived self-check，未 SSH/联网，未调用 `psql`/`pg_dump`，未创建或删除任何资源。

### 固定清单与安全边界

- profile shape：`production-snapshot-profile-v1`。
- 0043 清单：31 张业务表、74 个外键、16 个 revision/facts_revision 字段、54 个
  date/timestamp 字段、11 个 boolean 字段、36 个 allowlisted machine-value 字段、88 个 matrix
  非 preserve 字段。
- source 合同要求仓库外注入 exact database、run ID、exported snapshot identity，并在连接前由执行环境
  强制 `default_transaction_read_only=on`；脚本自身再使用 `REPEATABLE READ READ ONLY`。
- quarantine/verify database 必须分别精确等于 `quarantine_<run-id>` / `verify_<run-id>`。
- SQL 写关键字静态扫描无匹配；脚本数据库路径只包含 `SHOW`、只读 transaction/snapshot、catalog 与聚合
  `SELECT`。失败边界只输出 `command/status/error_type`。
- 缺少全部 source 环境变量执行 `profile source`：预期 exit=`1`，只输出
  `{"command":"profile","error_type":"ProfileError","status":"failed"}`，未尝试数据库连接。

### 实际离线 validation

| 检查 | 观察结果 |
| --- | --- |
| sanitizer SHA-256 | `124c2182ff439c34991506e08a846beaf81b376092472d4f2a470cd7f889fd1d`，PASS |
| matrix SHA-256 | `71c86e68f8127530d6a559c797ce8cf116c98bd2b652a9e051e47b4dc4d638a6`，PASS |
| profile contract SHA-256 | `7a25af428add14b02e813b1d1f3473b5e510d15e5613ea11a1fe9e909172d5cb` |
| Alembic heads | `0043_geo_platform_identity (head)`，PASS |
| sanitizer + profiler AST parse | PASS |
| profiler `py_compile` | PASS |
| profiler Ruff | PASS，`All checks passed!` |
| profiler targeted mypy | PASS，`Success: no issues found in 1 source file` |
| profiler no-DB `self-check` | PASS；artifact、ORM metadata、output shape、sessions/AI/password 非零允许变化、row count/伪名字段长度桶禁止变化 fail-closed 均通过，`database_connected=false` |
| profiler failure boundary | 缺失 source 参数及非法 CLI 参数均 exit=`1`，只输出 `command/status/error_type`；PASS |
| Trellis task validation | PASS；现有 database guideline context 超过 injection 大小的 warning 不影响 validation |
| `git diff --check` | PASS |

### 当前停止点

- 当前 Gate 仍为 `NOT_MET`；没有 source/raw/sanitized/fresh profile 实际数据，不能把静态 PASS 写成
  production validation。
- 仍缺精确 source label/revision 证明、只读 role/grants、export window、audit owner、execution host/client、
  encrypted raw path 与 run ID；production inventory/export 未获授权。
- profile 合同自身没有离线 blocker。实际 production-ready 结论仍取决于批准 host 上 PostgreSQL
  server/client 对 exported snapshot 与 `pg_dump --snapshot` 的版本核验，以及 Phase 2 的真实 read-only/audit
  证据。
