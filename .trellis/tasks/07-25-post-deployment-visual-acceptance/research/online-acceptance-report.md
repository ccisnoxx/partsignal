# 线上部署后视觉验收报告

## 结论

最新复验结果为“修复 release 部署通过、三项缺陷均通过线上几何复验、内容审核页仍因数据缺失未验证”，尚不能关闭任务。

首次检查发现线上 release `mvp-20260724-225411-da0b391f20eb` 早于视觉系统提交。经用户授权，已按 Runbook 将预发布切换到 `mvp-20260725-132132-bee2ef4a69a`，精确对应已推送的 `bee2ef4a69a629bae1e76710ec6f7c43c14441aa`，其中包含视觉系统工作提交 `2f00036`。部署、健康、缓存、认证和 12 个可访问页面的运行信号均正常。

随后按用户授权将 `main@ad46f5e9201af1d046c702b71e09c4e924660910` 完整部署为 `mvp-20260725-160540-ad46f5e9201a`。三项缺陷均已在真实公网 Chromium 中复验通过；但已认证 API 与 PostgreSQL 强制只读查询均确认当前没有内容版本，因此仍无法完成内容审核页验收。按 Runbook 未提前更新 `current`，其仍指向最后已完整验收的 `bee2ef4` release。

## 修复复验

- 验收时间：2026-07-25 16:05 CST 起
- 运行 release：`mvp-20260725-160540-ad46f5e9201a`
- 完整 Git 提交：`ad46f5e9201af1d046c702b71e09c4e924660910`
- 数据库备份：`/root/partsignal/backups/partsignal-20260725T080559Z.sql.gz`
- 公网 live/ready、首页、SPA fallback、主资源 `/assets/index-DK8pBprs.js` 缓存、对象存储代理、Nginx 与容器健康均通过。
- AI 渠道：1440×1000 下测试状态右边界 `953` 小于操作区左边界 `987`，表格宽度 `631/631`、文档宽度 `1440/1440`；375×844 下文档 `375/375`，表格内部滚动 `630/323`，更多操作可见。
- 指标卡：用户和平台各 5 张卡在 375px、320px 下均无图标与标题/数值相交，页面无横向溢出。
- 移动触控：总览和用户管理在 375px、768px 下的导航、主题和默认 Drawer 关闭按钮均至少 `44×44`，Drawer 保持 `280px`，Escape 后焦点正确恢复。
- 稳定复验的 console `error/warning=0`、`pageerror=0`、`requestfailed=0`；未运行写入型公网 E2E、未修改业务数据或线上配置、未保存线上截图或 trace。
- 内容数据：`GET /api/v1/content-tasks` 返回 0 项；PostgreSQL 强制只读查询 `content_versions` 无记录，当前不存在可提供的 `contentVersionId`。

## 执行环境

- 预发布 URL：`https://geo.962850.xyz`
- 验收时间：2026-07-25 13:21–14:03 CST
- 本地及远端 `main`：`bee2ef4a69a629bae1e76710ec6f7c43c14441aa`
- 视觉系统工作提交：`2f00036`
- 当前 release：`releases/mvp-20260725-132132-bee2ef4a69a`
- 浏览器：Chromium/Chrome 149–150
- 主视口：1440×1000，浅色
- 补充场景：1440×1000 深色和跟随系统、1024×1000、375×812、真实 tab zoom 200%

## 部署与公网资源

- `readlink /root/partsignal/current` 返回新 release；`2f00036` 是 `bee2ef4` 的祖先。
- 发布前创建了非空数据库备份，执行默认 full 部署；迁移停在预期的 `0024_audit_outcome`。
- API、Worker、Scheduler、PostgreSQL、Redis 健康，Nginx 配置校验通过。
- `./deploy/scripts/smoke.sh https://geo.962850.xyz` 通过，live 和 ready 均为 `ok`。
- 首页与 SPA fallback 返回 `200`、`Cache-Control: no-cache`。
- 实际 JS `index-B1c7FCdJ.js` 与 CSS `index-CTfahKTw.css` 返回 `200`、一年 immutable、`Vary: Accept-Encoding` 和 gzip。
- `https://geo.962850.xyz/object-storage/` 返回应用层 `404 application/json`，未出现代理层 `502`。

## 页面覆盖

以下 12 页在 1440×1000 浅色下完成复核，均为 `document.scrollWidth/clientWidth = 1440/1440`：

- 总览 `/`
- 用户管理 `/users`
- GEO 分析洞察 `/observations/insights`
- 审计日志 `/audit`
- 发布账号 `/settings?tab=accounts`
- Prompt 管理 `/configuration/prompts`
- 平台规则 `/configuration/platform-rules`
- 平台管理 `/configuration/platforms`
- GEO 观测 `/observations`
- 发布管理 `/publications`
- AI 渠道与模型 `/configuration/ai`
- 内容任务 `/tasks`

这些页面的共享 208px 侧栏、64px 顶栏、20px 桌面内容边距、标题层级、玻璃壳层、高不透明度数据面、圆角、边界、阴影和状态色总体一致。动态业务数据为空或与批准图不同，只影响内容密度，不作为视觉偏差。

三张可访问锚点 `/`、`/users`、`/observations/insights` 已补查：

- 深色与跟随系统：语义颜色、边界和表面层级正常。
- 1024×1000：无页面级横向溢出；宽表滚动位于表格内部。
- 375×812：内容边距 12px，Drawer 几何为 280px，无页面级横向溢出。
- 真实 200%：`chrome.tabs.getZoom()` 返回 `2`；CSS 视口为 720×500，页面宽度为 `720/720`，关键标题、导航和操作入口可达。

## 运行信号

- 12 页稳定主巡检：console `error/warning=0`、`pageerror=0`、`requestfailed=0`、非预期 HTTP `4xx/5xx=0`。
- 375px 和真实 200% 主场景同样为零异常。
- 快速路由几何复核出现过导航离页导致的 `net::ERR_ABORTED`，仅涉及取消的预取静态块或只读 GET；稳定主验收未复现，无 HTTP 错误响应、console 或 pageerror。
- 安全登录成功，`/api/v1/auth/me` 返回 `200`；密码只进入 Playwright 内存，未输出、截图或写入文件。

## 问题清单

### 已修复并复验：AI 渠道表格“测试状态”与固定“操作”列重叠

- 页面：`/configuration/ai/channels/:channelId`
- 条件：1440×1000，浅色，右侧详情面板打开。
- 实际：测试状态单元格和固定操作单元格均从 `x=979` 开始；测试状态控件与操作控件相交约 `48.3×27px`。
- 期望：高密度表格列保持清晰稳定，操作按钮不覆盖状态信息。
- 责任层：AI 渠道表格固定右列宽度或 sticky/fixed 列定位。

### 已修复并复验：用户管理移动端指标图标覆盖标题和数值

- 页面：`/users`
- 条件：375×812，浅色。
- 实际：五张指标卡保持两列布局，但图标圆形与标题、数值占用同一区域，出现明显文字覆盖。
- 期望：指标卡在窄屏下保持可读的信息层级；图标、标题和数值不得重叠。
- 责任层：用户管理指标卡的 375px 响应式布局。

### 已修复并复验：共享移动端关键触控目标不足

- 页面：三个可访问锚点的 375px 与 200% 场景。
- 实际：移动导航按钮和主题按钮为 `36×40 CSS px`；移动 Drawer 关闭按钮为 `24×24 CSS px`。
- 期望：`.trellis/spec/frontend/visual-system.md` 要求移动关键目标至少 `44×44 CSS px`。
- 责任层：共享移动顶栏和 Drawer 关闭按钮尺寸。

### 未验证：内容审核详情缺少既有对象

- 页面：`/content/:contentVersionId`
- 只读请求：`/api/v1/content-tasks?page=1&page_size=100` 返回 `200` 和空 `items`。
- 契约只允许从内容任务枚举其内容版本，没有独立枚举内容版本的入口。
- 影响：该页的 1440×1000 浅色、主题、1024px、375px 和真实 200% 均未验证。
- 责任层：预发布验收数据，不是已证实的前端视觉或部署问题。

## 安全与残余风险

- 除用户批准的新 release 创建、full 部署和 `current` 原子更新外，未修改 Nginx、共享环境文件、业务配置或业务数据。
- 未点击任何新建、保存、提交、批准、退回、删除、启停或测试连接操作；未运行公网纵向 E2E，未创建或更新视觉 snapshot。
- 所有临时浏览器 profile 和认证状态均已删除。主验收会话已正常登出；两个诊断会话在异常路径中未完成服务端 logout，但其本地 token/profile 已销毁，服务端会话按配置最长约 8 小时过期。
- 线上数据为空导致无法验证真实高密度内容下的截断、分页、抽屉和图表表现；当前结论只覆盖已实际渲染状态。
- 三项视觉缺陷已修复并在线上通过；剩余阻断仅为内容审核页缺少现有内容版本。
