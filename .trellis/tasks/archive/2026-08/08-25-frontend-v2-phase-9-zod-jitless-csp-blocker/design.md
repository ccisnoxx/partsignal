# Frontend V2 Phase 9 Zod jitless CSP blocker 设计

## 1. 设计结论

唯一 production 修复位于 `frontend-v2/src/main.tsx`：入口先加载 Zod 并同步执行 `z.config({ jitless: true })`，随后再动态导入 `AppProviders` 并渲染应用。这样无需新增 runtime wrapper，也不会让任何 route/domain 页面成为全局 validation runtime 的第二 owner。

```text
main.tsx 模块求值
→ Zod 模块加载（只定义缓存，不读取 allowsEval.value）
→ z.config({ jitless: true })
→ import('./app/providers')
→ router / routeTree / domain schema 初始化
→ allowsEval 首次读取时直接返回 false
```

仅把 `z.config` 写在当前静态 import 列表之后不成立：ES module 会先求值所有静态依赖，当前 `AppProviders` 依赖图会在 `main.tsx` body 运行前初始化应用 schema。动态导入是最小且确定的时序边界。

## 2. 根因与权威 owner

Zod 4.4.3 的对象 schema 初始化读取缓存型 `allowsEval.value`；其 getter 在 `globalConfig.jitless` 为假时执行 `new Function("")`。严格 CSP 的 Trusted Types enforcement 会在该动作发生时报告违规，异常随后被 Zod 捕获也不能撤销浏览器事件。

该行为影响全部 V2 Zod schema，不属于 LoginPage。应用入口是唯一能在 route/domain 模块加载前统一配置 validation runtime 的 owner。

## 3. 浏览器回归

复用 `frontend-v2/tests/e2e/auth-session.spec.ts`，不新增 fixture framework 或独立 orchestration：

1. 从 `deploy/nginx/partsignal-security-headers.conf` 解析唯一 production CSP；解析失败显式终止测试加载。
2. `page.addInitScript` 在 document 创建前登记 `securitypolicyviolation` listener。
3. document route 使用真实 production artifact response，仅增加权威 `content-security-policy` header；API 继续复用现有匿名 Auth fixture。
4. 导航 `/login`，断言登录页 heading、用户名、密码和 submit button 可见、可编辑或可用。
5. 断言全部 violation 数组为空，且 `console.error` 与 `pageerror` 数组为空。

Playwright 配置现有 `webServer` 会先 `npm run build` 再启动 `vite preview`，因此该用例验证真实 production artifact，而不是 dev server 或 dev-only CSP。

## 4. CSP 与兼容性

- 不修改 Nginx snippet、CSP 校验脚本、Trusted Types policy 或 Markdown sanitization owner。
- `jitless` 只关闭 Zod JIT schema compilation；schema API、表单校验结果、服务端权威校验和错误合同保持不变。
- production chunk 仍可能包含受保护的 `Function("")` 分支；验收目标是入口配置保证页面初始化不执行该 probe，不通过字符串删除冒充行为修复。

## 5. 回滚

回滚仅需撤销 `main.tsx` 的入口配置/动态加载与 Auth CSP 回归。CSP 和部署文件从未改变，无需部署或数据回滚。
