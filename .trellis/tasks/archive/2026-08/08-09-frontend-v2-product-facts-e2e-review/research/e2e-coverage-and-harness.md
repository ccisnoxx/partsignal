# Product Facts E2E 覆盖与 Harness 审计

## 1. 当前覆盖矩阵

现有 `frontend-v2/tests/e2e` 共 33 个 Playwright 用例：1 个 Foundation smoke 与 32 个 Product domain 页面用例。所有 V2 Product 用例都通过 `products.fixture.ts` 的 `page.route('**/api/v1/**')` 返回 generated-type fixture；fixture 顶部也明确声明“隔离真实后端，不代表完整业务 E2E”。

| 页面 / 边界 | 现有文件 | 用例数 | 已覆盖 | 真实栈缺口 |
|---|---|---:|---|---|
| App Shell / production artifact | `foundation-smoke.spec.ts` | 1 | `npm run build` + `vite preview`、375/1440、静态资源与匿名 auth fixture | 不连接真实 FastAPI |
| Products List | `products-list.spec.ts` | 5 | URL search/filter/sort/page、Back/Forward、primary/overflow、loading/empty/error、keyboard、四档宽度 | 列表投影与 action token 均由 fixture 生成 |
| New Product | `new-product.spec.ts` | 6 | 表单、trim、CSRF body、pending、结构化错误、DirtyGuard、canonical navigation、375/1440 | POST 与后续详情/list 均为 fixture |
| Product Detail | `product-detail.spec.ts` | 6 | 单 detail endpoint、summary、Activity、primary/overflow、更新/删除、错误、四档宽度 | 无真实 PostgreSQL 聚合或批准后投影 |
| Fact Workspace | `fact-workspace.spec.ts` | 6 | 单 read model、save、submit、revision conflict、DirtyGuard、只读状态、四档宽度 | 不创建真实不可变 FactVersion |
| Fact Review | `fact-review.spec.ts` | 5 | 单 context、Diff、目标历史、APPROVE/REQUEST_CHANGES、409、错误、四档宽度 | mutation 只更新 fixture 内存对象 |
| Fact Version Detail | `fact-version-detail.spec.ts` | 4 | 单 version endpoint、readonly、归属阻断、状态、错误、四档宽度 | 不读取真实已批准快照 |
| Flow A | 无 | 0 | 无 | create → save → submit → approve → immutable detail → `CREATE_CONTENT_TASK` 未跨页验证 |
| Flow B | 无 | 0 | 无 | request changes → revise → resubmit → approve 与版本专属 history 未跨页验证 |

## 2. Fixture 与真实栈边界

### Fixture-based tests 继续负责

- 页面级 loading、empty、404、403、409、503 与 retry UX。
- URL 规范化、Back/Forward、refresh、direct URL、keyboard/focus。
- 375/768/1024/1440 响应式矩阵。
- 精确 request body、CSRF、`expected_revision`、未声明 API 失败。
- 单页面只消费规定 read model，不发生客户端 API join。

### 新真实栈 E2E 只负责

- 页面之间的业务推进和服务端 canonical 状态转换。
- 真实 PostgreSQL 中 FactVersion 不可变、退回后新版本与 review history 归属。
- 批准后 Product 服务端投影为 `primary_task=CREATE_CONTENT_TASK`。
- V2 页面生成 `/content/tasks/new?productId=...` 交接链接，并能从 Product Detail 打开批准版本 readonly Detail。
- production build artifact 跨域连接真实 FastAPI；不重复 fixture 已覆盖的错误矩阵或四档响应式。

业务主流程不得使用 `page.route`、`route.fulfill` 或页面本地固定状态。测试 API 只用于建立登录会话和读取最终服务端投影。

## 3. 现有真实栈证据

- `deploy/scripts/e2e-local.sh:19-71` 创建进程唯一 PostgreSQL 数据库，迁移并在退出时统一 drop；同时创建唯一临时对象存储目录并清理。
- `deploy/scripts/e2e-local.sh:72-115` seed、启动 FastAPI/Redis worker/本机替身、V1 dev + production preview，并运行 V1 Playwright。
- `frontend/tests/e2e/mvp-flow.spec.ts:16-24` 已验证真实登录和 CSRF；`:305-362` 通过 V1 UI 创建产品并审核，但 facts save/submit 使用 `page.request`，不能替代 V2 主流程。
- `frontend/tests/e2e/mvp-flow.spec.ts:245-258,458-459` 使用批准事实和真实 API 创建内容任务，证明后端允许交接；这不是 V2 Content Task UI E2E。
- `backend/tests/integration/test_product_detail.py:429-612` 在临时 PostgreSQL 上验证 review context、退回、修订、重提、批准和目标版本专属历史。
- `backend/tests/integration/test_product_detail.py:616-740` 验证 save/submit revision、pending snapshot 不随 workspace 后续修改和 retired 门禁。
- `backend/tests/unit/test_workflow_projections.py:113-141` 验证批准事实投影为 `CREATE_CONTENT_TASK`。

## 4. 最小 Harness 调整

只扩展现有入口，不创建第二套 orchestration：

1. `deploy/scripts/e2e-local.sh`
   - 保留现有独立数据库、migration、seed、服务启动与 cleanup。
   - 将 FastAPI CORS 增加 `http://127.0.0.1:4174`，保留 V1 `5173`。
   - 用 `VITE_API_BASE_URL=http://127.0.0.1:8000` 构建 `frontend-v2/dist`。
   - 在 4174 启动 `vite preview`，登记独立 PID，ready probe 与 cleanup 都覆盖它。
   - 在同一数据库生命周期内运行新增真实栈 spec；现有 V1 E2E 继续运行。
2. `frontend-v2/playwright.config.ts`
   - 默认行为保持：自行 build + preview，运行现有 fixture tests。
   - 仅当脚本显式传入 V2 external base URL 时，复用已启动的 4174 preview，不再启动第二个 `webServer`。
3. `frontend-v2/tests/e2e/product-facts-real-stack.spec.ts`
   - 使用 `@playwright/test` 原生 API；不导入 `products.fixture.ts`。
   - 仅在显式 real-stack 环境变量开启时运行；默认 V2 fixture 门禁中标记 skip。
   - 通过 `page.request.post(http://127.0.0.1:8000/api/v1/auth/login)` 建立共享 browser-context cookie；业务步骤全部通过 V2 页面。
   - 使用 `randomUUID()` 后缀；不实现逐记录清理，依赖数据库统一销毁。

## 5. Makefile 结论

`make e2e` 已先调用 `deploy/scripts/e2e-local.sh`，再运行 V2 默认 Playwright；只要真实栈 spec 由脚本显式开启、默认运行时跳过，Makefile 无需修改。`make verify` 已依赖 `e2e`，因此不增加新 target。

## 6. Harness 风险

- V2 production artifact 以 4174 为 origin、API 为 8000，需要同时验证 CORS credentials 与 host-only session cookie 能跨端口发送。
- real-stack 模式必须禁止 Playwright 再启动默认 4174 `webServer`，否则端口冲突。
- cleanup 必须覆盖 V2 preview PID；即使 V2 测试失败也必须 drop 独立数据库。
- 新 spec 默认必须 skip，否则现有 fixture-only `npm --prefix frontend-v2 run e2e` 会错误依赖真实后端。
