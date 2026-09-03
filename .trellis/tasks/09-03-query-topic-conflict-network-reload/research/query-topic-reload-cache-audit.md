# Query Topic 409 Reload Cache 审计

## 结论

P1 缺口已定位到 Query Topic 页面两个 `reloadCanonical()`：它们都用带 `staleTime: 30_000` 的 `queryTopicsQueryOptions()` 调用 `queryClient.fetchQuery()`。在完整 options cache 仍 fresh 时，该调用可能不发起 GET；同 key 请求已在途时还可能复用点击前请求。调用方随后会把返回值当成显式重新读取成功，解除 `409` 冻结。

最小 owner 是 `query-topic-list-page.tsx` 内由编辑/删除共享的显式 fresh-fetch helper。普通 options query 的 30 秒缓存应保留。

## 代码证据

| 证据 | 位置 | 结论 |
| --- | --- | --- |
| 完整 options query key、GET 与缓存时长 | `frontend/src/domains/geo/geo.api.ts:141-153` | query 定义正确；默认 `staleTime` 不适合作为冲突恢复调用语义 |
| 编辑 reload | `frontend/src/domains/geo/query-topic-list-page.tsx:518-533` | 直接 `fetchQuery` 后重置表单/revision 并清错 |
| 删除 reload | `frontend/src/domains/geo/query-topic-list-page.tsx:699-720` | 直接 `fetchQuery` 后采纳 revision 或 available action 结果 |
| 编辑冲突回归 | `frontend/tests/e2e/geo-topics.spec.ts:113-155` | 只覆盖第一次 cache miss reload |
| 删除冲突回归 | `frontend/tests/e2e/geo-topics.spec.ts:184-208` | 同样未预热完整 options cache |
| 完整 options fixture | `frontend/tests/e2e/fixtures/geo-topics.fixture.ts:185-190` | 当前不记录请求数，也不能注入失败 |
| PATCH/DELETE 409 fixture | `frontend/tests/e2e/fixtures/geo-topics.fixture.ts:214-272` | 已支持 mutation 计数、revision 与冲突状态，可增量扩展 |

## 合同证据

- `contracts/openapi.yaml` 中 `/api/v1/query-topics` 是完整 canonical 列表，`/list-items` 是独立分页 read model；PATCH/DELETE 明确声明 409。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md` 要求 `expected_revision` 冲突后保留本地编辑、不自动重放，只有显式 reload 才恢复 canonical revision。
- `.trellis/spec/backend/available-actions-contract.md` 规定服务端 `available_actions`、revision 和受约束删除结果为最终权威。
- `.trellis/spec/frontend/state-management.md` 规定冲突 reload 失败时即使存在 stale data 也必须保持冻结，不能自动重放 mutation。
- `.trellis/spec/frontend/quality-guidelines.md` 要求 generated-type 严格 fixture、预期 409 UX 与未声明 API 显式失败。

## 已归档基线证据

`.trellis/tasks/archive/2026-09/08-30-frontend-v2-functional-contract-conformance-baseline` 的 conformance matrix 已记录：`/geo/topics` 冲突 reload 可能命中 30 秒 fresh cache。本 Task 只关闭该网络新鲜度缺口。

## 影响面

### 必须覆盖

- 编辑 PATCH 409 的显式 reload。
- 删除 DELETE 409 的显式 reload。
- fresh cache、点击前在途请求、GET 失败、成功恢复和 mutation 无自动重放。

### 明确排除

- Dialog target row snapshot 的 live projection；保留给 `query-topic-dialog-live-projection`。
- backend/OpenAPI/generated client/数据库/业务状态机变化。
- 全局 options cache 调整。
- `integrity-error-domain-mapping`。

## 方案判定

采用“exact cancel + 原 options 定义的单次 `staleTime: 0` fetch”。它以最小页面局部改动同时保证：

1. fresh cache 不能短路显式 reload；
2. 点击前同 key 在途请求不能成为本次采纳结果；
3. query key/query function 仍只有一个 owner；
4. 失败继续走既有 catch，不会用旧缓存恢复；
5. 不改变普通 options 消费者。

实现阶段必须通过当前安装的 TanStack Query 类型与 E2E 请求计数验证这些语义；若库行为与预期不符，停止并重新评估，不添加隐藏 fallback。
