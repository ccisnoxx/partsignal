# Frontend V2 Phase 5 GEO 完整真实栈 E2E — 实施计划

## 0. Approval gate

- 当前 Task 保持 `planning`；本轮不运行 `task.py start`、不创建分支、不改测试/生产代码。
- 用户审核并显式批准本规划后，运行：

```bash
python3 ./.trellis/scripts/task.py start 08-13-frontend-v2-geo-e2e
git status --short --branch
git rev-parse HEAD
git switch -c codex/frontend-v2-geo-e2e
python3 ./.trellis/scripts/task.py set-branch 08-13-frontend-v2-geo-e2e codex/frontend-v2-geo-e2e
python3 ./.trellis/scripts/task.py set-base-branch 08-13-frontend-v2-geo-e2e main
```

- 创建分支前必须仍在最新 `main` HEAD；工作区只允许本轮已知的 Task 规划文件。若出现未识别 dirty
  文件则停止，不覆盖用户改动。规划文件会随 `git switch -c` 带入临时分支，不在 `main` 预先提交。
- 该临时分支仅适用于本 Task；不自动 push。完成并合并回 `main` 后删除本地和已存在的远程分支。

## 1. 有序实施清单

1. 读取最终 `prd.md`、`design.md`、`implement.md`，加载 `trellis-before-dev` 及相关 spec；记录
   rollback HEAD。
2. 新建 `geo-real-stack.spec.ts`，按现有 spec 直接声明 generated types、real-stack gate、login、
   responseBody、两个消费者共用的文件内 prerequisite 函数和 afterEach runtime-error gate。
3. 实现 Flow A 前置数据；通过 V2 New UI 搜索/选择真实 Product、Topic、Article，上传 evidence 1，
   捕获 POST ID 并断言 root Detail。
4. 从 root Detail 的服务端 CORRECT 动作进入 Workspace，断言冻结字段；填写新 facts/time/notes，
   上传 evidence 2，捕获 POST ID 并断言 tail Detail。
5. 在 List UI、root direct Detail 和最终 Detail/list-items API 中完成 append-only、原记录不变、
   direct evidence 分离与 tail-only 断言。
6. 实现 Flow B 前置数据：独立 Product/Article/Topic/Fact/Platform，加 3 个上一周期正样本和 3 个
   当前周期负样本。
7. 通过 V2 Insights 读取真实 decline，证明 options 按需加载、单 POST Idempotency-Key、响应 ID
   导航与 Content Task Detail 不可变 GEO source。
8. 在 `e2e-local.sh` 的现有 V2 fixed list 中只追加 GEO spec；不调整服务、端口、数据库、storage、
   Playwright config、Makefile 或 V1 调用。
9. 完成 static checks 后执行一次 required real-stack gate；任何失败先归因，未发生针对性变化不得
   重跑同一昂贵命令。若真实栈暴露已验证缺口，按 R6 停止；2026-08-13 用户已批准只修复 GEO
   List `page_size` query parsing，并补 TestClient 回归后复跑唯一 gate。
10. 只有业务 flow 与 cleanup 都通过后，更新 `07`、`08` 和 infra isolation spec 的实际证据，
    写入 `research/validation.md`。
11. 加载 `trellis-check`，审计最终 diff：无 route mock、sleep、API 绕过目标步骤、重复 helper、
    隐藏 fallback、生产变化或无关文件。
12. 报告结果；提交前展示 commit plan 并等待确认。不自动 commit、merge、push、archive 或记录
    session bookkeeping。

## 2. 实现检查表

### Flow A

- [x] Product 先按唯一 part number 搜索，再选择，避免首屏 20 条依赖。
- [x] Query Topic 与 PublishedArticle candidate 来自真实 endpoint。
- [x] root 每篇 discovered/mentioned/accuracy 都由 UI 显式填写。
- [x] evidence 1 与 evidence 2 分别经过 intent → transfer → complete，文件名/ID 唯一。
- [x] 两次创建均捕获 POST response ID；canonical URL 精确匹配，不查询列表找 ID。
- [x] Root Detail 展示 Product/Topic/platform/query/results/article/evidence/notes/recorder/time。
- [x] Correction 只从 Detail token 入口进入；四个冻结身份字段无可编辑控件。
- [x] Correction POST 只提交新 evidence，`supersedes_id` 为 root/tail。
- [x] tail Detail history 顺序精确；root 与 tail facts/evidence/notes/time 不串线。
- [x] List UI/API 只返回 tail；root direct Detail 仍展示原始只读身份。

### Flow B

- [x] 两周期各 3 个唯一 root observations，筛选周期/Article/Product/Platform 精确。
- [x] Insights 真实 GET 投影 `CONTENT_DECLINE` 与 non-null action。
- [x] Dialog 打开前无 creation-options；打开后只有一次按需 GET。
- [x] Product/Platform 预选，Fact 显式选择；重复触发仍只有一个 optimization POST。
- [x] POST header 有非空 Idempotency-Key，body 精确合并 server source 与 target。
- [x] response ID 直接进入 Content Task Detail，无 Content Task List 搜索。
- [x] UI/API 都展示 `CONTENT_DECLINE`、周期、Article basis 与正确 Product/Platform/Fact。

### 共同边界

- [x] `console.error`、`pageerror`、`requestfailed` afterEach gate 为空。
- [x] 无 `page.route`、`route.fulfill`、fixture import、固定成功响应、任意 sleep。
- [x] API helper 只做前置/最终读取，目标 mutation 均来自 UI。
- [x] 两个测试随机唯一、互不共享业务对象、无需 test-level cleanup。

## 3. Required validation

### 3.1 Static / touched scope（重型 gate 前）

```bash
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
sh -n deploy/scripts/e2e-local.sh
git diff --check
```

`typecheck` 的 `tsconfig.node.json` 已包含 `tests/e2e`，可直接检查新 spec。默认不运行 contract check、
backend tests 或 fixture suites：计划不修改合同、生产代码或既有 fixture；若实现实际触及这些边界，
本规划失效并先回到用户决策点。

已批准的 backend 范围扩张增加以下 targeted validation：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py::test_geo_observation_list_accepts_page_size_from_query_string -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py -q
```

### 3.2 环境 preflight

```bash
: "${DATABASE_URL:?必须指向可创建 allowlisted E2E database 的本地 PostgreSQL}"
: "${REDIS_URL:?必须指向本次运行独占的 Redis logical DB}"
: "${PARTSIGNAL_E2E_STORAGE_PORT:=19009}"

redis-cli -u "$REDIS_URL" --raw DBSIZE
redis-cli -u "$REDIS_URL" --raw LLEN celery
redis-cli -u "$REDIS_URL" --raw HLEN unacked
redis-cli -u "$REDIS_URL" --raw ZCARD unacked_index
redis-cli -u "$REDIS_URL" --raw CLIENT LIST
if lsof -nP -iTCP:5173 -iTCP:4173 -iTCP:4174 -iTCP:8000 -iTCP:9001 \
  -iTCP:"$PARTSIGNAL_E2E_STORAGE_PORT" -sTCP:LISTEN; then
  echo "E2E 端口已被占用" >&2
  exit 1
fi
```

进入 gate 的条件：Redis `DBSIZE/LLEN/HLEN/ZCARD` 均为 0，没有其他 Worker/Scheduler 使用该 logical
DB；六个测试端口没有未知 listener。若不满足则换已确认独占资源或报告 blocker，不 flush 共享 Redis、
不终止未知进程。

### 3.3 唯一昂贵 real-stack gate

```bash
geo_e2e_log=$(mktemp "${TMPDIR:-/tmp}/partsignal-geo-e2e.XXXXXX.log")
set -o pipefail
DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" \
  deploy/scripts/e2e-local.sh tests/e2e/trusted-types.spec.ts 2>&1 | tee "$geo_e2e_log"
geo_e2e_status=$?
```

该命令运行脚本固定的全部 V2 real-stack specs，目标 GEO 应新增 2 条通过；随后 V1 只运行稳定且
轻量的 `trusted-types.spec.ts`，避免把完整 V1 suite 噪声作为本 Task 默认门禁。Playwright 仍使用
`foundation-desktop` production preview。

### 3.4 Cleanup 与证据保存

无论 `geo_e2e_status` 是否为 0，都继续执行：

```bash
rg 'Flow A：.*Observation.*Correction' "$geo_e2e_log"
rg 'Flow B：.*GEO.*优化' "$geo_e2e_log"
rg 'E2E_CLEANUP database=partsignal_e2e_[0-9]{8}_[0-9]+ status=deleted' "$geo_e2e_log"
rg 'E2E_CLEANUP storage=.*/partsignal-e2e-storage\.[^ ]+ status=deleted' "$geo_e2e_log"

geo_storage_path=$(sed -n 's/^E2E_CLEANUP storage=\(.*\) status=deleted$/\1/p' \
  "$geo_e2e_log" | tail -n 1)
test -n "$geo_storage_path" && test ! -e "$geo_storage_path"

geo_pg_url=${DATABASE_URL/postgresql+psycopg:/postgresql:}
psql "$geo_pg_url" -Atc \
  "SELECT datname FROM pg_database WHERE datname LIKE 'partsignal_e2e_%';"

if lsof -nP -iTCP:5173 -iTCP:4173 -iTCP:4174 -iTCP:8000 -iTCP:9001 \
  -iTCP:"$PARTSIGNAL_E2E_STORAGE_PORT" -sTCP:LISTEN; then
  echo "E2E cleanup 后仍有测试端口 listener" >&2
  exit 1
fi
redis-cli -u "$REDIS_URL" --raw CLIENT LIST
redis-cli -u "$REDIS_URL" DEL \
  _kombu.binding.celery \
  _kombu.binding.celeryev \
  _kombu.binding.celery.pidbox
test "$(redis-cli -u "$REDIS_URL" --raw DBSIZE)" = 0
test "$geo_e2e_status" -eq 0
```

判据：

- 两条 GEO flow 都有 passed 行；原始命令退出码为 0。
- database/storage cleanup 行存在，storage 路径已不存在，source PostgreSQL 没有
  `partsignal_e2e_%` 残留。
- 六个端口无本次 listener；本次 Worker/Beat 已退出。只对运行前确认独占的 Redis DB 删除已知
  Celery binding keys，最终 `DBSIZE=0`；不得 `FLUSHDB`。
- 将命令、退出码、flow 结果、cleanup 行、PostgreSQL/storage/port/Redis 事后结论写入
  `.trellis/tasks/08-13-frontend-v2-geo-e2e/research/validation.md`，再删除临时日志。
- cleanup 任一失败都使 required gate 失败，即使两个业务 flow 已通过。

### 3.5 Final hygiene

```bash
git diff --check
git status --short --branch
python3 ./.trellis/scripts/task.py validate 08-13-frontend-v2-geo-e2e
```

## 4. Optional full-suite validation

```bash
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/new-geo-observation.spec.ts \
  tests/e2e/geo-observation-detail.spec.ts \
  tests/e2e/geo-observation-correction.spec.ts \
  tests/e2e/geo-observations.spec.ts \
  tests/e2e/geo-insights.spec.ts

PARTSIGNAL_TEST_DATABASE_URL=<postgres-admin-url> \
  uv run --project backend pytest \
  backend/tests/integration/test_geo_observation_correction.py \
  backend/tests/integration/test_geo_observation_detail.py \
  backend/tests/integration/test_geo_observation_list.py \
  backend/tests/integration/test_geo_insights.py \
  backend/tests/unit/test_geo_insights.py -q

make verify
```

这些 suite 已有独立通过证据且计划内不修改其 owner，默认 optional。只有实现触及共享合同、生产行为，
或 required gate 的失败证据指向对应边界时才选择相关项；不因“更全面”无变化重复昂贵验证。

## 5. Failure attribution

| 首个失败位置 | 归因 | 本 Task 动作 |
| --- | --- | --- |
| prerequisite API | 唯一数据、环境或现有 Publication API | 只修本次测试数据错误；既有/环境缺陷停止报告 |
| Flow A selector/upload | 对照现有 strict fixture 与真实 response | 修本次测试；真实行为分歧停止，不 mock |
| append-only/evidence/list tail | 对照 backend integration 与 final payload | 数据合同缺陷，停止并请求范围扩张决定 |
| Flow B anomaly/action | 先核对六样本、日期、筛选 | 测试构造错误则修；服务分歧停止 |
| optimization source | 对照 unit/integration immutable source 证据 | 生产/read-model 缺陷，停止，不弱化断言 |
| 其他 V2/V1 spec | 核对 GEO 两 flow 是否已通过和 diff 影响 | 记录既有/无关失败，不修、不无变化重跑 |
| cleanup | database/storage trap、端口、Redis ownership | 精确清理并将 gate 判失败，不宣称完成 |

## 6. 预计文件

### Planned

- `frontend-v2/tests/e2e/geo-real-stack.spec.ts`
- `deploy/scripts/e2e-local.sh`
- `backend/app/routers/observation.py`
- `backend/tests/unit/test_contract.py`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/spec/infra/e2e-isolation.md`
- `.trellis/tasks/08-13-frontend-v2-geo-e2e/{prd.md,design.md,implement.md}`
- `.trellis/tasks/08-13-frontend-v2-geo-e2e/research/validation.md`（实施验证时创建）

### Explicitly unchanged unless separately approved

- `frontend-v2/playwright.config.ts`、Makefile、package manifests/lockfiles；
- GEO fixture specs/fixtures、其他 real-stack specs、共用 test helper；
- frontend production code、contracts、generated types、database/migrations；
- backend service 与 integration tests。

## 7. Pre-start checklist

- [x] Flow A 最小前置数据、UI/API 边界与 append-only 双层断言已确定。
- [x] PublishedArticle 最短构造复用现有 Publication real-stack 模式。
- [x] evidence 继续使用现有真实对象存储协议替身，无新 storage mock。
- [x] List tail-only、原 Detail readonly 与权威 API 断言已确定。
- [x] 新建独立 `geo-real-stack.spec.ts` 的所有权理由已确定。
- [x] 只有两个当前消费者的文件内 prerequisite helper；无 helper framework。
- [x] Flow B 已判定 required；成功 flow 与既有 stale/concurrency targeted evidence 分责明确。
- [x] 唯一 orchestration 接入点、2 个测试、90 秒单测上限和运行时间预算已确定。
- [x] required/optional validation、退出码、flow/cleanup 证据保存与 failure attribution 已确定。
- [x] Blocking open questions 为空。
- [x] 用户已审核本次最终规划摘要并明确批准实施。
- [x] 已运行 `task.py start`、创建临时分支并开始修改测试代码。
- [x] 用户已批准真实栈暴露的 GEO List query parsing 最小生产修复与 API 回归测试。
