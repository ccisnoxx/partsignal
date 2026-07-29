# 实施计划：事实版本审核历史精确归属

## 实施门禁

- [x] 用户明确批准本次最终规划摘要及 `review_history` 的公开 API 语义收窄。
- [x] 运行 `task.py start`，并通过 `trellis-before-dev` 重新读取任务文档和相关规范。
- [x] 修改前完整读取将要编辑的代码与测试文件，并再次确认用户现有脏改动没有冲突。

## 实施步骤

1. 在 `backend/app/services/review.py` 将事实审核历史查询限定为当前 `FactVersion.id`，同步中文 docstring；不修改 `_content_history`。
2. 在 `backend/tests/integration/test_publication_review_closure.py` 增加一个 PostgreSQL 回归场景：
   - 同产品建立 PUBLIC V1 与 RESTRICTED V2；
   - 分别执行不同事实审核命令；
   - 分别读取 V1、V2 上下文并断言 `target_id`、评论和动作不交叉；
   - 断言对应 `AuditLog` 的 `target_type/target_id` 精确指向各自版本。
3. 在 `frontend/src/features/product-facts/ProductFactsPage.test.tsx` 增加 V1/V2 页面场景，验证点击 V2 请求 V2 上下文且不显示 V1-only 事件；不在生产组件增加过滤。
4. 更新 `contracts/openapi.yaml`、生成的 `frontend/src/shared/api/schema.d.ts`、`contracts/database.md` 与 `docs/architecture.md`，明确版本级 owner 和数据范围。
5. 检查 diff，确认没有历史改写、产品级 fallback、共享审计查询变化、内容审核变化或 DEF-02 之外的修改。

以上步骤均已完成。

## 必需验证

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_review_closure.py \
  -k fact_review_history_is_scoped_to_version

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  -k runtime_openapi_matches_frozen_operations

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/services/review.py \
  backend/tests/integration/test_publication_review_closure.py

cd frontend
npm run api:check
npm exec -- vitest run src/features/product-facts/ProductFactsPage.test.tsx
npm run typecheck
```

后端集成测试需要 `PARTSIGNAL_TEST_DATABASE_URL`，若环境未配置导致 skip，必须明确报告，不能把 skip 当作通过。

## 可选全量验证

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_review_closure.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app

cd frontend
npm run lint
npm test
```

完整集成文件、全后端 mypy 和全前端测试可能受当前工作区其他未提交改动影响；只有证据表明失败由 DEF-02 修改引起时才纳入本任务修复。

## 验证结果

- PostgreSQL：目标版本边界及相邻既有审核链共 `3 passed`。
- 后端契约测试：`1 passed`；Ruff 通过；`backend/app/services/review.py` 定向 mypy 通过。
- 前端：`ProductFactsPage.test.tsx` 共 `8 passed`；TypeScript、定向 ESLint、OpenAPI 类型一致性检查通过。
- 全后端 mypy 使用 `backend/pyproject.toml` 中的 Pydantic、SQLAlchemy 插件和第三方类型 override 检查 67 个源文件，通过且无错误。
- `git diff --check` 与 Trellis 任务校验通过。

## 风险与回滚点

- `backend/tests/integration/test_publication_review_closure.py` 已有用户未提交的 GEO 测试改动；只在事实审核测试区域做局部追加，绝不覆盖或提交该现有改动。
- `contracts/openapi.yaml` 的描述变化需要重新生成 TypeScript 契约，生成后检查仅有预期注释差异。
- 若发现仓库外调用方依赖旧产品累计语义，停止实施并报告；不得增加兼容分支。
