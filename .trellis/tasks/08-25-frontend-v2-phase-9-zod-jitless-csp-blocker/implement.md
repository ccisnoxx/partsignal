# Frontend V2 Phase 9 Zod jitless CSP blocker 实施计划

## 状态

- [x] 确认起点为干净 `main`。
- [x] 创建 Trellis Task 与唯一临时分支 `codex/frontend-v2-phase-9-zod-jitless-csp-blocker`。
- [x] 核对上一 Task、权威 CSP、入口依赖图、Zod 4.4.3 实现/类型和当前 production chunk。
- [x] 形成可 review 的 `prd.md`、`design.md`、`implement.md` 与研究证据。
- [x] 用户批准最新规划后启动 Task。
- [x] 实施、验证与自审。
- [ ] 主会话展示 commit plan 并等待用户确认。

## 实施步骤

1. 先运行当前 production-artifact CSP 回归，复现匿名 `/login` 的 TrustedScript/security policy violation，并记录它与 Zod probe 的对应证据。
2. 修改 `frontend-v2/src/main.tsx`：同步调用 `z.config({ jitless: true })` 后才动态加载并渲染 `AppProviders`；保留全局样式与 StrictMode。
3. 修改 `frontend-v2/tests/e2e/auth-session.spec.ts`：复用权威 CSP 读取、document header 注入和 violation 监听模式，新增匿名登录 production-artifact 回归。
4. 运行 targeted Playwright，确认两个 project 均通过，且登录页可用、CSP/TrustedScript/console/page error 均为零。
5. 运行 typecheck、lint、production build 与安全头校验；检查最终 artifact 中配置调用及 schema chunk 的受控 probe 顺序。
6. 检查 diff、Task artifacts、禁止模式和 touched-scope 中文文档；不修复范围外失败。
7. 展示精确 commit plan，等待用户确认；不自动 commit/push/merge/archive。

## Expected Files

- `frontend-v2/src/main.tsx`
- `frontend-v2/tests/e2e/auth-session.spec.ts`
- `.trellis/tasks/08-25-frontend-v2-phase-9-zod-jitless-csp-blocker/*`

不预期修改 LoginPage、Vite 配置、CSP、安全脚本、依赖锁文件或任何 backend/contract/deploy 文件。

## Required Validation

```sh
npm --prefix frontend-v2 run e2e -- tests/e2e/auth-session.spec.ts
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
node deploy/scripts/check-nginx-security.mjs
git diff --check
python3 -m json.tool .trellis/tasks/08-25-frontend-v2-phase-9-zod-jitless-csp-blocker/task.json >/dev/null
python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-zod-jitless-csp-blocker
```

production artifact 额外只读检查：定位最终入口、Zod/schema chunks，确认 `jitless` 配置在应用模块动态加载前执行；浏览器回归作为“不执行 Function/eval probe”的最终行为证据。

## Optional Validation

- 无。此次只改 V2 入口与其 Auth production-artifact owner；不运行完整 V1/V2 E2E、backend suite 或 `make verify`，除非 targeted evidence 显示共享边界漂移。

## 风险与停止条件

- 若当前浏览器基线无法复现，先核对 production CSP 注入、artifact 与监听时序，不根据 chunk 名直接实施。
- 若 `z.config` 无法在应用 schema 前执行，停止并重新审查模块图；不得增加 CSP fallback 或页面局部 hack。
- 若 required check 出现与本 diff 无关的失败，完成归因并报告，不扩展到其他 Phase 9 owner。

## 回滚点

代码回滚边界仅为 `main.tsx` 与 Auth CSP 回归；任务文档保留根因与验证记录。无数据库、远程环境或部署状态变化。

## 实施结果

- 失败基线：仅加入回归、未修改入口时，mobile/desktop 均失败，各记录一条 `require-trusted-types-for: trusted-types-sink`。
- 入口修复：`main.tsx` 同步执行 `z.config({ jitless: true })`，然后动态导入 `AppProviders`。
- 浏览器回归：Auth production artifact 在 mobile/desktop 共 4 个用例通过；新用例确认登录表单可编辑且 CSP violation、`console.error`、`pageerror` 均为 0。
- 静态门禁：V2 typecheck、lint、production build 与 Nginx 安全头校验全部通过。
- 产物时序：最终入口中 `jitless:!0` 先于动态 `import("./providers-….js")`；`Function("")` 仅保留在 schema chunk 的 `jitless` 短路分支后。
- Spec 评估：现有 frontend quality spec 已覆盖 production artifact、CSP/Trusted Types 和 runtime error 门禁；版本特定的 Zod 4.4.3 根因与入口时序保留在本 Task 证据中，不重复写入稳定 spec。
