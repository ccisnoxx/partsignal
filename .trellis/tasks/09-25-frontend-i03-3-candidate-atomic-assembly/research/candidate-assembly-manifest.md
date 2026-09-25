# I03-3 候选文件原子组装清单

记录日期：2026-09-25
候选工作区：`/Users/sc/.codex/worktrees/frontend-redevelopment/partsignal`
原检出区：`/Users/sc/PycharmProjects/partsignal`
基线 SHA：`9100774b0e124d1d834f8c726cf85f2c0e171e5e`
目标分支：`codex/frontend-redevelopment-candidate`

## 1. 初始实时状态

- 候选在任务创建前与任务启动后均为 detached HEAD，指向指定基线；index 为 0 项。
- 原检出区为 `main...origin/main`，HEAD 指向同一基线，工作树 clean；只读核对，未接管其分支、任务或改动。
- 目标分支在本地不存在，worktree 列表中也没有该分支占用。
- 创建 I03-3 并启动后，实时清点为 147 个 tracked 修改，全部为 `M`；删除、重命名、复制和模式位变化均为 0。
- 同一时点有 323 个 untracked 文件：302 个位于 `.trellis/tasks/`，21 个位于任务目录外；staged 为 0。
- I03-1 曾记录 146 tracked / 314 untracked / 293 task / 21 non-task。实时变化解释为：I03-2 新增 `.github/workflows/ci.yml` 这一 tracked 路径，并继续修改当时已计数的 `Makefile`；I03-2 新增 5 个任务文件，I03-3 创建时新增 4 个任务文件。因此 tracked `+1`、untracked/task `+9`，非任务维护文件仍为同一 21 个。
- 本清单和 `implement.md` 创建后，预期提交前 untracked 为 325 个，其中 `.trellis/tasks/` 304 个、任务目录外 21 个；与 147 个 tracked 修改合计 472 个候选路径。

## 2. Tracked 候选分类

| 分类 | 实时文件数 | owner / 必要性 |
|---|---:|---|
| `.github/workflows` | 1 | I03-2 CI 统一门禁接线 |
| `.trellis/spec` | 2 | 前端状态与 E2E 隔离稳定合同同步 |
| `.trellis/workspace` | 2 | 本轮前端重新开发工作日志与索引 |
| `Makefile` | 1 | canonical build/E2E/六项 harness 统一入口 |
| `backend/app/services` | 1 | AI 配置服务候选实现 |
| `backend/tests/integration` | 2 | AI 配置/生成可靠性回归 |
| `deploy/scripts` | 2 | E2E 数据库与本地 lifecycle owner |
| `docs/frontend-v2` | 1 | 本轮 canonical 业务动作/状态/API 文档同步 |
| `frontend` tooling/config | 3 | package、lockfile、Playwright 配置 |
| `frontend/src/app` | 4 | auth/provider 候选实现与测试 |
| `frontend/src/design-system` | 3 | table/primitives 候选实现与测试 |
| `frontend/src/domains` | 69 | 各业务域候选实现与测试 |
| `frontend/src/routes` | 7 | canonical route 与 legacy routing |
| `frontend/src/styles` | 1 | canonical 全局样式 |
| `frontend/tests/e2e` | 48 | fixture/real-stack production artifact 验收 |
| **合计** | **147** | 全部属于本轮候选或必要合同/Trellis 同步 |

`git diff --summary` 为空，确认 tracked 候选没有删除、重命名或模式位变化。I03-2 完成后相对 I03-1 只增加 CI 路径、继续修改既有 Makefile，并新增/更新对应 Trellis 记录；与 I03-2 完成记录一致。

## 3. Untracked 候选分类

### 3.1 Trellis 任务记录

- 提交前预期 304 个文件、64 个任务目录，全部位于 `.trellis/tasks/`。
- 结构化只读检查加载每个任务的 `task.json`，沿 `parent` 链全部可达 `09-21-frontend-redevelopment-delivery`，问题数为 0。
- 这些记录覆盖 R00、F/P/C/U/G/A/S/W、I01、I02、I03 任务树及各自 PRD、设计、执行、研究与验收证据；均属于本轮前端重新开发，不是其他会话内容。

### 3.2 任务目录外 21 个维护文件

这 21 个文件与 I03-1 的逐项审计集合完全相同；owner、入口和遗漏影响仍成立：

| 路径组 | 数量 | owner / 调用入口 / 候选必要性 |
|---|---:|---|
| `backend/tests/unit/test_e2e_database_script.py`、`test_e2e_process_group_script.py` | 2 | backend unit 自动发现；验证数据库 owner 与 process-group helper |
| `deploy/scripts/e2e-database-lifecycle.sh`、`e2e-process-group.py`、`e2e-run-lifecycle.sh` | 3 | tracked `e2e-local.sh`/fixture wrapper 直接 source 或调用；real-stack/fixture 生命周期必需 |
| `deploy/scripts/test-e2e-database-lifecycle.sh`、`test-e2e-run-lifecycle.sh` | 2 | `Makefile test-deploy-scripts` 直接调用；顶层门禁必需 |
| `frontend/src/domains/audit/audit.api.test.ts` | 1 | Vitest 自动发现；Audit cache no-leak 回归 |
| `frontend/src/domains/configuration/ai-channel-models-section.test.tsx`、`ai-channel-runtime.api.test.ts`、`prompt-preview.test.tsx` | 3 | Vitest 自动发现；Configuration 候选回归 |
| `frontend/src/domains/geo/new-geo-observation-page.test.tsx` | 1 | Vitest 自动发现；GEO query/mutation 回归 |
| `frontend/tests/e2e/fixture-secrets.ts`、`real-stack-runtime.ts`、`real-stack-session.ts` | 3 | tracked fixture/real-stack specs 直接 import；类型检查与 E2E 模块解析必需 |
| `frontend/tests/e2e/run-with-secret-scan.sh`、`secret-artifact-global-setup.ts`、`secret-artifact-post-run.spec.ts` | 3 | package E2E、Playwright config、post-run harness 直接引用；秘密产物门禁必需 |
| `frontend/tests/helpers/real-stack-runtime.test.ts`、`secret-artifact.test.ts` | 2 | Vitest 自动发现；runtime/secret helper 回归 |
| `frontend/tests/helpers/test-secret-artifact-post-run.sh` | 1 | `Makefile test-deploy-scripts` 直接调用；post-run 安全门禁必需 |
| **合计** | **21** | 全部为维护源、脚本或测试，无生成物或真实凭据 |

可执行模式核对：三项直接执行的 shell harness 与 `run-with-secret-scan.sh` 为 `100755`；被 source 的 lifecycle shell 和显式由 Python 调用的 helper 为 `100644`，与调用方式一致。

## 4. 排除路径与原因

下列内容存在于本机或属于已知运行证据，但不进入候选 index：

| 排除路径/类型 | 原因 |
|---|---|
| `.env` | ignored 本地环境与潜在凭据，禁止提交 |
| `backend/.venv/`、`frontend/node_modules/`、根 `node_modules` | 依赖安装目录 |
| `frontend/dist/`、`frontend/.cache/`、TypeScript `*.tsbuildinfo` | 构建输出与缓存 |
| `.cache/`、`.mypy_cache/`、`.ruff_cache/`、`backend/**/__pycache__/`、`deploy/scripts/__pycache__/` | 工具/Python 缓存 |
| `frontend/playwright-report/`、`frontend/test-results/`、coverage、trace、video | Playwright/覆盖率产物；当前非 ignored 候选中也不存在 |
| 临时数据库、对象存储、manifest、runtime secret 目录 | E2E 运行时资源；当前非 ignored 候选中不存在 |
| `.trellis/.runtime/`、`.trellis/.developer` | 会话指针和本机开发者运行状态 |
| `/tmp/partsignal-i02-3-make-verify.log`、status 与其他 `/tmp` 日志 | 本机验证证据，不是源码恢复点 |
| `~/.codex/audits/multi-agent/` | 外部独立复核审计包，不属于仓库候选 |
| IDE 文件、`.DS_Store` 等 OS 元数据 | 当前非 ignored 候选中不存在；若出现也排除 |

ignored 路径实时共有 39,260 个，主要由 `frontend/node_modules`、`backend/.venv`、构建输出和缓存组成；精确 staging 只消费已审计的 tracked diff 与非 ignored untracked 清单，不会纳入这些路径。

## 5. 敏感内容筛查

- 对 470 个初始候选路径执行只读 literal-pattern 扫描，不输出匹配值。
- 私钥 PEM、AWS access key、GitHub token、OpenAI key 和 Slack token 格式命中均为 0。
- generic password/API-key/secret literal 共 13 处，全部位于 8 个测试文件；路径与 I03-1 已确认的测试 sentinel/fixture 分类一致，不是实际凭据。
- 文件名中含 `secret` 的 6 个维护文件是 canonical secret-artifact 测试与 harness，必须纳入；名称本身不是敏感值。

## 6. 精确 staging 与预期候选提交

- tracked 路径来源：`git diff --name-only -z`。
- untracked 路径来源：`git ls-files --others --exclude-standard -z`。
- staging 使用 `git add --pathspec-from-file=- --pathspec-file-nul` 分别消费上述 NUL 分隔清单；不使用 `git add -A`。
- 预期原子提交包含 147 个 tracked 修改和 325 个 untracked 新文件，共 472 个路径；删除、重命名、复制均为 0。
- 预期提交完整表达当前产品代码、测试、CI/Make/lifecycle/secret harness、稳定 spec、文档、工作日志与前端重新开发 Trellis 任务树。
- staged-tree 独立复核、实际 commit/tree 和最终计数将在复核与提交后写入 I03-3 收尾记录；该后写只允许进入第二个纯 Trellis 收尾提交。

## 7. 提交前 staging 结果

- 实际 staged 为 472 个路径：147 个 `M`、325 个 `A`；删除、重命名、复制均为 0。
- `git diff --cached --stat` 为 472 files changed；完整 name-status 与 stat 只保存在 `/tmp` 作为本机核对材料，不进入候选提交。
- staged 后 unstaged 为 0、非 ignored untracked 为 0；所有已审计候选路径都已进入 index，没有 staged/unstaged 分裂。
- 首次 `git diff --cached --check` 发现 10 处 Trellis Markdown 行尾双空格，其中 6 处来自此前 untracked 的 I03-1 审计记录、4 处来自本清单。只做了 Trellis 记录的格式等价空白规范化；没有修改生产、测试、CI、合同或稳定 spec 内容。
- 重新 staging 后，`git diff --cached --check` 与 `git diff --check` 均通过。
- fresh `critical_reviewer` 复核与原子提交尚未执行；只有复核结论为 `NO BLOCKER` 才允许提交。
