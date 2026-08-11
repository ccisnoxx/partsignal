# 精确失败复现与根因

## 基线

- 日期：2026-08-11
- 分支：`main`
- HEAD：`8c95e6230eec9dc5b4d1961f9dd494d6a818eb52`
- 会话起始状态：主工作目录位于干净的 `main`，无活动 Trellis Task。
- 复现时状态：已创建本规划 Task；除未跟踪的 Task 产物外，源码、配置与运行环境相对上述 HEAD 未变化，尚未运行 `task.py start` 或创建分支。

## 精确复现

只运行一次：

```bash
npm --prefix frontend-v2 run test -- src/app/layout/app-shell.test.tsx
```

结果：

```text
Test Files  1 failed (1)
Tests       1 failed | 4 passed (5)
Duration    1.80s

FAIL  src/app/layout/app-shell.test.tsx > AppShell > 由 match metadata 激活父级导航并生成详情面包屑
TestingLibraryElementError: Unable to find role="heading" and name "产品详情"
at src/app/layout/app-shell.test.tsx:73
```

同一失败在相关代码或环境改变前不再运行。

## 根因

1. 测试在 `app-shell.test.tsx:71` 进入 `/products/router-foundation`，因此使用真实生成 route tree，而不是 Router mock。
2. Product Detail route 在 `$productId.tsx:12-16` 调用 `productDetailQueryOptions(params.productId)` 并启动 prefetch。
3. query function 在 `product.api.ts:71-85` 请求 `GET /api/v1/products/{product_id}/detail`；当前测试没有提供 `api.GET` 替身，`src/test/setup.ts` 也没有全局网络成功替身。
4. `ProductDetailPage` 在 `product-detail-page.tsx:71-107` 必须等该 query 成功后才渲染详情内容；因此测试先在加载/失败路径被阻断，无法证明 route 已完成加载。
5. 详情成功态的 `h1` 是产品型号（`product-detail-page.tsx:135-143`），而“产品详情”是 eyebrow 与 route breadcrumb。补齐响应后，完成加载应由 fixture 产品型号 heading 证明；“产品详情”继续由 breadcrumb 断言证明。

根因属于测试环境未随真实 route loader 演进而补齐数据边界，不是 Product Detail production code、loader 或 AppShell metadata 逻辑缺陷。

## 既有模式

`frontend-v2/src/domains/product/product-detail-page.test.tsx` 已采用：

- `components['schemas']['ProductDetail']` 约束 fixture；
- `vi.spyOn(api, 'GET')` 局部替身；
- `{ data, response: Response.json(data) }` 成功响应；
- 精确 endpoint 与 path 参数断言。

该模式可直接在 AppShell 测试内最小复用；现有 unit fixture 未导出，E2E fixture 属于不同测试层，因此不为单个用例建立共享 fixture framework。
