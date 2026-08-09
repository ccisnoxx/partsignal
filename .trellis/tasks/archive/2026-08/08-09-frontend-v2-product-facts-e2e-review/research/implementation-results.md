# 实施与验证结果

## 1. 交付结果

- `deploy/scripts/e2e-local.sh` 在原有独立 PostgreSQL、seed、FastAPI、Worker、临时对象存储与 trap cleanup 生命周期中新增 V2 production build/preview，并把 Product Facts gate 放在 V1 suite 之前，避免既有 V1 失败跳过新增门禁。
- `product-facts-real-stack.spec.ts` 只使用原生 Playwright；业务 mutation 全部操作 V2 页面，测试 API 只登录和读取最终投影，没有 `page.route`、fixture 或逐记录清理器。
- Flow A 与 Flow B 在真实 PostgreSQL、FastAPI 和 V2 production artifact 上均通过。每次运行都删除进程唯一测试数据库与临时对象存储，4174 preview 也已关闭。
- 唯一产品代码重构是把 `confidentialityRegistry` 收敛到现有 `product.model.ts`，删除 Fact Review 第二 mapping；没有新增抽象层或通用 framework。

## 2. Flow 证据

### Flow A

UI 完成 create → enter/save → submit → review/approve → Product Detail → immutable Fact Version Detail。最终只读 API 断言 `primary_task=CREATE_CONTENT_TASK`，页面 handoff 精确为 `/content/tasks/new?productId=<productId>`，并验证批准版本只读且没有编辑或审核命令。

### Flow B

UI 完成 create → enter/save/submit v1 → request changes → revise/save/resubmit v2 → approve。页面分别显示 `FactVersion v1` 与 `FactVersion v2`；v2 审核历史不含 v1 提交摘要或退回意见。最终 review context 中每条 `review_history.target_id` 都等于 v2 ID，动作序列为 `submit-review`、`approve`。

## 3. Required validation

| 检查 | 结果 |
| --- | --- |
| `sh -n deploy/scripts/e2e-local.sh` | 通过 |
| `npm --prefix frontend-v2 run lint` | 通过 |
| `npm --prefix frontend-v2 run typecheck` | 通过 |
| `npm --prefix frontend-v2 run test -- src/domains/product` | 11 files / 63 tests 通过 |
| `npm --prefix frontend-v2 run build` | 通过；仅保留既有 chunk-size warning |
| `make contract-check` | 通过 |
| `PARTSIGNAL_TEST_DATABASE_URL=... pytest backend/tests/integration/test_product_detail.py -q` | 5 tests 通过；首次只设置 `DATABASE_URL` 时明确 skip，已按测试合同纠正 |
| 隔离真实栈目标运行 | V2 Flow A/B 2/2 通过；轻量 V1 `trusted-types.spec.ts` 7/7 通过；database/storage cleanup 通过 |
| `npm --prefix frontend-v2 run e2e` | 65 通过、4 个 real-stack 预期 skip、1 个既有 Products 桌面键盘菜单失败 |
| `git diff --check` | 通过 |

默认 V2 fixture suite 的唯一失败是 `products-list.spec.ts:117`：桌面项目对“更多操作”按钮发送 Enter 后没有出现 menu；同一 mobile 项目通过。失败路径未被本 Task 修改，trace 中列表、搜索和按钮均正常，故未修改产品代码或测试，也未以重复运行掩盖结果。

首次运行完整 V1 suite 得到 48 通过、4 失败，分别位于 AI channel management、跨页 visual inventory、Dashboard GEO clearance 与 V1 MVP delete 状态断言；均不在本 Task 修改范围。该证据促使 V2 gate 前置，但没有修复或跳过 V1 失败。

`make verify` 属于 optional full-suite，本次未运行：required checks 已覆盖新 harness、Product domain、合同、PostgreSQL 服务边界和真实业务闭环；现有 V1/V2 全套失败已保留原始证据。

## 4. Vertical slice abstraction review

- Query keys、generated OpenAPI DTO、API error mapping 与 Product action registry 仍各有单一来源。
- 六个 Product 页面继续消费服务端 `primary_task`、`available_actions` 与 canonical response，没有按 status、数量或正文推导业务资格。
- Design System 未混入 Product token、权限或状态机；现有 `TableShell`、`WorkspaceShell`、`DetailSection` 已覆盖稳定纯 UI，不新增 Table/Review/VersionDetail framework。
- 未发现兼容 fallback、重复 DTO、手写 OpenAPI 类型或页面级 API join。
- 唯一稳定重复是 Confidentiality label mapping，已通过删除第二 mapping 收敛；其余候选没有足够证据，不实施。

## 5. Exit gate

`CREATE_CONTENT_TASK` 的服务端 token 与 Phase 3 handoff href 已由真实 V2 闭环证明；本 Task没有实现或点击不存在的 Content Task UI。Fact History 仍无列表 query、route 与 page，Product Detail 不能替代历史扫描，建议后续独立 Task `frontend-v2-fact-history`。因此本 Task 交付完成，但 Phase 2 exit gate 仍为 `NOT_MET`。
