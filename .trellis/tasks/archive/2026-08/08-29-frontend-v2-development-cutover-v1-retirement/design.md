# Frontend V2 Development Cutover 与 V1 Retirement：设计

## 1. 设计结论

采用一次性开发仓库切换：从干净 `main` 创建专用实施分支，删除旧 V1 `frontend/`，将 `frontend-v2/` 迁移为 canonical `frontend/`，随后在权威入口消除双前端分支。路径切换与 Production 发布解耦；现有 main 上的 V2-only Production 安全代码继续保留，但本任务不执行相关远端流程。

核心不变量是：完成后仓库只有一个可构建、可测试、可部署的前端源码根目录 `frontend/`，所有活动入口都指向它；历史文档和兼容合同可以保留 V1/V2 名称，但不得形成第二套可编辑或可发布实现。

## 2. 基线与 candidate 分支审计

审计时状态：

- 当前分支：`codex/frontend-v2-production-candidate-artifact-gate`
- 当前 HEAD：`831def47dd76b8aa1caed592255d0e2a47617a2e`
- `main` 与 `origin/main`：`1cc6ec44ec76f593b424f8ae3911f90ab5f6d3ce`
- merge-base 是 `main`，candidate 分支领先 3 个提交，共 18 个文件、496 行新增、20 行删除。

三个提交分别是：

1. `7e5c39d17b19fbdc101513c70495e818565ced49`：Hostdzire 本地 candidate image 流程，修改 Production Compose、部署脚本、测试和 Hostdzire 文档。
2. `1149df2439bcdfaadaeca06abc88b38628fc42cb`：candidate artifact gate Trellis 归档 bookkeeping。
3. `831def47dd76b8aa1caed592255d0e2a47617a2e`：workspace journal/index bookkeeping。

上述差异均不属于开发仓库 cutover 的产品实现。实施不得 cherry-pick、merge 或复制这些差异；专用分支必须从干净 `main` 创建。当前 candidate 分支保持原状。

## 3. 源码目录迁移

### 3.1 安全迁移顺序

1. 当前五个旧 Production planning task 加本 task 共六个目录均为未跟踪文件。先记录其精确清单并移入唯一 `mktemp -d`，不得包含其他未识别文件。
2. 切换到 `main`，确认 `main == origin/main` 且工作树完全干净，再创建实施分支 `codex/frontend-v2-development-cutover-v1-retirement`；随后把六个任务目录从临时位置原样恢复到实施分支工作树。
3. 确认 `frontend/`、`frontend-v2/` 是预期目录而非符号链接，并记录 tracked 与 ignored 内容。
4. 另建唯一临时目录，将旧 `frontend/` 整体移入该临时目录，避免其 ignored `node_modules/`、`dist/`、`test-results/` 与新目录冲突。
5. 使用 `git mv frontend-v2 frontend` 完成 canonical 路径迁移，并用 `git add -A -- frontend frontend-v2` 记录删除/重命名。
6. 保留旧 V1 的精确临时目录直到 targeted validation 证明不再需要恢复，再只删除该显式目录；不得使用宽泛 glob、`git clean` 或破坏性 Git 命令。六个 Trellis task 目录随后作为本任务已授权的规划/终止记录纳入实施 diff，但任何提交仍须先取得用户对 commit plan 的确认。

### 3.2 canonical 前端运行合同

- 将原 V2 `AGENTS.md` 随目录迁移，并将路径说明更新为 `frontend/`。
- 在 canonical Dockerfile 中增加开发 Compose 所需的 `development` stage；保留 V2 build + Nginx Production stage 和生产环境无 source map 合同。
- 将 Vite 开发端口从 V2 临时端口 5174 统一为 dev Compose 既有端口 5173；E2E preview 继续使用隔离的 4174。
- 保留 V2 legacy URL redirects、Markdown sanitizer、设计系统、Storybook、unit 和 E2E；删除 V1 Ant/theme-init/visual-contract 实现与快照。
- 不因目录切换自动重命名应用标题、包名、Production image/tag/env/project/data-root。

## 4. 构建、CI 与 Compose

### Makefile 与 CI

- 将 npm install/check/lint/typecheck/test/build 收敛为 canonical `frontend/` 一套。
- 删除 V1/V2 双构建、V1 visual/theme-init 和旧路径 cache/install；保留适用的 V2 unit、设计系统、Storybook、容器与 E2E 检查。
- 将活动的 V2 临时命名改为通用命名，例如 `build-frontend`、`test-frontend-container`，并更新调用者。
- 本任务不运行本机 container/real-stack 或最终聚合 `make verify`；用户明确不需要本机隔离容器测试。相关入口继续保留供未来 CI/开发任务使用，但本轮状态为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`，不视为 `MET`。

### Compose 与部署脚本

- `deploy/compose.dev.yaml` 已使用 `../frontend`，由 canonical Dockerfile 的 `development` stage 接管。
- `deploy/compose.staging.yaml` 的 build context 从 `../frontend-v2` 改为 `../frontend`；保留 staging service、端口、fake-oss 和对象存储隔离。
- `deploy/compose.prod.yaml` 已是单 frontend service；保留 main 上的 V2-only image identity、manifest、data-state、quarantine、restore、activate 和 rollback 保护。
- staging 部署脚本与测试改为 canonical path，删除仅用于 V1 image fallback 的测试分支。
- Production 部署测试仅按通用安全脚本/路径重命名做必要适配；不引入 candidate 分支的 `pull_policy: never`、Hostdzire direct-build/local-image 行为，也不执行远端部署。

## 5. 安全检查

- 中央 `deploy/scripts/check-nginx-security.mjs` 从双目录扫描改为只扫描 `frontend/`。
- 删除 V1 theme-init 和 V1 sink owner allowlist 的专属假设。
- 保留 CSP、Nginx headers、DOM sink owner、Markdown sanitizer、敏感数据和本地路径泄漏检查。
- 删除 V1 要求“公开 source map 完整存在”的 Production asset 合同，改为验证 V2 Production build 中没有 `.map` 和 `sourceMappingURL`；保留容器 cache/404/head 安全检查。
- 将 `test-frontend-v2-container.sh` 等活动入口改为通用单前端命名，并同步 Makefile、CI、部署测试与文档引用。

## 6. E2E

- 删除 V1 E2E、共享启动逻辑和 V1 snapshot PNG；迁移并保留 V2 的 46 个 specs 与 20 个 fixtures。
- 根 `e2e-local.sh` 删除 V1 build/dev/preview/PID 与 V1 Playwright 阶段，只保留 canonical real-stack 入口；fixture suite 仍由 Makefile 的 canonical E2E 入口运行。本任务只执行 fixture suite，不启动本机隔离 real-stack。
- 活动变量 `PARTSIGNAL_E2E_V2_SPEC` 与 `PARTSIGNAL_E2E_V2_BASE_URL` 分别改为 `PARTSIGNAL_E2E_SPEC` 与 `PARTSIGNAL_E2E_BASE_URL`。
- `e2e-environment.py` 的固定端口集合删除 V1 的 5173/4173，保留 backend 8000、fake OSS 9001、canonical preview 4174；staging object storage 19009 仍独立。
- 保留 real-stack trace 策略、fixture failure trace、secret artifact scan、Redis 非零独占 DB/allowlist、数据库 drop、对象存储移除、进程 stop/wait 和端口释放实现；未执行的 real-stack 生命周期不推断验证结果。

## 7. 五个 Production planning task 的终止

对象为 `frontend-v2-production-migration`、`frontend-v2-main-candidate`、`frontend-v2-clean-init-rehearsal`、`frontend-v2-production-cutover`、`frontend-v2-production-observation`。它们均处于 planning，未实施且未创建远端资源。每项在 PRD 与 `task.json` 中记录：

- `outcome = CANCELLED_BY_SCOPE_DECISION`
- `gate = NOT_APPLICABLE`
- `execution = NOT_STARTED`
- `remote_mutation = NONE`
- 未来如需 Production 发布必须重新规划，不得从这些 task 续跑。

Trellis 生命周期的 `completed/archived` 只表示规划任务已安全终止，不代表 Gate `MET`。实施时先归档四个子 task，再归档父 task，并使用 `task.py archive --no-commit`，避免产生未经确认的自动提交。

## 8. 文档与合同影响清单

直接活动入口包括：迁移后的 `frontend/AGENTS.md`、`Makefile`、`.github/workflows/*` 的前端步骤、三套 Compose、E2E 环境/清理脚本、staging/Production 部署脚本及测试、Nginx/asset/container/security 检查脚本。

权威 specs 与开发文档包括：

- `.trellis/spec/frontend/index.md`、`visual-system.md`、`component-guidelines.md`、`quality-guidelines.md`
- `.trellis/spec/infra/ci-execution.md`、`e2e-isolation.md`
- `.trellis/spec/backend/available-actions-contract.md` 及经检索确认仍引用 live generated-schema path 的相关 spec
- `docs/development.md`、`docs/testing.md`、`docs/operations.md`
- `docs/deployed-full-functional-acceptance-plan.md` 的 source-map 当前合同
- `docs/frontend-v2/README.md`、01-09 中仍承担现行路径/owner/acceptance/ADR 的段落
- `docs/GEO系统前后端技术与部署方案.md`
- Hostdzire runbook 与 appendix 中当前执行路径和 Production readiness 状态说明

历史阶段结果、release/image/task 名、已归档 task 和既有 ADR 决策历史不批量重命名。`07`/`08` 的当前 Production readiness 段落应把未执行 Gate 明确改为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`；未来条件式 runbook 中的 `Gate=MET` 可以保留为未来前提，但不得被描述为本次已达成。

## 9. 风险与回退

- 最大本地风险是旧 `frontend/` 的 ignored 大目录与新 canonical 路径冲突；用唯一临时目录避让并在验证前保留可恢复副本。
- 最大合同风险是误删 V2 compatibility routes、Production data-state safety 或 E2E cleanup；通过按权威 owner 做定点修改和 targeted regression 避免。
- 最大文档风险是把历史 V2 名称全局替换、或把取消 Gate 写成 MET；只修改现行 owner/路径和当前状态段落。
- 未提交前可通过恢复精确临时目录与撤销本任务明确文件回到基线；禁止使用破坏性 Git 恢复命令。提交仍须单独获得用户对 commit plan 的确认。
