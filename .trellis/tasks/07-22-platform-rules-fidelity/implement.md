# 配置中心平台规则高保真复刻实施计划

> 当前仅供最终评审。用户在后续消息中批准最新规划摘要后才执行 `task.py start`；规划批准不等于 Git 提交授权。

## 0. 工作区保护与实施门禁

- [x] 经用户授权创建独立 Trellis 任务 `07-22-platform-rules-fidelity`，保持 `main` 单分支且未提交、未推送。
- [x] 完成前端、后端、数据库、OpenAPI、状态命令、审计、引用链、测试、文档和历史任务调查。
- [x] 使用 Browser 在 1581×995 读取真实当前页面并保存基线；固化批准原型并完成视觉量化清单。
- [x] 记录工作区已有平台管理、GEO、AI 与规则 URL 筛选等未提交改动；后续只改必要 hunk，不整文件覆盖或回退用户变更。
- [x] 用户确认 PRD 的规则字段、退役语义和影响分桶契约保守基线。
- [x] 用户明确批准 `prd.md`、`design.md`、`implement.md` 后执行 `python3 .trellis/scripts/task.py start 07-22-platform-rules-fidelity`。

## 1. 契约优先

- [x] 更新 `contracts/openapi.yaml`：新增 `PlatformProfileVersionSummary`、动作枚举、`PlatformRuleImpactSummary` 和影响接口；版本列表 items 使用管理投影。
- [x] 为 `GET /content-tasks` 增加 `platform_profile_version_id`，声明与 `platform_profile_id` 的 AND 语义及省略参数兼容。
- [x] 把 `AuditLogOut.actor_id` 改为 required nullable，确保 Actor 删除后的历史仍有契约表达；不新增同义 Actor 字段。
- [x] 明确所有新增/变更接口的权限、404/409/422、CSRF（写接口）、revision 和响应必填字段，不增加可猜测兼容分支。
- [x] 运行 `make contract-check` 的语义部分并执行 `make contract-generate`；检查 `schema.d.ts` 只包含批准契约的生成差异。

## 2. 后端批量投影与影响摘要

- [x] 在现有配置/投影服务新增规则版本批量投影，一次聚合引用数和一次聚合审计元数据；禁止版本卡 N+1。
- [x] 创建人只认 `platform_profile_version.created` 审计，激活时间只认 `activated`，最后变更时间按设计中的权威集合计算；缺失演员返回 `null`。
- [x] 集中计算 `available_actions`，并写单元测试固定 DRAFT/ACTIVE/RETIRED × 有无引用的动作矩阵。
- [x] 实现单版本影响服务和路由，使用单条 SQL/CTE 对直接引用任务去重并执行发布→审核→未发布优先级。
- [x] 在目标数据库或集成数据库检查影响 SQL 执行计划；现有规则版本与内容版本索引命中，无需新增迁移。
- [x] 扩展内容任务列表查询，按平台和/或规则版本过滤；无参数路径保持现有排序与响应。

## 3. 状态命令与审计闭环

- [x] 保持创建、更新、激活、直接退役和删除的现有权限、CSRF、revision、状态与引用门禁。
- [x] 激活替代时在旧 ACTIVE 上追加 `retired(reason=REPLACED)` 审计，并在新版本 `activated` 审计记录 previous ID；两条事件携带命令 comment。
- [x] DRAFT 直接退役审计记录 `reason=DIRECT` 和 comment；不得给创建/更新补造不存在的人工摘要。
- [x] 通用审计路由不再丢弃 `actor_id IS NULL` 事件，修复 `total` 与 items 不一致；检查受影响审计页和 AI 审计构造点的生成类型。
- [x] 用两事务集成测试验证同平台并发激活串行、最多一个 ACTIVE、旧/新 revision、双审计及异常整体回滚。
- [x] 覆盖任意状态零引用删除、任意任务引用阻断及列表显示可删除后竞态重检。

## 4. 前端查询与 URL 状态

- [x] 扩展 `queryKeys.ts` 与 `queryOptions.ts`：规则版本影响、参数化审计 key、按平台版本列表和用户姓名解析；不保留静态审计 key 冲突。
- [x] 扩展 `types.ts` 的生成路径类型别名，只引用 `schema.d.ts`，不手写第二套响应结构。
- [x] 在 `PlatformRulesPage` 以 URL 唯一拥有 `q/platform_profile_id/version_id`，实现默认选择、深链、非法 ID 局部错误和浏览器历史恢复；平台列不提供启停状态筛选。
- [x] 平台查询复用平台管理在途契约；版本查询复用现有按平台接口，保留用户已有 `platform_profile_id` 改动并消除页面内临时 query 定义。
- [x] 写成功精确失效版本列表、影响、审计、平台投影和必要候选查询；不使用全局清空或静默成功。

## 5. 四列工作台与真实功能

- [x] 重构 `PlatformRulesPage.tsx` 为平台列、版本列和页面编排；平台列仅保留平台管理入口、搜索及真实 Logo/名称/版本数，不复制“规则版本”页签或平台状态；保留现有 RuleEditor、范围校验、章节表单和结构化错误。
- [x] 新增 `PlatformRuleDetail.tsx`，用单一字段描述表渲染全部现有规则和类型化差异 Modal；覆盖字符串、范围、布尔、数组、栏目、首版本和无变化。
- [x] 新增 `PlatformRuleMetaPanel.tsx`，展示状态、审计元数据、影响、历史和危险操作；窄屏复用同一内容到 Drawer。
- [x] 版本卡展示真实状态、创建人/时间、激活时间（需要时）、自动差异摘要和引用数；无来源字段显示明确空值，不写原型示例。
- [x] 连接新增草稿、编辑、激活、DRAFT 直接退役和删除；动作只来自 `available_actions`，命令收集非空 comment 与最新 revision。
- [x] “查看引用详情”链接到 `/tasks?platform_profile_version_id=...`；内容任务页解析、显示、移除并发送该筛选，不做前端全量过滤。
- [x] “查看完整历史”使用真实审计筛选；删除用户 Actor 显示“已删除用户”，未知非空 ID 显示稳定 ID 而非猜名称。

## 6. 高保真样式与响应式

- [x] 在 `AppLayout.tsx` 只扩展现有配置中心路由修饰逻辑，使平台规则页使用约 190px 侧栏和目标顶栏网格；不改变非配置页面。
- [x] 在现有 `global.css` 添加平台规则命名空间样式，按 `research/visual-spec.md` 对齐四列宽度、间距、行高、版本卡、规则行、右栏、边框、圆角、阴影和背景。
- [x] 只使用现有语义 Token、Ant 线性图标和 `PlatformAvatar`；不增加硬编码主题色、Emoji、品牌字块或远程占位资产。
- [x] 覆盖默认、悬浮、选中、加载、空、局部错误、无权限、禁用、保存中和危险确认；状态文本不只依赖颜色。
- [x] 1199px 以下右栏进入 Drawer，767px 以下使用平台→版本→详情分步布局；验证长 URL/长受众、独立滚动和无页面横向溢出。
- [ ] 检查图标按钮名称、键盘顺序、Modal/Drawer 焦点圈定、关闭焦点归还和 200% 缩放。（按钮名称与 Ant 焦点契约已检查；Browser 无独立真实缩放控制，已用等效窄视口覆盖，待发布前人工复核真实 200%。）

## 7. 后端与契约测试

- [x] 在现有平台规则生命周期集成测试旁补充批量列表元数据、动作矩阵、Actor 可空和任务精确筛选。
- [x] 补充影响摘要测试：零引用、三桶、桶优先级、多内容版本、多发布记录、去重和总和不变量；发布失败/移除语义继续由现有发布生命周期测试覆盖。
- [x] 补充激活替代双审计、comment、并发、revision 和回滚；确认数据库部分唯一索引仍是最终约束。
- [x] 补充三状态物理删除允许/阻断和列表动作竞态；错误继续包含真实引用数量。
- [x] 无数据库结构变化，无需新增迁移或修改 `test_migrations.py`。
- [x] 保持现有普通用户读权限、管理员审计/用户读取、非管理员写入、CSRF 和状态/revision 门禁；新增读接口复用现有依赖。

## 8. 前端组件与 E2E 测试

- [x] 更新 `ConfigurationPages.test.tsx`，覆盖 URL、四列状态、局部失败、用户姓名、版本元数据和影响三桶。
- [x] 覆盖创建/编辑/激活/直接退役/删除允许与拒绝、comment/revision 载荷、精确失效和成功反馈。
- [x] 覆盖差异模型、首版本、无变化、长数组、栏目 URL 与语义交互；jsdom 不断言像素坐标和实际 sticky。
- [x] 更新内容任务列表测试，断言 URL 参数发送服务端、筛选标签与移除行为；无参数测试继续通过。
- [x] 更新现有 E2E 的真实规则页激活流程；本轮核心替代、差异、历史与引用入口由 Browser 真实 API 流程补充验证，不硬编码原型人物或数字。

## 9. Browser 与视觉验收

- [x] 优先使用 Browser 加载真实页面；Browser 已覆盖本任务，无需以 `playwright-cli` 替代核心验收。
- [x] 在 1581×995 保存四列骨架、选中版本、差异、状态确认和最终截图，用 `view_image` 与批准原型逐轮比较。
- [x] 建立 `artifacts/fidelity-ledger.md`，逐项登记 `research/visual-spec.md` 的 18 个检查点、偏差、修复和有依据的保留差异。
- [x] 实际点击平台/版本切换、创建、编辑、激活、DRAFT 退役、删除允许/拒绝、差异、历史、引用详情和浏览器后退恢复。
- [ ] 验证加载、空、局部错误、无权限、零引用、无审计、长文本、375/768/1024/1440、1581×995、200% 缩放和三种主题。（除 Browser 无法独立设置的真实 200% 缩放外均已覆盖；等效窄视口已通过。）
- [x] 收集最终干净标签页控制台错误和失败请求，确认没有本任务引入错误或非预期 4xx/5xx；最终 `warn/error` 为空。

## 10. 文档与质量门禁

- [x] 更新 `contracts/database.md` 的规则状态、自动替换审计、引用/影响口径和无新状态源说明。
- [x] 更新 `docs/GEO多平台内容运营系统方案设计.md` 与技术部署方案中的平台规则工作台、影响定义和测试矩阵，并修正固定五类平台旧描述。
- [x] 只把稳定的数据库投影、审计与分桶约束写入 `.trellis/spec/`，未复制实施清单。
- [x] 对实质修改 Python 模块、函数、复杂 SQL、异常、日志和注释完成中文文档检查；新增 TypeScript 文件包含中文文件级职责说明。
- [x] 先运行最小目标测试，再运行契约、类型、lint、前端测试、相关 PostgreSQL 集成和构建；纵向 E2E 已执行且平台规则段通过，随后被当前 AI 详情路由与旧重定向断言不一致阻断，规则页真实替代流程另由 Browser 完整覆盖。
- [x] 检查最终 diff 是否存在 N+1、全量前端计数、重复状态逻辑、静默默认、宽泛 catch、死代码、固定成功路径、第二数据源或无关改动。
- [x] 交付变更摘要、文件、契约/文档状态、验证结果、原型/最终截图、fidelity ledger、核心交互和剩余风险。
- [ ] 提交前另行给出只含本任务文件/hunk 的 commit 计划并等待用户确认；不自动提交或推送。

## 计划验证命令

```bash
python3 .trellis/scripts/task.py validate 07-22-platform-rules-fidelity
make contract-check
uv run --project backend pytest -q backend/tests/integration/test_publication_review_closure.py backend/tests/integration/test_migrations.py
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test -- src/features/configuration/ConfigurationPages.test.tsx src/features/content-tasks/ContentTasksPage.test.tsx
npm --prefix frontend run build
```

实施时先运行新增的精确测试节点；完整 E2E 通过项目现有 `deploy/scripts/e2e-local.sh` 或等价受影响 spec 执行。命令是否成功只在真实运行后记录，不预填结果。
