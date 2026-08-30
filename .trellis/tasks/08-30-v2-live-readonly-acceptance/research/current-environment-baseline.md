# 当前环境只读基线

## 采集时间与范围

- 日期：2026-08-30（Asia/Shanghai）。
- 范围：任务规划前的无认证只读探测与仓库证据核对。
- 未执行：Playwright、登录、业务写入、SSH、部署、服务器修改。

## 当前公开探测

```text
https://geo.962850.xyz/                  200 text/html
https://geo.962850.xyz/login             200 text/html
page title                               PartSignal Frontend V2
https://geo.962850.xyz/api/health/live   200 application/json
live body                                {"status":"ok","checks":null}
https://geo.962850.xyz/api/health/ready  200 application/json
ready body                               {"status":"ok","checks":{"postgresql":"ok","redis":"ok"}}
```

该探测只证明采集时的公开可达性，不证明浏览器 UI、登录后业务、异步服务、AI/OSS 或 Production Observation 通过。

## 已记录部署身份

依据 `.trellis/tasks/archive/2026-08/08-30-hostdzire-v2-production-execution/research/development-rebuild-execution.md`：

- release：`mvp-20260830-133651-a663bcce`；source commit：`a663bcce9fd49da9c5aea7f257372fc318447234`。
- `.env.staging -> /root/partsignal/shared/.env.staging`。
- 七个容器属于 `partsignal-staging`；Frontend 与 fake OSS 运行。
- 最近公网证据只包括 live、ready、首页、`/products` 和前端标题。
- Nginx target 仍为 `partsignal-staging.conf`，没有 write/reload。
- Production A2/manifest/quarantine/rollback 与 Production Cutover/Observation 不在该执行范围内。

因此当前任务默认将目标称为“公网 V2 Staging/预发布运行态”。若执行前出现新的 Production 完成证据，需先更新 PRD/设计并重新经过规划审阅，不能在执行中静默改口径。

## 现有测试资产

- `frontend/tests/e2e/` 当前有 46 个 `*.spec.ts`，约 212 个 `test(...)` 声明。
- `frontend/playwright.config.ts` 当前使用 Desktop Chrome 的 375×900 与 1440×1000 项目。
- fixture-based spec 会拦截 API；real-stack spec 依赖本地隔离 PostgreSQL、Redis、FastAPI、Worker 和 fake provider。
- 这些资产是用例与风险线索，不能替代当前公网真实网络证据。

## 当前工作区保护边界

任务创建前已有 5 项与本任务无关的未提交 Trellis 变化：

```text
M  .trellis/tasks/archive/2026-08/08-30-hostdzire-v2-production-execution/research/authorization-packages.md
?? .trellis/tasks/archive/2026-08/08-30-hostdzire-v2-production-execution/research/package-a1-exact.md
?? .trellis/tasks/archive/2026-08/08-30-hostdzire-v2-production-execution/research/package-a1-execution.md
?? .trellis/tasks/archive/2026-08/08-30-hostdzire-v2-production-execution/research/package-a2-exact.md
?? .trellis/tasks/archive/2026-08/08-30-hostdzire-v2-production-execution/research/step2-source-freeze.md
```

本任务不得修改、删除、提交或把这些文件归入自己的产物。
