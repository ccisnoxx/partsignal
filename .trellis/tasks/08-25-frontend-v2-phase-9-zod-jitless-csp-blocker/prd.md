# Frontend V2 Phase 9 Zod jitless CSP blocker

## 目标

在不改变生产 CSP 与 Trusted Types 策略的前提下，关闭 Frontend V2 匿名 `/login` 初始化期间由 Zod eval feature probe 触发的 TrustedScript P1，并以真实 production artifact 浏览器回归证明登录页可见、可用且无 CSP 或运行时错误。

## 背景与已确认事实

- 上一 Task 已固定并激活 V2 candidate；HTTP Gate=`MET`，Browser Gate 因匿名 `/login` 的 TrustedScript error 为 `NOT_MET`，open P0/P1/P2=`0/1/0`。
- Staging 错误来源为 `/assets/schemas-C9kTthWC.js`；当前本地 production build 生成同名 chunk，包含 Zod 4.4.3 的 `Function("")` feature probe。
- 当前安装的 Zod 4.4.3 公开暴露 `z.config({ jitless: true })`；`jitless` 为 `$ZodConfig` 的正式字段。
- Zod `allowsEval.value` 是首次读取后固定结果的缓存；未启用 `jitless` 时会执行 `new Function("")`，严格 CSP 即使捕获异常仍会产生 `securitypolicyviolation`。
- 当前入口静态依赖为 `main.tsx → AppProviders → router → routeTree.gen → route/domain schemas`，因此配置必须先于整个应用模块图的 schema 初始化。
- 权威生产 CSP 位于 `deploy/nginx/partsignal-security-headers.conf`，明确禁止 `unsafe-eval`，并保留 `trusted-types dompurify; require-trusted-types-for 'script'`。

## 范围内要求

1. 使用当前安装版本公开支持的 `z.config({ jitless: true })`，不得修改、fork 或 patch Zod。
2. 配置由 V2 应用入口统一持有，并确定性早于 `AppProviders` 及其路由/domain schema 模块求值；不得放入 LoginPage 或其他单页 owner。
3. 保持生产 CSP、安全头、Trusted Types allowlist 和现有 Markdown sink owner 原样。
4. 扩展既有 V2 Auth production-artifact Playwright owner，直接读取权威 Nginx CSP 并注入 document response。
5. 回归在首次导航前监听 `securitypolicyviolation`，同时监听 `console.error` 和 `pageerror`；匿名访问 `/login` 后证明标题、用户名、密码和登录按钮可见可用。
6. 回归必须断言 CSP violation、TrustedScript error、console error 与 pageerror 均为零，不得增加忽略名单或削弱已有 runtime error 断言。
7. 最终 production build 必须核对 Zod probe 仍受 `jitless` 保护，且应用初始化顺序先配置、后加载 schema；浏览器回归是“不执行 probe”的权威行为证据。

## 验收标准

- [x] 根因由已安装 Zod 源码、当前入口依赖图、production chunk 和浏览器复现共同确认，不根据 chunk 文件名推断。
- [x] `z.config({ jitless: true })` 位于 V2 应用入口，并在动态加载 `AppProviders` 之前同步执行。
- [x] 匿名 `/login` 在两个现有 Playwright project 的 production artifact 上可见可用。
- [x] 注入权威 production CSP 后，`securitypolicyviolation=0`、TrustedScript error=`0`、`console.error=0`、`pageerror=0`。
- [x] targeted Auth Playwright、V2 typecheck、lint 和 production build 通过。
- [x] production artifact 检查确认应用初始化不再触发 `Function`/eval probe。
- [x] `deploy/nginx/partsignal-security-headers.conf` 与 `deploy/scripts/check-nginx-security.mjs` 无修改，且安全脚本继续通过。
- [x] 自审无局部 LoginPage hack、CSP 放宽、全局 monkey patch、node_modules 修改、错误忽略或范围外业务/部署变更。

## 不在范围

- 不添加 `unsafe-eval`，不删除 `require-trusted-types-for 'script'`，不放宽 `trusted-types` allowlist，不创建任意脚本 Trusted Types policy。
- 不 monkey-patch `globalThis.Function`，不修改 `node_modules`，不 fork/patch Zod。
- 不修改 backend、OpenAPI、数据库、migration、部署拓扑、业务页面或现有认证行为。
- 不执行 SSH、Staging 写操作、重新部署、更新 `current`、fallback/restore、legacy routing、production-like rehearsal 或其他 Phase 9 Task。
- 不自动 push、合并 `main`、提交、归档或开始下一 Task；提交前单独展示 commit plan 并等待确认。

## 阻塞问题

无。用户已明确目标、技术约束、验收边界和禁止项。
