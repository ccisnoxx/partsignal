# 实施计划

## 1. 执行顺序

- [x] 用户确认本计划后运行 `task.py start`，重新确认分支、task artifacts、相关 specs 与工作树状态。
- [x] 扩展 `deploy/scripts/e2e-local.sh`：V2 CORS、production build/preview、ready probe、目标 Playwright invocation 和 cleanup。
- [x] 调整 `frontend-v2/playwright.config.ts`，支持复用脚本已启动的 external production preview；默认 fixture 行为不变。
- [x] 新增一个 real-stack Product Facts spec，实现 Flow A/B；业务 mutation 全走 V2 UI，测试 API 只登录和读取最终投影。
- [x] 将 `Confidentiality` label registry 收敛到 `product.model.ts`，删除 Fact Review 第二 mapping；不新增抽象文件。
- [x] 更新直接相关迁移与测试验收文档，明确 Content handoff、Fact History gap 和 Phase 2 gate。
- [x] 运行 required validation；只修复证据表明由本 Task 引入或暴露且属于 Product Facts 的问题。
- [x] 检查最终 diff、禁止范围、中文开发者文本、cleanup 行为和 Git 状态；提交前另行给出 commit plan 等待确认。

## 2. 允许实施的小型重构

- 把 `confidentialityRegistry` 移到现有 Product shared model。
- 让 Product Detail、Fact Workspace、Fact Review、Fact Version Detail 使用同一 mapping。
- 删除 Fact Review 本地 `classificationLabels`。

真实 E2E 若发现 Product Facts 缺陷，只允许修复其权威共享位置并补直接回归；超出预计文件或涉及合同、数据库、权限时先暂停并回报，不自动扩大范围。

## 3. 明确排除项

- 不实现 Content Task route/page，不点击 `/content/tasks/new` 伪造 UI 成功。
- 不实现 Fact History query/route/page，也不创建该后续 Task。
- 不重写 fixture E2E，不复制其 loading、404、响应式与键盘矩阵。
- 不新增 Playwright config、E2E framework、page object、flow DSL 或逐记录清理器。
- 不新增通用 Table、ReviewWorkspace、VersionDetail、状态机、repository 或 service abstraction。
- 不为未来 Content Review 预建任何类型或组件。
- 不修改 OpenAPI、数据库合同、无关 backend、V1 页面、部署流程或依赖；`e2e-local.sh` 的 V2 启动是唯一允许的 deployment 脚本调整。
- 不修改 Makefile，除非实施时发现当前入口与已审计版本不一致并先取得确认。

## 4. 预计修改文件

必需：

- `frontend-v2/tests/e2e/product-facts-real-stack.spec.ts`（新增）
- `frontend-v2/playwright.config.ts`
- `deploy/scripts/e2e-local.sh`
- `frontend-v2/src/domains/product/product.model.ts`
- `frontend-v2/src/domains/product/product-detail.model.ts`
- `frontend-v2/src/domains/product/fact-workspace-page.tsx`
- `frontend-v2/src/domains/product/fact-review-page.tsx`
- `frontend-v2/src/domains/product/fact-version-detail-page.tsx`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- 本 Task 的 `prd.md`、`design.md`、`implement.md` 与 `research/*.md`

不预计修改：

- `Makefile`
- `contracts/openapi.yaml`
- `contracts/database.md`
- `backend/**`
- `frontend/**`
- `frontend-v2/src/routeTree.gen.ts`

## 5. Required validation

```bash
sh -n deploy/scripts/e2e-local.sh
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run test -- src/domains/product
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e
make contract-check
PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend \
  pytest backend/tests/integration/test_product_detail.py -q
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  REDIS_URL=redis://127.0.0.1:56379/9 \
  deploy/scripts/e2e-local.sh tests/e2e/trusted-types.spec.ts
git diff --check
```

验收重点：

- 默认 V2 E2E 中 real-stack spec 被显式 skip，32 个 Product fixture 用例仍独立执行；本次全套出现 1 个与改动路径无关的既有桌面菜单键盘失败，详见 `research/implementation-results.md`。
- 完整脚本实际运行 V2 production artifact、真实 FastAPI 与进程唯一 PostgreSQL；失败后也删除测试数据库并关闭 V2 preview。
- Flow A/B 的每个业务 mutation 都通过 V2 UI；测试中不存在 Product Facts `page.route`/`route.fulfill`。
- Flow A 验证 approved immutable detail、`CREATE_CONTENT_TASK` 与 handoff href。
- Flow B 验证退回后新 FactVersion 及 target-specific review history。
- PostgreSQL integration test 继续证明服务层版本与历史边界。

## 6. Optional full-suite validation

```bash
make verify
```

只有用户明确要求、准备发布，或 shared gate 证据表明需要全仓验证时运行。Required validation 已覆盖本 Task 的脚本语法、V2 静态门禁、fixture 回归、真实栈 flow、合同 drift 与 PostgreSQL 服务边界。

## 7. 风险与阻塞项

- 跨端口 credential：V2 origin 4174 调用 API 8000，必须以真实登录验证 CORS、cookie 和 CSRF；失败时修正现有测试环境配置，不绕过鉴权。
- 端口/进程冲突：external-base 模式必须关闭 Playwright 内置 webServer，cleanup 必须登记 V2 preview PID。
- 有状态 flow 重复：真实 spec 只运行一个 desktop project，避免两个 project 对同一业务流重复执行。
- 文档 gate 歧义：迁移计划中 Content Task 条件必须区分 Phase 2 handoff 与 Phase 3 UI creation。
- Fact History 是已确认阻塞 Phase 2 全量退出的产品缺口，但不阻塞本 Task 实施；本 Task 完成后仍需独立产品决策与 Task。
- 当前无阻塞本 Task 开始实施的未知合同。若真实 flow 暴露数据库、权限或 public API 变更需求，停止实施并请求确认。

## 8. Phase 2 Exit Gate

规划时判定：`NOT_MET`。

- 本 Task 通过后，只能确认真实 Product Facts Flow A/B 与 Phase 3 handoff 已被 V2 production artifact 验证。
- `/content/tasks/new` 完整 UI 不属于本 Task，也不得计为已完成。
- Fact History 列表未实现且现有 Product Detail 不能替代；该 gap 关闭前不得宣布 Product Facts 或 Phase 2 全部退出条件满足。

## 9. Git 与交付

- 实施分支固定为 `codex/frontend-v2-product-facts-e2e-review`，base 为 `main`。
- 本规划阶段不运行 `task.py start`，不修改业务代码。
- 不自动 commit 或 push。实施验证完成后，先给出 commit plan 并等待用户确认。
