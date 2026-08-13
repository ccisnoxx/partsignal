# 实施计划

## 0. 当前停止门禁

- [x] 主工作目录、main、前置 commits、归档状态与 clean workspace 已核对。
- [x] 父 Task 已创建为 planning；未运行 `task.py start`。
- [x] AGENTS、Trellis workflow、V2 docs/spec、Platform 与 Content AI 归档任务已阅读。
- [x] 当前 frontend/backend/OpenAPI/V1 行为已审计。
- [x] `prd.md`、`design.md`、`implement.md` 已形成可 review 版本。
- [x] 用户批准范围、Preview contract 与 Core/Preview 拆分。
- [x] 两个 planning 子 Task 已创建，依赖与独立验收写入各自 artifacts；父 Task不创建业务分支。
- [ ] 用户批准两个子 Task 的最新独立规划后，才可 start Core。

本轮到此停止：不创建子 Task/分支，不修改业务代码，不运行重型测试，不提交。

## 1. 推荐实施顺序

### Task A：frontend-v2-prompt-workspace-core

候选分支：`codex/frontend-v2-prompt-workspace-core`。

1. 批准后从 clean main 创建并 start 子 Task，再创建唯一临时分支。
2. 新增 canonical q/promptId/new model 与 model tests；扩展 DirtyGuard 可选导航 predicate，保持默认行为。
3. 新增 Admin route、Prompt nav entry 与 generated route tree；固定 ENGINEER route 403。
4. 建立 `prompt.api.ts` 作为唯一 Prompt query/mutation owner；从 `platform.api.ts` 移入完整 Prompt list query，Platform Workspace 改用同一 key。
5. 实现 Library/Detail/Editor/Bound Platforms：RHF+Zod、MarkdownEditor、StickyActionBar、impact/delete dialogs、conflict reload、Ctrl/Cmd+S、focus return。
6. 精确实现 create/update/delete 与 Platform bind/unbind cache matrix；不触碰 Content snapshot。
7. 新增 component tests 和 strict production-artifact fixture/Playwright；未声明 API、console/page/request errors 必须失败。
8. 自审 diff、完成 touched-scope 中文文档/开发者文本检查并报告；提交前单独给出 commit plan 等待确认。

Core 不显示 Preview 占位。交付状态是可完整使用的 Prompt 管理页，右侧只含 Bound Platforms 与生成边界说明。

### Task B：frontend-v2-prompt-workspace-preview

依赖：Core 已验证、提交、归档并 fast-forward 合入 main。

候选分支：`codex/frontend-v2-prompt-workspace-preview`。

1. 从合入 Core 的 clean main 创建并 start 子 Task，再创建唯一临时分支。
2. Contract first：OpenAPI 增加 ADMIN-only Preview Options path/schemas；生成 V1/V2 types。
3. Backend read model：复用 ContentTask action projection筛选 context；在 Content 查询 owner 抽取现有模型 options helper供两个 endpoint 复用；保持稳定排序、固定查询次数和无 N+1。
4. Backend integration：权限、404、资格矩阵、Prompt binding、模型筛选、sparse/dense query count 与 runtime OpenAPI consistency。
5. V2 public API：Prompt options query + ContentVersion narrow query；不导出 Content UI。
6. 在 Core reference pane 加入 Preview controls/result：dirty/new/revision mismatch gate、Test Context、模型、显式副作用确认、stable Idempotency-Key。
7. 复用 existing GenerationJob create/list polling；只追踪返回 ID，terminal 停止并读取 immutable ContentVersion；失败公开 error。
8. 完成 create/terminal/bind-unbind cache matrix，扩展 component/fixture Playwright 状态矩阵。
9. 更新 03/05/08/09 直接相关 V2 文档；不修改 database contract 或 stable specs。
10. 自审 diff并报告；提交前单独给出 commit plan 等待确认。

## 2. Core Required Validation

批准并完成 Core 实施后运行：

```bash
npm --prefix frontend-v2 run test -- \
  src/app/navigation.test.ts \
  src/design-system/forms/dirty-guard.test.tsx \
  src/domains/configuration/prompt-workspace.model.test.ts \
  src/domains/configuration/prompt-workspace-page.test.tsx \
  src/domains/configuration/platform-workspace-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/prompt-workspace.spec.ts
git diff --check
```

直接证明：

- q/promptId/new canonicalization、direct/refresh/Back/Forward、safe q-only navigation；
- ADMIN nav/route 与 ENGINEER 403；
- Library/Detail loading/empty/stale/404/403/error/retry；
- create/update/delete、字段映射、revision、name conflict、unknown action；
- dirty、shortcut、impact、409 保留/reload、focus return；
- Bound Platform handoff、精确 Prompt/Platform/Content cache invalidation；
- 375/768/1024/1440、Tabs/三栏、根无横向溢出及 runtime error audit。

Core 没有合同/backend 变更，因此不机械运行 backend 或 contract suite。

## 3. Preview Required Validation

具体 test node 以实施时最终文件名为准；默认命令：

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/integration/test_prompt_preview_options.py

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/schemas/content.py \
  backend/app/routers/production.py \
  backend/app/services/content_task_queries.py \
  backend/tests/integration/test_prompt_preview_options.py

npm --prefix frontend-v2 run test -- \
  src/domains/configuration/prompt-workspace.model.test.ts \
  src/domains/configuration/prompt-workspace-page.test.tsx \
  src/domains/configuration/platform-workspace-page.test.tsx \
  src/domains/content/content-ai-production.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/prompt-workspace.spec.ts
git diff --check
```

直接证明：

- OpenAPI schemas、generated types 与 runtime FastAPI contract 一致；
- Preview Options ADMIN 200/ENGINEER 403/404、stable order、真实 action 资格、Prompt binding、模型 enabled/tested、fixed query count；
- dirty/new/revision mismatch disabled、options loading/empty/error/retry、显式 context/model；
- 单次确认与稳定 Idempotency-Key、PENDING/RUNNING/SUCCEEDED/FAILED、只跟踪返回 Job、terminal stop；
- immutable ContentVersion、公开失败、真实首稿副作用提示与 task handoff；
- precise create/terminal/bind-unbind invalidation；
- production artifact 下未声明 API 与浏览器 runtime errors 为失败。

现有 `frontend-v2/tests/e2e/content-ai-real-stack.spec.ts` 已证明相同 mutation/Worker/provider/snapshot/ContentVersion 链路。Preview Task 不改变该链路时不重复运行；若 implementation diff 改到共用生成命令或该证据失败，再把它加入 Required。

## 4. Optional Validation

```bash
make verify
make test-integration
npm --prefix frontend-v2 run e2e
```

- Phase 6 完整 real-stack E2E 留给后续独立 Task。
- 全量 backend integration、全部 V2 E2E 与其他 domain real-stack 不作为默认 completion gate。
- Optional 失败只在证据归因到当前 diff 时进入修复范围。

## 5. Diff 自审门禁

### Core

- [ ] 同一 Prompt list endpoint 只有一个 query key owner。
- [ ] 无客户端分页拼接、server sort复制、bound filter 或 Detail waterfall。
- [ ] 无从 count/role/status 推导业务 action；unknown token 显式失败。
- [ ] 409 不自动 replay，本地 Name/Markdown 保留。
- [ ] DirtyGuard 覆盖 identity/route/unload，q-only navigation 不误报。
- [ ] 无 Prompt 专用 CodeMirror、通用 Workspace framework、新依赖或 Humanization Tab。
- [ ] Core 未渲染假 Preview 或固定成功 fixture。

### Preview

- [ ] 新 endpoint 只有 read model，不创建 preview mutation/type/table。
- [ ] context 资格复用服务端 action projection；mutation 再次锁内校验。
- [ ] 浏览器不拼 Prompt/model/input snapshot，不导入 Content 内部 UI。
- [ ] stable Idempotency-Key 只按同一 signature 重用；冲突后废弃。
- [ ] 只轮询返回 Job ID；terminal 后停止；结果只读 ContentVersion。
- [ ] Preview 文案明确真实 ContentTask 首稿副作用。
- [ ] cache 只命中矩阵真实消费者；历史 Job/Version 不被重新解释。
- [ ] sparse/dense query count 固定，无 N+1、无 Fact/Prompt Markdown 泄露。

### 一致性

- [ ] code、OpenAPI、generated types、tests 与 03/05/08/09 文档一致。
- [ ] 无 database schema 行为变化，因此没有 migration/database contract diff。
- [ ] Python touched-scope comments/docstrings/log/error 完成中文检查。
- [ ] 无未识别文件、无 unrelated cleanup、`git diff --check` 通过。

## 6. 交付门禁

- 每个子 Task 实施完成后先报告 changed files、行为变化、合同/backend、revision/dirty、Preview副作用、权限/action、cache、实际验证、跳过项、风险和文档一致性。
- 提交前提供 commit plan 并等待用户确认；不自动 push、不创建 PR。
- 确认后提交、归档子 Task、fast-forward 合入 main、删除临时分支。
- Preview 合入后再核对父 Task验收与文档一致性，申请归档父 Task。
