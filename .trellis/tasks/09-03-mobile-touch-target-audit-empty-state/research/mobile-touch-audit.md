# Research: P2-001 移动触控目标与 P2-003 审计空态布局

- Query: 定位移动端登录控件低于 44×44 CSS px，以及系统审计空态在窄屏初始视口外的权威组件、样式 owner、测试边界和最小修复方案。
- Scope: internal
- Date: 2026-09-03

## Findings

### P2-001：确认的触控目标缺陷与最小边界

历史线上只读验收记录明确：320/375px 登录页的用户名、密码、显示密码和登录控件实测高度为 32px，低于项目 44px 合同；该证据来自已归档的 `08-30-v2-live-readonly-acceptance`，不是本次重新登录或线上复验（`.trellis/tasks/archive/2026-09/08-30-v2-live-readonly-acceptance/research/live-readonly-execution-summary.md:21-34`）。

权威渲染路径是 `frontend/src/domains/auth/login-page.tsx:58-116`：两个 `FormField` 分别渲染用户名和密码输入，密码行旁边渲染“显示/隐藏”按钮，底部渲染登录提交按钮。共享 `Input` primitive 在 `frontend/src/design-system/primitives/input.tsx:6-16` 固定 `h-8`；共享 `Button` primitive 的默认、sm、icon 尺寸分别包含 `h-8`、`h-7`、`size-8`（`frontend/src/design-system/primitives/button.tsx:23-35`）。因此已观察到的 32px 是共享 primitive 的默认尺寸直接造成的，而不是浏览器默认样式。

最小推荐边界是登录页局部的移动覆盖：在 `LoginPage` 的用户名输入、密码输入、密码可见性按钮和提交按钮上使用 `h-11`（44px），在 `md` 及以上恢复既有 `h-8`，或由一个仅属于认证页的 class 统一表达该覆盖。不要直接把 `Input`/`Button` 默认尺寸改成 44px：这会改变所有业务表单、筛选、分页和行操作的桌面密度，并把一个登录页验收缺陷扩散到整个 design system。`cn()` 使用 `tailwind-merge`（`frontend/src/shared/lib/utils.ts:1-5`），所以调用方 class 可以安全覆盖 primitive 的默认高度。

`frontend/src/domains/auth/account-security-page.tsx:69-117` 也复用同一 `Input` 与 `Button` primitive。已归档验收的 P2-001 明确复现点是 `/login`；实施时应先保持 `/account/security` 的行为与视觉边界不变，除非任务验收标准明确把强制/自助改密页面一并纳入。若纳入，必须对当前密码、新密码、显示密码和确认修改同样做认证页局部覆盖，并在 fixture E2E 中分别断言，不应通过全局 primitive 改尺寸。

### P2-003：审计空态偏出初始视口的根因与 owner

`SystemAuditPage` 在 `frontend/src/domains/audit/system-audit-page.tsx:115-142` 通过 `TableShell regionLabel="系统审计日志" className="audit-list-table"` 渲染七列表头，并在 `total === 0` 时使用 `EmptyTable colSpan={7}`。`TableShell` 将传入的 class 放到原生 `<table>`（`frontend/src/design-system/data-table/table-shell.tsx:5-19`），所以 `audit-list-table` 是该页面可用的局部样式钩子；`EmptyTable` 本身在 `frontend/src/design-system/data-table/empty-table.tsx:13-25` 只负责语义、最小高度和内容，不应该知道审计页面。

根因位于共享表格基础样式：`.ps-table` 在 `frontend/src/styles/global.css:209-215` 有 `min-width: 52rem`，而 `.ps-table-region` 在 `frontend/src/styles/global.css:193-202` 只允许横向局部滚动。窄屏审计没有数据时，`colSpan=7` 的空态 `<td>` 仍然属于 832px 宽的 table；`EmptyTable` 内部使用 `justify-center`/`text-center`（`empty-table.tsx:18-22`），所以提示文字按 832px 单元格居中，初始滚动位置的约 349px region 看不到提示。归档报告把该几何现象量化为“349px 滚动容器承载 832px 空态单元格，提示偏出初始视口”（`.trellis/tasks/archive/2026-09/08-30-v2-live-readonly-acceptance/research/authenticated-readonly-final-summary.md:17-23`）。

最小推荐修复是为 `.audit-list-table` 增加窄屏表格布局规则，而不是改 `EmptyTable` 或取消所有表格的宽表合同：在 `@media (max-width: 767px)` 下令该 table `min-width: 100%`、`table-layout: fixed`，并按需要将该表的 primary 列 `min-width` 覆盖为 0。现有 `global.css:291-312` 的 `.platform-list-table` 移动规则和 `global.css:329-374` 的 AI/User 列表规则证明了项目已有这种“按 feature table class 收窄”的模式。这样空态单元格在首屏 viewport 内居中；有数据时仍保留审计页面现有 metadata 隐藏规则与 TableShell 局部滚动语义。不要修改全局 `.ps-table min-width`，也不要让 `EmptyTable` 全局左对齐，因为其他宽表空态可能仍需要局部横向滚动和统一居中。

### 测试与验证边界

- 组件回归：`frontend/src/domains/auth/login-page.test.tsx` 当前覆盖表单校验、密码切换、pending 和服务端错误（文件第 9-79 行）；可增加对关键控件具有移动覆盖 class/尺寸语义的稳定断言，但 jsdom 不适合证明最终 CSS 几何。
- 登录真实几何回归：`frontend/tests/e2e/auth-session.spec.ts:119-165` 是匿名登录页的 production-artifact fixture；`frontend/playwright.config.ts:13-21` 的 `foundation-mobile` 固定 375×900，`foundation-desktop` 固定 1440×1000。建议在移动 project 断言用户名、密码、显示密码和登录按钮的 `boundingBox().height >= 44`，并在 desktop project 保留既有页面可用性检查，避免把 desktop 密集尺寸误当缺陷。
- 审计组件回归：`frontend/src/domains/audit/system-audit-page.test.tsx:100-249` 已覆盖七列、错误/空态、筛选和焦点；但 jsdom 不证明横向几何。
- 审计浏览器回归：`frontend/tests/e2e/system-audit.spec.ts:133-154` 已覆盖 fixture 失败重试、越界恢复、375/768/1024/1440 根无溢出和 ENGINEER 403。建议增加一个空列表 fixture 分支（例如使用不会匹配的 `actorId`）并在 375px 断言 `.audit-list-table` 的空态 status 内容矩形与 viewport 相交，且 `table` 的 `getBoundingClientRect().width` 不大于 region 的 client width；不要只检查 `document.documentElement.scrollWidth`，因为该缺陷被正确限制在 TableShell 的局部滚动区域内。
- 项目规定的 frontend 质量门禁要求 production build/preview、375/768/1024/1440、键盘和局部 TableShell 滚动；相关依据为 `.trellis/spec/frontend/visual-system.md:116-123`、`:6`、`:131-138` 以及 `.trellis/spec/frontend/quality-guidelines.md:96-106`、`:149-157`。开发阶段建议先运行针对性 Vitest，再运行 `npm --prefix frontend run e2e -- tests/e2e/auth-session.spec.ts --project=foundation-mobile` 与 `npm --prefix frontend run e2e -- tests/e2e/system-audit.spec.ts --project=foundation-mobile`；变更共享样式或 auth/audit 测试后再按任务计划运行 frontend typecheck/lint/build 与对应两组 E2E。

### 影响面与非目标

- 预期修改范围仅为 `frontend/src/domains/auth/login-page.tsx`（若选择调用方 class）或认证页专属样式 owner、`frontend/src/styles/global.css` 的 audit-list-table 移动规则，以及登录/审计对应 component/E2E tests；不涉及 backend、OpenAPI、generated client、数据库、业务 HTTP 行为、权限或状态转换。
- `TableShell`、`EmptyTable`、全局 primitive 默认尺寸和系统审计的数据/API owner 都是稳定共享边界，除非新增证据证明局部覆盖无法表达需求，不建议改其公共 API。
- 本研究没有启动浏览器、登录公网实例或修改线上数据；旧管理员密码保持不变。未使用外部资料，结论依据项目源码、当前 frontend specs 和已归档验收证据。

## Caveats / Not Found

- 当前 Task 仍处于 planning 状态，`prd.md` 只有 TBD；本文件提供研究结论，不替代主代理对 PRD、design.md、implement.md 和 acceptance criteria 的最终确认。
- 历史线上报告同时使用“移动产品控件多为 28–32px”的概括，但可定位、可复现且明确编号为 P2-001 的证据是登录页四个控件。产品列表、分页、筛选等其他业务控件是否纳入 P2-001，需要主代理依据用户最终验收范围决定；本研究不扩大范围。
- 未找到现有专门的登录控件几何断言或审计空列表几何断言；现有测试主要验证可见性、语义和根容器不溢出，因此上述回归断言仍需新增。
- 未读取或修改其他 Task、artifacts、`.gitignore`、`backend/app/schemas/configuration.py`，也未开始 `integrity-error-domain-mapping`。
