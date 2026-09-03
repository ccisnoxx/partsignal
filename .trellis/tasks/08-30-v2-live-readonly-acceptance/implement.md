# V2 线上 UI/UX、路由与受控业务流程验收实施计划

## 1. 执行前门禁

- [x] 用户审阅并明确批准本轮最终规划摘要。
- [x] 任务状态已核验为 `in_progress`（执行前检查 `task.json`）。
- [x] 记录 `git status --short --branch`，冻结既有未提交文件清单；未修改或提交这些文件。
- [x] 生成北京时间 `run-id` 和唯一 `playwright-cli` 会话名。
- [x] 运行 `playwright-cli list --all --json`，记录启动前会话快照，未关闭其他任务会话。
- [x] 通过匿名 `curl` 重新验证首页、`/login`、live、ready 和页面标题；与 planning baseline 一致。

## 2. 波次 0：环境与证据基线

- [x] 建立当前 run 的 artifact 目录和脱敏结果模板。
- [x] 记录目标 URL、时间、HTTP 状态、content type、页面标题和公开 health body。
- [x] 对照最新部署执行材料记录可证实的 release、`.env.staging`/fake OSS 和 Production Gate 状态；未通过 Compose project 名单独推断环境语义。
- [x] 记录当前测试边界：匿名、Chromium、无认证、无业务写入、无 mock、无 SSH。
- [x] 核验未处于维护、发布或身份漂移状态，未触发 `BLOCKED` 停止条件。

## 3. 波次 1：只读浏览器验收

### 3.1 登录页桌面基线

- [x] 用唯一会话打开 `https://geo.962850.xyz/login`，先观察最新 snapshot。
- [x] 检查标题、表单字段、按钮、密码显示切换、提示文案、可访问名称和初始焦点。
- [x] 在不输入凭据的情况下验证 Tab/Shift+Tab、密码显示按钮、空提交校验及焦点反馈。
- [x] 检查 console、pageerror、requestfailed、CSP/Trusted Types 和关键请求；CLI 不提供独立 pageerror/requestfailed 列表的部分已记为 `NOT_RUN`。
- [x] 保存并查看 1440×900 登录页截图，确认不是空白、加载或错误窗口。

### 3.2 Canonical/legacy/unknown 路由

- [x] 逐一访问 PRD 的 canonical 路由矩阵，记录匿名重定向 URL、标题、可见内容和 refresh 结果。
- [x] 对代表路径执行 Back/Forward，确认无循环、空白或跨域跳转。
- [x] 逐一访问 legacy 路由矩阵，只判断匿名链路，不推断登录后的 canonical landing。
- [x] 访问未知 path，记录 404/认证边界和恢复入口。
- [x] 每个路径检查运行时错误；重复的同根因错误只创建一个 defect，受影响路径已汇总。

### 3.3 响应式与键盘

- [x] 按 320×800、375×900、768×900、1024×768、1440×900 依次重新设置视口；每次变更后重新获取 snapshot 和当前节点。
- [x] 检查 document root 横向溢出、内容裁剪、按钮可达性、字段标签、错误区和焦点环。
- [x] 对 320、375、1440 保存并查看接受截图；未发现断点差异，未额外保存 768/1024 截图。
- [x] 尝试真实浏览器 200% 缩放；Chromium 工具未能证明缩放，已记录 `NOT_RUN`，未使用 CSS zoom。
- [x] 观察 reduced-motion 基线；未通过 CSS/DOM 写入模拟，reduced-motion 变体已记为 `NOT_RUN`。

### 3.4 运行时收口

- [x] 汇总 console/page/request/CSP 事件，区分预期匿名响应与真正异常；未保存敏感请求详情。
- [x] 对每个缺陷补齐最短复现、预期/实际、视口、步骤和证据路径。
- [x] 未打开、保存或公开包含凭据、Cookie、Token、CSRF 或敏感 Header 的详情。

## 4. 报告与会话清理

- [x] 写入 `artifacts/deployed-acceptance/<run-id>/acceptance-report.md`，所有未执行项保持 `NOT_RUN` 或 `BLOCKED`。
- [x] 写入任务 `research/live-readonly-execution-summary.md`，记录环境、用例状态、缺陷、阻断和证据索引。
- [x] 在最终报告中分别列出功能/路由发现与 UI/UX/可访问性发现，并说明截图证据限制。
- [x] 关闭本任务命名会话。
- [x] 运行 `playwright-cli list --all --json`，确认本任务会话不是 open；未使用 `close-all` 或 `kill-all`。
- [x] 检查 `git diff --check` 和本任务 diff，确认没有产品代码、合同、部署或既有未提交文件变化。

## 5. 波次 2 执行前门禁

- [x] 用户已在本扩展规划摘要之后明确批准波次 2–4：执行波次 2，确认 Staging 后执行可清理波次 3，波次 4 只规划。
- [x] 任务状态仍为 `in_progress`；不重复运行 `task.py start`。
- [x] 记录执行前环境 identity、health、release 语义与 `git status`；与波次 0–1 的 Staging/预发布口径一致。
- [x] 生成独立 run `20260830-191717-v2-auth-readonly` 和非 `default` 会话 `v2-auth-readonly-191717`。
- [x] 运行 `playwright-cli list --all --json`，启动前没有浏览器实例，未复用或关闭其他任务会话。
- [x] 通过不回显的临时进程输入登录；密码未写入参数、文件、截图、日志或工具输出。
- [x] 请求记录确认唯一写请求为一次 `POST /api/v1/auth/login`，返回 200。

## 6. 波次 2：已认证只读验收

续跑授权：用户已在 run `20260830-191717-v2-auth-readonly` 因工具会话意外关闭后，明确授权开启一个新的独立 Chromium 会话并再次登录一次，从 `/content/tasks` 继续波次 2；完成后仍仅在 Staging 门禁通过时进入波次 3。

最终补测授权：用户已在 run `20260830-192848-v2-auth-resume` 因 `/system/users` 导航命令误用非任务域名而提前收口后，再次明确授权开启一个新的独立 Chromium 会话，在权威目标 `https://geo.962850.xyz` 登录一次并补完波次 2。波次 3 仍要求可把当前公网实例与 Staging release 直接关联的正面只读证据或相应核验授权。

### 6.1 登录与认证门禁

- [x] 打开 `/login`，确认当前页面身份与波次 0–1 基线一致后，使用用户提供的凭据登录一次。
- [x] 登录成功，没有认证 5xx、CSP/runtime 错误，也没有重试。
- [x] 登录后 App Shell 显示系统管理员，未触发强制改密，并进入 canonical `/`；这是 UI 守卫证据。
- [x] 续跑会话已脱敏核验 `/auth/me`：HTTP 200、`accountType=ADMIN`、`mustChangePassword=false`；未保存 Cookie、Token 或敏感 Header。
- [x] 未出现强制改密、角色不符或 ADMIN 403。
- [x] 已完成路由与搜索交互保持 GET-only；除获授权的一次登录外，没有执行业务 `POST/PUT/PATCH/DELETE`。

### 6.2 桌面 canonical 与 ADMIN 页面

- [x] 在 1440×900 核验 `/` 的侧栏、active/`aria-current`、面包屑、主内容焦点和健康/聚合卡片。
- [x] `/products`、`/content/tasks`、发布三页均已获得 direct URL 与只读列表结果；代表性 Reload/Back/Forward 在 system 路由补测通过。
- [x] `/geo/insights`、`/geo/observations` 与 `/settings/platforms` 的只读边界通过；`/geo/topics` 首次加载和一次重试均因 GET 422 判 `FAIL`。
- [x] `/settings/platforms/types`、`/settings/prompts`、`/settings/ai`、`/system/users`、`/system/audit` 均获得 ADMIN 结果；用户页未保存截图、未导出或打开管理动作。
- [x] `/content/tasks`、发布三页、GEO 三页、设置四页和 system 两页均得到当前只读结果；`/geo/topics` 因 GET 422 判 `FAIL`，其余核心列表页可达。
- [x] `/content/tasks` 搜索与重置仅触发只读行为；未打开或确认写入对话框。

### 6.3 真实详情、键盘与移动端

- [x] 只从页面可见列表判断详情候选；产品、内容、发布、GEO 与审计没有可安全选择的真实记录，没有猜测或枚举 ID。
- [x] 真实详情因安全样本不足记为 `NOT_APPLICABLE`；未为覆盖率进入写入流。
- [x] 桌面账户菜单和移动导航 Sheet 验证 Escape 与焦点恢复；系统审计刷新和路由历史通过。没有安全详情，因此 pane/detail 键盘路径为 `NOT_APPLICABLE`。
- [x] 在 375×900 核验 `/`、`/products`、`/system/audit`；无页面级横向溢出，确认局部表格滚动、P2-001 触控目标不足和 P2-003 审计空态偏出初始视口。
- [x] 当前缺陷在 375 已有充分证据，未额外扩展 320/768/1024；没有把未执行尺寸写成通过。

### 6.4 证据与清理

- [x] 保存并逐张检查续跑 run 的 1440 关键截图；375、系统审计和用户页因环境中断未保存，避免持久化不完整或敏感页面。
- [x] 汇总已观察请求与错误：登录 200、权威目标 Query Topic GET 422；误用非任务域名后 Chromium 为 `ERR_CONNECTION_CLOSED`，随后对同一非目标域名的独立 curl 在 TLS 阶段失败并返回 HTTP 000。未保存 Cookie、CSRF、Authorization、body 或敏感 Header。
- [x] 写入 `artifacts/deployed-acceptance/20260830-192848-v2-auth-resume/acceptance-report.md` 和任务 `research/authenticated-readonly-resume-summary.md`。
- [x] 写入波次 2 独立报告；路由 sweep 期间会话意外关闭，按门禁停止，没有重复登录或进入波次 3。
- [x] 用户授权的续跑会话完成一次重新登录；系统页导航命令误用了非任务域名并返回 `ERR_CONNECTION_CLOSED`，会话随后收口，未第三次登录。权威目标的当前首页与 `/api/health/*` 仍为 200。
- [x] 最终补测 run `20260830-195237-v2-auth-final` 保存并逐张检查 1440/375 当前截图；写入完整报告和 `research/authenticated-readonly-final-summary.md`，不含用户列表或敏感值。
- [x] Query Topic 422 已通过一次页面“重试”复现；移动触控目标与审计空态几何已量化，不把截图单独当作 WCAG 证明。
- [x] 可观察 console 与当前页面请求已汇总；`pageerror`、`requestfailed`、`securitypolicyviolation` 没有独立事件列表，明确保持 `NOT_RUN`，未从 console 推断通过。

## 7. 波次 3：Staging 可清理业务流程

本轮状态：`READY`。波次 2 已完成并得到 `FAIL` 结果；用户随后授权 `ssh hostdzire` 只读核验，公网域名、启用的 Staging Nginx upstream、唯一 `partsignal-staging/frontend` 容器、Compose working dir/config、frontend image reference/ID、current release 和 source commit 已形成直接证据链，R10 Staging 正面门禁通过。门禁核验本身没有创建 TEST registry 或产生业务写入。

### 7.1 写入门禁与 TEST registry

- [x] 已通过获授权的 `ssh hostdzire` 只读核验形成当前 Staging 正面证据：`geo.962850.xyz → partsignal-staging.conf → partsignal_staging_frontend:19080 → partsignal-staging/frontend 容器 → mvp-20260830-133651-a663bcce image/current/source`；详见 `research/staging-runtime-identity-gate.md`。
- [x] 创建唯一前缀 `TEST-W3-20260830-204002-` 和 TEST registry；记录对象类型、精确 ID、页面、最新 revision、引用状态、清理动作和结果。
- [x] 当前 ADMIN 页面具有候选动作，Product/Platform Type/Prompt 的服务端 `available_actions` 与删除条件符合预期；没有通过 UI 绕过动作投影。
- [x] 每次写入前已在 registry 记录预期 method/path；动作后通过详情/列表、网络状态、revision 与审计 safe projection 复核。

### 7.2 W3-A 独立低风险聚合

- [x] 通过 `/products/new` 完成空产品创建、详情、编辑和最新 revision 核验；确认无事实/内容/GEO 引用后按精确 ID 删除并复核 404/列表移除。
- [x] Query Topic 分支沿用 P1-002 列表 GET 422 判为 `BLOCKED`；没有绕过 UI 创建对象。
- [x] 通过 `/settings/platforms/types` 完成独立 Platform Type 创建、编辑；确认 `platform_count=0`、blockers 为空后删除并复核列表空态。
- [x] 通过 `/settings/prompts` 完成未绑定 Prompt 创建、编辑与删除，revision `0 → 1`、绑定数始终为 0；确认未进入全局 Prompt。记录 P2-004 名称单独编辑时保存错误禁用。
- [x] Platform Profile 本次为 `NOT_APPLICABLE`：用户本次明确授权的执行摘要收口到空产品、Platform Type 与未绑定 Prompt，没有扩大到 Profile 创建。

### 7.3 W3-B/W3-C 条件性聚合

- [ ] 仅对 TEST 空产品保存合成事实、提交并批准；验证事实状态、历史与按钮投影。在没有任何下游引用且删除动作明确时删除 FactVersion，再删除产品。
- [ ] 仅在 TEST FactVersion 已批准且存在受控 ACTIVE 平台时创建 OPEN ContentTask；验证唯一 Idempotency-Key、防重复、列表/详情与状态，然后在无 job/version/发布/GEO 引用时删除。
- [ ] 仅在 OPEN TEST task 上创建 HUMAN DRAFT，保存合成 Markdown，不提交审核、不生成、不发布；按最新 revision 删除 DRAFT，再删除 task。
- [ ] 仅在能够安全生成内存临时密码、测试用户不是最后一个 ADMIN 且没有业务历史时，创建 TEST 用户，验证编辑/禁用/删除；不 reset、bulk 或 export。
- [ ] 任一条件性流程不满足时标记 `BLOCKED` 或 `NOT_APPLICABLE`，不为覆盖率使用真实对象或放宽清理条件。

### 7.4 反向清理与波次 3 报告

- [x] 三个独立对象在各自流程结束时按最新 revision 精确清理；没有创建 Draft、Task、FactVersion、Profile、Query Topic 或 User 依赖。
- [x] 清理后通过活动列表与 Product 精确详情 URL 复核对象不再可用；append-only 审计保留，抽查 safe projection 未发现秘密。
- [x] 清理未出现 blocker/409/403/未知状态；没有级联或盲目重放。
- [x] 已写入 `artifacts/deployed-acceptance/20260830-204002-v3-staging-business/` 报告、TEST registry、三张脱敏截图，并更新 `research/wave3-business-execution-summary.md`。

## 8. 波次 4：高风险流程矩阵（只规划）

- [x] 基于 `research/wave3-reversible-business-scope.md` 输出 `research/wave4-risk-matrix.md`，逐项列出页面/API、外部依赖、不可逆状态、恢复条件、授权包和硬停止条件。
- [x] 明确 Publication Work、Published Article/Issue、GEO Observation/Correction、AI test/discovery、generation/humanization、上传、真实发布、全局 Prompt、用户 reset/bulk/export 和永久删除均未执行。

## 9. 最终会话与任务收口

- [x] Chromium context 在路由 sweep 中意外关闭，认证态随临时 context 丢弃；未点击 logout，未执行额外 POST。
- [x] 续跑会话 `v2-auth-resume-192848` 在环境中断后被精确关闭；没有第三次登录、logout 或业务写入，CLI 临时目录已移至 `/tmp/v2-auth-resume-192848-cli-artifacts` 保留。
- [x] 最终补测会话 `v2-auth-final-195237` 已精确关闭；没有 logout、storage state 或业务写入，CLI 临时目录移至 `/tmp/v2-auth-final-195237-cli-artifacts`，扫描未发现持久化密码值；两份含内部账号标识的自动 YML 快照已按精确文件名永久删除，复扫无账号标识残留。
- [x] 波次 3 会话 `v3-staging-204002` 已精确关闭，未执行 logout 或保存 storage state；28 份本 run 自动 YML/console 文件已按精确文件名永久删除，凭据文件级扫描为 0。`playwright-cli` 工具输出曾意外回显密码和临时 CSRF header，后续登录保持停止并要求轮换凭据。
- [x] 运行 `playwright-cli list --all --json`，确认 `browsers=[]`、`servers=[]`；未使用 `close-all` 或 `kill-all`。
- [x] 运行 Trellis validate、`git diff --check` 并复核工作区，确认未修改产品代码、合同、部署和既有未提交文件。

## 10. 必需验证

本任务没有产品代码变更。本轮必需验证直接覆盖已执行的线上只读行为与会话清理；波次 3 的 TEST 聚合与最终清理命令仅在后续满足写入门禁并实际进入波次 3 时成为条件性必需验证：

```bash
curl -sS -L --connect-timeout 10 --max-time 20 \
  -o /dev/null -w 'status=%{http_code} final=%{url_effective} type=%{content_type}\n' \
  https://geo.962850.xyz/

curl -sS --connect-timeout 10 --max-time 20 \
  https://geo.962850.xyz/api/health/live

curl -sS --connect-timeout 10 --max-time 20 \
  https://geo.962850.xyz/api/health/ready

playwright-cli list --all --json
python3 .trellis/scripts/task.py validate .trellis/tasks/08-30-v2-live-readonly-acceptance
git diff --check
```

浏览器必需验证为本计划第 3、6、7、9 节的实际命名会话流程。登录命令和合成密码不在文档中展开，避免把凭据处理固化为可复制命令。现有 fixture Playwright 不作为公网验收结果；本任务不运行需要本地数据库/Redis 的完整 `make e2e` 或 `make verify`。

## 11. 可选验证

- `npm --prefix frontend run e2e -- --list`：仅用于重新盘点既有用例，不证明公网行为。
- 对确认缺陷使用匿名 trace：只有证据价值明确且不会收集敏感数据时执行；默认不启用。
- Firefox/WebKit/真实移动设备：本任务明确延期，不作为当前退出标准。

## 12. 停止条件与回滚点

- 发现敏感信息、跨域跳转、无需认证的受保护内容或写入口：立即停止相关路径并记录 P0。
- 连续大范围 5xx、维护页、环境身份变化或发布中的构建漂移：停止浏览器扩展测试，保留已获取证据并判 `BLOCKED`。
- 波次 3 只回滚 TEST registry 中精确登记且满足服务端删除合同的对象；审计历史保留。任何未清理对象都必须作为残留风险报告。
- 波次 2 登录失败、强制改密、角色不符、会话失效、环境漂移、敏感信息或登录以外写请求均立即停止；不重试登录、不自动恢复、不扩大权限。
- 波次 3 的 Staging 身份不明确、引用 blocker、revision 冲突、未知状态、清理失败或外部副作用均停止所有后续写入。

## 13. 完成判定

- [x] `prd.md` 的 AC1–AC10 均有结果和证据；AC3 已通过独立只读复核补齐 route direct/refresh 与 Forward 最终稳定状态，工具能力限制项保持 `NOT_RUN`。
- [x] 没有把登录后页面、其他浏览器或历史 Gate 写成当前通过。
- [x] 所有本任务会话均已关闭。
- [x] 报告、截图和执行摘要可供下一阶段测试复用，但不包含敏感信息。
- [x] 没有修改或提交产品代码和既有未提交文件。
- [x] AC11–AC15 均有明确结果：波次 2 的 375×900、账户菜单、移动 Sheet、Escape/焦点恢复与系统页已补齐；AC11 在波次 3 因 CLI 工具输出回显敏感值转为 `FAIL`，虽未落盘但要求轮换密码。
- [x] 已认证截图来自波次 2 当前 run，且不含密码、Cookie、Token、API key、敏感 Header 或不适合持久化的个人信息。
- [x] 波次 2 已完成的登录后路由和搜索行为未发现业务 mutation；每个 run 的唯一写请求为获授权登录。波次 3 仅执行 TEST registry 预先记录的获授权创建、编辑与清理请求。
- [x] 波次 2 会话已关闭，认证态未持久化，未执行 logout。
- [x] AC16–AC20 均有当前结果：AC16 `PASS`；AC17–AC19 对已执行 Product/Platform Type/Prompt 流程均有精确 registry、revision、网络结果、审计与清理证据且无业务对象残留；未执行的条件性分支保持 `NOT_RUN/BLOCKED`；AC20 通过。
- [x] 波次 4 风险矩阵完成且没有执行其中任何动作。

## 14. 最终收尾记录

- 任务执行状态：`completed`；产品验收结论：`FAIL`。完成验收任务不等于产品通过验收。
- 波次 0–1：`FAIL（P2）`；波次 2：`FAIL（P1/P2）`；波次 3 W3-A：三个 TEST 对象均 `CLEANED`，本轮因 `P2-004` 与敏感输出事件为 `FAIL`；W3-B/W3-C：`BLOCKED`；波次 4：`NOT_RUN`。
- PRD AC1–AC20 已逐项回填最终状态。AC11 明确为 `FAIL`；AC5/AC6 保留 `NOT_RUN`，没有把工具无法证明的检查写成通过。
- 多次认证均来自不同 run 的后续明确授权，每个 run 只登录一次；没有自动重登、复用已关闭 context 或保存 storage state。波次 3 工具输出事件后，旧管理员密码不再复用。
- 完整 artifact 在提交 `e898c06158c31cb417ca6507c8902d34405fe04c` 中可追溯，任务材料提交为 `50aff8b4f1b646f747e6c75729fbd752e8567736`。当前 index 中任务外的 543 个 artifact 删除包含本任务五个 run 的 71 个文件；收尾不恢复、不取消暂存、不提交这些删除。
- 2026-09-03 收尾只读复核：公开首页 200，live 200，ready 200（PostgreSQL/Redis 均为 `ok`）；Trellis validate 通过；任务文档 trailing-whitespace 检查通过；浏览器清单为 `browsers=[]`、`servers=[]`。该探测只证明当前公开健康状态，不覆盖或改写 2026-08-30 的各 run 结论。
- 收尾不修改产品代码、公共合同、generated client、测试、Makefile、CI、数据库合同或业务设计文档，也不开始 `integrity-error-domain-mapping`。
