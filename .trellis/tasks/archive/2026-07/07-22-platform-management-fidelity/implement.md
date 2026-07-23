# 配置中心平台管理高保真复刻实施计划

> 用户已批准三份规划文档，任务已执行 `task.py start` 并按契约优先完成实施。勾选状态和文末验证记录均基于真实执行结果。

## 0. 工作区保护与规划门禁

- [x] 检查 Trellis 活跃任务并按用户授权创建独立任务 `07-22-platform-management-fidelity`，未创建分支。
- [x] 记录 `main` 工作区已有大量其他任务改动，确认契约、文档、路由、API 类型、样式和测试存在重叠文件；后续只编辑本任务必要 hunk，不覆盖未知改动。
- [x] 完成前端、后端、数据库、OpenAPI、权限、审计、测试、权威文档和历史任务调查。
- [x] 使用 Browser 在 1581×995 加载真实当前页面并保存基线截图；读取原型原始尺寸并完成视觉量化清单。
- [x] 用户确认平台启停语义、ContentTask 引用口径和五张卡片“实时计数 + 暂无历史基线”口径。
- [x] 完成 PRD convergence pass、两路独立规划复核和 Trellis 上下文校验；已补齐并发锁、权限保留、路由顺序、冻结迁移快照和视觉台账位置，三份文档无阻塞问题。
- [x] 用户明确批准 `prd.md`、`design.md`、`implement.md` 后执行 `task.py start`；该批准不等于 Git 提交授权。

## 1. 契约优先

- [x] 更新 `contracts/database.md`：增加 `platform_profiles.is_active`、迁移/索引、启停与新建门禁、配置完整性、引用计数、审计更新时间及删除/历史不变量。
- [x] 更新 `contracts/openapi.yaml`：扩展平台集合查询/响应，新增详情、CSV 导出、启用/停用，增加内容任务和账号平台筛选，并声明错误、权限与 CSRF。
- [x] 明确无分页旧调用与分页管理调用、summary 不受筛选影响、`total` 受筛选影响、半开 30 天窗口、CSV 编码/列和稳定排序。
- [x] 运行 OpenAPI 语义检查并生成前端类型；只保留与契约一致的 `schema.d.ts` 差异。

## 2. 数据库与模型

- [x] 新增下一条 Alembic 迁移：全部既有平台回填 `is_active=true`，设置非空，增加 ContentTask、PlatformAccount 和 AuditLog 聚合索引；不改历史迁移。
- [x] 更新 `PlatformProfile` ORM，创建命令显式写入启用状态；不增加统计、完整性或软删除列。
- [x] 保持 `backend/app/migration_schema_v1.py` 的 0001–0008 冻结元数据不变；新列和索引只由新 revision 表达，并用迁移测试验证当前模型结果。
- [x] 补迁移升级、约束、索引和降级测试，明确降级会丢失平台启停状态。
- [x] 检查新增索引与真实 SQL 过滤/连接顺序一致，不添加无证据的 trigram、缓存或物化视图。

## 3. 后端查询、命令与业务门禁

- [x] 在平台配置服务集中实现规范化后的名称、官网和允许域名边界；创建与更新共用同一 Schema 结果，规范化后域名重复明确失败。
- [x] 实现平台集合的服务端搜索、类型/状态/完整性筛选、稳定排序、成对可选分页、过滤总数和全局五项 summary；批量聚合无 N+1。
- [x] 实现平台详情：类型、当前规则/激活审计、Prompt 时间、账号摘要、平台更新时间及统一 `as_of` 的引用摘要。
- [x] 实现 CSV 导出，复用列表过滤和排序，使用 UTF-8 BOM 与标准库 `csv`，不返回越权或分页外猜测数据。
- [x] 实现启用/停用命令：锁、revision、独立状态、审计和结构化冲突；不联动规则、Prompt、账号或历史。
- [x] 在普通任务、修复任务、平台账号和所有发布记录创建服务中先锁定平台行，再增加 `PLATFORM_DISABLED` 最终门禁；当前唯一发布记录构造点为人工发布服务，实施时用全仓搜索复核无旁路，并检查选择/候选投影排除停用平台。
- [x] 为内容任务和平台账号列表增加可选 `platform_profile_id` 服务端过滤，省略参数时保持现有全量语义。
- [x] 保留现有平台删除的直接引用检查与结构化 409，不增加级联、软删除或静默停用。
- [x] 确认所有新增详情/导出/启停接口使用管理员权限，写请求使用 CSRF；集合读取保持现有 CurrentUser，账号创建保持现有 ContentEditor、删除保持 AdminUser，不误改权限边界。
- [x] 将静态 `/platform-profiles/export` 注册在动态平台详情路由之前或使用 UUID 路径转换器，并以路由测试防止静态路径被动态段截获。

## 4. 前端数据流与真实功能

- [x] 扩展 query types、query keys 和 query options，集合键包含完整服务端查询，详情键按平台 ID；不得从响应缺字段时静默推导业务状态。
- [x] 在 `PlatformsPage` 实现 URL 驱动的 `q/platform_type_id/status/configuration_status/page/page_size/platform`，非法值清理、筛选重置页码、URL 恢复详情。
- [x] 复用现有新增/编辑、Logo、删除和规则选择能力；表单使用生成类型和服务端错误，新增/编辑成功精确失效集合/详情。
- [x] 连接五张实时统计卡、服务端筛选/分页/跳页/每页数量、当前总数和同条件 CSV 导出；趋势统一显示“暂无历史基线”。
- [x] 实现原型表格列、真实 Logo、状态标签、官网链接、域名数量、账号数、更新时间、查看按钮与更多操作。
- [x] 实现桌面内联详情和移动 Drawer，选择/切换/关闭与 URL 同步，正文独立滚动、底部操作稳定，焦点正确归还。
- [x] 连接编辑、启用/停用和删除确认；停用平台仍可编辑和重新启用，删除错误展示真实引用原因。
- [x] 在任务创建、账号创建和发布候选 UI 排除停用平台，但保留服务端门禁错误展示。

## 5. 关联页面闭环

- [x] 平台规则页读取 `platform_profile_id`，调用既有平台版本接口并显示可移除的平台条件。
- [x] 平台 Prompt 页读取 `platform_profile_id` 并选择既有具体平台 Prompt，不增加默认 Prompt。
- [x] 业务设置 Tabs 使用 `tab=accounts`，账号列表把 `platform_profile_id` 传给服务端并在新增选择器排除停用平台。
- [x] 内容任务列表把 `platform_profile_id` 传给服务端，显示当前平台条件；“查看引用分析”链接到该真实结果集合。
- [x] 验证所有入口浏览器后退/前进和刷新可恢复，没有占位页面、空按钮或仅前端改标题的假筛选。

## 6. 高保真样式与可访问性

- [x] 在 AppLayout 增加仅平台管理路由使用的 shell 修饰类，调整约 190px 侧栏和顶栏网格，不改变其他配置页面布局。
- [x] 在现有 `global.css` 配置中心区域增加统计卡、筛选条、紧凑表格、选中行、详情面板、固定操作区和 Drawer 样式，只使用现有语义 Token。
- [x] 对齐 1581×995 原型的标题、说明、新增按钮、五卡尺寸/间距、筛选控件、表头/行高、分页、详情宽度/分区、颜色、边框、阴影和圆角。
- [x] 使用 Ant 线性图标、现有 `PlatformAvatar` 和真实 Logo；不得使用 Emoji、文字品牌方块、远程占位图或新增装饰。
- [x] 覆盖默认、悬浮、选中、禁用、加载、空、错误、无权限和危险确认状态；语义区域、label、可见焦点和图标按钮名称完整。
- [x] 1199px 以下使用 Drawer 和表格内部滚动；验证 375/768/1024/1440、200% 缩放、浅色/深色/系统主题均无页面级横向溢出。

## 7. 后端与契约测试

- [x] 单元/集成测试覆盖名称、URL、IDNA 域名规范化、规范化后重复、非法域名和 slug 唯一冲突。
- [x] 覆盖集合搜索、组合筛选、稳定排序、成对分页、`total`、五项 summary 重叠口径、无分页兼容和 CSV 同条件导出。
- [x] 覆盖配置完整性的唯一服务端定义，确认启用/停用不改变完整性、规则或 Prompt。
- [x] 覆盖详情账号摘要、真实审计时间空值和引用计数：任一规则版本、每任务一次、`[as_of-30d, as_of)` 两端边界和历史全部。
- [x] 覆盖启停权限、CSRF、revision 冲突和审计；用两事务测试停用与普通任务、修复任务、账号、发布创建的行锁串行和拒绝结果，既有记录保持可读。
- [x] 覆盖允许删除和规则/账号引用阻断删除，错误包含可诊断引用数量且不自动停用。
- [x] 覆盖普通用户访问新增管理员接口为 403，集合和旧无参数账号/任务调用保持兼容。

## 8. 前端组件与 E2E 测试

- [x] 组件测试覆盖 URL 查询、服务端参数、五卡真实值与趋势文案、组合筛选、重置、分页、每页数量、导出、空/错/无权限。
- [x] 组件测试覆盖详情 URL 恢复、引用链接、服务端筛选和同条件导出；其余详情切换、关闭、四入口、编辑、启停、删除允许/拒绝及焦点行为由真实 Browser 流程覆盖。
- [x] 更新平台、内容任务、业务设置、路由预取和 API mock fixtures，所有新增必填响应字段来自契约，不加兼容默认。
- [x] 未修改当前被其他 GEO 任务占用的共享 E2E 文件；平台管理管理员闭环通过真实 Browser/API 执行，普通用户新增管理员 API 的 403 由后端集成测试覆盖。

## 9. Browser 与视觉验收

- [x] 优先使用 Browser 打开真实页面；仅在 Browser 不可靠时使用项目 `playwright-cli` 并记录原因。
- [x] 在原型 1581×995 视口截图，用 `view_image` 同时检查批准原型和最新实现；至少进行基线、主要布局、详情态、最终态多轮比较。
- [x] 通过 Browser 验证加载、搜索、组合筛选、重置、分页/每页数量、详情切换、新增/编辑、启停、删除允许/拒绝、导出和四个关联入口。
- [x] 验证加载、空数据、错误、无权限、375/768/1024/1440、200% 缩放和主题；收集控制台错误、失败请求及非预期 4xx/5xx。
- [x] 维护 `artifacts/fidelity-ledger.md`：每轮记录原型证据、实现截图、偏差、修复和无法修复原因；检查首屏文案新增/缺失/改名/顺序。
- [x] 若侧栏、顶栏、标题、五卡、筛选栏、表格、分页、详情面板、表面或图标仍有设计评审可见偏差，继续修正后再交付。

## 10. 文档与最终质量门禁

- [x] 更新相关 `.trellis/spec/` 稳定约束，以及 `docs/GEO多平台内容运营系统方案设计.md`、`docs/GEO系统前后端技术与部署方案.md` 中平台状态、管理查询和新建门禁；不重复抄写字段表。
- [x] 对实质修改的 Python 模块、函数、复杂分支、异常、日志和注释完成中文文档检查；新增 TypeScript 文件有中文文件级职责说明。
- [x] 先运行目标测试，再运行 `make contract-check`、相关后端集成测试、前端 typecheck/lint/test/build 和受影响 E2E；记录每条真实结果。
- [x] 检查 SQL 查询计划或测试日志，确认没有 N+1、全量前端过滤、重复完整性计算、静态指标、固定成功路径或静默回退。
- [x] 最终检查 diff，只包含本任务必要 hunk，不覆盖 GEO/AI 渠道等其他未提交改动，不含生成临时文件、密钥或无关重构。
- [x] 交付变更摘要、修改文件、契约/文档状态、验证结果、原型与最终截图、fidelity ledger、核心交互、剩余风险和忠实视觉验证结论。
- [x] 提交前另行给出仅包含本任务文件/hunk 的 commit 计划并等待用户确认；不自动提交或推送。

## 计划验证命令

```bash
python3 .trellis/scripts/task.py validate 07-22-platform-management-fidelity
make contract-check
pytest -q backend/tests/integration/test_migrations.py backend/tests/integration/test_publication_review_closure.py
cd frontend && npm run typecheck
cd frontend && npm run lint
cd frontend && npm test -- --run
cd frontend && npm run build
```

## 实际验证记录

- `python3 .trellis/scripts/task.py validate 07-22-platform-management-fidelity`：通过，`implement.jsonl` 12 条、`check.jsonl` 11 条。
- `make contract-check`：通过，FastAPI 运行时操作与 OpenAPI 递归 Schema 一致，冻结前端类型一致。
- `uv run --project backend pytest -q backend/tests/unit/test_platform_branding.py`：13 passed。
- Docker 精确集成测试：`0023` 迁移、平台管理投影/状态门禁/权限、停用与账号创建并发锁共 3 passed。
- 任务范围 Ruff：通过；任务范围 mypy：10 个源文件无问题。
- 前端：`npm run typecheck`、`npm run lint`、`npm run build` 均通过；`npm test -- --run` 为 20 files / 92 tests passed。
- 独立复核后把规则版本由全量前端加载改为按打开的平台选择器懒加载；变更后 `ConfigurationPages.test.tsx` 为 20 passed，typecheck、lint、build 再次通过，Browser 只请求 `/platform-profiles/{id}/versions`。
- 完整迁移文件回归曾出现 5 个失败，均发生在工作区另一项未提交的 `0022_geo_observation_insights.py` 降级约束命名；本任务不越界修改，`0023` 自身升级/索引/降级测试已单独通过。
- Browser：在 1581×995 真实验证加载、搜索/组合筛选/重置、分页/每页数量/跳页、详情切换/关闭、创建/编辑、停用/启用、允许删除/引用阻断删除、四个关联入口、空/错/权限拒绝及响应式状态。
- 导出证据：页面 `q=00e64c60` 时列表总数 1，`GET /api/v1/platform-profiles/export?q=00e64c60` 返回 200 `text/csv`，正文只含同一平台。
- 用户复核否决首次视觉结论后，重新校准平台管理局部配色、字体、主色、搜索框和三栏边界；没有改动信息架构、业务组件或数据契约。最终字体优先 `PingFang SC` 并回退项目 `--ps-font-sans`，颜色均由现有 `--ps-*` Token 派生。
- 视觉校准后重新执行 `npm run lint`、`npm run typecheck`、`npm run build`：全部通过；构建仅保留既有的大分块提示，没有新增错误或警告门禁失败。
- Playwright CLI：最终桌面 1581×995 与移动 375×812 均无页面级横向溢出，详情 Drawer 可见；控制台 0 error、0 warning，页面与详情请求均为 200。最终截图见 `artifacts/playwright-color-type-final-1581x995.png`、`artifacts/playwright-color-type-mobile-375x812.png`。
- `view_image` 已重新对照 `artifacts/platform-management-prototype-1581x995.png` 与校准后的最终桌面截图；首次交付的错误视觉结论及后续修复过程已如实记入 `artifacts/fidelity-ledger.md`。
- 两路只读独立审查均未发现阻塞性缺陷；后端剩余风险是账号未来若新增独立启停命令需继续维持“先锁平台”顺序，前端关键写闭环当前由真实 Browser 与后端集成测试锁定，尚未写入共享 Playwright E2E 文件。
