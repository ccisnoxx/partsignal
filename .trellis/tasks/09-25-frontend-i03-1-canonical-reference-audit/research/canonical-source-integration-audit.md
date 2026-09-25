# I03-1 Canonical 源码与集成引用审计

审计日期：2026-09-25
候选工作区：`/Users/sc/.codex/worktrees/frontend-redevelopment/partsignal`
原检出区：`/Users/sc/PycharmProjects/partsignal`
候选基线：`9100774b0e124d1d834f8c726cf85f2c0e171e5e`

## 1. 结论

1. 仓库中只有一个活动前端源码根：`frontend/`。不存在 `frontend-v1/`、`frontend-v2/` 或其他重复前端源码目录；`docs/frontend-v2/` 是 canonical 设计/决策基线并包含迁移历史，不是源码或构建输入；`.trellis/tasks/archive/**frontend-v2**` 是历史任务记录。
2. Makefile、dev/staging Compose、Dockerfile、Playwright、nginx、安全检查、部署脚本和 OpenAPI 生成链都指向 canonical `frontend/`。Production Compose 按发布边界只消费已构建镜像，不持有源码 build context。
3. `partsignal-frontend-v2` 是当前镜像/package identity，不是源码目录；`frontend-v1` 在活动部署脚本中是拒绝模式，在部署测试中是负例；业务 `legacy` 路由/数据类型是兼容行为，不是第二套前端源码。
4. `contracts/openapi.yaml`、`frontend/src/shared/api/generated/schema.d.ts`、`frontend/scripts/check-openapi.mjs` 相对基线均无差异。生成入口和检查链没有路径漂移，可复用 I02-3 的 contract/generated-type 绿色证据，不重新生成类型。
5. 确认一个 CI 门禁缺口：本地 `make verify` 必经的 frontend container smoke、process lifecycle、database lifecycle 和 post-run secret regression harness 没有出现在 `.github/workflows/ci.yml` 的 `verify` job 中。远端 GitHub Actions 本会话未运行，不能表述为通过或与本地门禁等价。
6. `.trellis/tasks/` 之外仍有 21 个未跟踪维护文件。它们全部是源码、脚本或测试，不是生成物、缓存或临时产物；其中多项被 tracked Makefile/package/config/source 直接引用。候选尚无 Git staging、branch 或 commit，因此 clean checkout 无法原子重建当前绿色候选。

## 2. 工作区与恢复点

| 对象 | 实时结果 | 判断 |
|---|---|---|
| 候选 HEAD | `9100774b0e124d1d834f8c726cf85f2c0e171e5e`，detached worktree | 与指定基线一致；没有候选 commit |
| 原检出区 | 同一 HEAD，`main...origin/main`，`git status` 0 项 | 保持干净，本任务未在原检出区实施 |
| 候选 tracked diff | 146 个文件，全部为 `M`；顶层分布：`.trellis` 4、backend 3、deploy 2、docs 1、frontend 135、Makefile 1 | `git diff` 可描述 tracked 修改，但不是独立恢复点 |
| 候选 untracked | 最终记录为 314 个；其中 `.trellis/tasks/` 293 个，其他维护文件 21 个 | `git diff` 不包含这些文件；丢失工作目录会丢失候选组成 |
| staging | 0 个文件 | 没有 index tree 可用于原子清单或 clean-checkout 组装 |
| 分支/提交 | 候选 worktree detached；未创建分支或提交 | 没有 Git ref 指向候选状态 |
| I02-3 日志 | `/tmp/partsignal-i02-3-make-verify.log` 仍存在，229117 bytes；status 为 `MAKE_VERIFY_EXIT=0` | 是本机验证证据，不是可移植源码恢复点 |
| I02-3 多代理审计 | `20260925T165833Z-i02-3-full-candidate-independent-review-9597ace7`，closed/verified，无 anomaly | 是独立复核证据，不包含当前未跟踪文件的 Git 原子快照 |
| I02-3 Trellis 记录 | 记录 679 backend unit、755 frontend unit、337 integration、16 real-stack、494/34 fixture、两轮 secret scan clean | 输入未变化时可复用；不能外推到远端 CI 或未来 clean checkout |

已存在的恢复证据是基线 SHA、候选 worktree、tracked diff、逐文件未跟踪清单、I02-3 日志/状态、Trellis 记录和已验证多代理审计包。缺少的是一个被 Git 对象/ref 表达的完整候选树。未获 staging/commit 授权时，不能证明新 clone/worktree 能无遗漏组装，也不能执行有意义的 clean-checkout `make verify`。

## 3. Canonical 源码与字符串分类

- `git ls-files` 的唯一前端源码顶层为 `frontend`。文件系统前两层的 frontend-like 目录只有 `frontend/` 与 `docs/frontend-v2/`。
- `frontend/` 的直接子目录为 `.storybook/`、`scripts/`、`src/`、`tests/`，以及被 `.gitignore` 排除的 `.cache/`、`dist/`、`node_modules/`。`dist/` 是当前本机构建输出，不是第二套源码。
- `docs/frontend-v2/` 是当前 canonical 前端的设计/决策基线，其中 `07-migration-plan.md` 与分支/Cutover 内容属于迁移历史；整个目录都不是源码或构建输入。归档 Trellis task 中的 `frontend-v2` 是历史任务记录。
- `deploy/scripts/test-deploy-staging.sh` 中的 `../frontend-v2` 只出现在负断言，确保 staging 不恢复旧 context。
- `deploy/scripts/activate-production.sh`、`deploy/scripts/deploy.sh` 中的 `frontend-v1` 是显式拒绝模式；`test-deploy-production.sh` 中的 V1 镜像是拒绝/回滚反例。
- `partsignal-frontend-v2` 出现在 package 名、Make/CI 镜像 tag 与 Production 测试中，只标识镜像/产物 lineage；实际 Docker build context 仍为 `frontend/`。
- `frontend/src/routes/-legacy-routing.model.ts`、对应 fixture/spec 和 OpenAPI `Legacy*` 类型属于当前 canonical app 的兼容读取/路由行为。

## 4. 本地 `make verify` 与远端手动 CI 执行图

| 门禁 | 本地 `make verify` | `.github/workflows/ci.yml` `verify` | 结果 |
|---|---|---|---|
| OpenAPI/runtime/generated | `make contract-check` | `make contract-check` | 一致 |
| lint/typecheck | 根 `make lint`、`make typecheck` | 同命令 | 一致 |
| backend unit | `make test-unit` 内运行 | 直接运行 backend pytest | 行为覆盖一致，入口不同 |
| frontend unit | `make test-unit` 内运行一次 | verify job 运行一次，另有 `frontend-test` 两路 shard | CI 有额外分片反馈 |
| PostgreSQL integration | `make test-integration` 通过 dev Compose `backend-test` | 宿主 service 上直接 pytest | 测试集合相同，容器入口不同 |
| backend/frontend image build | `make build` | `make build` | 一致 |
| real-stack + fixture E2E | `make e2e`，Redis DB 由调用环境决定 | `make e2e` 且 step 覆盖 DB 14 | 一致；CI 与 backend integration DB 15 隔离 |
| dev/prod Compose config | verify recipe 两项 | 两项显式 step | 一致 |
| staging/production deploy harness | `test-deploy-scripts` | 两项显式 step | 一致 |
| frontend container smoke | `test-deploy-scripts -> test-frontend-container` | 缺失 | **缺口** |
| process lifecycle harness | `test-deploy-scripts` 直接运行 | 缺失 | **缺口** |
| database lifecycle harness | `test-deploy-scripts` 直接运行 | 缺失 | **缺口** |
| post-run secret regression | `test-deploy-scripts` 直接运行 | 缺失 | **缺口** |

CI 采用手工分解，而不是调用 `make verify`，所以 I02-2 新接入 Make 的四项门禁没有自动进入 workflow。最小修复 owner 是 `.github/workflows/ci.yml`；稳定 spec `.trellis/spec/infra/ci-execution.md` 已明确要求这些门禁，无需为当前事实另建兼容规则。修复应复用 `make test-deploy-scripts` 或保证等价的单一受控入口，避免再次复制子步骤。

## 5. OpenAPI 生成类型

| 项目 | 当前事实 | 判断 |
|---|---|---|
| 权威输入 | `contracts/openapi.yaml` | 一致 |
| 生成命令 | `frontend/package.json`: `openapi-typescript ../contracts/openapi.yaml -o src/shared/api/generated/schema.d.ts` | 一致 |
| 生成文件 | `frontend/src/shared/api/generated/schema.d.ts`，tracked | 一致 |
| 漂移检查 | `frontend/scripts/check-openapi.mjs` 在临时目录重新生成并逐字节比较 | 一致 |
| 根入口 | `make contract-generate` / `make contract-check` 使用 `npm --prefix frontend` | 一致 |
| CI | `make contract-check` | 一致 |
| 输入变化 | OpenAPI、生成文件、check 脚本相对基线均无 diff；package 的 generated scripts 行未变化 | 无路径/调用漂移 |
| 复用证据 | I02-3 `make verify` 已通过 runtime/OpenAPI/generated check | 可复用；本任务未重新生成 |

## 6. 未跟踪维护文件逐项审计

以下 21 个文件均为当前候选维护源；无生成物、缓存或临时产物。涉及 secret/password 的内容是受控测试 sentinel、运行时动态 cookie/CSRF 登记或随机临时 key，不是实际凭据。

| 文件 | 类型与 owner | 维护引用/入口 | 候选必要性与敏感分类 | 遗漏时 clean-checkout 影响 |
|---|---|---|---|---|
| `backend/tests/unit/test_e2e_database_script.py` | backend unit；E2E DB owner | pytest 自动发现，验证 `deploy/scripts/e2e-database.py` | 必需回归；测试 owner token 为固定反例，无真实 secret | 单独遗漏不使命令报错，但 backend unit 数量/数据库所有权回归与 I02 证据不可复现 |
| `backend/tests/unit/test_e2e_process_group_script.py` | backend unit；process lifecycle owner | pytest 自动发现；加载 `deploy/scripts/e2e-process-group.py` | 必需回归；无敏感值 | 单独遗漏降低覆盖；若测试存在而 helper 遗漏则 backend unit 失败 |
| `deploy/scripts/e2e-database-lifecycle.sh` | infra source helper | tracked `e2e-local.sh` source；database lifecycle harness source | 运行必需；无敏感持久化 | `make e2e` 与 `make verify` 在 source 阶段失败 |
| `deploy/scripts/e2e-process-group.py` | infra source helper | tracked `e2e-local.sh` 两处直接调用；unit/harness 引用 | 运行必需；无敏感值 | real-stack E2E 无法启动受控 process group，unit 也失败 |
| `deploy/scripts/e2e-run-lifecycle.sh` | infra source helper | tracked `e2e-local.sh` 与 fixture wrapper source；两个 harness 引用 | 运行必需；组合退出码/信号/scan owner | real-stack/fixture E2E 在 source 阶段失败 |
| `deploy/scripts/test-e2e-database-lifecycle.sh` | 可执行 infra harness | Makefile `test-deploy-scripts` 直接调用 | 顶层门禁必需；只用临时 owner token | `make test-deploy-scripts` / `make verify` 直接失败 |
| `deploy/scripts/test-e2e-run-lifecycle.sh` | 可执行 infra harness | Makefile `test-deploy-scripts` 直接调用 | 顶层门禁必需；仅受控 secret sentinel | `make test-deploy-scripts` / `make verify` 直接失败 |
| `frontend/src/domains/audit/audit.api.test.ts` | Audit domain unit | Vitest `*.test.ts` 自动发现 | 候选回归必需；仅 sentinel | 单独遗漏不报错，但 frontend unit 计数与 audit cache no-leak 证据不可复现 |
| `frontend/src/domains/configuration/ai-channel-models-section.test.tsx` | Configuration domain component test | Vitest 自动发现 | 候选回归必需；固定 CSRF/API key 状态为测试数据 | 单独遗漏不报错，但模型区行为覆盖与 I02 计数不可复现 |
| `frontend/src/domains/configuration/ai-channel-runtime.api.test.ts` | Configuration API unit | Vitest 自动发现 | 候选回归必需；仅 raw sentinel | 单独遗漏不报错，但 runtime cache no-leak 覆盖缺失 |
| `frontend/src/domains/configuration/prompt-preview.test.tsx` | Prompt domain component test | Vitest 自动发现 | 候选回归必需；无真实 secret | 单独遗漏不报错，但 preview 状态/命令覆盖与 I02 计数不可复现 |
| `frontend/src/domains/geo/new-geo-observation-page.test.tsx` | GEO domain component test | Vitest 自动发现 | 候选回归必需；测试 CSRF | 单独遗漏不报错，但页面 query/mutation 回归与 I02 计数不可复现 |
| `frontend/tests/e2e/fixture-secrets.ts` | fixture secret owner | 多个 tracked specs/fixture、global setup 直接 import | 运行必需；用临时随机 key 派生测试值，无硬编码实际凭据 | frontend typecheck/E2E 模块解析失败 |
| `frontend/tests/e2e/real-stack-runtime.ts` | real-stack runtime audit helper | tracked Auth/System real-stack specs；unit 直接 import | 运行必需；只收集脱敏 runtime failure | frontend typecheck/unit/E2E 模块解析失败 |
| `frontend/tests/e2e/real-stack-session.ts` | real-stack session secret registrar | 9 个 tracked real-stack specs；secret unit import | 运行必需；运行时登记 cookie/CSRF，不写固定真实凭据 | frontend typecheck/unit/E2E 模块解析失败 |
| `frontend/tests/e2e/run-with-secret-scan.sh` | 可执行 fixture E2E 门禁入口 | `frontend/package.json` `e2e`；post-run harness | 运行必需；临时 0600 key/manifest | `npm --prefix frontend run e2e`、`make e2e`、`make verify` 直接失败 |
| `frontend/tests/e2e/secret-artifact-global-setup.ts` | Playwright global setup | tracked `frontend/playwright.config.ts` | 运行必需；登记动态 fixture test secret | Playwright 配置加载/E2E 失败 |
| `frontend/tests/e2e/secret-artifact-post-run.spec.ts` | 受控负例 E2E | Playwright config 条件纳入；post-run harness 精确调用 | 顶层安全门禁必需；只写受控派生 secret | `test-secret-artifact-post-run.sh` 找不到目标 spec，顶层门禁失败 |
| `frontend/tests/helpers/real-stack-runtime.test.ts` | frontend helper unit | Vitest 自动发现；import runtime helper | 候选回归必需；无真实 secret | 单独遗漏不报错，但 runtime audit helper 回归/I02 unit 证据不可复现 |
| `frontend/tests/helpers/secret-artifact.test.ts` | frontend security unit | Vitest 自动发现；import secret/session helpers | 候选安全回归必需；仅 synthetic secrets/临时加密 manifest | 单独遗漏不报错，但 secret scanner 与 session 登记回归/I02 unit 证据不可复现 |
| `frontend/tests/helpers/test-secret-artifact-post-run.sh` | 可执行安全 harness | Makefile `test-deploy-scripts` 直接调用 | 顶层门禁必需；验证 secret 不进入 stdout/stderr | `make test-deploy-scripts` / `make verify` 直接失败 |

## 7. 审计矩阵

| 检查对象 | 当前引用 | 期望引用 | 状态 | 后续 owner | 建议任务 |
|---|---|---|---|---|---|
| 前端源码根 | `frontend/` | 唯一 `frontend/` | 一致 | frontend | 无 |
| 本地 build/cache | `frontend/dist`、`.cache`、`node_modules`，均 ignored | 不作为源码/提交输入 | 一致 | frontend tooling | 无 |
| `docs/frontend-v2/` | canonical 设计/决策基线，包含迁移历史 | 仅文档，不作 build context | 一致 | docs | 无 |
| 归档 `frontend-v2` tasks | `.trellis/tasks/archive/**` | 仅历史证据 | 历史记录 | Trellis | 无 |
| `../frontend-v2` | staging test 中负断言 | 必须不存在于 Compose context | 测试反例 | deploy test | 无 |
| `frontend-v1` | deploy 拒绝模式与 production 负例 | 不得成为 Production runtime/source | 测试反例 | deploy | 无 |
| 业务 `legacy` | canonical route/data compatibility | 保留当前兼容行为 | 历史记录 | frontend domains | 无 |
| package/image `v2` 名称 | `partsignal-frontend-v2` | 允许产物 lineage，不改变 source root | 一致 | release/deploy | 无 |
| Make npm prefix | 全部 `npm --prefix frontend` | `frontend/` | 一致 | Makefile | 无 |
| Make Docker build | `-f frontend/Dockerfile ... frontend` | canonical context | 一致 | Makefile | 无 |
| Make production build | `build-frontend` | canonical Dockerfile/context | 一致 | Makefile | 无 |
| Make E2E | `e2e-local.sh` 后 `npm --prefix frontend run e2e` | real-stack 后 fixture artifact | 一致 | infra/frontend test | 无 |
| dev Compose | context/bind 均为 `../frontend`，development target | canonical source | 一致 | `deploy/compose.dev.yaml` | 无 |
| staging Compose | context `../frontend`，默认 Dockerfile；image 为发布 identity | canonical source | 一致 | `deploy/compose.staging.yaml` | 无 |
| prod Compose | 只消费 `${PARTSIGNAL_FRONTEND_IMAGE}`，无 build | immutable release image | 一致 | `deploy/compose.prod.yaml` | 无 |
| Dockerfile | 同一 context 完成 dev/build/nginx runtime | canonical artifact | 一致 | frontend | 无 |
| container nginx | `frontend/nginx.conf` | SPA fallback/cache/source map contract | 一致 | frontend/deploy | 无 |
| 外层 nginx 安全检查 | `check-nginx-security.mjs` 读取 `frontend/index.html/src/nginx.conf` | canonical source | 一致 | deploy security | 无 |
| 前端 env | `.env.example` `VITE_API_BASE_URL`；dev Compose `VITE_API_PROXY_TARGET` | canonical Vite config | 一致 | env/dev Compose | 无 |
| OpenAPI authority | `contracts/openapi.yaml` | 根合同 | 一致 | contracts | 无 |
| generated output | `frontend/src/shared/api/generated/schema.d.ts` | 唯一生成类型 | 一致 | frontend shared API | 无 |
| generator/check | package scripts + exact temporary compare | 不手改、无路径漂移 | 一致 | frontend scripts | 无 |
| CI cache/install/workdir | lockfile、npm ci、unit shard 都为 `frontend` | canonical source | 一致 | CI | 无 |
| CI E2E Redis isolation | step DB 14；job DB 15 | 不共享 integration DB | 一致 | CI/infra | 无 |
| CI frontend container/lifecycle/secret regression | 未执行四项本地必经 harness | 与 `make verify`/CI spec 等价 | 缺口 | `.github/workflows/ci.yml` | CI 门禁一致性修复 |
| 21 个未跟踪维护文件 | 仅存在于候选工作目录 | 原子进入候选树 | 缺口 | I03 Git integration owner | 候选文件原子组装与恢复点 |
| clean-checkout 候选 | 无 staging、branch、commit；detached | 可由明确 Git 对象/ref 重建 | 缺口 | I03 Git integration owner | 候选文件原子组装与恢复点 |
| 最终本地集成门禁 | I02-3 当前工作树已绿；后续 CI/组装变化尚未复验 | 修复与原子组装后 clean checkout 复验 | 缺口 | I03 integration owner | I03 最终本地集成复验 |

## 8. 最小后继任务建议（本会话不创建）

1. **CI 门禁一致性修复**
   Owner：`.github/workflows/ci.yml`；必要验证 owner 为 `.trellis/spec/infra/ci-execution.md` 和 Makefile 现有 target。最小范围是在手动 `verify` job 中复用本地 `test-deploy-scripts` 等价入口，补齐 frontend container、process lifecycle、database lifecycle 与 post-run secret regression；不得把未运行 workflow 写成通过。
2. **候选文件原子组装与恢复点**
   Owner：I03 主代理/Git integration。精确核对 146 个 tracked 修改、21 个非任务未跟踪维护文件及需要保留的 Trellis 任务记录，形成可恢复候选。任何 `git add`、commit、branch 或临时集成提交都需要用户明确授权；没有授权时只能保留清单，不能宣称 clean checkout 成立。
3. **I03 最终本地集成复验**
   Owner：I03 integration。只在 CI 修复和原子组装完成后，从授权的 clean checkout/等价 Git tree 运行仓库级门禁、复核资源清理与 active reference，并安排最终独立复核；然后才可判断 I03 是否完成。

下一任务建议为“CI 门禁一致性修复”；本会话没有创建 I03-2，也没有实施上述任何发现。

## 9. 本任务验证与未运行项

- 已运行：`git status`、`git diff --name-only/name-status`、`git ls-files --others`、限定范围 `rg/find`、`make -n verify`、dev/staging/prod frontend Compose config 展开、Git worktree/staging/HEAD 检查、I02-3 日志与审计包存在性检查。
- 复用：I02-3 单次完整 `make verify` 绿色证据，因为本任务没有改变其 contract/generated/build/test 输入。
- 未运行：完整 `make verify`、Playwright、PostgreSQL integration、Docker build、远端 GitHub Actions、staging/production 部署。
- 独立复核：fresh `critical_reviewer` 结论为 `NO BLOCKER`；确认 active 引用、字符串分类、Make/CI 执行图、generated-type 链、21 个文件、clean-checkout 风险和三个后继任务边界完整。复核指出的未跟踪总数与 `docs/frontend-v2/` 措辞已在本报告修正。
- 独立复核未运行完整门禁、远端 Actions 或部署；其只读检查包含 Git 清点、`make -n verify`、限定搜索与三套 Compose frontend config 展开。
- 最终 `git diff --check` 已通过；候选实时清点为 146 个 tracked 修改、314 个未跟踪路径（293 个位于 `.trellis/tasks/`、21 个位于任务目录外），staged 文件为 0。原检出区仍为基线且 clean；本任务新增范围仅为 I03/I03-1 Trellis 记录和本报告。
- 独立复核审计包 `20260925T193252Z-i03-1-canonical-source-reference-audit-independe-27cfb4fb` 已闭合并通过完整性校验：1 次执行尝试、1 次验收通过、1 次独立复核、无异常、无写入观测。
