# 技术设计

## 1. Invariant 与 owner

- `FactVersion.revision` 与状态转换由 backend `transition_fact_version` 在行锁内最终裁决。
- Fact Review 页面只把当前 canonical target 的 revision 放入命令；409 不自动重放，只展示服务端错误并 refetch 产品级 review context。
- fixture E2E 负责 production artifact 的 UI/request/refetch 语义；real-stack E2E 负责 PostgreSQL/FastAPI 的真实 conflict 与最终状态。两层证据互补，不互相冒充。

## 2. Fixture 场景的最小修正

现有失败不是 production defect，而是测试先更新 fixture canonical context，再打开确认 Dialog。由于 query 在 window focus 时总是 refetch，页面可能在 mutation closure 建立前读取 revision 1。

只调整顺序：

1. 以 revision 0 workspace 导航并打开批准 Dialog；
2. Dialog 已可见后，把 fixture GET 的后续 canonical response 改为 revision 1；
3. 点击确认，mutation 仍使用当前渲染 target 的 revision 0；
4. fixture 返回 409，页面 refetch 并采用 revision 1。

不改 fixture handler、模式枚举、业务响应或断言强度。

## 3. Real-stack conflict flow

```text
V2 UI create/save/submit
  -> V2 Fact Review GET (revision 0 cached in page)
  -> real API REQUEST_CHANGES(expected_revision=0)
       -> server canonical CHANGES_REQUESTED/revision 1
  -> stale V2 UI APPROVE(expected_revision=0)
       -> server 409 REVISION_CONFLICT
  -> page records request ID and refetches review context
       -> UI + final API remain CHANGES_REQUESTED/revision 1
```

- 并发写入用现有 authenticated `page.request` 与 generated request/response types；它是制造独立写入者的窄前置，不在测试中实现状态转换。
- 用浏览器 request listener 只记录 approve endpoint 的次数、非敏感 body 和 CSRF header 是否存在的布尔值；断言恰好一次，证明没有 replay。
- 捕获该 approve response，断言 409/error code/request ID；UI 使用同一 request ID，最终 GET 验证状态/history/正文。
- real-stack 模式继续由 Playwright config 统一 `trace: off`；不记录登录 body、密码、cookie 或完整 headers。

## 4. 定向 real-stack runner

现有 `deploy/scripts/e2e-local.sh` 是唯一 PostgreSQL/Redis/storage/process/cleanup owner，但只能运行完整 real-stack + V1 suite。为遵守 blocker 的定向验证边界，增加一个可选变量：

```text
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/product-facts-real-stack.spec.ts
```

- 未设置：完全保留当前 V2 spec 列表、V1 build/dev/preview/suite 和 `make e2e` 行为。
- 已设置：仍执行 preflight、独立 DB、migration、seed、V2 production build/preview、API/依赖服务和完整 cleanup；只把该文件传给 V2 Playwright，不构建/启动/运行 V1，也不运行其他 V2 specs。
- 目标文件不存在或 Playwright 失败：保留非零退出码并执行同一 cleanup。
- 不新增 Make target、脚本、数据库、端口、process owner 或参数 parser。

该变量只用于独立 blocker 诊断，不能作为 Phase 7 Exit Gate 的完整证据；最终 recheck 仍使用未设置变量的 `make e2e`/`make verify`。

## 5. 依赖与修改边界

```text
fact-review.spec.ts
  -> existing products.fixture.ts (unchanged)

product-facts-real-stack.spec.ts
  -> V2 UI + real API + generated schema
  -> existing e2e-local.sh isolation owner

e2e-local.sh optional selector
  -> existing processes/database/storage cleanup (unchanged owner)
```

不修改 `fact-review-page.tsx`、`product.api.ts`、backend、OpenAPI、Playwright config 或 Makefile。

## 6. Rollback 与停止条件

- 回滚单位是 fixture 的顺序调整、一个 real-stack test、runner 的可选分支和对应 infra spec；默认完整 gate 路径不得受影响。
- 若真实 stale approve 未返回 409，先保存 status/error code/request body/final context 的非敏感证据并停止；不得改 backend 或前端来迎合测试。
- 若定向模式无法在不复制 cleanup owner 的前提下实现，停止并报告 runner blocker，不创建第二脚本。
