# Frontend V2 Phase 9 Cutover — Implementation Roadmap

## 0. 当前状态

- [x] 本 planning Task 已创建并获批启动，status=`in_progress`。
- [x] 审计开始前为 clean `main`，无 active Task；Phase 8 已归档且 Gate=`MET`。
- [x] 规划 artifacts 已形成。
- [x] 规划阶段未改实现/部署/CI/合同/配置，未连接远程。
- [x] 用户已批准本规划；已运行 `task.py start` 并创建唯一临时分支 `codex/frontend-v2-phase-9-cutover-planning`。

已按批准执行：

```sh
python3 ./.trellis/scripts/task.py start frontend-v2-phase-9-cutover-planning
git switch -c codex/frontend-v2-phase-9-cutover-planning
```

提交 planning artifacts 前仍需按项目规则展示 commit plan并取得确认。不 push、不建 PR。规划完成/合回 `main` 后删除临时 branch 的时机另行确认；本 Task 不自动归档，因为 `task.py archive` 可能创建 bookkeeping commit。

## 1. 子 Task 共同规则

每个子 Task：

1. 从最新 clean `main` 开始，确认依赖 Task 已提交；不 pull/push/PR。
2. 独立创建并完成 `prd.md`、`research/audit.md`、`design.md`、`implement.md`、`task.json`，等待批准后才 start。
3. 只保留一个可 review 目标；定向验证和自审通过后展示 commit plan，等待提交确认。
4. 外部只读、外部写、cleanup/delete 分别授权；批准 repo 实现不自动批准环境操作。
5. 不删除 V1，不创建长期双 owner，不使用生产数据作测试源，不增加通用 deployment/redirect framework。
6. 未知 external fact 会改变方案时停止，不猜 host/domain/platform/command。

## 2. P9.1 — `frontend-v2-phase-9-staging-integration`

### 单一目标

让现有 staging `frontend` service 可逆地服务一个可验证的 V2 container artifact，保持 outer proxy、端口、API 同源和 V1 rollback 接口不变。

### 建议变更/提交范围

- `frontend-v2/Dockerfile`、`frontend-v2/nginx.conf`
- `frontend-v2/vite.config.ts`
- `deploy/compose.staging.yaml`
- `deploy/scripts/check-nginx-security.mjs`
- `deploy/scripts/test-deploy-staging.sh`
- `Makefile`
- `docs/Hostdzire部署上线流程.md`、`docs/Hostdzire部署附录.md`
- `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md`
- 本子 Task artifacts

不预计修改 outer staging Nginx、security snippet、`deploy-staging.sh`、production 配置或 `.env`。

### Required Validation

```sh
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
make test-deploy-scripts
node deploy/scripts/check-nginx-security.mjs
docker build -f frontend-v2/Dockerfile -t partsignal-frontend-v2:cutover-test frontend-v2
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-staging-integration
```

另用独立本地 container session 验证 `/login`、代表 deep link、hashed chunk、missing asset、index/fallback cache、无 `.map`；精确脚本在子 Task 根据新增 test owner 固定，不复用远程环境。

### 外部授权点

repo commit 后，另行授权：只读核验 staging release/config → build/deploy staging release → 必要时 Nginx reload → 公网浏览器验收。每一步失败即停，不自动进入下一步。

### Stop / rollback

- 实际 staging 不是文档 topology、V1 rollback tag 不可用、V2 CSP/fallback/API base 失败、需要改 production 或需要 schema migration时停止。
- repo rollback：revert 本 Task commit。
- staging rollback：用已验证旧 release/tag 重启相同 `frontend` service并验收；不删除失败 release。

## 3. P9.2 — `frontend-v2-phase-9-legacy-routing`

### 单一目标

实现并冻结 `design.md` 第 4 节的唯一 legacy redirect/deep-link contract，包括安全 return-to、显式 404 与 browser history，无部署 owner 变更。

### 建议变更/提交范围

- 最少的 `frontend-v2/src/routes/` legacy route files 与根级 not-found
- 必要的 route-local parser/model 与定向 Vitest
- `frontend-v2/tests/e2e/legacy-routing.spec.ts` 及最小 fixture
- 仅在现有 backend query 已支持时扩展对应 V2 search model；不得顺带扩 API
- `docs/frontend-v2/02-information-architecture-and-routing.md`、`07`、`08`
- 本子 Task artifacts

### Required Validation

```sh
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e -- tests/e2e/legacy-routing.spec.ts tests/e2e/auth-session.spec.ts
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-legacy-routing
```

E2E 必须逐项覆盖 path/ID/query、已认证/匿名/must-change/ENGINEER、direct/refresh/Back/Forward、replace 无 loop、不存在资源与未知 path。最终 staging 验证另需 P9.1 外部写授权。

### 外部授权点

实现提交不含外部操作。若要把该 release 部署到 staging，必须单独批准 staging build/deploy/browser validation；不切 production。

### Stop / rollback

- `/publications` closed history、旧 selected/filter 或 `/content` 若被要求做 data lookup/new API，停止并拆最小 blocker；若用户要求 `/products/:id` 继续直达 Facts，也因与现有 V2 Detail canonical path 冲突而停止并单独规划公共路由合同变更。
- return-to 不能证明同源安全、权限行为与 server 403 不一致、redirect loop 或 identity 丢失即停止。
- rollback：revert route commit；P9.1 V2 artifact 仍可运行 canonical routes，V1 仍保留。

## 4. P9.3 — `frontend-v2-phase-9-production-like-rehearsal`

### 单一目标

在隔离、脱敏、禁止真实外部副作用的 clone 上执行 V2 production-like rehearsal，并形成 production 零写入与 cleanup/隔离证据；不准备或切换 production artifact。

### 建议变更/提交范围

- 本子 Task 的数据边界清单、运行记录、结果与 gap
- 仅更新被 rehearsal 证据改变的 `docs/frontend-v2/07`、`08` 或 runbook
- 默认不新增 sanitizer/framework；若必须写脱敏代码，先停止并规划独立数据安全 Task

### Required Validation

在子 Task 中用用户确认的真实值替换 `<...>` 后冻结命令；任何占位符未解析不得开始：

```sh
test "<production-source-dsn>" != "<rehearsal-target-dsn>"
VERIFY_DATABASE_URL='<rehearsal-target-dsn>' deploy/scripts/restore-verify.sh '<approved-sanitized-backup>'
docker compose --env-file '<rehearsal-env>' -f deploy/compose.staging.yaml config --quiet
deploy/scripts/smoke.sh '<rehearsal-url>'
PARTSIGNAL_E2E_REAL_STACK=1 \
PARTSIGNAL_E2E_API_BASE_URL='<rehearsal-api-url>' \
PARTSIGNAL_E2E_V2_BASE_URL='<rehearsal-url>' \
PARTSIGNAL_SEED_ADMIN_PASSWORD='<rehearsal-admin-password>' \
PARTSIGNAL_SEED_ENGINEER_PASSWORD='<rehearsal-engineer-password>' \
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/auth-session-real-stack.spec.ts \
  tests/e2e/system-admin-real-stack.spec.ts
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-production-like-rehearsal
```

Required evidence：source 只读审计、target identity、脱敏 allowlist/denylist、scheduler/AI/OSS/第三方副作用关闭、representative volume、关键 route/workspace、production 零写入、cleanup 成功或获批隔离保留。

### 外部授权点

依次独立批准：production 只读 snapshot/export；创建/使用隔离 target；导入/运行 rehearsal；删除 clone/object prefix。任一步不授权，不自动替代。

### Stop / rollback

- DSN 无法证明不同、生产凭据可写、敏感字段未知、外部副作用可达、备份未脱敏或 cleanup target 不精确时停止。
- rollback 是停止 rehearsal、隔离 target、保留证据；删除 clone需单独授权。production 无任何回滚动作，因为不得有写入。

## 5. P9.4 — `frontend-v2-phase-9-production-artifact-readiness`

### 单一目标

基于用户确认的实际 production 平台，冻结一个 immutable V2 artifact 与可执行的 V1/V2 原子切换/回退机制；不切 production 流量。

### 建议变更/提交范围

- 实际 production owner 对应的最少 publisher/manifest/runbook/test
- production Nginx template 仅在确认它是实际 owner 时修改
- V2 build SHA/checksum/API base/source map policy 与 asset smoke
- `Makefile`/CI 只复用入口，不新建 CD framework
- `docs/operations.md`、production runbook、`docs/frontend-v2/07`、`08`
- 本子 Task artifacts

production 平台未确认前无法列出安全的精确实现文件，这是本 Task 的启动 blocker，不以 staging template 代替。

### Required Validation

```sh
make contract-check
make test-deploy-scripts
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
node deploy/scripts/check-nginx-security.mjs
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-production-artifact-readiness
```

另需对子 Task 确认的实际 publisher 做定向 test：同一 release manifest 的 HTML/assets checksum、missing asset 404、source map policy、prepare/activate/rollback 幂等和失败保留现场。未确认平台前不猜命令。

### 外部授权点

可先授权 production 只读 inventory。任何上传 artifact、创建 release directory、写 pointer/config 或 Nginx test/reload 都需单独写授权；本 Task 默认只在本地/prod-like target 演练。

### Stop / rollback

- production owner/domain/切换点未知，previous V1 release/checksum/DB兼容性无法确认，或需要 DNS/schema/permission 变更时停止。
- repo rollback：revert commit。prod-like artifact 回滚到 previous pointer；不删除新旧 release。

## 6. P9.5 — `frontend-v2-phase-9-rollback-drill`

### 单一目标

在 staging 或独立 production-like target 上，以同一候选 artifact 完成 V2→V1→V2 回滚演练并量化恢复时间；不触碰 production 流量。

### 建议变更/提交范围

- 本子 Task drill manifest、时间线、命令输出摘要、失败/成功证据
- 必要的 production runbook 修正与 `docs/frontend-v2/07`、`08`
- 默认不改产品/合同/数据库

### Required Validation

由 P9.4 冻结的 exact platform commands 依次执行：snapshot current → activate V2 → core smoke → activate previous V1 → V1 smoke/DB compatibility → reactivate same V2 → full artifact smoke。另运行：

```sh
make test-deploy-scripts
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-rollback-drill
```

Required evidence 包含两次切换 identity/checksum、`nginx -t`/平台等价检查、登录/session、核心 V1/V2 route、API health、assets/cache/CSP、实际 RTO 和失败现场保留。

### 外部授权点

只允许已批准的 staging/prod-like target。activation、reload、回退、清理分别按环境写授权；不得把“production-like”扩大为 production。

### Stop / rollback

- target 被识别为 production、previous V1 与当前 DB 不兼容、旧 assets/release 缺失、切换非原子或无法恢复时立即停在最后已验证 release。
- 不做 DB downgrade，不删除失败 artifact。

## 7. P9.6 — `frontend-v2-phase-9-production-cutover`

### 单一目标

在一次精确授权的维护窗口切换 production frontend 到已冻结 V2 release，完成强观察与 24 小时稳定观察；不删除 V1。

### 建议变更/提交范围

- Cutover manifest、授权记录引用、pre/post evidence、观察时间线、最终 Gate
- production runbook 与 `docs/frontend-v2/07`、`08` 的实际结果
- 默认无产品/合同/schema 变更

### Required Validation

切换前：P9.5=`MET`、Cutover Gate 1–9 全绿、exact V1/V2 release/checksum、snapshot、monitor query/threshold/owner、维护窗口，并在固定候选上运行：

```sh
make test-deploy-scripts
make verify
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-production-cutover
```

`make verify` 只在固定候选的独立阶段全绿后、切换前运行一次。切换后只执行 P9.4 冻结的 production smoke 与观察查询；任何 hard trigger 或已批准 threshold trigger 立即执行 P9.5 已验证的回滚命令。

### 外部授权点

必须重新取得仅针对 exact production endpoint、release、切换控制点、维护窗口的写授权。只读观察不授权其他配置变更；任何额外修复先回滚，再单独规划。

### Stop / rollback

- Gate 非 `MET`、阈值/owner/previous release 不完整、入口现场与 P9.4 不符，均不得切换。
- 触发条件见 design 第 8 节。回滚只切 frontend 到 V1，不降 DB；保留 V2 artifact/logs。

## 8. P9.7 — `frontend-v2-phase-9-v1-retirement`

### 单一目标

在 P9.6 完成且再次批准后，删除 repo 内旧 `frontend/` 与 V1-only build/deploy/test pipeline owner；不删除任何外部 V1 artifact、镜像、backup 或数据。

### 建议变更/提交范围

- 删除 `frontend/`
- 清理 `Makefile`、`.github/workflows/ci.yml`、Compose/deploy/security checks 中仅属于 V1 的路径/stage
- 删除 V1-only E2E/asset/source-map pipeline owner
- 更新 README、operations、Hostdzire/production runbook、Frontend V2 07/08/09 与 Trellis spec 中已过时的 V1 并行说明
- 本子 Task artifacts

### Required Validation

```sh
rg -n "frontend/|partsignal-frontend|V1|vite.*5173" Makefile .github deploy docs .trellis/spec README.md
make contract-check
make lint
make typecheck
make test
make build
make test-deploy-scripts
make e2e
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-v1-retirement
```

`rg` 命中必须逐项分类为仍有效历史/rollback 文档或待删除 owner，不能机械清零。作为共享 release cleanup，最终候选可再运行一次 `make verify`，但应在独立阶段全绿后且不重复无效 gate。

### 外部授权点

repo 删除需用户独立批准并在提交前再次确认。外部 V1 release/image/storage 删除不在本 Task；若未来需要，另立带保留期与精确 target 的 Task。

### Stop / rollback

- P9.6 观察未完成、有 P0/P1/P2、rollback runbook 仍依赖从源码重建 V1、外部保留期未确认或用户未再次批准时停止。
- rollback：revert 单一 retirement commit；外部保留的 V1 artifact 继续可用。

## 9. 依赖与批准顺序

1. 当前只批准/收尾 planning Task。
2. P9.1 批准、实施、验证、提交。
3. P9.2 批准、实施、验证、提交。
4. P9.3 与 P9.4 可分别规划，但在同一主工作区仍逐个实施/提交。
5. P9.5 依赖 P9.3/P9.4 均完成。
6. P9.6 依赖 P9.5 与 Cutover Gate=`MET`，且需 production exact 写授权。
7. P9.7 依赖 P9.6 的 24 小时观察完成并再次批准。

当前不创建上述 Task，不执行任何命令或环境操作。
