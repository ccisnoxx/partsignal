# 业务设置用户管理实施计划

> 当前任务处于 `in_progress`。用户已批准最终规划并授权执行 `task.py start`；实施不等于 Git 提交授权。

## 0. 规划与工作区保护

- [x] 检查 Trellis 活跃任务并在用户授权后创建 `07-23-business-settings-user-management`；任务状态保持 `planning`，未创建分支。
- [x] 记录主工作区存在大量用户/其他任务改动；后续只编辑本任务必要 hunk，不覆盖、清理或提交未知改动。
- [x] 完成前端路由/页面/状态、后端身份/会话/密码/权限/审计、OpenAPI、数据库约束、历史用户引用、测试、权威文档和原型量化调查。
- [x] 将批准原型原样复制到 `artifacts/user-management-prototype-1581x995.png` 并校验尺寸与 SHA-256；未使用 ImageGen。
- [x] 写入 `research/current-state.md`、`research/visual-spec.md` 及可评审的 PRD/设计/实施计划。
- [x] 用户于 2026-07-23 确认五项最小契约包：新账号初始临时密码、状态控件组合语义、无趋势基线、批量部分成功、单一 CSV 格式。
- [x] 用户明确批准三份规划文档后执行 `python3 .trellis/scripts/task.py start .trellis/tasks/07-23-business-settings-user-management`；批准实施不等于 Git 提交授权。

## 1. 契约优先

- [x] 更新 `contracts/openapi.yaml`：为用户列表增加 `q/account_type/status/page/page_size`，增加 `UserStatus`、`UserSummary` 与 summary 响应。
- [x] 按批准决定把 `UserCreate.password` 替换为 `temporary_password` 并声明新用户强制改密；不增加双字段或兼容别名。
- [x] 新增 `POST /api/v1/users/bulk-status`：逐项用户不存在、revision 冲突和最后管理员保护进入 200 响应的 failure；整批认证/权限/CSRF/Schema（含空、重复、超限）分别按 401/403/422 失败。
- [x] 新增 `GET /api/v1/users/export` 的筛选参数、`text/csv` 响应、允许字段和管理员权限；静态路由顺序不得被 `{user_id}` 截获。
- [x] 更新 `contracts/database.md` 的身份状态、初始改密、批量逐项事务、会话撤销、导出审计和历史身份不变量；明确无表/字段/迁移变化。
- [x] 运行 `make contract-generate` 生成 `frontend/src/shared/api/schema.d.ts`，只保留与冻结契约一致的生成差异；不得手改生成类型。
- [x] 运行 OpenAPI 语义/运行时契约检查，先修契约漂移再进入 UI。

## 2. 后端查询、密码与导出

- [x] 在 `backend/app/schemas/common.py` 实现列表 summary、状态枚举、批量请求/结果的 Pydantic 契约；校验批量 1–100 项且 UUID 唯一。
- [x] 在 `backend/app/services/identity.py` 增加用户名/显示名称字面量搜索、类型/状态过滤、`created_at/id` 稳定排序、真实分页、过滤 total 和未筛选实时 summary。
- [x] 列表与导出复用同一个过滤/排序构造函数；搜索转义 `\`、`%`、`_` 并显式使用 LIKE escape，不允许隐式 SQL LIKE 通配。
- [x] 用标准库 `csv` 在内存完整生成批准的 UTF-8 BOM CSV，字段、顺序、状态值和 UTC 时间严格按设计；不返回 UUID、revision、密码、认证或会话信息，不使用流式生成。
- [x] CSV 完整生成后再追加并提交 `user.exported` 审计，最后构造响应；只记录非敏感筛选和行数，不把 CSV 正文或任何密码字段写入审计。
- [x] 按批准语义调整 `create_user`：临时密码只哈希、`must_change_password=true`、默认启用；复核响应/日志/异常中不存在明文。
- [x] 在 `backend/app/routers/identity.py` 连接列表、导出与生成 Schema，确保 `/users/export`、`/users/bulk-status` 在动态用户路由前可达。

## 3. 单个与批量状态事务

- [x] 把现有用户更新的“锁定、revision、最后管理员、状态写入、会话撤销、审计”整理为同文件事务内私有函数；单个和批量共享该唯一不变量。
- [x] 保持单用户 PATCH 的允许字段、用户名不可变、表锁/行锁、修订冲突和自我停用既有语义，不增加系统账号或运行任务的猜测规则。
- [x] 实现批量状态命令：一次表锁、按 UUID 稳定锁行、每项 revision、只改 `is_active`、成功项递增 revision，停用项撤销全部会话。
- [x] 只把写入前产生的预期 `AppError` 转为逐项 failure；不得捕获 `IntegrityError` 后继续，意外数据库/编程/审计错误回滚整批并显式失败，不用宽泛异常捕获。
- [x] 确保批次内最后管理员判断读取同一事务当前状态：可部分成功，但提交后始终至少一个有效管理员。
- [x] 每个批量成功项写现有用户更新审计并标记批量来源；失败项不得出现成功审计；独立复核后进一步确保详情只含实际变化字段。
- [x] 复核重置临时密码、自助改密、服务端强制改密白名单和会话撤销无需平行实现；仅补缺失测试和准确错误。

## 4. 前端信息架构与数据流

- [x] 更新 `frontend/src/app/AppLayout.tsx`：把发布账号、历史目标问题、用户管理、审计日志归入业务设置，按账号类型过滤，配置中心不再重复用户/审计。
- [x] 保留 `/settings` 与 `tab=accounts/platform_profile_id` 深链；导航匹配和预取对查询参数使用同一真实路由，不新增占位页或别名页面。
- [x] 更新 `AppLayout.test.tsx`、`routePrefetch.ts/test`，覆盖管理员/工程师可见项、顺序、选中态和查询参数预取。
- [x] 把 `queryKeys.users` 改为 `all/list(filters)` 层级，列表键包含完整服务端筛选/分页；所有写入失效统一 users 根键。
- [x] 在 `UserManagementPage` 实现 URL `q/account_type/status/page/page_size` 的解析、非法值清理、默认值省略、筛选回第 1 页和越界页显式纠正。
- [x] 删除前端全量过滤和本地业务分页；summary、items、total/page/page_size 均只读生成契约。
- [x] 状态选择器和“显示停用账号”开关投影同一状态；移除旧 `inactive` 作为第二状态源并同步文档。

## 5. 用户页面真实功能

- [x] 迭代现有 `/users`，实现全局唯一面包屑、标题/说明、新增按钮、五张实时统计卡、筛选条、当前总数、表格、分页和右侧说明栏。
- [x] 五卡加载用 Skeleton/占位符，成功只显示 summary；趋势按批准文案显示“暂无历史基线”，不使用 0 或样例数字伪装加载/历史。
- [x] 表格实现稳定头像回退、全部批准列、状态文字标签、准确 Ant 图标、Tooltip、行内编辑/重置/启停和更多操作。
- [x] 新增/编辑/重置 Modal 只使用生成 Schema；敏感表单关闭/成功后销毁，密码字段使用正确 `autoComplete`，不进入 URL 或持久化状态。
- [x] 单个启停通过现有 PATCH 与 revision，停用确认说明会话影响；自我停用成功后由全局认证失效流程回登录页。
- [x] 使用 Ant Table 原生 `rowSelection` 作为唯一批量目标；筛选、翻页、每页数量或数据刷新后清除不可见选择，不做跨页隐式全选。
- [x] 连接批量启用/停用；有失败时在同一上下文列出用户名、code/message，并同时承认真实成功项，不显示“全部成功”。
- [x] 连接当前筛选 CSV 下载，复用平台页 Blob/Content-Disposition 模式；加载、失败和空导出均有明确反馈。
- [x] 右栏只展示真实 ADMIN/ENGINEER 权限摘要、已确认临时密码行为、无删除/历史保留提示和三个真实快捷操作。
- [x] 查询/表单/批量/导出覆盖加载、空、错误、403、409、`LAST_ADMIN_REQUIRED` 和失败重试；不静默回退或自动重试写命令。

## 6. 高保真样式与可访问性

- [x] 为 `/users` 增加局部 shell 修饰类，1581×995 桌面侧栏约 186–190px，不改变其他配置/业务页面宽度。
- [x] 在现有全局样式中增加 `.user-management-*` 规则，对齐五卡尺寸/间距、筛选基线、表头/50px 行高、操作按钮、分页和约 300px 右栏。
- [x] 只使用现有主题语义 Token、Ant 线性图标和稳定头像回退；不硬编码第二色板、不用 Emoji/远程随机图、不添加无功能顶栏按钮。
- [x] 覆盖默认、悬浮、选中、聚焦、禁用、加载、空和错误；状态不只依赖颜色，图标按钮有 Tooltip/`aria-label`，表单有可见 label。
- [x] 1199px 以下按现有规则将右栏堆叠到主区后；表格内部滚动，375/768/1024/1440 和 200% 等效 CSS 视口无页面级横向溢出。
- [ ] 未逐键盘执行弹窗焦点圈定、Escape、关闭后焦点归还及全部操作链；使用 Ant Modal/Form 原生焦点行为，Browser 已验证打开/关闭和可见 label，作为剩余人工无障碍检查项。

## 7. 后端与契约测试

- [x] 新增 `backend/tests/integration/test_identity_management.py`，覆盖管理员/工程师权限、CSRF、创建/编辑/启停/重置/改密、修订冲突和最后管理员保护。
- [x] 覆盖列表搜索字面量、组合筛选、稳定排序、分页边界、过滤 total 与未筛选 summary 的全部口径。
- [x] 覆盖创建临时密码首次强制改密、旧临时密码失效、其他会话撤销，日志/审计/响应不含明文。
- [x] 覆盖批量全部成功、部分 404/revision/最后管理员失败、空/重复/超限、会话撤销、逐项审计，以及注入审计/数据库意外错误时整批回滚。
- [x] 覆盖另有有效管理员时自我降权、自我停用成功，自停用后当前会话被拒绝，以及最后管理员同类操作被拒绝。
- [x] 覆盖 CSV 同筛选/排序、UTF-8 BOM、批准列、空集合、普通用户 403、导出审计和敏感字段黑名单。
- [x] 覆盖停用并重新启用后同一用户 UUID 仍被历史业务引用，业务行和审计未被删除/改写。
- [x] 运行契约单元测试和任务范围 Ruff/mypy；本任务无迁移，不新增迁移文件或迁移测试。

## 8. 前端组件与 Browser 测试

- [ ] 组件测试已覆盖 URL/API 参数、summary、状态联动、重置和服务端分页参数；选择清理由 Browser 验证，越界页与空/错误状态尚无独立组件用例。
- [ ] 组件测试已覆盖新增/敏感销毁、批量部分失败/最后管理员错误；编辑、重置、单个启停、revision 错误和 CSV Blob 尚无独立前端用例，对应后端契约由隔离集成测试覆盖。
- [x] 更新所有受 UserList summary 与 UserCreate 字段影响的 API fixtures，不加可选链或默认值掩盖契约缺失。
- [x] 先使用 Browser 打开真实页面完成渲染与交互验证；Browser 固定为 1280×720 且不能设置原型视口，因此按设计约定回退到项目 `playwright-cli` 生成 1581×995 原生截图。
- [x] 在 1581×995 用 `view_image` 同轮比较批准原型和最新截图，核对导航/顶栏、标题与五卡、筛选与表格、分页与右栏、颜色/图标五组证据。
- [ ] Browser 已真实验证搜索/筛选/重置、新增弹窗和批量选择清理；为避免在不可删除的开发库留下账号或撤销当前管理员会话，未手工提交新增/重置/自停用等破坏性命令，这些流程由临时 PostgreSQL 集成测试覆盖。
- [ ] Browser 已验证 375/768/1024/1440、200% 等效 CSS 视口、浅色/系统主题和最终标签页 console；未单独人工验证深色主题、注入查询错误与 403/409 页面状态。
- [x] 维护 `artifacts/fidelity-ledger.md`，记录每轮原型/实现证据、差异、修复和有依据的保留差异；首屏文案新增/缺失/改名/顺序逐项检查。

## 9. 文档与最终质量门禁

- [x] 更新 `frontend/README.md` 的业务设置导航和用户页 URL 参数。
- [x] 更新 `docs/GEO多平台内容运营系统方案设计.md` 中用户管理、权限、强制改密、批量/导出和历史身份关系；只描述已实现/已批准事实。
- [x] 按长期复用价值更新 `.trellis/spec/frontend/state-management.md` 及必要后端规范，不重复维护 OpenAPI 字段表。
- [x] 对实质修改的 Python 模块/函数/异常/审计完成中文注释与开发者文本检查；新增 TypeScript 文件使用中文文件级职责说明，显然代码不加机械注释。
- [x] 先运行目标测试，再运行 contract-check、前端 typecheck/lint/test/build 和必要集成/Browser；结果与跳过原因记录如下。
- [x] 检查本任务最终 diff：无密码泄露、第二权限源、重复状态规则、前端全量过滤、宽泛异常吞噬、静默默认、固定成功、用户删除或未说明行为变化；工作区其余既有改动保持未触碰、未清理、未纳入提交。
- [ ] 交付变更摘要、修改文件、契约/文档状态、验证结果、原型与最终截图、fidelity ledger、核心交互、剩余风险和忠实视觉验证结论。
- [ ] 提交前另行提供只包含本任务文件/hunk 的 commit 计划并等待用户确认；不自动提交或推送。

## 计划验证命令

```bash
python3 .trellis/scripts/task.py validate .trellis/tasks/07-23-business-settings-user-management
make contract-check
UV_CACHE_DIR=.cache/uv uv run --project backend pytest -q backend/tests/unit/test_contract.py
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest -q backend/tests/integration/test_identity_management.py
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/schemas/common.py backend/app/routers/identity.py backend/app/services/identity.py backend/tests/integration/test_identity_management.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app/schemas/common.py backend/app/routers/identity.py backend/app/services/identity.py
npm --prefix frontend run test -- src/features/users/UserManagementPage.test.tsx src/app/AppLayout.test.tsx src/app/routePrefetch.test.ts
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
```

Browser/Playwright 的真实命令、截图和结果在实施期写入本文件“实际验证记录”；规划阶段不启动会迁移或写入数据库的完整应用栈。

## 实际验证记录（2026-07-23）

- `make contract-generate`：通过，OpenAPI 生成类型已同步。
- `make contract-check`：通过，FastAPI 运行时操作、OpenAPI 0.1.1 递归 Schema 和生成 TypeScript 类型一致。
- `UV_CACHE_DIR=.cache/uv uv run --project backend pytest -q backend/tests/unit/test_contract.py`：2 passed；仅有 Starlette/httpx 上游弃用警告。
- `docker compose --env-file .env -f deploy/compose.dev.yaml --profile test run --rm backend-test pytest tests/integration/test_identity_management.py -q`：2 passed，使用临时 PostgreSQL 验证查询/summary/CSV、临时密码、权限/CSRF、单个与批量事务、最后管理员、会话撤销、审计脱敏、历史引用和意外错误整批回滚；仅有同一 Starlette/httpx 上游弃用警告。
- `UV_CACHE_DIR=.cache/uv uv run --project backend ruff check ...`：本任务后端文件全部通过。
- `UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml ...`：4 个本任务源文件无类型错误。
- `npm --prefix frontend run test -- src/features/users/UserManagementPage.test.tsx src/app/AppLayout.test.tsx src/app/routePrefetch.test.ts`：3 个文件、16 个用例通过；jsdom 记录不支持伪元素 `getComputedStyle`，不影响断言结果。
- `npm --prefix frontend run typecheck`：通过。
- `npm --prefix frontend run lint`：全量 ESLint 与主题颜色检查通过。
- `npm --prefix frontend run build`：生产构建通过，4925 个模块完成转换；保留项目既有主 chunk 大于 500 kB 警告，本任务用户页独立产物约 18.61 kB（gzip 6.96 kB）。
- `python3 .trellis/scripts/task.py validate .trellis/tasks/07-23-business-settings-user-management`：通过，`implement.jsonl` 12 项、`check.jsonl` 11 项均有效。
- Browser：在 `http://localhost:5173/users` 以真实 API/PostgreSQL 验证默认启用视图、`status=ALL`、搜索、重置、服务端总数、选择清理和新增弹窗；最终标签页 console error/warn 为空。1581×995、375、768、1024、1440 和 790×498 等效 200% CSS 视口均无页面级横向溢出；截图与量化差异见 `artifacts/fidelity-ledger.md`。
- 视觉重映射复核：`/users` 已解除 `.app-shell-configuration` 玻璃外壳继承，使用独立全出血壳层并统一 PingFang SC；重新校准冷白背景、蓝紫主色、9px 卡片圆角、轻阴影及 4px 浅色填充标签。Browser 先验证真实页面与“显示停用账号”开关往返，因固定 1280×720 视口改用 `playwright-cli` 在 1581×995、`status=ALL`、130 条真实数据条件下生成 `artifacts/user-management-final-remapped-1581x995.png`；同轮 `view_image` 对照原型，控制台 error 为 0。
- 视觉重映射增量质量门：用户页与 AppLayout 目标测试 2 文件、13 用例通过；`npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`、`npm --prefix frontend run build`、任务 `validate` 和目标文件 `git diff --check` 均通过。生产构建仅保留项目既有主 chunk 大于 500 kB 警告。
- 未在 Browser 提交新增、重置、自停用等会永久留下账号或撤销当前会话的命令，也未单独验证深色主题和注入式错误页；前者由隔离 PostgreSQL 集成测试覆盖，后两项保留为人工回归风险。
