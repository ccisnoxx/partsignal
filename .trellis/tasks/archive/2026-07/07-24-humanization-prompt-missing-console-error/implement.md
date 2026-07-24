# 实施计划

## Phase 1 — 更新权威契约与后端读取语义

### 必须修改

- `contracts/openapi.yaml`
  - `paths./api/v1/content-humanization-prompt.get.responses`
  - 保留 200，增加 204“尚未配置”，不把预期缺失描述为 404。
- `backend/app/routers/configuration.py`
  - `get_content_humanization_prompt`
  - 无单例行时返回空 204；有记录、权限和输出模型路径不变。
- `backend/tests/integration/test_publication_review_closure.py`
  - `test_content_humanization_prompt_api_lifecycle_and_audit`
  - 将缺失断言改为 204 + 空响应体，并保留 403、422、200、409 和审计断言。

### 生成文件

- `frontend/src/shared/api/schema.d.ts`
  - 运行 `npm --prefix frontend run api:generate` 生成，禁止手改。

### 最小验证

```bash
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend \
  pytest backend/tests/integration/test_publication_review_closure.py \
  -k content_humanization_prompt_api_lifecycle_and_audit
npm --prefix frontend run api:generate
make contract-check
```

### 停止条件与回滚点

- 若 204 影响 PUT、权限或审计，停止并回滚本阶段；不得用兼容 404 分支兜底。
- 若生成类型与 OpenAPI 不一致，先修正权威契约，禁止手改生成文件消除差异。

## Phase 2 — 收敛前端缺失状态

### 必须修改

- `frontend/src/features/configuration/PlatformPromptsPage.tsx`
  - `humanizationPrompt` 的 `queryFn`
  - `humanizationMissing`、`remotePrompt` 与 `reloadCurrent` 的局部类型流
  - 204 映射为 `null`；200 继续 `unwrap`；其他错误继续抛出。
- `frontend/src/features/configuration/ConfigurationPages.test.tsx`
  - 增加 204 未配置场景，验证空状态、输入框和首次保存语义。
  - 保留或补充非 204 错误进入失败反馈的断言。

### 不修改

- `frontend/src/shared/api/client.ts:unwrap`
- `queryKeys.contentHumanizationPrompt`
- 平台 Prompt 的 404/`isNotFound` 分支
- 视觉样式和共享组件

### 最小验证

```bash
npm --prefix frontend exec -- vitest --root frontend run \
  src/features/configuration/ConfigurationPages.test.tsx
npm --prefix frontend run typecheck
```

### 停止条件与回滚点

- 若 TanStack Query 报“data cannot be undefined”，必须维持局部 `null` 映射，不允许返回 `undefined`。
- 若真实 4xx/5xx 被渲染成未配置空状态，停止并回滚本阶段。

## Phase 3 — 固化浏览器与 MVP 契约

### 必须修改

- `frontend/tests/e2e/mvp-flow.spec.ts`
  - 初始 GET 只接受 200/204。
  - `humanizationPromptWasConfigured` 必须以 `status() === 200` 判断，不能使用对 204 也为真的 `ok()`。
- `frontend/tests/e2e/editor-workspace-convergence.spec.ts`
  - 增加确定性的 204 路由场景。
  - 直达全局自然化 Prompt Tab，断言空编辑器可用。
  - 监听并断言 `console.error`、`pageerror`、`requestfailed` 均为空；不得因数据库已有 Prompt 而 skip。

### 最小验证

```bash
npm --prefix frontend exec -- playwright test \
  tests/e2e/editor-workspace-convergence.spec.ts \
  -g "未配置自然化 Prompt"
```

MVP 纵向 E2E 需要本地完整 PostgreSQL、Redis、Celery 和显式 Mock Provider，按项目脚本运行：

```bash
deploy/scripts/e2e-local.sh
```

### 停止条件与回滚点

- 若浏览器断言只能通过过滤 404、关闭监听或预先创建 Prompt，测试无效，停止并修正。
- 若 MVP E2E 的首次创建分支未实际执行，停止并修正状态判断。

## Phase 4 — 完整质量门禁与人工复核

```bash
make contract-check
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check \
  backend/app/routers/configuration.py \
  backend/tests/integration/test_publication_review_closure.py
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test
```

人工复核：

1. 在本地无 Prompt 状态下登录管理员并直达
   `/configuration/prompts?tab=humanization`。
2. 确认空状态、输入框和首次保存按钮语义未变，不提交表单。
3. 确认 GET 为 204，控制台无 error/warning，网络无失败请求。
4. 若另行部署，再通过真实公网域名做同一只读验收；部署不是本修复任务的自动动作。

## AC mapping

| AC | 实施步骤 | 证据 |
|---|---|---|
| AC1 | Phase 1 | 后端缺失集成测试：204 + 空响应体 |
| AC2 | Phase 1 | 同一集成测试：200/403 保持 |
| AC3 | Phase 2、3 | 组件测试 + Playwright 空编辑器断言 |
| AC4 | Phase 3 | 确定性 204 Playwright console/pageerror/requestfailed 断言 |
| AC5 | Phase 2 | 非 204 错误组件测试 |
| AC6 | Phase 1、4 | `api:generate` + `make contract-check` + typecheck |
| AC7 | Phase 1、3、4 | 后端生命周期测试 + MVP E2E + lint/test |

## Final file scope

预计必须修改：

1. `contracts/openapi.yaml`
2. `backend/app/routers/configuration.py`
3. `backend/tests/integration/test_publication_review_closure.py`
4. `frontend/src/shared/api/schema.d.ts`（生成）
5. `frontend/src/features/configuration/PlatformPromptsPage.tsx`
6. `frontend/src/features/configuration/ConfigurationPages.test.tsx`
7. `frontend/tests/e2e/mvp-flow.spec.ts`
8. `frontend/tests/e2e/editor-workspace-convergence.spec.ts`

不因计划完整性新增源文件、抽象或依赖。任务保持 `planning`，本计划获批前不得运行 `task.py start`。
