> 2026-09-07：用户已明确批准最新规划实施。以下 planning-only 文字记录上一轮授权；当前允许按本计划实施与验证，提交/归档/push 仍未授权。

# 实施计划：ContentVersion identity 数据库最终边界

## 当前授权与依赖

本轮仅 planning。不得运行 task.py start、实施代码/测试、修改 stable spec、提交/归档/push。实施前须用户明确批准本任务最新规划摘要。父任务和合同 owner 保持 planning。前置任务的精确 archived 路径见 PRD；I1/I2 metadata 已 completed，启动前核对 main 上已包含交付。

## 顺序与所有权

1. 读取本任务 prd/design/implement、两份 manifests 引用和 current-boundary research；核对 current main HEAD、当前脏文件与两个前置交付。只读记录工作树与 index 基线，禁止清理既有脏文件。
2. 核对测试 PostgreSQL/Redis 环境可用，隔离临时数据库迁移到 current head；先补 catalog 与真实 diagnostics（AC1），名称不符即停止。
3. 由 trellis-implement 负责三个允许测试文件及有证据必要的 generation.py/content_production.py；主代理负责两个 stable specs 与任务工件。原生 context injection 优先，未注入或被截断时 child 分段完整加载（database-guidelines.md 已知超过32768字节注入上限，不得只依赖注入前缀）；不允许 child 修改 contracts、root deployment 或执行 Git。
4. 先完成 AC2 正常重复/provider前lookup，再完成 AC3/AC5 两个精确constraint的首次flush sentinel、AC4正常锁对照、AC6–AC8晚期rollback和同Session复用、AC9–AC10 HTTP/no-leak/revision 对照。测试落点见 research；不新增第三种错误分类系统。
5. 仅当测试证明已冻结行为不满足时，对相应生产 owner 作最小修正；记录失败证据和变更理由。若无必要保持生产零diff。新增/实质修改注释、docstring、开发者可见文本按中文 touched-scope 处理。
6. 先运行最小新增用例；随后由 trellis-check 完成一次规定文件级 required gate；并由独立只读 reviewer 对事务/并发证据作审查（实现若改变持久化或并发行为，使用 critical_reviewer）。主代理同步必要 spec，检查实际 diff、完整边界与 AC 映射。
7. 只在 required 通过后考虑 optional full suite；记录每项实际结果/skip/未运行原因。不自动提交、归档或push；后续提交仍须具体 commit plan 与用户确认。

## Required validation（实施阶段，不在本轮执行）

以下命令从仓库根目录执行。本机执行前由既有安全配置提供 PARTSIGNAL_TEST_DATABASE_URL（有创建临时数据库权限）、REDIS_URL、AI_ALLOW_LOCAL_HTTP=true 和项目测试配置；不打印凭据。PostgreSQL/Redis 不可用不得改用 SQLite 或算通过。完整 reliability 文件包含 Redis broker 测试，不能只配置 PG。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_generation.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_generation_reliability.py backend/tests/integration/test_content_draft_lifecycle.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/generation.py backend/app/services/content_production.py backend/tests/unit/test_generation.py backend/tests/integration/test_generation_reliability.py backend/tests/integration/test_content_draft_lifecycle.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
git diff --check
```

实测修正：现有容器仅挂载 backend，无法读取 /contracts/openapi.yaml。两份合同测试使用上面的本机 UV 命令；generation unit 与两个 integration 文件可使用下列容器命令，已通过的检查不无故重复：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/unit/test_generation.py tests/integration/test_generation_reliability.py tests/integration/test_content_draft_lifecycle.py -q -ra
```

新增测试实施后在 research 记录精确 nodeid 和实测结果；上述文件级命令已包含它们，不用尚不存在的 nodeid 声称已运行。required 必须实际覆盖 AC1–AC10，不能以退出码0但 skipped/零收集通过。catalog 查询通过新增 PG 测试执行，不另建一次性审计脚本。

零 diff gate（同时覆盖 staged/unstaged）：

```bash
git diff HEAD --exit-code -- contracts/openapi.yaml contracts/database.md backend/app/routers/production.py backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py frontend/src/shared/api/generated/schema.d.ts frontend/src/domains/content docs/frontend-v2/05-business-actions-state-and-api-contract.md backend/app/models backend/alembic
```

还必须核对本任务新增的 untracked 文件均在任务目录中，实施时如有允许测试文件新增则按白名单审查；git diff 不包含 untracked，不能仅依赖上述命令。既有全局脏文件造成 diff-check/mypy失败时先归因，只修本任务可归因问题，不改 configuration.py 或 artifacts；记录受限路径替代检查与缺失门禁，不宣称全局通过。

## Optional validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra
```

full backend suite optional。若不运行，交付列出五文件、精确PG/HTTP/worker/锁/原子性、Ruff/mypy/零diff的实际替代证据，残余风险是这些路径以外未覆盖的间接回归。本任务无前端行为或生成类型修改，不运行 frontend build/E2E。

## 成本、停止与回退

- 同一 gate 最多两次 repair→targeted re-check、累计约20分钟；同根因重复即提早停止。一次 final/full-scope gate 不自动重跑。
- 独立 review 一次完整检查，最多一次针对性复审；仍有 material finding 则报告并停止。
- 任务专用 verifier/fixture/harness/audit script 超过300改动行或显著超过产品diff前，先评估并取得用户对额外证据成本的确认；优先复用既有 temporary_database/fake_ai_server，不搭建新框架。正常行为回归测试与专用辅助设施分开记录规模，不用拆文件规避预算。
- catalog或有效触发器使设计的sentinel不可达：先检查测试fixture/注入时点，不关闭trigger、不削弱锁、不改schema。需新合同/新错误/跨领域修改即停止。
- 回退仅处理本任务新增候选，保留既有工作树与index；不得宽路径删除/reset/checkout/stash。

## 本轮 planning gate

```bash
python3 .trellis/scripts/task.py validate 09-07-content-version-identity-integrity-boundary
python3 -m json.tool .trellis/tasks/09-07-content-version-identity-integrity-boundary/task.json
git diff --check -- .trellis/tasks/09-07-content-version-identity-integrity-boundary .trellis/tasks/09-04-integrity-error-domain-mapping/task.json
```

另外逐行解析 JSONL、确认引用真实存在且无模板占位；读完收敛后的 PRD；独立只读 planning review 检查 AC 与测试方案、依赖和文件边界。最终汇报规划状态，等待后续明确批准实施。
