# 修复移动端触控目标与审计空态布局

## 目标与用户价值

修复公网 V2 验收确认的两个独立 P2 移动端可用性缺陷：`P2-001` 登录页四个关键控件在 320px/375px 视口仅 32px 高，低于项目规定的 44×44 CSS px 触控目标；`P2-003` 系统审计空结果在 375px 视口仍按 52rem 宽表格居中，导致提示偏出初始可见区域。

修复后，移动用户无需精细点按即可完成登录，并能在打开系统审计空结果时立即看到状态与恢复动作；桌面密度、业务行为、权限与数据合同保持不变。

## 已确认事实

- 已归档公网验收记录证明 `/login` 的用户名、密码、显示密码和登录按钮在 320px/375px 均为 32px 高；P2-001 的可定位范围是登录页，不泛化为全站所有链接、菜单项或业务控件。
- `LoginPage` 直接复用默认 32px 的 `Input`/`Button`。调用方 class 经 `tailwind-merge` 可安全覆盖高度，因此无需改变共享 primitive 的全局默认尺寸。
- `SystemAuditPage` 已为表格提供 `audit-list-table` 局部 class。共享 `.ps-table` 的 `min-width: 52rem` 使七列空态单元格按约 832px 宽度居中，而移动端 TableShell 初始可见宽度约 349px。
- 项目已有 Platform、AI Channel 与 User 列表按 feature table class 在移动端收窄表格的模式；审计页可复用相同所有权边界，无需改变 `TableShell` 或 `EmptyTable` 公共 API。
- 本任务使用本地 fixture 驱动的 production-artifact Playwright 验证，不登录公网、不复用或修改旧管理员密码。

## 范围内要求

### R1 登录页移动触控目标

- 仅调整 `/login` 的用户名输入、密码输入、显示/隐藏密码按钮和登录提交按钮。
- 在 320px 与 375px 视口，上述四类关键控件的可点击/可编辑边界高度必须至少为 44 CSS px。
- 在 `md` 及以上保留既有 32px 紧凑高度，不修改全局 `Input`/`Button` primitive 默认尺寸。
- 保留现有字段标签、校验、焦点顺序、密码可见性、pending 禁用和提交 payload 行为。

### R2 系统审计移动空态

- 仅通过 `audit-list-table` 的移动布局规则收窄系统审计表格；不得取消 `TableShell` 的局部横向滚动合同，也不得全局改变 `.ps-table` 或 `EmptyTable`。
- 在 320px 与 375px 视口，筛选空结果的标题、描述和重置动作必须在 TableShell 初始水平可见区域内呈现，无需先横向滚动。
- 非空列表继续保留七列表头、移动端既有列隐藏规则、行级详情交互和桌面布局。
- 页面根不得产生横向溢出。

### R3 回归证据

- 使用现有 auth fixture 和 system audit fixture；不得新增公网凭据、真实登录或业务写入依赖。
- Playwright 必须直接读取 rendered bounding box/region 几何来证明 44px 触控高度与空态初始可见，不以 jsdom class 断言替代浏览器几何。
- 保留现有登录和审计组件行为测试，并运行相关 frontend lint、typecheck、production build/preview E2E。

## 非目标

- 不修复或复验 `P2-004` Prompt 名称编辑保存状态；该问题由独立且未启动的 `09-03-platform-prompt-name-save-state` 处理。
- 不创建或启动 `integrity-error-domain-mapping`。
- 不把触控目标修复扩大到全站筛选、分页、菜单项、业务链接、强制改密或账户安全页面。
- 不修改 backend、OpenAPI、generated client、数据库合同、业务 HTTP 行为、权限、事务或状态转换。
- 不部署、不登录公网、不修改旧管理员密码，也不执行线上验收。

## 验收标准

- [x] 320px 与 375px 下，登录页用户名、密码、显示/隐藏密码和登录按钮的 rendered height 均 `>= 44` CSS px。
- [x] 768px 与 1440px 下，登录页上述控件保持既有 32px 紧凑高度。
- [x] 登录校验、密码显示切换、pending 禁用、错误呈现和 exact `LoginRequest` 提交行为继续通过现有测试。
- [x] 320px 与 375px 下，系统审计筛选空态的标题、描述和重置按钮均位于 TableShell 初始水平可见区域内，表格不再以 52rem 空态宽度把内容居中到视口外。
- [x] 系统审计页面根无横向溢出；非空七列、筛选、分页、详情、权限和错误恢复行为继续通过现有测试。
- [x] 变更仅落在登录页局部样式、审计 feature-table 移动规则及对应测试；没有公共 primitive API、合同、generated、backend 或业务设计文档变化。
- [x] Required Validation 全部实际通过；未运行的 optional suites 明确记录为 `NOT_RUN`，不得写成通过。

## 约束与风险

- 44px 是移动触控目标而非全断点统一高度；断点 class 必须显式恢复桌面高度，防止不必要的密度回归。
- 审计空态缺陷属于 TableShell 内部几何，单纯断言页面根无溢出无法捕获；回归必须比较空态内容与 region 的真实矩形。
- 若局部 class 无法在 production build 中覆盖 primitive，或审计局部 table 规则破坏非空列表可达性，应停止扩大修改并更新设计，不得转为全局 primitive/TableShell fallback。
