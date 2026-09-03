# V2 线上 UI/UX、路由与受控业务流程验收

## 目标与用户价值

对 `https://geo.962850.xyz` 当前公开 V2 前端执行波次 0–4 的证据化验收。波次 0–1 已完成环境身份与匿名基线；波次 2 使用用户提供的 ADMIN 凭据执行已认证 UI/UX、路由与安全交互审计；波次 3 只有在重新证明目标仍为 Staging/预发布后，才使用唯一 TEST 前缀执行可精确清理的业务流程；波次 4 只规划高风险、不可逆或外部副作用流程，不在本轮执行。任务不修改产品代码、部署或服务器配置。

本任务不把“页面可打开”等同于系统通过，也不继承历史 Browser Gate 结论。每一项能力只按本轮实际证据判定为 `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN` 或 `NOT_APPLICABLE`。

## 已确认事实

- 用户已同意创建 Trellis 任务，并授权使用项目 `playwright-cli` 的独立 Chromium 会话执行波次 0–1 的只读测试。
- 波次 0–1 已于 run `20260830-175056-v2-readonly` 完成，总体结果为 `FAIL（P2）`：移动端登录用户名、密码、显示密码和登录控件实测高度为 32px，低于项目至少 44px 的触控目标合同；其余已执行匿名检查通过，工具无法证明的项目保持 `NOT_RUN`。
- 波次 2 通过三个分别获授权、各自只登录一次的独立 run 完成，最终结果为 `FAIL`：确认 `P1-002` Query Topic 列表 GET 422、`P2-001` 移动触控目标不足和 `P2-003` 移动审计空态偏出初始视口；没有把前两个中断 run 写成通过。
- 波次 3 在另行获授权的 Staging 身份只读门禁和独立登录后，只执行 W3-A 的空产品、Platform Type、未绑定 Prompt 三条创建—编辑—精确清理闭环；三个对象均已清理。结果为 `FAIL`：确认 `P2-004` Prompt 名称单独编辑时保存按钮错误禁用，且 `playwright-cli` 工具输出曾回显密码和临时 CSRF header。W3-B/W3-C 因此保持 `BLOCKED`，旧管理员密码不得复用。
- 波次 4 已完成风险矩阵但保持 `NOT_RUN`，没有触发外部服务、上传、发布、生成、永久删除或其他高风险动作。
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
- 波次 0–1 保持匿名；波次 2 的首轮、续跑和最终补测，以及波次 3，均使用分别获用户明确授权的独立会话，每个 run 只发起一次 `POST /api/v1/auth/login`。会话中断后不自动重登，不猜测或替换凭据。
- 凭据原计划通过不回显的临时进程输入传给浏览器，且未进入 shell 命令参数、文件、截图或 storage state；但波次 3 的 `playwright-cli` 生成代码输出仍意外回显密码，另一次请求诊断回显临时 CSRF header。该输出不可撤回，后续登录以密码轮换和新授权为硬门禁。
- 波次 2 登录后的页面数据请求只能是 `GET`；波次 3 仅允许 R10 与 TEST registry 明确列出的业务写入和精确清理。发现任何未授权 `POST`、`PUT`、`PATCH` 或 `DELETE` 时立即停止，不确认弹窗、不重试。
- 不使用 `page.route`、固定成功响应、本地 mock、浏览器扩展注入或页面 DOM 修改来改变线上行为。
- 波次 0–2 不执行会产生业务数据、配置变更、外部调用、上传、删除、审核、发布、GEO 纠错或审计写入的动作；波次 3 只执行 R10 明确授权的 TEST 聚合动作。
- 浏览器验收本身不连接 SSH，也不修改 Nginx、Compose、数据库、Redis、部署文件或服务器状态。波次 3 前经用户另行明确授权执行了一次 `ssh hostdzire` 只读身份核验；该核验没有读取秘密或执行服务器写入。

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

以下复选框表示“已有最终判定”，不表示产品行为全部通过。`FAIL`、`BLOCKED`、`NOT_RUN` 与 `NOT_APPLICABLE` 均保留为真实验收结果。

- [x] **AC1 — PASS**：任务记录公开环境身份、时间、health、页面标题和环境语义；只使用 Staging/预发布口径，没有写成 Production 通过。
- [x] **AC2 — PASS（按最终授权范围）**：全部 run 使用独立命名 Chromium 会话；每次登录均有单独授权且每个 run 只登录一次，未保存认证态、未 mock 网络。波次 2 保持业务只读；波次 3 只执行获授权的 TEST 聚合写入和精确清理。原始“一次登录”约束已被用户对续跑、最终补测和波次 3 的后续明确授权取代。
- [x] **AC3 — PASS**：计划中的 canonical、legacy 和 unknown 代表路由均有状态，direct/refresh 和可安全执行的 history 行为有证据。
- [x] **AC4 — FAIL**：五档登录页视口已完成；320/375 的关键控件仅 32px，形成 `P2-001`。真实 200% 缩放子项因工具不能证明而保持 `NOT_RUN`，没有使用页面样式模拟。
- [x] **AC5 — NOT_RUN**：匿名键盘、焦点、标签/可访问名称和横向溢出子项已检查；reduced-motion 变体未形成独立证据，因此本 AC 不宣称完整通过或完整 WCAG 合规。
- [x] **AC6 — NOT_RUN**：console、关键网络响应和 CSP 头子项已检查并归因；CLI 未提供可独立汇总的 `pageerror`、`requestfailed`、`securitypolicyviolation` 事件列表，因此本 AC 不宣称完整通过。
- [x] **AC7 — PASS**：`P1-002`、`P2-001`、`P2-003`、`P2-004` 均有复现和当前运行证据，关键截图已检查并按流程保存。
- [x] **AC8 — PASS**：报告分别呈现波次 0–1 与波次 2 各 run 的当前证据，没有继承历史 fixture、本地真实栈或匿名结果作为登录后通过。
- [x] **AC9 — PASS**：全部本任务 Playwright 会话均已精确关闭，最终清单为 `browsers=[]`、`servers=[]`，没有使用全局关闭命令。
- [x] **AC10 — PASS**：本任务未修改产品代码、合同、部署、服务器配置或既有未提交文件；远端变化仅限获授权的 W3-A TEST 聚合，且业务对象均已精确清理。
- [x] **AC11 — FAIL**：登录成功和停止条件均有脱敏证据，凭据未进入文件、截图、storage state 或最终报告；但波次 3 的工具输出意外回显密码和临时 CSRF header。旧密码必须轮换，后续登录保持阻断。
- [x] **AC12 — PASS**：App Shell、核心 canonical 列表页和 ADMIN 页面均有本轮状态；没有安全真实 ID 的详情保持 `NOT_APPLICABLE`，未猜测或枚举 ID。
- [x] **AC13 — PASS（已执行范围）**：1440 与 375 的代表性已认证页面完成 UI/UX、响应式、键盘与焦点检查；截图逐张检查且不含敏感信息，发现的问题按 `FAIL` 保留。
- [x] **AC14 — PASS（波次 2）**：波次 2 登录后未发现业务 mutation；波次 3 的写请求均为 TEST registry 中预先列明的获授权创建、编辑和清理动作。
- [x] **AC15 — PASS**：认证会话均通过关闭精确命名 Chromium context 丢弃，未执行 logout 或保存 storage state，并经会话清单验证。
- [x] **AC16 — PASS**：波次 3 开始前已通过另行获授权的只读服务器核验形成 Staging 正面证据；门禁不足阶段保持零业务写入。
- [x] **AC17 — PASS**：已执行的三个波次 3 对象使用唯一 TEST 前缀、精确 ID 和最新 revision；写入 method/path/status/revision 已记录，未修改既有业务对象。
- [x] **AC18 — PASS（已执行范围）**：三条 W3-A 流程均核验状态、列表/详情、动作投影和审计安全投影并完成精确清理；Query Topic、W3-B/W3-C 按明确 blocker 停止，没有绕过 UI。
- [x] **AC19 — PASS**：清理后 TEST 聚合不再出现在活动业务页面；append-only 审计保留已明确说明，没有宣称无痕回滚。
- [x] **AC20 — PASS**：波次 4 仅形成风险矩阵，状态为 `NOT_RUN`，没有触发任何高风险动作。

## 最终结论

本验收任务的执行与结果记录已完成，任务状态可收口为 `completed`；产品验收总结果仍为 **FAIL**，不能写成通过。波次 0–1 为 `FAIL（P2）`，波次 2 为 `FAIL（P1/P2）`，波次 3 W3-A 的对象清理为成功但本轮整体为 `FAIL`，W3-B/W3-C 为 `BLOCKED`，波次 4 为 `NOT_RUN`。

完整浏览器报告、逐项 YAML 与截图在提交 `e898c06158c31cb417ca6507c8902d34405fe04c` 中可追溯；任务 `research/` 保存脱敏文本摘要。当前 index 中已有任务外 artifact 清理，包含本任务五个 run 的 71 个文件，本任务收尾不恢复、不取消暂存也不提交这些删除。

## 风险与延期项

- 波次 2 只证明 ADMIN 视角的只读 UI/UX、导航和当前运行时状态；波次 3 只证明已执行 TEST 聚合的可清理流程，不等同于全角色、全状态机或真实外部集成通过。
- 波次 3 的清理会保留审计历史；事实、内容与配置对象一旦产生未知引用，就不能视为可安全删除。
- 公网环境可能在测试期间发生发布或数据重建；环境身份变化会使跨时间截图不可比较，必须停止并重新建立 run。
- 现有 Chromium-only 配置不能证明 Firefox、Safari/WebKit 或真实触摸设备兼容性，这些留给后续独立兼容性任务。
- 当前工作区不干净；本任务收尾只允许路径受限地处理本任务文档和 Trellis bookkeeping，不得吸收现有 `.gitignore`、`backend/app/schemas/configuration.py` 或 543 个 staged artifact 删除。

## 阻塞问题

没有阻止本验收任务收口的 blocker。任何新的已认证线上验收仍因波次 3 敏感输出事件而 `BLOCKED`，必须先由用户轮换旧管理员密码并重新授权；这不是继续执行 W3-B/W3-C 的授权。
