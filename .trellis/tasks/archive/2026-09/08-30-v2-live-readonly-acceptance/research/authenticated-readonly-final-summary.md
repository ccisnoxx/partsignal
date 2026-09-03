# 波次 2 最终补测摘要

## 结果

Run `20260830-195237-v2-auth-final` 在权威目标 `https://geo.962850.xyz` 使用独立会话 `v2-auth-final-195237` 完成一次获授权登录，并补齐波次 2 的系统用户、系统审计、代表性 Reload/Back/Forward、账户菜单、375×900 工作台/产品/系统审计和移动导航证据。

执行时间为 2026-08-30 19:52:37–19:59:40（Asia/Shanghai）。

波次 2 状态为 `FAIL`，不是 `BLOCKED`：范围已得到结果，但存在 P1-002 Query Topic 422、P2-001 移动触控目标不足和 P2-003 移动系统审计空态偏出初始视口。真实业务详情因列表为空且没有安全 ID，按边界记为 `NOT_APPLICABLE`。

波次 3 在本次浏览器 run 收口时因缺少运行态直接关联证据而为 `BLOCKED` 且零写入。2026-08-30 20:12:24（Asia/Shanghai），经用户另行授权的 `ssh hostdzire` 只读核验已把公网域名、当前启用的 Staging Nginx upstream、运行中 frontend 容器、Compose project、release、image ID 与 source commit 直接关联，R10 Staging 正面门禁后续转为 `PASS`。没有创建 TEST registry、TEST 对象或清理残留，波次 3 尚未开始。

## 当前运行事实

- `/api/v1/auth/me`：HTTP 200、ADMIN、未强制改密。
- `/system/users`：2 个启用账号；安全搜索进入空态并可重置，未截图、未导出、未打开管理动作。
- `/system/audit`：默认最近三天 0 条；刷新、Reload、Back/Forward 通过。
- 桌面账户菜单：Escape 关闭并恢复焦点。
- 375×900：工作台、产品、系统审计无页面级横向溢出；移动导航完整并可用 Escape 关闭。
- Query Topic：首次加载与一次重试均为 GET 422，请求标识 `1651e80e-3374-4b48-891b-376c546fadfc`。
- 移动产品控件多为 28–32px 高；移动系统审计的 349px 滚动容器承载 832px 空态单元格，提示偏出初始视口。
- 可观察 console 只有两次已归因 Query Topic 422；CLI 未提供本轮可独立汇总的 `pageerror`、`requestfailed`、`securitypolicyviolation` 列表，这些事件级检查保持 `NOT_RUN`。
- 会话已精确关闭；收口 `browsers=[]`、`servers=[]`。
- 两份包含内部账号标识的自动 YML 临时快照已永久删除，复扫 CLI 临时目录后没有内部账号标识残留。

## 证据

- 完整报告：`artifacts/deployed-acceptance/20260830-195237-v2-auth-final/acceptance-report.md`
- 桌面审计：`screenshots/01-system-audit-1440.png`
- 移动工作台：`screenshots/02-workbench-375.png`
- 移动导航：`screenshots/03-mobile-nav-375.png`
- 移动产品：`screenshots/04-products-375.png`
- 移动审计：`screenshots/05-system-audit-375.png`
- Query Topic 422：`screenshots/06-geo-topics-retry-1440.png`

## Staging 门禁后续结果

获授权的只读核验已建立 `geo.962850.xyz → partsignal-staging.conf → partsignal_staging_frontend:19080 → partsignal-staging/frontend 容器 → mvp-20260830-133651-a663bcce image/current/source` 的直接证据链，R10 为 `PASS`。核验没有读取或输出 `.env`、环境变量、凭据、Cookie、Token、证书私钥、请求头或其他秘密，也没有执行任何服务器或业务写入。完整证据见 `research/staging-runtime-identity-gate.md`。

波次 3 当前为 `READY`、尚未开始；P1-002 仍独立阻断 Query Topic 分支。
