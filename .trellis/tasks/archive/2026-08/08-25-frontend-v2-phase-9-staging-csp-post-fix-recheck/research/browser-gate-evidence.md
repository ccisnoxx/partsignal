# Browser Gate 证据

- 执行时间：2026-08-25 20:25–20:30（Asia/Shanghai）
- 公网目标：`https://geo.962850.xyz`
- 唯一 session：`frontend-v2-p9-staging-csp-post-fix-recheck`
- 固定 release：`mvp-20260825-172239-2a6fd940b848`
- 授权边界：允许 `content_editor` 首次改密、共享 env 原子替换、empty-state 验收调整与完整 Browser Gate；不修改业务数据、`current`、Nginx、容器或 release，不执行 fallback/restore。

## ENGINEER blocker 修复

- 第一次尝试中登录 API 为 200，但自动化在 SPA 跳转完成前读取 URL，未调用改密接口；staged env 已按失败清理合同删除，数据库与权威 env 均未变化。
- 修正等待条件后重新生成 36 位随机密码；浏览器自动化输入侧的旧、新密码只经进程内存与权限 `0600` 的 FIFO 传递，除已授权的远端 staged/权威 env 外，未输出或写入普通文件。
- `content_editor` 登录 200 并进入 `/account/security`；`POST /api/v1/auth/change-password=204`，随后 `/api/v1/auth/me=200`、`account_type=ENGINEER`、`must_change_password=false`。
- 数据库写成功后，将同文件系统、权限 `0600` 且脱敏 checksum 一致的 staged env 通过 `mv -T` 原子替换 `/root/partsignal/shared/.env.staging`。fresh Browser Gate 从更新后的权威 key 重新读取密码，ENGINEER 登录 200，证明数据库与 env 同步。
- 结束时 staged env 文件数为 0；所有 release 的 `.env.staging` symlink 仍指向共享权威 env。

## blocker-specific

- 匿名 `/login` 标题=`PartSignal Frontend V2`，heading=`登录`；用户名与密码输入可见、可编辑，登录按钮可见、可用。
- 匿名 `/api/v1/auth/me=204`。
- `securitypolicyviolation=0`、TrustedScript error=`0`、`console.error=0`、`pageerror=0`、非预期 `requestfailed=0`、失败静态资源=`0`。
- 结论：此前由 Zod schema chunk 触发的 TrustedScript P1 已在真实 Staging Chrome 中关闭，blocker-specific Gate=`MET`。

## 完整矩阵

- ADMIN：登录 200，canonical session=`ADMIN`、`must_change_password=false`，session restore 与 logout 通过。
- ENGINEER：fresh 登录 200，canonical session=`ENGINEER`、`must_change_password=false`；`/settings/ai`、`/system/users`、`/system/audit` 均保持原 URL 并显示服务端权限页，焦点可达；`GET /api/v1/users=403`、code=`PERMISSION_DENIED`；logout 通过。
- 路由：Workbench、Products list/detail/fact、Content list/workspace、Publishing、GEO list/detail、Platform、AI、Users、Audit 全部 pathname/heading/canonical 状态一致，无根横向溢出。
- 无数据条件：Workbench 未发现 attention link，但 canonical empty state=`当前没有需要关注的事项。` 且 `/api/v1/workbench=200`；Publishing 未发现 workspace link，但 canonical empty state=`暂无活动发布工作` 且 `/api/v1/publication-works?page=1&page_size=20=200`。
- History：direct、reload、Back、Forward 均通过。
- Responsive：375 Products list、768 Content list、1024 现有 Content workspace、1440 Workbench shell 全部 main 可见、无根横向溢出、关键交互可达。
- Accessibility：主导航、账户菜单、Tab 键焦点可达；账户菜单关闭后在 500ms 条件等待内恢复焦点。
- Runtime：`securitypolicyviolation=[]`、TrustedScript errors=`[]`、`console.error=[]`、`pageerror=[]`、`requestfailed=[]`、失败资源=`[]`、非预期 HTTP response=`[]`。

结论：完整 Browser Gate=`MET`，open P0/P1/P2=`0/0/0`。

## 清理与 protected state

- 未创建 trace、video、screenshot 或 storage state。专属 session 已关闭；`playwright-cli list --all --json` 确认 browsers=`[]`、servers=`[]`。
- Browser Gate 后生成 `after-browser.txt` 并与 `candidate-protected.txt` 逐字节一致：容器身份、健康状态、restart、DB=`0043_geo_platform_identity`、migrate 集合、Nginx target/checksum 与 `current` 均未漂移。
- `current` 仍为 `releases/mvp-20260806-195740-afb1b8c82f40`；未执行 fallback、restore、Nginx 写入/reload、容器/release 变更或 production 操作。
- HTTP Gate、blocker-specific、完整 Browser Gate 与 protected-state 检查均已通过；用户选择不更新 `current` 并按现状归档，因此最终 Staging Gate=`NOT_MET`。
