# 审计记录

## 1. 结论

Fact Review runtime 与 backend revision owner 正确，不需要产品修正。当前 blocker 由两部分组成：fixture 测试没有稳定制造旧 revision，以及 real-stack Product Facts 缺少真实 stale command → 409 → canonical refetch 证据。

最小关闭方式是修正 fixture 场景的时序，并在现有 `product-facts-real-stack.spec.ts` 增加一个真实冲突场景。为遵守“只运行该 E2E”，扩展唯一 `e2e-local.sh` 支持单 V2 spec 诊断；不创建第二套环境或 cleanup。

## 2. 已观测失败与根因

- Parent System audit 保存的实际证据：`make e2e` 中 Fact Review mobile/desktop 都发送 `expected_revision: 1`，而 `fact-review.spec.ts:130-134` 仍期待 `0`。
- `fact-review.spec.ts:118-125` 在 navigation 后立即把 fixture GET 的 canonical revision 改为 1，随后才在 `:127-128` 打开 Dialog并确认。
- `productFactReviewQueryOptions` 设置 `refetchOnWindowFocus: 'always'`；因此测试环境允许页面在 mutation 前读取新 fixture context。这解释了 actual 1，且不表示 production 把 revision 推导错了。
- 把 fixture revision 更新移到 Dialog 已打开之后，可确保本次 mutation closure 来自 revision 0 渲染，同时保留 409 后 GET 返回 revision 1 的 UI 证据。

## 3. 权威 owner

- `frontend-v2/src/domains/product/fact-review-page.tsx:119-130`：APPROVE/REQUEST_CHANGES 均直接使用当前 target 的 `fact_version.revision`。
- `frontend-v2/src/domains/product/fact-review-page.tsx:155-162`：`REVISION_CONFLICT`/`INVALID_STATE_TRANSITION` 只标记 stale 并 refetch，不 replay mutation。
- `backend/app/services/review.py:283-309`：server 锁定 FactVersion，先比较 revision，不匹配即 `409/REVISION_CONFLICT`；成功才转换状态并递增 revision。
- `backend/tests/integration/test_product_detail.py:692-696`：现有 PostgreSQL integration 已证明 stale 409 与 request-changes 后 canonical revision 1。
- `frontend-v2/tests/e2e/fixtures/products.fixture.ts:485-503`：strict fixture 已记录命令 body/CSRF，并能返回明确 409；无需增加新的 fixture mode 或复制 backend 逻辑。

## 4. 当前测试边界

- `fact-review.spec.ts` 已覆盖 request ID、单命令记录、refetch 和 revision 1 UI，但当前 setup 时序使 stale body 断言不稳定。
- `product-facts-real-stack.spec.ts:68-125` 已有可复用的 UI create/save/submit/list/review helpers；Flow A/B/C 覆盖成功批准、退回修订和 Content Editor，没有 409 场景。
- 已归档 `frontend-v2-fact-review` 明确要求“409 不自动重试、显示 request ID、刷新 canonical context”；`frontend-v2-product-facts-e2e-review` 又明确 fixture 不替代真实 PostgreSQL/FastAPI 状态转换。
- Session memory 没有发现新的产品决定；当前任务沿用已归档 owner 和用户本轮明确范围。

## 5. Real-stack 最小场景

1. 用 V2 UI 创建唯一产品、保存事实并提交审核。
2. 从 Products List 打开 Fact Review，读取并保留 revision 0 的不可变正文与 target ID。
3. 使用同一真实 session/CSRF 对 target 执行一次 API `REQUEST_CHANGES(expected_revision=0)`，取得 `CHANGES_REQUESTED/revision 1`；这是模拟另一个写入者的唯一 API mutation。
4. 原页面点击 APPROVE，捕获唯一 POST，断言 body revision 0 与真实响应 `409/REVISION_CONFLICT/request_id`。
5. 断言页面 refetch 后无陈旧动作并展示最新状态；最终真实 GET 的 revision/history/body 与并发 canonical response 一致，且没有 approve record。

该场景不使用 `page.route`、`route.fulfill`、数据库直写、service helper 或手写状态计算。

## 6. Runner 审计

- `.trellis/spec/infra/e2e-isolation.md:21-38` 要求真实栈复用唯一 `e2e-local.sh` 的独立 DB、Redis、storage、process 和 cleanup owner。
- `deploy/scripts/e2e-local.sh:134-154` 当前硬编码全部 V2 real-stack specs，随后总是运行 V1；没有符合本 blocker“只运行该 E2E”的入口。
- 新建第二脚本会复制环境和清理 owner。一个 optional `PARTSIGNAL_E2E_V2_SPEC` 分支是最小机制：定向模式仍走同一 lifecycle，默认 unset 路径保持完整 gate。
- 该变量属于开发测试配置，必须同步 infra spec，并明确 targeted PASS 不能替代未设置变量的 `make e2e`/`make verify`。

## 7. 敏感信息与 artifact

- `frontend-v2/playwright.config.ts` 在 `PARTSIGNAL_E2E_REAL_STACK=1` 时统一 `trace: off`。
- 新 request listener 只记录 approve endpoint 的次数、`{expected_revision, comment}` 和 CSRF header 是否存在的布尔值，不记录 login body、password、cookie、CSRF 原值、Authorization 或完整 headers。
- 使用既有 `reporter: list`、`.cache/playwright-results` 和 cleanup；不新增 screenshot/video/attachment/report 输出。

## 8. 排除项

- 不改 `fact-review-page.tsx`、`fact-review.model.ts`、`product.api.ts`、backend integration 或 OpenAPI。
- 不新增 retry、wait/sleep、fixture business transition、real-stack flow framework 或第二 orchestration。
- 不把 fixture 409 和 real-stack 409 合并成一个测试：前者证明 UI contract，后者证明服务端 authority。
