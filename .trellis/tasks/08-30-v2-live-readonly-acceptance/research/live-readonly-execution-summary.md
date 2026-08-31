# 线上只读执行摘要

## Run

- run-id：`20260830-175056-v2-readonly`
- 目标：`https://geo.962850.xyz`
- 时间：2026-08-30 17:50:56–17:56:24（Asia/Shanghai）
- 会话：主执行 `v2-live-readonly-175056`；AC3 复核 `v2-live-readonly-recheck-20260830-ac3`，Chromium，匿名临时 context
- 边界：无凭据、无 storage state、无 mock/route、无业务写入、无 SSH/部署/服务器修改
- 执行前状态：`main...origin/main [ahead 3]`；既有 5 项归档文件变化和本任务目录变化均保留

## 环境

- 首页：HTTP 200，`text/html`，最终 URL `https://geo.962850.xyz/`
- `/login`：HTTP 200，`text/html`，最终 URL `https://geo.962850.xyz/login`
- 标题：`PartSignal Frontend V2`
- `/api/health/live`：`{"status":"ok","checks":null}`
- `/api/health/ready`：`{"status":"ok","checks":{"postgresql":"ok","redis":"ok"}}`
- 可证实身份：release `mvp-20260830-133651-a663bcce`，`.env.staging`，`partsignal-staging`，fake OSS；因此报告口径为公网 V2 Staging/预发布运行态，不代表 Production 通过

## 结果

- canonical `/`、`/products`、`/content/tasks`、`/publishing/work`、`/geo/observations`、`/settings/platforms`、`/system/audit`：匿名 direct/refresh 均安全进入 `/login?redirect=...`，PASS。首轮过渡帧未作为通过依据；独立 AC3 复核等待稳定页面后补齐最终 URL 和登录表单标识。
- legacy `/tasks`、`/observations`、`/configuration`、`/users`、`/audit`：匿名 direct/refresh 均记录原始站内 return-to，PASS；未推断登录后的 canonical 落点。
- 未知 `/__v2-readonly-not-found__`：direct/refresh 均稳定显示明确 404 页面，PASS。
- Back/Forward：代表序列恢复对应安全登录入口，无循环或跨域，PASS。
- 登录页 320/375/768/1024/1440：均无页面级横向溢出，PASS；320/375 关键控件高度均为 32px，低于移动端 44px 合同，`P2-001`。
- 键盘：初始焦点、Tab/Shift+Tab、Enter 空提交、错误焦点、密码显示切换和可访问名称通过，PASS。
- 真实 200%：Chromium `Control+Equal` 未改变 viewport/DPR/visual scale，`NOT_RUN`。
- runtime/network：console 0 messages/errors/warnings；可见静态资源 200，匿名 `/api/v1/auth/me` 为预期 204；CSP 含 `trusted-types dompurify` 和 `require-trusted-types-for 'script'`。CLI 未提供独立 pageerror/requestfailed 列表，相关事件级断言保持 `NOT_RUN`。

## 总体结论

`FAIL（P2）`。主要缺陷为 `P2-001` 移动端登录控件 32px 高度；无 P0/P1，无敏感信息泄露，无匿名写入。登录后业务体验因无安全凭据未覆盖。

## 证据索引

- 报告：`/Users/sc/PycharmProjects/partsignal/artifacts/deployed-acceptance/20260830-175056-v2-readonly/acceptance-report.md`
- 用例结果：`/Users/sc/PycharmProjects/partsignal/artifacts/deployed-acceptance/20260830-175056-v2-readonly/case-results/wave-0-1-results.md`
- 截图目录：`/Users/sc/PycharmProjects/partsignal/artifacts/deployed-acceptance/20260830-175056-v2-readonly/screenshots/`
- 关键截图：`01-login-1440.png`、`02-login-320.png`、`03-login-375.png`、`04-unknown-404.png`
- AC3 补测：`/Users/sc/PycharmProjects/partsignal/artifacts/deployed-acceptance/20260830-175056-v2-readonly/case-results/ac3-recheck-20260830.yml`
