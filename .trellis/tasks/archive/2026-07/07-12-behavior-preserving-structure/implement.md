# 阶段五：行为保持的代码结构改善实施计划

## 执行规则

- 严格按切片顺序执行；每个切片通过定向回归后才进入下一切片。
- 每次先写或确认特征测试，再移动实现；优先删除重复逻辑。
- 手工编辑不得触碰迁移、`contracts/openapi.yaml` 或 `contracts/database.md`。
- 每个切片都记录涉及文件、移动边界、行为保持依据、测试、回滚方式和完成证据。

## 切片清单

### 1. 冻结基线与特征测试

- [x] 运行契约检查、lint、typecheck、后端单元和 PostgreSQL 集成、前端组件、构建与 E2E 基线。
- [x] 记录 metadata 表数 / mapper 数、Alembic heads、OpenAPI 生成一致性和当前 preflight 输出。
- [x] 为配置 revision 复核、事实替换、内容生成幂等 / 重试、发布转换、文件校验和关键 HTTP 错误映射补足特征测试。
- [x] 回滚：本切片只增加测试与任务记录，可逐文件移除新增测试。
- [x] 完成标准：生产代码未变，后续各移动路径均有可失败的行为断言。

基线证据：FastAPI / OpenAPI 与前端生成类型一致；后端 62 个单元测试、17 个 PostgreSQL 集成测试和前端 8 个组件测试通过；后端与前端镜像构建通过；沙箱外真实 Chromium 的 2 个 Playwright 流通过。ORM 为 36 张表、36 个 mapper，Alembic head 为 `0013_publication_closure`，`preflight-integrity` 输出 `[]`。配置 revision 复核、事实替换、生成幂等 / 重试、发布转换和关键 HTTP 映射由现有 PostgreSQL 集成与 E2E 覆盖；本切片另固定文件完整性与平台版本投影行为。

### 2. 删除重复投影并修正依赖方向

- [x] 删除 planning Router 的重复平台投影，调用权威投影。
- [x] 将 `verified_files` 移入文件域，将 Markdown 派生和发布查询投影放入权威查询模块。
- [x] 发布域仅在有收益处区分 query 与 command，不改调用结果。
- [x] 回滚：恢复原函数和导入；无数据迁移。
- [x] 完成标准：重复实现和跨 Router 导入消失，定向单元 / 集成 / 契约测试通过。

切片证据：`platform_version_out` 与 `platform_profile_out` 只有一个实现位置；configuration 不再导入 planning Router；文件完整性规则归属 `file_records`；发布只读投影与 Markdown 派生归属 `publication_queries`，状态命令仍归属 `publication`。64 个后端单元测试、17 个 PostgreSQL 集成测试、ruff、mypy 和运行时契约检查通过。

### 3. AI 与平台配置应用服务

- [x] 将启停、锁顺序、revision 复核、失效与审计协调迁移到应用服务。
- [x] Router 只保留 HTTP 依赖、输入输出和错误映射。
- [x] 不为简单读取建立服务包装。
- [x] 回滚：逐用例恢复 Router 内实现并删除无调用服务函数。
- [x] 完成标准：状态写入只有一个权威位置，并发与审计特征测试通过。

切片证据：平台类型、Prompt 和平台资料命令归属 `platform_configuration`；AI 渠道、Header、模型、统一锁序、连接配置失效和外部测试 revision 复核归属 `ai_configuration`。列表、详情和模型发现等只读 / 外部查询仍直接留在 Router。64 个后端单元测试、17 个 PostgreSQL 集成测试、ruff、mypy 和运行时契约检查通过。

### 4. 产品事实应用服务

- [x] 迁移完整工作区替换、图校验、事实版本和状态转换。
- [x] 保持版本号、引用约束、审计和事务完全一致。
- [x] 回滚：逐用例恢复原实现；无 Schema 或数据库变化。
- [x] 完成标准：Router 无核心事实写事务，事实图和版本测试通过。

切片证据：产品身份不可变门禁、事实图读取与完整性校验、按依赖方向替换工作区、版本号分配和审计事务归属 `product_facts`；事实审核状态机继续唯一归属 `review`。64 个后端单元测试、17 个 PostgreSQL 集成测试、ruff、mypy 和运行时契约检查通过。

### 5. 内容策划与生产应用服务

- [x] 迁移任务创建、prompt / classification 更新、生成输入快照、幂等作业创建、重试和内容修订。
- [x] 保留 worker、生成 transport 和审核服务现有边界。
- [x] 回滚：逐用例恢复原实现；保持作业和审计记录可验证。
- [x] 完成标准：重复状态协调消失，生成可靠性与审核测试通过。

切片证据：目标问题、平台规则版本、任务上下文和 Prompt 分级命令归属 `content_planning`；不可变生成快照、幂等 Job、显式重试、提交后投递和人工修订归属 `content_production`。Worker 仍只消费 Job UUID，生成 transport、恢复扫描和审核状态机边界未改变。64 个后端单元测试、17 个 PostgreSQL 集成测试、ruff、mypy 和运行时契约检查通过。

### 6. 身份、文件与 GEO

- [x] 仅迁移涉及状态转换、权限门禁、跨实体协调或审计的用例。
- [x] 保留简单读取和无业务不变量的局部 CRUD。
- [x] 回滚：按领域独立恢复，任一领域失败不阻塞已验证领域。
- [x] 完成标准：跨模块直接写入消失，相关权限和完整性测试通过。

切片证据：账号、密码、最后管理员和 PostgreSQL 会话命令归属 `identity`；上传意图、对象完整性确认和中止归属 `file_records`；追加式 GEO 观测及纠正链归属 `geo_observation`；平台发布账号创建归回 `publication`。Router 中已无 `commit`、`with_for_update`、审计追加或实体增删。64 个后端单元测试、17 个 PostgreSQL 集成测试、ruff、mypy 和运行时契约检查通过。

### 7. Pydantic Schema 拆分

- [x] 按稳定接口领域移动声明并更新直接导入。
- [x] 不保留兼容性重导出，不改变类名、字段、验证器或序列化结果。
- [x] 回滚：合并回单文件并恢复导入。
- [x] 完成标准：运行时 OpenAPI 与冻结契约一致，前端生成类型无差异。

切片证据：Schema 按 common、product_facts、configuration、content、publication、geo_files 六个稳定接口领域组织；`schemas/__init__.py` 不重导出类，全部调用方直接导入权威模块。FastAPI 运行时 Schema 与冻结 OpenAPI 递归一致，前端生成类型无差异；64 个单元测试、ruff 和 mypy 通过。

### 8. SQLAlchemy 模型拆分

- [x] 按稳定领域移动映射声明，保持同一 `Base` 和字符串外键。
- [x] `models/__init__.py` 只完成模块注册，修正全部直接导入。
- [x] 检查 import cycle、mapper 配置、metadata 集合和 Alembic migration graph。
- [x] 回滚：合并回单文件并恢复导入；不生成迁移。
- [x] 完成标准：表集合、mapper 数、Alembic heads 和迁移集成测试与基线一致。

切片证据：ORM 按 identity、product_facts、configuration、content、ai_generation、publication、geo_files 组织；所有类继续继承 `app.db.Base`，跨域外键仍使用字符串表名，`models/__init__.py` 只导入模块完成注册。拆分前后均为 36 表、36 mapper，Alembic head 仍为 `0013_publication_closure`；64 个单元测试、17 个 PostgreSQL 集成测试、ruff、mypy 和契约检查通过。

### 9. 前端物理拆分

- [x] 拆分发布页、配置中心和内容编辑器中已证实混合的容器 / 表单 / 展示职责。
- [x] 建立精确 query key 注册表并保持失效语义。
- [x] 简单页面保持现状，不引入新的状态管理层。
- [x] 回滚：恢复原组件文件和内联 query key。
- [x] 完成标准：组件、类型检查、构建和关键 Playwright 流通过，界面行为无变化。

切片证据：配置中心按 AI 渠道和平台类型面板拆分，发布页按工作台、详情、异常和修复路由拆分，内容编辑器仅提取有独立本地预览状态的修订表单；Dashboard、GEO、用户等简单页面保持原结构。`queryKeys` 精确复用原数组和前缀失效语义，所有 API 类型继续来自 OpenAPI 生成产物。TypeScript、ESLint 和 8 个前端组件测试通过；构建与 Playwright 纳入最终验证。

## 最终验证

- [x] `make contract-check`
- [x] `make lint`
- [x] `make typecheck`
- [x] `make test-unit`
- [x] `make test-integration`
- [x] `make build`
- [x] `make e2e`
- [x] Compose 配置解析、迁移历史和 preflight 完整性验证
- [x] 更新架构、开发、测试文档及受影响的中文注释 / docstring
- [x] 审计最终 diff：无迁移、无契约变化、无隐藏回退、无第二来源、无薄包装、无未说明行为变化

最终证据：契约、ruff、ESLint、mypy、TypeScript、64 个后端单元测试、8 个前端组件测试、17 个 PostgreSQL 集成测试、前后端镜像构建和独立空数据库上的 2 个 Playwright 流全部通过。开发、生产和预发布 Compose 均可解析；Alembic current/head 均为 `0013_publication_closure`，ORM 保持 36 表、36 mapper，生产 preflight 输出 `[]`。阶段五相对阶段四未改变 `contracts` 或任何迁移源文件；Router 无事务、审计或 ORM 写入，Schema/ORM 无兼容重导出，前端无内联 React Query 键第二来源。

隔离工作树中 `make` 的 `uv` 默认环境链接不可写，因此契约、lint 和 typecheck 使用可写临时 `UV_PROJECT_ENVIRONMENT` 运行；`test-unit` 另显式设置项目既有导入要求 `PYTHONPATH=backend`。`make test-integration`、`make build` 和最终 `make e2e` 直接运行，E2E 使用独立空数据库以排除开发历史数据分页污染。

## 停止条件

- 任何公共契约、数据库结构、状态机、权限或用户可见行为必须改变。
- 业务不变量没有单一权威来源，且无法在当前证据下确定归属。
- metadata、Alembic、OpenAPI 或并发行为无法证明与基线一致。
