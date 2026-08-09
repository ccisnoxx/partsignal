# 实施计划

## 执行顺序

- [x] 再次确认 active task、临时分支与干净基线；读取本 Task artifacts 和前端相关 specs。
- [x] 在 `contracts/openapi.yaml` 补齐 getFactVersion 错误响应；同步两套 generated types，扩展 backend contract test。
- [x] 在 Product API query key/factory 增加 exact FactVersion query。
- [x] 新增专用 readonly Detail page：header、snapshot、metadata、timeline、导航、loading/error/refetch/mismatch。
- [x] 新增 thin TanStack route，并由 Router plugin 更新 generated route tree。
- [x] 添加组件测试，扩展 generated-type Products Playwright fixture，新增目标 production-artifact spec。
- [x] 更新 Frontend V2 页面蓝图与测试验收文档；显式保留 Fact History gap。
- [x] 运行 required validation；加载 `trellis-check` 做全范围检查并修复 attributable findings。
- [x] 检查最终 diff、禁止范围、依赖方向、generated drift、注释/开发者可见中文与 Git 状态。

## 预计文件

合同与生成物：

- `contracts/openapi.yaml`
- `backend/tests/unit/test_contract.py`
- `frontend/src/shared/api/schema.d.ts`
- `frontend-v2/src/shared/api/generated/schema.d.ts`

Frontend V2：

- `frontend-v2/src/domains/product/product.api.ts`
- `frontend-v2/src/domains/product/fact-version-detail-page.tsx`（新增）
- `frontend-v2/src/domains/product/fact-version-detail-page.test.tsx`（新增）
- `frontend-v2/src/routes/_app/products/$productId_.facts_.versions_.$versionId.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（生成）
- `frontend-v2/tests/e2e/fixtures/products.fixture.ts`
- `frontend-v2/tests/e2e/fact-version-detail.spec.ts`（新增）
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`

Product Detail、Fact Review、Fact Workspace 源码不计划修改。

## Required validation

```bash
make contract-generate
npm --prefix frontend-v2 run api:generate
make contract-check
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py -q
npm --prefix frontend-v2 run test -- src/domains/product/fact-version-detail-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/fact-version-detail.spec.ts
git diff --check
```

目标 Playwright 必须覆盖 Product Detail 点击、direct、refresh、immutable Markdown、approved/pending/changes-requested、product mismatch、loading、404、403、generic retry、375/768/1024/1440、keyboard/focus 及 console/pageerror/requestfailed/未声明 API 审计。

## Optional full-suite validation

```bash
make test-unit
make test-integration
make e2e
make verify
```

只有共享合同发布门禁或用户明确要求时运行完整套件；它们不授权实现 Phase 2.8。

## Review gates

- 无新 endpoint/read model/client join/依赖/全局状态/通用 renderer。
- 不显示或推导任何 FactVersion command。
- mismatch 在任何 snapshot 内容渲染前阻断。
- generated OpenAPI types 与权威合同一致。
- Product Detail 现有链接仍由已有测试保护，无无关业务修改。
- Fact History 列表只记录 gap，不实施。

## Git 与交付

- 实施分支固定为 `codex/frontend-v2-fact-version-detail`，base 为 `main`。
- 不自动 push。提交、归档、合并、删除临时分支前先按 `AGENTS.md` 给出 commit plan 并取得用户确认。
