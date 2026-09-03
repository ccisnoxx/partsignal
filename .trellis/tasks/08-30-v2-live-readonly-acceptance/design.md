# V2 线上 UI/UX、路由与受控业务流程验收设计

## 1. 测试边界

波次 0–1 把线上系统视为匿名不可变外部目标；波次 2 的每个获授权认证 run 只执行一次登录 POST，登录后仅允许 GET 页面数据、导航和本地 UI 操作；波次 3 在正面确认 Staging 身份后，通过 V2 页面对唯一 TEST 聚合执行最小业务 mutation 并按精确 ID/revision 清理；波次 4 只规划高风险或外部副作用流程。任何波次都不通过 API 直调、数据库、fixture 或 mock 构造线上通过结果。

```text
公开 URL
  ↓ 真实 TLS/HTTP
独立 playwright-cli Chromium 会话
  ├─ 波次 0–1：匿名 context（已关闭）
  ├─ 波次 2：三个分别获授权的临时 context（每个 run 一次登录，不保存状态）
  ├─ 波次 3：另行获授权的临时 context（一次登录，W3-A 后关闭）
  ├─ DOM snapshot：结构、名称、焦点、URL
  ├─ screenshot：当前可见视觉证据
  ├─ console/pageerror：运行时错误
  └─ requests：状态码与失败资源（脱敏）
        ↓
当前 run 的用例结果、缺陷与证据
```

浏览器证据只证明当前公开构建在各 run 时间窗口内的行为。波次 3 的清理是业务聚合清理，不删除 append-only 审计历史，也不替代本地 integration、权限矩阵或 Production Observation。

## 2. 权威依据

执行时按以下顺序解释差异：

1. `.trellis/spec/frontend/visual-system.md`：当前视觉、响应式和可访问性合同。
2. `docs/frontend-v2/02-information-architecture-and-routing.md`：canonical 与 legacy 路由边界。
3. `docs/frontend-v2/08-testing-quality-and-acceptance.md`：浏览器验收矩阵。
4. `docs/deployed-full-functional-acceptance-plan.md`：线上证据、结果状态和安全约束。
5. 当前公开页面与真实网络响应：实际行为。

文档、合同和线上行为不一致时记录为差异，不选择更容易通过的解释。

## 3. 会话与运行标识

- 波次 0–1 使用 run `20260830-175056-v2-readonly`；波次 2 实际由 `20260830-191717-v2-auth-readonly`、`20260830-192848-v2-auth-resume`、`20260830-195237-v2-auth-final` 三个分别获授权的 run 完成；波次 3 使用 `20260830-204002-v3-staging-business`。不同 run 的截图和结论保持独立。
- 每个 run 使用包含任务标识和 run id 的独立非 `default` 会话，不复用已关闭的匿名或认证会话。每个认证 run 只登录一次；首轮会话关闭和续跑执行错误后都停止，得到新授权才开启后续 run。
- 每个认证 run 使用临时 Chromium context；不使用持久 profile、storage state 或外部 Chrome 会话。关闭 context 即丢弃 Cookie 和认证态，不执行 logout。
- 凭据由不回显的临时进程输入提供，未写入命令参数、源文件、临时文件、报告、截图或 storage state。波次 3 实际执行中，`playwright-cli` 的生成代码输出仍回显密码，一次请求诊断又回显临时 CSRF header；因此该工具路径不能视为秘密安全，旧密码必须轮换，后续登录需要新授权。
- 首次 `open` 后先观察 URL、标题、DOM 和可见状态，再执行任何点击、键盘或 resize。
- 每次动作前使用最新 snapshot 定位；动作后用 DOM 或 screenshot 证明状态变化。
- 波次 2 在登录动作前安装请求观察器：只允许一次 `POST /api/v1/auth/login`，此后业务请求必须为 GET。波次 3 只允许 TEST registry 预先记录的写请求；任一波次出现未预期写请求时停止，不依赖事后报告来补救。

## 4. 测试矩阵

### 4.1 路由矩阵

| 类型 | 路径 | 只读断言 |
| --- | --- | --- |
| 公开 | `/login` | V2 标题、登录表单、字段标签、密码显示切换、匿名状态 |
| Canonical | `/`、`/products`、`/content/tasks`、`/publishing/work`、`/geo/observations` | 无会话时安全进入登录流程，redirect 保留站内路径且无循环 |
| 受限 canonical | `/settings/platforms`、`/system/audit` | 无会话时不泄露页面内容，进入同一认证边界 |
| Legacy | `/tasks`、`/observations`、`/configuration`、`/users`、`/audit` | 记录匿名重定向链；不推断登录后的最终 canonical 页面 |
| 未知 | `/__v2-readonly-not-found__` | 明确 404 或安全认证入口；无空白页、跨域跳转或循环 |

### 4.2 视口矩阵

| 视口 | 目的 |
| --- | --- |
| 320×800 | 最窄支持宽度、页面级溢出和操作可达性 |
| 375×900 | 项目标准移动宽度 |
| 768×900 | Tablet/narrow 布局 |
| 1024×768 | Small desktop、中等高度 |
| 1440×900 | 主桌面基线 |
| 200% zoom | 仅在 Chromium 可证明真实浏览器缩放时执行，否则 `NOT_RUN` |

本任务不以窄 Desktop Chrome 冒充真实移动设备；触摸、软键盘、iOS safe-area 和 Safari 行为留给后续任务。

### 4.3 可访问性与交互矩阵

- Tab/Shift+Tab 的顺序与焦点可见性。
- 用户名、密码、显示密码和提交按钮的可访问名称。
- Enter 提交空表单时的真实校验与焦点去向；不得填入凭据。
- Escape 只在有真实可关闭浮层时验证，不制造不适用断言。
- reduced-motion 仅观察真实媒体状态下的非必要动画，不通过 DOM 样式覆盖模拟。
- 截图可证明布局和可见状态；语义、键盘和焦点必须用 DOM/行为证据补充。

### 4.4 波次 2 路由与交互矩阵

| 组别 | canonical 路径 | 只读断言 |
| --- | --- | --- |
| App Shell | `/` | ADMIN 身份、桌面侧栏、移动导航 Sheet、面包屑、主内容焦点、健康/聚合卡片 |
| 业务列表 | `/products`、`/content/tasks`、`/publishing/work`、`/publishing/articles`、`/publishing/issues` | 搜索/筛选/排序/分页只改变 URL 或本地状态；不触发写动作 |
| GEO | `/geo/insights`、`/geo/topics`、`/geo/observations` | 查询、筛选、只读关联链接；不创建优化、主题或观测 |
| 业务配置 | `/settings/platforms` | 列表、状态、真实详情链接；不启停、编辑或测试连接 |
| ADMIN | `/settings/platforms/types`、`/settings/prompts`、`/settings/ai`、`/system/users`、`/system/audit` | 路由可达、权限标签、只读列表/详情和敏感值掩码；不新建、编辑、导出、重置或启停 |

详情路由只能从列表中提取真实可见 ID；不猜测、不枚举。代表性最小集合为：产品或内容详情二选一、发布不可变详情、GEO 观测详情、AI usage/logs Tab、系统审计详情。页面没有安全样本、需要进入写入流或会持久化敏感数据时，使用 `NOT_APPLICABLE`、`BLOCKED` 或 `NOT_RUN`，不为提高覆盖率放宽边界。

允许的交互只有站内导航、direct/refresh/history、Tab/hash、移动导航 Sheet、账户菜单展开，以及已证明不会产生 mutation 的搜索、筛选、排序、分页和只读 pane/Sheet。所有 create/new、editor、review、correct、save、delete、archive、approve、generate、publish、upload、download、export、copy secret、test connection、reset password、enable/disable 与确认弹窗动作均禁止。

### 4.5 波次 2 视口与截图矩阵

1440×900 覆盖 `/`、`/products`、一个安全详情、一个不可变发布或 GEO 详情、AI usage/logs 和 `/system/audit`；375×900 至少覆盖 `/`、`/products`、同一代表详情和 `/system/audit`。优先验证侧栏/移动 Sheet、TableShell 局部滚动、长文本换行、详情 pane/Sheet、Escape 与焦点恢复。320/768/1024 仅在代表页面出现断点或溢出风险时补测。

### 4.6 波次 3 数据所有权与清理栈

波次 3 使用单一 TEST run registry，记录每个对象的类型、精确 ID、创建页面、最新 revision、引用状态、清理顺序和最终结果。业务字段采用 `TEST-W3-<date>-<run-id>-` 前缀，服务器 ID 与 Idempotency-Key 保持各自合同，不伪造成业务名称。

```text
确认 Staging 身份
  ↓
低风险独立聚合：Product / Query Topic / Platform Type / Prompt / Platform Profile
  ↓ 每步 GET 校验状态、available_actions、revision
条件性聚合：FactVersion / OPEN ContentTask / HUMAN DRAFT / TEST User
  ↓
按反向依赖顺序清理：Draft → Task → FactVersion → Product；Profile → Prompt → Type；User 单独清理
  ↓
重新 GET 列表/详情并检查 Audit safe projection
```

清理不使用名称批量匹配。删除前重新 GET 最新 revision；任何 409、403、引用 blocker、状态漂移、未知对象或非预期响应都停止当前分支，不级联到现有数据。

### 4.7 波次 3 流程分层

| 层级 | 候选流程 | 执行条件 |
| --- | --- | --- |
| W3-A | 空产品、独立 Query Topic、独立 Platform Type、未绑定 Prompt、无账户/无 logo Platform Profile | Staging 身份明确；创建后无引用；UI 暴露精确删除动作 |
| W3-B | TEST FactVersion 保存/提交/批准与删除、OPEN ContentTask 创建/删除、HUMAN DRAFT 保存/删除 | W3-A 通过；事实为完全合成数据；平台依赖受控；不触发 generation/review/publishing/GEO |
| W3-C | TEST 用户创建、编辑、禁用、删除 | 合成临时密码仅在内存；不是最后一个 ADMIN；无业务历史；不 reset/export/bulk |

W3-B 与 W3-C 是条件性分支，不是覆盖率硬指标。页面动作投影、清理路径或依赖不满足时以 `BLOCKED` 收口，比绕过 UI 或引入真实引用更符合验收目标。

### 4.8 波次 4 风险隔离

Publication Work 没有对称删除 API；Published Article/Issue、GEO Observation/Correction 和批准历史属于保留或 append-only 记录；AI test/discovery、generation/humanization、上传和真实发布会触发外部服务。它们只输出页面、接口、前置账号/存储/预算、恢复策略和授权门禁矩阵，不在当前浏览器会话中执行。

## 5. 证据模型

建议产物结构：

```text
artifacts/deployed-acceptance/<run-id>/
├── acceptance-report.md
├── case-results/
│   └── wave-0-1-results.md
└── screenshots/
    ├── 01-login-1440.png
    ├── 02-login-375.png
    └── ...

.trellis/tasks/08-30-v2-live-readonly-acceptance/research/
├── current-environment-baseline.md
├── live-readonly-execution-summary.md
├── authenticated-readonly-scope.md
├── authenticated-readonly-execution-summary.md
├── wave3-reversible-business-scope.md
├── wave3-business-execution-summary.md
└── wave4-risk-matrix.md
```

波次 2 各 run 输出使用独立的 `artifacts/deployed-acceptance/<run-id>/`，包括 `acceptance-report.md` 和按步骤编号截图。审计详情、AI 配置和用户列表在截图前先检查敏感信息；无法安全持久化时只保留脱敏文本结论，不保存截图。

波次 3 使用另行获授权的独立 context，并输出独立的 `artifacts/deployed-acceptance/<run-id>-v3-staging-business/`。测试数据 registry 只记录前缀、对象类型、精确 ID、revision、状态和清理结果，不记录密码、Cookie、CSRF、Authorization、正文中的敏感内容或完整请求 Header。

完整 artifact 在提交 `e898c06158c31cb417ca6507c8902d34405fe04c` 中可追溯；任务 `research/` 中的脱敏摘要是收尾时仍留在任务目录内的稳定证据。当前 index 中的任务外 artifact 清理覆盖这五个 run，本任务不恢复或提交该清理。

截图在保存后使用本地图片查看能力检查。空白、错误状态、加载中、裁剪错误、错误窗口或敏感内容截图不进入报告。console/request 证据只保留脱敏摘要；不持久化完整网络请求、Cookie 或 Header。

## 6. 缺陷判定

- `P0/Critical`：匿名泄露秘密或受保护数据、跨域跳转、无需认证即可写入。
- `P1/High`：登录页不可用、核心路由循环/空白、关键视口无法操作、严重 CSP/Trusted Types 阻断。
- `P2/Medium`：可恢复但明显影响理解、导航、响应式或键盘使用。
- `P3/Low`：不阻断任务的视觉一致性和轻微文案问题。

历史缺陷只作为回归线索，不自动继承为当前缺陷。每个 finding 必须绑定本轮步骤或截图。

## 7. 失败与停止策略

- 目标证书/域名不一致、连续 health 失败、维护页、跨页面大面积 5xx 或页面身份改变：停止扩展测试，记录 `BLOCKED`。
- 发现敏感信息泄露：停止相关路径，不继续打开网络详情或截图敏感页面，记录 P0。
- 登录墙阻止受保护页面：记录预期匿名边界；登录后 UI 不判定通过。
- `playwright-cli` 操作失败：先尝试关闭本任务会话并验证；不使用 `kill-all`。
- 不通过 SSH、部署、刷新服务或修改服务器来“恢复”测试环境。
- 登录失败、强制改密、非 ADMIN、ADMIN 403、会话 401/204/CSRF 错误或重新进入 `/login`：保留脱敏证据后停止，不自动重登。
- 登录后出现业务 `POST/PUT/PATCH/DELETE`、未掩码秘密或不适合持久化的个人信息：立即停止相关步骤，不确认、不重试、不保存敏感截图。
- 波次 2 开始前的 health、版本或环境身份与波次 0–1 基线不一致：将波次 2 标记 `BLOCKED`，不合并跨构建结论。
- 波次 3 无法形成 Staging 正面证据：不执行任何写入，整体标记 `BLOCKED`。
- 波次 3 任一创建、更新或删除返回未预期状态，或 TEST 对象出现未知引用：停止当前分支并优先清理已经创建且仍满足合同的对象；不为清理扩大操作范围。
- 清理失败时保留精确对象 ID、状态与 blocker 的脱敏记录，立即停止所有下游写入，并向用户报告残留 TEST 聚合。

## 8. 回滚与清理

波次 0–2 除各独立 run 获授权的一次登录外无业务写入。波次 3 的回滚按 TEST registry 对已执行 W3-A 对象反向清理，并在每步前重新获取 revision；审计历史按合同保留。清理完成或停止后关闭本任务精确命名的浏览器会话，不创建 storage state、不点击 logout，关闭临时 context 后认证态不可复用。

## 9. 兼容性与延期

本任务明确固定 Chromium，因为用户已授权该浏览器。Firefox、WebKit、真实移动设备、屏幕阅读器、ENGINEER 角色对比，以及波次 4 的 AI/OSS/发布/GEO/永久删除能力留给后续独立授权，避免把受控 Staging 流程扩成不可恢复的线上写入验收。
