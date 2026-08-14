# 实施计划

## 0. Start Gate

- [x] Preview子Task已创建为planning，PRD/design/implement可review。
- [x] Core已验证、提交、归档并fast-forward合入main；primary workspace clean main。
- [x] 用户在Core合入后批准Preview最新规划并授权implementation。
- [x] 运行`task.py start`指向Preview，再创建唯一分支`codex/frontend-v2-prompt-workspace-preview`。

## 1. Ordered Implementation

1. Contract first：path/schemas/errors，生成V1/V2 types并contract check。
2. Backend schema/query：shared model options、Prompt context read model、stable order/fixed query count。
3. Backend route/integration：ADMIN/ENGINEER/404、资格矩阵、binding、models、sparse/dense。
4. Frontend public API：Preview Options query key和narrow ContentVersion query。
5. Preview UI：gates、explicit selects、side-effect confirmation、stable key、pending防重。
6. Polling/result：tracked Job only、terminal stop、failure、immutable Version/fullscreen/task link。
7. Cache matrix：create/terminal/Prompt/Platform mutations。
8. Component + strict fixture Playwright；复用existing real-stack evidence。
9. 更新03/05/08/09并完成diff/中文touched-scope自审；提交前给commit plan等待确认。

## 2. Required Validation

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

如shared generation command/action projection发生修改，Required追加其直接backend unit/integration和`frontend-v2/tests/e2e/content-ai-real-stack.spec.ts`；没有diff则不机械重跑。

## 3. Optional Validation

```bash
make test-integration
npm --prefix frontend-v2 run e2e
make verify
```

Phase 6完整real-stack E2E与其他domain suites不是默认gate。

## 4. Self-review

- [x] 只有read-only options新合同，无preview mutation/type/table/origin fallback。
- [x] 最终context资格复用CREATE_GENERATION_JOB action，mutation锁内重验。
- [x] models query单owner；response不泄露Markdown/snapshot/credential。
- [x] browser不拼snapshot、不导入Content内部UI、不自动选context/model。
- [x] stable key/pending防重/IDEMPOTENCY_CONFLICT处理准确。
- [x] tracked Job only、terminal stop、immutable Version、no auto retry/fake result。
- [x] Preview明确普通首稿副作用，历史记录不因当前Prompt变化而改写。
- [x] precise cache、fixed query count、四档layout/runtime audit。
- [x] code/OpenAPI/generated/docs/tests一致，无database/migration/依赖变化。
- [x] Python comments/docstrings/log/error与frontend developer text完成中文touched-scope检查。

## 5. Delivery Gate

- 报告changed files、合同/backend、Preview真实语义/副作用、权限/action、cache、实际测试、跳过项、风险和文档一致性。
- 提交前提供commit plan并等待确认；不自动push、不建PR。
- 确认后提交、归档、fast-forward合入main、删除Preview临时分支。
- 最后回到父Task核对Core+Preview总验收并申请归档父Task。
