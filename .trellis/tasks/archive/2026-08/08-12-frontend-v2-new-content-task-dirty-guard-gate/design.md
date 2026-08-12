# Frontend V2 New Content Task DirtyGuard Gate — Design

## 1. 不变量与所有权

- `DirtyGuard` 仍是共享的真实 navigation blocker，继续覆盖 pathname、search、hash 与 beforeunload。
- `/content/tasks/new` route 拥有 Product 字段到 `productId` search 的 canonical 投影。该投影是同一用户动作的 URL 持久化，不代表离开当前表单，因此只能在这个 route callback 上显式使用 `ignoreBlocker: true`。
- Cancel、用户 Back/Forward、普通链接及成功前的其他导航仍走默认 blocker；不得按 pathname/search 类型做全局豁免。

## 2. 最小数据流

```text
Product Select
  → RHF 更新 product_id，清空 fact_version_id，保留 platform_profile_id
  → route navigate({ search: { productId }, ignoreBlocker: true })
  → canonical search/options 同步完成，不弹 Dialog

Cancel
  → route navigate({ to: '/content/tasks' })
  → DirtyGuard blocked
  → 继续编辑：reset blocker，保留表单/URL并恢复触发器焦点
  → 放弃修改并离开：proceed 到列表

Create success
  → form.reset(values) / 清 idempotency / invalidate lists
  → isDirty=false
  → route navigate canonical Detail
```

使用 TanStack Router 已安装版本的原生 option，不增加 ref、状态位、延迟、第二个 blocker 或 DirtyGuard 公共 API。

## 3. 回归证明

- Component router harness 必须与生产 route 使用相同的单次 `ignoreBlocker` 语义。
- Product URL 用例先让非 URL 字段变脏，再更换 Product；先等待 router search，再断言无 Dialog、Fact 清空、Platform 保留，避免仅依赖调度恰好先完成。
- ErrorSummary/Cancel 用例先完成 canonical search，再点击 Cancel；分别验证 stay 的值/URL/焦点保留和 leave 的列表导航。不得把任意先出现的 Dialog 当作 Cancel 证据。
- 成功创建现有用例继续断言 canonical Detail 与无 Dialog。
- Production-artifact 用例区分两类 search：Product Select 的页面-owned push 不阻断；用户 Back/Forward 是真实 full-URL navigation，应进入 DirtyGuard 决策后再 stay/leave。

## 4. 兼容性与文档

- 不改变 DirtyGuard 公共行为、props 或其他消费者，因此不需要全消费者扩展测试或独立 production build gate。
- 权威 state-management spec 已同时规定 `productId` URL 所有权与 DirtyGuard；本修复使实现与既有合同一致，无需修改业务、API、数据库或设计文档。
- 若 `ignoreBlocker` 无法只作用于该次 canonical navigation，立即停止，不使用共享 search/hash 白名单替代。

## 5. 回滚

改动没有数据或合同迁移。route option、component 回归和同域 Playwright 断言可按同一小组回滚；不得通过回退 `1035878` 削弱 shared full-URL Guard。
