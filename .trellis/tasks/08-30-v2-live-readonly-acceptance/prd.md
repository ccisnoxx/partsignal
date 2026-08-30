# V2 线上 UI/UX、路由与受控业务流程验收

## 目标与用户价值

对 `https://geo.962850.xyz` 当前公开 V2 前端执行波次 0–4 的证据化验收。波次 0–1 已完成环境身份与匿名基线；波次 2 使用用户提供的 ADMIN 凭据执行已认证 UI/UX、路由与安全交互审计；波次 3 只有在重新证明目标仍为 Staging/预发布后，才使用唯一 TEST 前缀执行可精确清理的业务流程；波次 4 只规划高风险、不可逆或外部副作用流程，不在本轮执行。任务不修改产品代码、部署或服务器配置。

本任务不把“页面可打开”等同于系统通过，也不继承历史 Browser Gate 结论。每一项能力只按本轮实际证据判定为 `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN` 或 `NOT_APPLICABLE`。

## 已确认事实

- 用户已同意创建 Trellis 任务，并授权使用项目 `playwright-cli` 的独立 Chromium 会话执行波次 0–1 的只读测试。
- 波次 0–1 已于 run `20260830-175056-v2-readonly` 完成，总体结果为 `FAIL（P2）`：移动端登录用户名、密码、显示密码和登录控件实测高度为 32px，低于项目至少 44px 的触控目标合同；其余已执行匿名检查通过，工具无法证明的项目保持 `NOT_RUN`。
- 用户已提供一组 ADMIN 凭据并要求登录后继续。凭据只允许在内存和本任务临时浏览器会话中使用，不得写入任务文件、报告、截图、命令行历史、日志、storage state 或其他持久化介质。
- 用户已在扩展规划摘要之后明确批准将当前任务扩展为波次 2–4：先执行波次 2，再仅在重新确认目标为 Staging/预发布后执行可回滚的波次 3。波次 4 保持规划态，任何执行都需要新的明确授权。
- 目标入口为 `https://geo.962850.xyz`。2026-08-30 的无认证只读探测显示首页、`/login`、`/api/health/live` 和 `/api/health/ready` 均为 HTTP 200，页面标题为 `PartSignal Frontend V2`。
- 最新已记录部署为 release `mvp-20260830-133651-a663bcce`，使用 `.env.staging`、`partsignal-staging` 容器集合和 fake OSS；最近执行证据没有完成 Production Cutover 或 Observation。依据：`.trellis/tasks/archive/2026-08/08-30-hostdzire-v2-production-execution/research/development-rebuild-execution.md:52-63,86-103`。
- 当前仓库 canonical 前端为 `frontend/`；旧 V1 与 `frontend-v2/` 不是受支持源码入口。依据：`.trellis/spec/frontend/index.md:1-4`。
- 现有 Playwright 配置只声明 Desktop Chrome 的 375×900 与 1440×1000 两个项目；fixture 与隔离真实栈测试不能替代本轮公网真实网络证据。依据：`frontend/playwright.config.ts:7-31`、`docs/deployed-full-functional-acceptance-plan.md:57-66`。
- 当前工作区在本任务创建前已有 5 项与本任务无关的 `.trellis/tasks/archive/...` 未提交变化。本任务必须保留它们，不得修改、提交或混入测试产物。

## 范围内要求

### R1 环境身份与门禁

- 记录测试开始/结束时间、目标 URL、公开 health 响应、页面标题、可见 V2 marker、当前可证实的 release/环境语义及是否处于维护或发布状态。
- 在没有新的 Production Cutover/Observation 证据时，报告必须使用“公网 V2 Staging/预发布运行态”口径，不得写成 Production 已通过。
- 若目标域名、证书、页面身份或连续健康状态与计划不一致，停止浏览器扩展测试并记录 `BLOCKED`。

### R2 独立浏览器与只读边界

- 使用任务专属的非 `default` Chromium 会话；会话名包含本任务标识和 run id。
- 波次 0–1 保持匿名；波次 2 仅允许使用用户提供的 ADMIN 凭据发起一次 `POST /api/v1/auth/login`。登录失败不重试，不猜测或替换凭据。
- 凭据通过不回显的临时进程输入传给浏览器，不出现在 shell 命令参数、文件、截图或工具输出中；不加载或保存 storage state，不创建测试账号。
- 登录后的页面数据请求只能是 `GET`；发现登录以外的业务 `POST`、`PUT`、`PATCH` 或 `DELETE` 时立即停止，不确认弹窗、不重试。
- 不使用 `page.route`、固定成功响应、本地 mock、浏览器扩展注入或页面 DOM 修改来改变线上行为。
- 不执行会产生业务数据、配置变更、外部调用、上传、删除、审核、发布、GEO 纠错或审计写入的动作。
- 不连接 SSH，不修改 Nginx、Compose、数据库、Redis、部署文件或服务器状态。

### R3 匿名访问与路由冒烟

- 验证 `/login`、`/`、`/products`、`/content/tasks`、`/publishing/work`、`/geo/observations`、`/settings/platforms`、`/system/audit` 的 direct URL 与 refresh 行为。
- 验证代表性 legacy 入口 `/tasks`、`/observations`、`/configuration`、`/users`、`/audit` 的匿名重定向链；只记录本轮实际可观察的 return-to，不假设登录后的 canonical 结果。
- 验证一个未知 SPA path 显示明确 404 或按当前认证合同安全落到登录页，不出现空白页、循环重定向或跨域跳转。
- 对可安全执行的代表路径验证 Back/Forward；不得通过登录绕过匿名边界。

### R4 UI/UX 与响应式基线

- 登录页至少覆盖 320×800、375×900、768×900、1024×768、1440×900；记录页面级横向溢出、遮挡、截断、布局跳动和关键操作可达性。
- 在 Chromium 能可靠执行真实缩放时，对登录页补充 200% 缩放；若工具无法证明真实缩放，则标记 `NOT_RUN`，不得用 CSS `zoom` 冒充。
- 检查视觉层级、术语、表单标签、错误/提示区域、焦点可见性、键盘顺序、Enter/Space/Escape 的适用行为、密码显示切换按钮的可访问名称及 reduced-motion 基线。
- 截图只能来自本轮实际页面；保存后必须重新检查，拒绝空白、加载中、裁剪错误、错误窗口或含敏感信息的截图。

### R5 浏览器运行时与网络健康

- 记录并归因 `console.error`、`pageerror`、`requestfailed`、`securitypolicyviolation`、失败静态资源、CSP/Trusted Types 相关错误和可见 4xx/5xx。
- 对预期匿名 `401/403/redirect` 与真正资源失败分开判定；未知错误不得静默忽略。
- 只记录脱敏的 method、URL path、status、错误类别和必要 request id，不输出 Cookie、CSRF、Authorization、请求正文或敏感 Header。

### R6 证据、状态与报告

- 每个检查项使用唯一结果状态：`PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`、`NOT_APPLICABLE`。
- 缺陷记录至少包含：缺陷 ID、严重度、类型、URL、视口、前置状态、最短复现步骤、预期、实际、控制台/网络证据和截图路径。
- 当前 run 的截图按步骤编号保存并在最终回复中以内嵌方式展示关键证据；截图不能单独支持完整可访问性合规结论。
- 输出 `artifacts/deployed-acceptance/<run-id>/` 下的只读验收报告和截图，以及任务 `research/` 下的脱敏执行摘要。

### R7 会话收口

- 成功、失败或中途停止时，都必须关闭本任务创建的每个 `playwright-cli` 会话。
- 最终回复前运行 `playwright-cli list --all --json`，确认本任务会话不再为 open。
- 不使用 `close-all` 或 `kill-all`，不影响其他浏览器自动化任务。

### R8 波次 2 已认证只读页面

- 登录成功后先核验 `account_type=ADMIN`、`must_change_password=false`、当前环境身份和 App Shell；若任一条件不满足，按 R9 停止。
- 核验 canonical 列表页：`/`、`/products`、`/content/tasks`、`/publishing/work`、`/publishing/articles`、`/publishing/issues`、`/geo/insights`、`/geo/topics`、`/geo/observations`、`/settings/platforms`。
- 核验 ADMIN 页面：`/settings/platforms/types`、`/settings/prompts`、`/settings/ai`、`/system/users`、`/system/audit`；不得把前端隐藏导航视为权限证明。
- 详情页只能使用列表中实际可见的真实 ID，禁止虚构或枚举 ID。代表性覆盖优先为产品或内容详情、不可变发布详情、GEO 观测详情、AI usage/logs Tab 与审计详情；无安全样本时标记 `NOT_APPLICABLE` 或 `BLOCKED`。
- 允许站内导航、direct URL、refresh、history、Tab/hash、移动导航 Sheet、账户菜单展开，以及不会产生业务 mutation 的搜索、筛选、排序、分页和只读详情展开。
- 禁止新建、编辑、保存、删除、归档、恢复、批准、驳回、生成、发布、验证、纠错、上传、下载、导出、复制敏感值、测试连接、重置密码、启停或任何确认动作；不进入明确以写入为目的的 new/editor/review/correct 路由。
- 响应式主证据覆盖 1440×900 与 375×900；对 `/`、`/products`、代表性详情和 `/system/audit` 检查页面级溢出、TableShell 局部滚动、移动导航、详情 pane/Sheet、焦点恢复和长文本排版。只有发现边界风险时补充 320/768/1024。

### R9 认证安全与停止条件

- 若登录失败、认证服务 5xx、CSP/runtime 错误或页面明确报错，记录脱敏证据后停止，不重复登录。
- 若 `must_change_password=true`，只确认 `/account/security` 的强制改密状态后停止，不输入或提交新密码。
- 若账户不是 ADMIN 或 ADMIN 页面返回 403，停止对应分支，不更换角色、不猜测隐藏 URL、不绕过前端守卫。
- 若出现认证 401、`AUTH_REQUIRED`、`/api/v1/auth/me` 变为 204、CSRF 错误或重定向回 `/login`，立即停止，不自动重登。
- 若页面出现未掩码秘密、完整 token、敏感 header 或不适合持久化的个人信息，停止截图；只记录脱敏结论。审计详情需先检查再决定是否保存截图。
- 若环境标识、health、release 或数据身份相对波次 0–1 基线发生漂移，停止波次 2，不把跨构建证据合并为同一验收结论。
- 清理采用关闭临时 Chromium context 丢弃认证态，不点击退出、不额外执行 logout POST。

### R10 波次 3 可精确清理的业务流程

- 波次 3 开始前必须重新确认域名、health、V2 页面身份、当前 release 证据和 `.env.staging`/`partsignal-staging`/fake OSS 语义没有漂移；无法形成正面 Staging 证据时，波次 3 整体为 `BLOCKED`，不得写入。
- 新建实体统一使用每次运行唯一的 `TEST-W3-<date>-<run-id>-` 业务可见前缀，并用服务器返回的真实 ID 建立测试聚合清单。同一前缀不跨 run 复用，不通过名称模糊匹配删除。
- “可回滚”定义为满足服务端状态、引用和 revision 条件后的精确清理，不表示无痕恢复；成功业务变更产生的 append-only 审计记录可以保留，必须在报告中明确。
- 第一组低风险流程包括：空产品创建/编辑/删除、独立 Query Topic 创建/编辑/删除、独立 Platform Type 创建/编辑/删除、未绑定 Platform Prompt 创建/编辑/删除、无账户/无 logo/无内容任务的 Platform Profile 创建/禁用/删除。
- 第二组条件性流程只有在第一组完成、依赖可控且服务端动作投影明确时执行：TEST 产品事实保存/提交/批准后删除 FactVersion 与产品；基于 TEST 产品和受控 ACTIVE 平台创建 OPEN 内容任务并删除；创建 HUMAN DRAFT、保存并删除；创建 TEST 用户、编辑/禁用/删除。任一流程无法证明精确清理边界时标记 `BLOCKED`，不得继续下游流程。
- 每次写入前记录当前页面、对象 ID、revision、预期 method/path 和清理动作；每次写入后重新 GET 实体并核验状态、`available_actions`、列表/详情一致性和审计安全投影。
- 删除或清理必须使用本 run 的精确 ID 与最新 revision；遇到引用 blocker、409、403、状态漂移、未知引用或清理失败时立即停止，不做级联、不修改真实对象、不盲目重放。
- 波次 3 不使用 page/API 直调绕过 UI。业务流程必须通过当前 V2 页面执行，网络和服务端结果只作为可观测证据。

### R11 波次 4 高风险与外部副作用流程

- 只建立测试矩阵和前置门禁，不执行 Platform Account、logo/附件上传、Publication Work、发布结果登记、Published Article/Issue/Repair、GEO Observation/Correction/Optimization、AI Channel/API key/model discovery/test、generation/humanization、正式 review/approval/发布链、全局 Prompt、真实用户 reset/bulk/export 或永久删除。
- 波次 4 的后续执行必须具备专用 Staging 外部账号/对象存储/模型 key、预算和超时边界、可恢复策略、精确授权包及新的用户批准；缺一项即保持 `BLOCKED`。

## 范围外

- ENGINEER 账号、ADMIN/ENGINEER 角色对比和权限绕过测试。
- 波次 3 清单之外的业务写入、对现有业务对象的修改，以及为清理 TEST 聚合而解除或删除真实引用。
- AI/OSS、异步 Worker、真实第三方发布、上传和外部模型调用。
- Publication Work、Published Article/Issue、GEO Observation/Correction、真实用户管理、永久删除和其他不可逆业务闭环。
- Firefox、WebKit、真实移动设备和屏幕阅读器兼容性测试。
- 压测、渗透测试、破坏性安全测试、部署或服务器诊断。
- 修复缺陷、修改测试代码、增加 visual baseline 或执行 Git 提交。

## 验收标准

- [ ] AC1：任务记录当前公开环境身份、时间、health、页面标题和环境语义；没有把 Staging/预发布证据写成 Production 通过。
- [ ] AC2：只使用独立命名 Chromium 会话；仅波次 2 执行一次获授权登录，凭据与认证态未被持久化；未 mock 网络、未产生业务写入或远端变更。
- [ ] AC3：计划中的 canonical 与 legacy 代表路由均得到本轮 `PASS/FAIL/BLOCKED/NOT_RUN/NOT_APPLICABLE` 结果，direct/refresh 和可安全执行的 history 行为有证据。
- [ ] AC4：登录页完成 320/375/768/1024/1440 响应式检查；真实 200% 缩放完成或明确标记 `NOT_RUN`，没有用页面样式模拟。
- [ ] AC5：完成匿名键盘、焦点、标签/可访问名称、横向溢出和 reduced-motion 基线；未声称截图即可证明完整 WCAG 合规。
- [ ] AC6：console、page error、request failure、CSP/Trusted Types 和关键网络响应均已检查并归因；未知异常不会被写成通过。
- [ ] AC7：每个确认缺陷都有最短复现步骤和当前运行证据；关键截图已检查并按流程顺序保存。
- [ ] AC8：报告分别呈现波次 0–1 与波次 2 的当前运行证据，不把历史 fixture、本地真实栈或匿名结果继承为登录后通过。
- [ ] AC9：所有本任务 Playwright 会话均已关闭并经 `list --all --json` 验证；没有使用全局关闭命令。
- [ ] AC10：本任务未修改产品代码、合同、部署、服务器或既有未提交文件。
- [ ] AC11：登录成功或停止条件有脱敏证据；凭据未进入文件、截图、命令输出、storage state 或最终报告。
- [ ] AC12：App Shell、核心 canonical 列表页和 ADMIN 页面均得到本轮 `PASS/FAIL/BLOCKED/NOT_RUN/NOT_APPLICABLE` 结果；详情只使用页面中实际发现的真实 ID。
- [ ] AC13：1440 与 375 的代表性已认证页面完成 UI/UX、响应式、键盘与焦点检查，当前运行截图已逐张检查且不含敏感信息。
- [ ] AC14：登录后的网络证据未发现业务 mutation；若发现意外写请求，已立即停止并记录脱敏 method/path/status。
- [ ] AC15：认证会话通过关闭本任务 Chromium context 丢弃，未执行 logout 或其他额外状态变更，并经会话清单验证。
- [ ] AC16：波次 3 开始前形成当前运行态为 Staging/预发布的正面证据；证据不足时没有执行任何业务写入。
- [ ] AC17：所有波次 3 对象使用唯一 TEST 前缀与精确 ID 清单，每次写入记录 method/path/status/revision，未修改现有业务对象。
- [ ] AC18：每条已执行波次 3 流程均完成预期状态、列表/详情一致性、按钮/路由和审计安全投影检查，并完成精确清理或因明确 blocker 停止。
- [ ] AC19：清理后的 TEST 聚合不再出现在活动业务页面；保留的 append-only 审计记录已明确说明，没有宣称无痕回滚。
- [ ] AC20：波次 4 仅形成风险矩阵，未触发外部服务、上传、发布、生成、永久删除或其他高风险动作。

## 风险与延期项

- 波次 2 只证明 ADMIN 视角的只读 UI/UX、导航和当前运行时状态；波次 3 只证明已执行 TEST 聚合的可清理流程，不等同于全角色、全状态机或真实外部集成通过。
- 波次 3 的清理会保留审计历史；事实、内容与配置对象一旦产生未知引用，就不能视为可安全删除。
- 公网环境可能在测试期间发生发布或数据重建；环境身份变化会使跨时间截图不可比较，必须停止并重新建立 run。
- 现有 Chromium-only 配置不能证明 Firefox、Safari/WebKit 或真实触摸设备兼容性，这些留给后续独立兼容性任务。
- 当前工作区不干净，不阻止本次只读浏览器验收，但本任务产物不得提交，直到既有变化的归属得到确认。

## 阻塞问题

无。用户已在扩展规划摘要之后批准波次 2–4，当前任务为 `in_progress`，无需再次运行 `task.py start`。执行仍受 R9–R11 的逐步停止条件约束。
