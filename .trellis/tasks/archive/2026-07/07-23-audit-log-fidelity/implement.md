# 审计日志高保真复刻与审计闭环实施计划

## 0. 实施门禁

- 当前任务保持 `planning`。
- “九类关键命令”失败/拒绝范围已于 2026-07-23 获用户确认；用户评审本次最终规划摘要并明确批准进入实施后，才运行 `task.py start`。
- 开始前重新确认主工作目录仍在 `main`，记录并避开现有未提交用户修改；不创建分支、不自动提交或推送。
- 公共契约和数据库改动由主 Agent 完成；提交前另行提供提交计划并等待用户确认。

## 1. 基线与契约先行

### 1.1 基线

1. 记录 `git status --short`，标出本任务将触碰且已有用户修改的文件。
2. 运行最小现有基线：身份审计集成测试、AI 审计测试、平台规则投影测试、现有配置前端测试和契约检查。
3. 如基线失败，先区分既有失败与本任务回归，不为通过测试修改无关代码。

### 1.2 更新契约

修改：

- `contracts/openapi.yaml`
- `contracts/database.md`
- `backend/app/schemas/common.py`
- `frontend/src/shared/api/schema.d.ts`（由 `npm --prefix frontend run api:generate` 生成）

内容：

- `AuditModule`、`AuditOutcome`、actor 当前投影、nullable target、列表项、详情、变化项、关联状态。
- 列表组合参数、详情端点和真实筛选选项端点。
- 明确 UTC、`[created_from, created_to)`、请求 ID 相关而非唯一、管理员权限、成功/失败事务边界和安全摘要。

先运行：

```bash
make contract-generate
make contract-check
```

## 2. 数据库迁移

修改：

- `backend/app/models/identity.py`
- 新增当前 Alembic head 之后的单一迁移文件
- `backend/tests/integration/test_migrations.py`

步骤：

1. 添加 `business_module/outcome/result_message/error_code`，允许失败创建的 `target_id` 为空。
2. 迁移先验证全部历史 action/target 组合可分类；未知组合直接失败。
3. 精确回填现有成功和已文档化 AI 失败记录，不推断其他历史字段。
4. 添加 CHECK、非空约束和 `(created_at DESC, id DESC)`。
5. 对候选筛选索引运行代表性 `EXPLAIN (ANALYZE, BUFFERS)`，只加入有观测收益者。
6. 编写升级、当前 head、不可安全降级三类测试。

定向验证：

```bash
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/integration/test_migrations.py -q
```

## 3. 审计领域与查询服务

### 3.1 强类型和写入

新增/修改：

- 新增 `backend/app/audit_types.py`
- 修改 `backend/app/audit.py`
- 修改 `backend/app/main.py`

工作：

1. 定义 `AuditModule/AuditOutcome/AuditEntry`，避免继续传递松散长参数。
2. `append_audit(db, entry)` 只加入当前事务；`commit_audit(entry)` 只用于已回滚的失败/拒绝。
3. details 改为 `changes/facts` 白名单结构；完善敏感键第二道检查。
4. 请求 ID 中间件验证长度和控制字符，仍允许重复。
5. 不捕获并吞掉数据库或编程异常。

### 3.2 查询与安全投影

新增/修改：

- 新增 `backend/app/services/audit_logs.py`
- 修改 `backend/app/routers/identity.py`
- 修改 `backend/app/schemas/common.py`

工作：

1. 从路由移出增长后的查询/投影，路由只保留管理员依赖和参数。
2. 同一条件构建列表与 count，按 `created_at DESC, id DESC` 排序。
3. 一次联结/批量投影 actor，明确当前目录语义和已删除用户。
4. 列表/详情只投影白名单摘要；保留平台规则和 AI 渠道现有安全键。
5. 详情固定检查已支持对象类型的存在/父级，不生成任意 URL。
6. action/target type 选项只从数据库真实 distinct 值产生，不维护第二套事件枚举。

## 4. 全部现有成功调用点迁移

因为 `business_module/outcome/result_message` 为非空强契约，使用：

```bash
rg -n 'append_audit\(' backend/app
```

逐个调用点改为显式 `AuditEntry`，不进行无证据批量猜测。受影响服务预计包括：

- `backend/app/services/identity.py`
- `backend/app/services/platform_configuration.py`
- `backend/app/services/content_planning.py`
- `backend/app/services/review.py`
- `backend/app/services/publication.py`
- `backend/app/services/geo_observation.py`
- `backend/app/services/product_facts.py`
- `backend/app/services/content_production.py`
- `backend/app/services/file_records.py`
- `backend/app/services/ai_configuration.py`

规则：

- 原 action 和 target type 不改名。
- 一般成功明确写 `SUCCESS`；AI 测试/发现现有真实失败明确写 `FAILED`。
- 一般结果说明使用受控“操作已完成”；九类关键事件使用具体但不含业务载荷的说明。
- 不顺手补其他业务功能或重构服务。

## 5. 九类失败/拒绝闭环

### 5.1 权限纯函数

修改 `backend/app/deps.py`：提取 `assert_account_types`，现有依赖和九类路由共用同一权限权威。不得复制账号类型判断。

### 5.2 路由显式边界

修改：

- `backend/app/routers/configuration.py`
- `backend/app/routers/planning.py`
- `backend/app/routers/production.py`
- `backend/app/routers/publication.py`
- `backend/app/routers/observation.py`
- `backend/app/routers/identity.py`
- `backend/app/routers/product_facts.py`

对覆盖矩阵中的具体 handler：

1. 认证与 CSRF 保持现有依赖。
2. 在 handler 内显式检查账号类型并调用原服务。
3. 仅捕获 `AppError`；rollback 后写 `FAILED/DENIED`，再原样抛出。
4. 创建失败 target 为空；已有对象命令使用路径 ID。
5. 不记录请求体、异常文本或可疑自由文本。

### 5.3 成功摘要

修改九类权威服务调用点，只在已经锁定并真实读取的值上写 changes：

- 平台/用户：启停和允许的配置字段前后值或计数。
- 规则/内容/事实/发布：状态和 revision 前后值。
- Prompt：是否已配置与 revision，不含 Markdown。
- GEO：新建/更正关系和安全计数，不含搜索结果正文或 notes。
- 账号删除：仅记录删除动作和无引用校验完成，不记录凭据。

## 6. 后端测试

新增/更新：

- 新增 `backend/tests/unit/test_audit.py`：强类型、安全白名单、敏感嵌套、受控消息。
- 更新 `backend/tests/integration/test_identity_management.py`：管理员列表/详情、组合筛选、当前 actor 投影、请求 ID、权限、不可变触发器。
- 更新 `backend/tests/integration/test_ai_channel_management.py`：既有 AI 失败 outcome 和安全摘要。
- 更新 `backend/tests/integration/test_publication_review_closure.py`：关键发布/审核成功、失败、拒绝事务。
- 更新相关平台、GEO、用户、产品事实测试覆盖九类事件。

必须断言：

- 成功状态与审计同时提交，审计失败时业务回滚。
- 业务失败/拒绝不改变状态，但独立审计存在。
- 请求解析、未登录和 CSRF 不产生业务审计。
- UPDATE/DELETE 在 PostgreSQL 触发器层失败。
- 列表与详情不返回禁用键/值，关键字不扫描未批准字段。
- 同时间戳稳定排序，组合筛选和 total 一致。

## 7. 前端实现

### 7.1 数据层

修改：

- `frontend/src/shared/api/queryKeys.ts`
- `frontend/src/shared/api/queryOptions.ts`
- 生成的 `frontend/src/shared/api/schema.d.ts`

增加全局列表、详情、action 选项 key/options；参数对象直接进入稳定 query key，不在页面维护第二份缓存。

### 7.2 页面与壳

修改：

- `frontend/src/features/configuration/AuditLogPage.tsx`
- 视实施复杂度新增 `AuditLogFilters.tsx`、`AuditLogDetailPanel.tsx`，否则保留在页面文件
- `frontend/src/app/AppLayout.tsx`
- `frontend/src/shared/components/StatusTag.tsx`
- `frontend/src/styles/global.css`

实现顺序：

1. URL 解析/canonical、默认最近三天、服务端分页。
2. 原型两行筛选、关键字和重置。
3. 记录总数、30 秒可见页自动刷新、手动刷新。
4. 十列表格、状态标签、选中行和分页。
5. 桌面 `315px` 详情 aside、窄屏 Drawer、变更/结果/关联入口。
6. AppLayout 审计路由 `188px` 级侧栏和“审计与安全”面包屑。
7. 加载、刷新、空、错误、无权限、目标缺失和 unsupported 状态。

遵守：不硬编码主题颜色；不让所有表格列等宽；操作列在需要时 fixed right；按钮和开关有可访问名称；查询参数变化不抢焦点。

### 7.3 前端测试

新增/更新：

- 新增 `frontend/src/features/configuration/AuditLogPage.test.tsx`
- 更新 `frontend/src/app/AppLayout.test.tsx`
- 更新 `frontend/src/features/configuration/ConfigurationPages.test.tsx` 的 AuditLog fixture
- 按需更新 `frontend/src/shared/components/StatusTag` 测试

覆盖：URL 恢复/规范化、组合参数、重置、分页、手动/自动刷新和页面隐藏暂停、详情切换/关闭、历史缺失值、关联入口、加载/空/错误、非管理员重定向。

定向验证：

```bash
npm --prefix frontend run test -- AuditLogPage AppLayout ConfigurationPages
npm --prefix frontend run typecheck
```

## 8. 权威文档同步

实现同轮更新：

- `contracts/openapi.yaml`
- `contracts/database.md`
- `docs/GEO多平台内容运营系统方案设计.md`
- `docs/GEO系统前后端技术与部署方案.md`
- 必要时补充 `.trellis/spec/backend/database-guidelines.md` 的追加式审计迁移/事务约束

文档只写最终已实现行为：权限范围、结果语义、失败事务、时间/身份/request ID、敏感白名单、查询和保留范围。若最终没有新增稳定开发约束，不为形式创建新 spec 文件。

## 9. 验证顺序

### 9.1 定向检查

```bash
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/unit/test_audit.py -q
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/integration/test_identity_management.py -q
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/integration/test_ai_channel_management.py -q
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/integration/test_publication_review_closure.py -q
npm --prefix frontend run test -- AuditLogPage AppLayout ConfigurationPages
```

### 9.2 跨层质量门

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
npm --prefix frontend run build
```

如完整集成测试或构建因环境/既有工作区状态无法运行，交付时列出真实失败、已运行替代检查和剩余风险，不以置信度代替证据。

### 9.3 Browser 功能和视觉 QA

1. 启动项目既有本地服务和真实开发数据库，不使用静态审计假数据。
2. Browser 打开 `/audit`，设置 `1581 × 995` 视口。
3. 验证页面加载、所有筛选、请求 ID 精确查询、关键字、重置、分页/跳页、手动/自动刷新、详情、结果、关联入口、无权限/缺失、加载/空/错误。
4. 检查控制台错误和失败网络请求。
5. 截取最新实现；同轮用 `view_image` 查看原型和截图，按 `research/visual-spec.md` 分区域比较。
6. 每轮把原型证据、实现证据、差异、修复或保留原因写入 fidelity ledger；明显偏差未解决时继续调整。
7. 以移动断点补一轮可达性检查，不发明移动端新信息架构。

## 10. 最终 diff 审计

交付前逐项检查：

- 无审计 UPDATE/DELETE API，触发器仍有效。
- 无敏感键、任意原始 JSONB、第三方错误/响应或 Prompt 正文泄露。
- 无前端事件、第二张表、第二 action 枚举、静默 fallback、固定成功或广泛异常吞噬。
- 成功与失败事务边界符合设计，所有新增字段只有一个权威来源。
- 查询键、URL、API 参数和数据库条件一致；总数和 items 使用同条件。
- 现有 AI/规则对象历史没有因安全投影回归。
- 未混入现有用户脏文件中的无关修改。
- 代码、契约、测试和权威文档一致。

## 11. 提交前门禁

完成并验证后先向用户提供提交计划，列出拟提交文件和 commit message；获得确认后才可提交到主工作目录 `main`。不得自动 push。
