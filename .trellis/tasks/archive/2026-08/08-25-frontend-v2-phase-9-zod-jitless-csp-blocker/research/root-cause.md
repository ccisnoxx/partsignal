# Zod jitless / Trusted Types 根因证据

## 已观察行为

- 上一归档 Task 的真实 Staging Browser Gate 在匿名 `/login` 首次加载时记录：`This document requires 'TrustedScript' assignment. The action has been blocked.`，来源 `/assets/schemas-C9kTthWC.js`。
- 当前本地 `npm --prefix frontend-v2 run build` 成功后生成同名 `schemas-C9kTthWC.js`，其中可见受缓存保护的 `Function("")` probe；这把 Staging 行为与当前安装代码对应起来，但最终归因仍以下述 Zod 源码为准。

## 已安装 Zod 4.4.3

- `frontend-v2/node_modules/zod/v4/core/core.d.ts`：`$ZodConfig` 正式声明 `jitless?: boolean`，`config(newConfig?: Partial<$ZodConfig>)` 为公开 API。
- `frontend-v2/node_modules/zod/v4/core/core.js`：global config 存在 `globalThis.__zod_globalConfig`，`config()` 通过 `Object.assign` 同步更新该唯一对象。
- `frontend-v2/node_modules/zod/v4/core/util.js`：`allowsEval` 是首次访问后以自有 `value` 固定结果的缓存；getter 先检查 `globalConfig.jitless`，否则执行 `new Function("")`。
- `frontend-v2/node_modules/zod/v4/core/schemas.js`：对象 schema 初始化读取 `util.allowsEval`，并通过 `jit && allowsEval.value` 决定 fast path。

结论：根因不是 chunk 命名或 LoginPage 渲染器，而是 Zod object schema 首次初始化在 `jitless` 尚未配置时读取 `allowsEval.value`。

## 应用入口时序

当前 `main.tsx` 静态导入 `AppProviders`；后者静态导入 router，router 导入 `routeTree.gen.ts`，route tree 连接 login 与大量 domain route/schema。production `index-yCpPSAMt.js` 也静态导入 `schemas-C9kTthWC.js`。

ES module 在执行 `main.tsx` body 前先求值静态依赖，因此仅在现有 import 列表之后增加 `z.config(...)` 不能形成确定的前置条件。最小确定方案是让 `main.tsx` 只静态加载 Zod/React 基础入口，先同步配置 `jitless`，再通过 `import('./app/providers')` 启动应用模块图。

## CSP owner

`deploy/nginx/partsignal-security-headers.conf` 当前唯一 CSP 为：

```text
default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; trusted-types dompurify; require-trusted-types-for 'script'
```

`deploy/scripts/check-nginx-security.mjs` 已明确拒绝 `script-src 'unsafe-eval'` 和项目安全头漂移。本 Task 不修改这两个 owner。

## 本地行为复现与修复证据

- 在仅加入 production artifact 回归、未配置 `jitless` 时，mobile/desktop 均捕获到 `require-trusted-types-for: trusted-types-sink`，回归按预期失败。
- 入口改为先 `z.config({ jitless: true })` 后动态加载 `AppProviders` 后，同一回归在两个 project 中均通过，违规与运行时错误均为 0。
- 最终 production 入口产物明确包含 `jitless:!0` 后才动态导入 `providers-*.js`；schema chunk 中保留原生 `jitless` 短路与 `Function("")` probe，证明修复依赖公开配置时序，而非删改依赖或字符串。
