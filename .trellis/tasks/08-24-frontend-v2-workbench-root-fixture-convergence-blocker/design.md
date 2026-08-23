# Frontend V2 Workbench Root Fixture Convergence 技术设计

## 1. 设计结论

不改产品。真实根路由依赖 `GET /api/v1/workbench` 已是已交付合同；修复测试 owner 的输入合同即可。

```text
Vitest App Shell owner
  / -> Workbench GET -> 本地 typed minimal aggregate
  /products -> Product GET -> 本地 typed ProductList

Playwright production-artifact owners
  workbench.fixture.ts::emptyAggregate
                 | same runner import
       +---------+----------+
       |                    |
  Auth fixture        Platforms fixture
  exact GET /workbench exact GET /workbench
                           |
                 Prompt fixture inheritance
```

不新增 shared data framework、builder class、route helper 或 wildcard handler。

## 2. Data Ownership

### Vitest

`app-shell.test.tsx` 自己拥有最小 `WorkbenchAggregate` 和 ProductList。原因：该 harness 只验证 App Shell navigation/focus；导入 `tests/e2e/fixtures/workbench.fixture.ts` 会把 Playwright runner 模块和 fixture lifecycle 引入 Vitest，是错误边界。

最小 aggregate 仍必须完整表达 generated required fields：六类 zero counts 及其合法 links、四域 `CLEAR` health、固定 window、三项 `0/0/null` rate、空 recent items。使用 `satisfies components['schemas']['WorkbenchAggregate']`，不使用 `as never` 掩盖 fixture shape。

### Playwright

复用 `workbench.fixture.ts` 现有 `emptyAggregate`。只扩大一个测试数据常量的 export，不改变 Workbench fixture 本身。Auth 与 Platforms 都处于同一 Playwright runner，直接复用不会形成跨 runner 依赖，也比复制两份 aggregate 更小、更不易漂移。

## 3. Endpoint Dispatch

### App Shell unit

mock 必须以 OpenAPI path 为分支：

```text
/api/v1/workbench -> WorkbenchAggregate
/api/v1/products  -> ProductList
otherwise         -> explicit Error
```

不根据调用顺序返回不同 shape，不对任意 GET 返回固定成功，不添加 fallback。

### Auth / Platforms

在各自已有 `page.route('**/api/v1/**')` 中，认证 handler 之后、unexpected 分支之前增加：

```text
method === GET && pathname === /api/v1/workbench
  -> 200 + emptyAggregate
```

handler 不接受 query alias、其他 method 或相邻 endpoint。原 501 与 teardown arrays 不变。

## 4. Fixture Inheritance

`prompt-workspace.fixture.ts` 通过 `import { test as base } from './platforms.fixture'` 并在 auto fixture 中消费 `platformsApi`，因此 Platforms catch-all 是根 `/api/v1/**` 的权威 owner。Prompt-specific routes 使用更窄的 route patterns并 `fallback()`；无需再声明 Workbench handler。

此设计避免 Prompt 与 Platforms 各保存一份 allowlist，也保留 `prompt-workspace.spec.ts` 从 `/` 经真实 App Shell 主导航进入页面的测试价值。

## 5. Compatibility / Non-Changes

- API、generated types、Workbench UI、route loader、query key、Auth/session、Prompt/Platform 产品行为全部不变。
- unexpected API 501、runtime errors、secret scan、trace policy、mobile/desktop projects 全部不变。
- 不修改 `prompt-workspace.spec.ts`、`prompt-workspace.fixture.ts`、Playwright config 或 npm scripts。
- A26 不兼容处理、不忽略、不缓解；Phase 8 Gate 仍为 `NOT_MET`。

## 6. Rollback

实施未涉及持久化、合同或产品代码。若候选失败，只用 `apply_patch` 反向撤销四个测试文件的本任务精确 hunks；Task artifacts 保留失败证据并回到 planning。不得使用 `git reset --hard`、`git checkout --` 或历史改写。
