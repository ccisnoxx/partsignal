# Frontend V2 Development Cutover 与 V1 Retirement：实施计划

> 当前状态：实施与范围内验证完成，等待 commit plan 确认。用户明确不要求本机隔离容器测试；container/real-stack/最终聚合门禁为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`，不是 `MET`。

## 1. 基线与分支

- [x] 再次执行 `git fetch --prune origin`，核对 `main`、`origin/main` 和当前候选分支状态。
- [x] 精确列出五个旧 Production planning task 与本 task 共六个未跟踪目录，将且仅将这些目录移入唯一临时位置；若出现其他 dirty/untracked 文件则停止并报告。
- [x] 切换到 `main`，确认 `main == origin/main` 且工作树干净；从 `main` 创建 `codex/frontend-v2-development-cutover-v1-retirement`，不 merge/cherry-pick 当前 candidate 分支。
- [x] 在实施分支原样恢复六个 task 目录并核对内容；其后把安全终止记录纳入本任务 diff，但提交前仍须单独给出 commit plan 并取得确认。

## 2. 安全终止旧 Production 规划

- [x] 更新五个 task 的 PRD 与 `task.json`，写入 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE / NOT_STARTED / NONE`。
- [x] 明确生命周期 completed/archived 不等于 Gate MET；记录未来需要重新规划。
- [x] 先四个子 task、后父 task执行 `task.py archive --no-commit`。
- [x] 校验未发生 Hostdzire、Production、远端文件、镜像、release、quarantine 或环境文件操作。

## 3. canonical 源码迁移

- [x] 精确检查 `frontend/`、`frontend-v2/` 类型、tracked/ignored 内容和用户产物。
- [x] 创建唯一 `mktemp -d`，将旧 `frontend/` 整体移至临时位置。
- [x] 执行 `git mv frontend-v2 frontend`，用限定路径的 `git add -A` 记录删除/重命名。
- [x] 更新迁移后的 `frontend/AGENTS.md` 路径说明。
- [x] 为 canonical Dockerfile 增加 `development` stage，并将 Vite dev 端口与 dev Compose 统一为 5173；保留 Production no-source-map Nginx stage。
- [x] 检查 legacy redirects、后端 compatibility endpoints、Markdown sanitizer、Storybook、设计系统、unit/E2E 均保留。

## 4. 单前端构建、CI、Compose 与部署检查

- [x] Makefile 收敛到 canonical `frontend/`，删除 V1 visual/theme-init 和双构建入口，将活动 V2 临时命名改为通用命名。
- [x] CI 收敛 cache/install/lint/typecheck/unit/build/E2E 到 canonical 路径，保留必要 shards 与 V2 检查。
- [x] 更新 dev/staging Compose build context/stage；核对 prod Compose 不含源码旧路径。
- [x] 更新 staging full/fast 部署脚本与测试，删除 V1 fallback fixture 分支。
- [x] 仅对 Production 脚本/测试做 canonical 通用命名的必要适配，保留 main 的 V2-only safety code。

## 5. 安全与 E2E

- [x] 中央 Nginx/security checker 改为单 canonical 前端，删除 V1 theme-init/sink owner 假设。
- [x] 将 asset 合同改为 V2 Production 无 `.map`/`sourceMappingURL`，保留 CSP、headers、DOM sink、Markdown、敏感数据、本地路径、cache/404/head 检查。
- [x] 将 V2 container/security 活动脚本改为通用单前端命名，并更新全部调用者。
- [x] 删除 V1 E2E、共享启动代码与 snapshot PNG；迁移 V2 specs/fixtures 到 canonical 路径。
- [x] 根 E2E 只启动 canonical preview 4174 和现有 backend/fake OSS；更新 active env var 名称。
- [x] 更新固定端口与 cleanup 逻辑，同时保留 DB/Redis/object storage/process/port/secret artifact 不变量。

## 6. 文档与 specs 一致性

- [x] 更新 `.trellis/spec/frontend/` 与 `.trellis/spec/infra/` 的 canonical path、CI 和 E2E 合同。
- [x] 更新 backend spec 中仍承担 live generated-schema owner 的路径引用；不得更改 API 字段或兼容合同。
- [x] 更新 development/testing/operations、部署验收、frontend-v2 01-09 的现行路径/owner/acceptance/ADR 段落。
- [x] 新增或更新 ADR，记录“开发阶段一次性 canonical cutover、V1 retirement、Production gates 取消”的决策；保留既有 ADR 历史。
- [x] 更新 GEO 与 Hostdzire 文档的当前源码路径和当前 scope 状态，不执行其远端步骤。
- [x] 检索活动文件残余 `frontend-v2/`、V1 构建/E2E、旧 env var 与双前端语义；按历史/活动语境逐项判定，不做盲目全局替换。

## 7. Required validation

只运行本次开发仓库切换范围内、无需本机隔离容器的 targeted checks；修复只限本任务可归因失败。

### 7.1 结构与静态检查

```bash
test -d frontend
test ! -e frontend-v2
git diff --check
python .trellis/scripts/task.py validate 08-29-frontend-v2-development-cutover-v1-retirement
bash -n deploy/scripts/e2e-local.sh
python -m py_compile deploy/scripts/e2e-environment.py deploy/scripts/e2e-database.py
node deploy/scripts/check-nginx-security.mjs
```

并执行限定范围 `rg`，确认活动 Makefile、CI、Compose、deploy scripts、specs 与现行文档没有旧 canonical path、V1 pipeline 或旧 E2E env var；历史名称允许保留但必须人工判定。

### 7.2 canonical 前端

```bash
npm --prefix frontend run api:check
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test
npm --prefix frontend run build
```

### 7.3 Compose 静态解析与部署脚本

使用项目既有测试环境变量渲染并校验三套 Compose；精确命令以实施时从现有脚本确认的 required env 为准，不猜测 Production 配置值。

```bash
docker compose -f deploy/compose.dev.yaml config
docker compose -f deploy/compose.staging.yaml config
docker compose -f deploy/compose.prod.yaml config
bash deploy/scripts/test-deploy-staging.sh
bash deploy/scripts/test-deploy-production.sh
```

这些命令只能做本地静态 config/test；不得执行真实 deploy、Hostdzire 或任何远端 mutation。`make test-frontend-container` 按用户范围决策不执行，状态为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`。

### 7.4 E2E

先执行 canonical frontend 的 foundation/auth/legacy redirects fixture specs，再执行完整 fixture suite：

```bash
npm --prefix frontend run e2e -- tests/e2e/foundation-smoke.spec.ts tests/e2e/auth-session.spec.ts tests/e2e/legacy-routing.spec.ts
npm --prefix frontend run e2e
```

完成后确认 fixture preview 进程及 4174 端口释放。`make e2e` 所属本机隔离 real-stack 不执行，状态为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`。

### 7.5 最终自审

最终聚合 `make verify` 包含用户明确排除的本机 container/real-stack 阶段，因此本任务不运行，状态为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`。

- [x] 检查完整 diff，排除 candidate 分支内容、第二来源、隐藏 fallback、宽泛异常吞噬、失效文档、未说明的行为变化与无关修改。
- [x] 检查代码、contracts、tests、docs、Trellis specs 一致；若 contracts 无需修改，最终报告说明原因。
- [x] 做 touched-scope documentation pass，并在最终报告说明注释/docstring/开发者可见文本的处理结果。
- [x] 报告未运行的本机 container/real-stack、远端 CI、Hostdzire 与 Production gates，以及为什么它们是 `NOT_APPLICABLE` 而不是 `MET`。
- [x] 范围内验证通过后，将旧 V1 的精确临时目录 `/private/tmp/partsignal-v1-retirement.zN5234` 移入 macOS 废纸篓；tracked 源码仍可从 Git 历史恢复，ignored 依赖缓存和构建产物仅可在清空废纸篓前恢复。

### 7.6 当前验证实绩（2026-08-29）

已通过：目录唯一性、`git diff --check`、Trellis task validate、Shell/Python 语法、Nginx/security checker、OpenAPI generated check、ESLint、TypeScript、Vitest（83 files / 489 passed）、production build、`make contract-check`、Ruff、mypy（80 files）、backend unit（208 passed）、dev/prod Compose 静态解析、staging/production deploy script tests、foundation/auth/legacy fixture Playwright（18 passed）以及完整 fixture Playwright（397 passed / 33 skipped / 0 failed）。完整 fixture 首轮的两个失败均来自同一 Work List 旧断言；修正并完成定向复验后，已从头重跑整套并通过。

本机 container smoke、Docker backend integration/build、canonical isolated real-stack E2E 与最终聚合 `make verify` 未执行。用户明确不需要本机隔离容器测试，因此这些项目不是阻塞，也不能标记为通过；统一记录为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`。此前 `make test-deploy-scripts` 在 Docker build 阶段因 `/var/run/docker.sock` 不存在停止，该次运行不是 Gate=`MET`，也无需重跑。

## 8. Optional validation

- GitHub Actions 远端工作流、Production candidate、clean-init、Production cutover/observation 均不属于本任务 required validation，不运行。
- 本机 container/real-stack/最终聚合门禁已由用户从本任务范围取消，统一为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`，不得写成 `MET`。

## 9. 提交与交付

- [ ] 在提交前向用户展示 commit plan：拟提交范围、排除项、验证结果和是否包含 Trellis task 归档 bookkeeping。
- [ ] 仅在用户确认后提交到当前实施分支；不自动 merge、push 或删除任何分支。
- [ ] 本会话只完成本任务，不自动创建或实施后续任务。
