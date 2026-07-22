# AI 渠道与模型管理页面实施计划

> 规划已确认，任务已激活；按契约优先顺序实施并逐层验证。

## 0. 工作区保护与规划门禁

- [x] 创建独立 Trellis 任务并确认不复用范围冲突的 `07-13-configuration-center-navigation`。
- [x] 记录 `main` 工作区已有未提交文件，确认契约、App 路由、导航、query key、生成类型、全局样式和 E2E 存在其他任务改动。
- [x] 完成前端、后端、契约/数据库、权限/审计、安全、测试与历史任务调查。
- [x] 阅读当前任务 PRD、相关 Trellis 设计、AI 配置规范、OpenAPI、数据库契约和关键实现。
- [x] 用户确认统计口径、默认时间窗及测试/发现排除规则，并已同步 PRD 与设计。
- [x] 用户确认受控品牌目录、`CUSTOM` 语义及品牌—协议显式校验规则，并已同步 PRD 与设计。
- [x] 用户确认权限感知的页面/功能导航搜索边界，并已同步 PRD 与设计。
- [x] 完成 PRD convergence pass 和独立规划复核；Trellis 上下文校验通过，三份文档可评审且无阻塞开放问题。
- [x] 执行 `task.py start` 激活任务；此步骤不等于 Git 提交授权。

## 1. 契约优先

- [x] 在 `contracts/database.md` 增加渠道描述、协议类型、受控供应商品牌、渠道最近测试派生、按时间窗统计索引和渠道审计投影说明；保持一次调用不变量。
- [x] 在 `contracts/openapi.yaml` 更新渠道创建/更新/详情，新增服务端分页的渠道摘要集合、品牌—协议枚举、最近测试字段、`7d|30d|90d|all` 使用统计和渠道操作日志接口。
- [x] 明确成功率、最近使用时间、可空 token/耗时聚合、审计分页及错误响应，不添加供应商别名、重试配置或敏感字段。
- [x] 运行 OpenAPI 语义检查并生成前端类型；仅保留与提交契约一致的生成差异。

验证：

```bash
make contract-check
```

回滚点：契约和生成类型必须作为一个精确切片反向应用，不保留只存在一侧的临时类型。

## 2. 数据库与后端模型

- [x] 新增下一条 Alembic 迁移：为 `ai_channels.description` 回填空字符串、协议回填 `openai-compatible-chat-completions`、品牌回填 `CUSTOM`，设置非空和 `CHECK`，并增加 `generation_jobs(ai_channel_id, created_at)` 索引；不修改历史迁移，不猜测既有品牌。
- [x] 更新 `AIChannel` ORM 和 Pydantic Schema，创建/更新服务显式写入描述、协议和品牌，并拒绝未注册组合。
- [x] 让测试、发现、正式生成与自然化根据 `protocol_type` 选择真实实现，并把同一值写入不可变快照和 `adapter_name`；Worker 校验当前协议与快照一致。当前只接受 OpenAI-compatible，原生或未知协议明确失败，不增加单实现工厂；显式 deterministic 开发生成器保持独立。
- [x] 更新 `channel_out`，确定性投影最新模型测试状态和时间。
- [x] 更新 `contracts/database.md` 中迁移序列、删除与历史语义。
- [x] 补迁移/模型最小测试，验证升级、非空约束和降级行为。
- [x] 更新现有调用方：渠道创建/编辑表单、`ConfigurationPages.test.tsx` fixtures、`frontend/tests/e2e/mvp-flow.spec.ts` 创建载荷及所有后端直接 Schema/ORM 构造；不添加兼容默认。

验证：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_migrations.py -q
```

高风险点：公共创建/更新请求变为要求描述、协议和品牌；必须同批更新所有调用方，不增加默认兼容字段。降级测试只使用测试创建的隔离 PostgreSQL 数据库，不降级当前开发数据库。

## 3. 后端投影、权限与审计

- [x] 将渠道集合接口改为服务端 `q/status/provider_brand/sort/page/page_size` 查询，返回摘要、分页总数及排除 status 条件的分类数量；列表不返回 Header 值或模型数组。
- [x] 增加渠道使用统计管理员接口，按 `7d|30d|90d|all` 聚合正式业务 `generation_jobs` 的状态、成功率、耗时、token 和最近使用时间；测试/发现不计入，缺失用量保持 `null`。
- [x] 增加渠道操作日志管理员接口，读取同一 `audit_logs` 表并覆盖渠道、Header、当前/新关联模型事件。
- [x] 为模型 CRUD/启停审计增加安全 `channel_id`，保持模型 target 不变。
- [x] 修改模型测试命令签名，记录 `ai_model.tested` 的状态和渠道关联；修订冲突记录安全错误码，不记录错误正文。保留“测试后模型停用、通过后手动启用”的服务端状态机。
- [x] 把模型发现协调移入有实际审计职责的服务函数，成功/失败均记录安全结果。
- [x] 确认所有新增接口使用 `AdminUser`，写请求继续使用 `CsrfProtected`；OpenAPI 同步声明会话、CSRF 及 `401/403` 响应。
- [x] 增加路由级普通用户/CSRF 拒绝、测试/发现审计、敏感详情拒绝和统计可空值测试。

验证：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_ai_boundaries.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_ai_configuration_management.py backend/tests/integration/test_migrations.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration -q -k 'ai or configuration or audit'
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app backend/tests
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
```

回滚点：审计与状态更新必须同批回滚，不能留下测试变更无审计或审计引用不存在字段的中间状态。

## 4. 前端路由与三栏工作区

- [x] 将 AI 路由改为父工作区加渠道详情 Outlet，保留 `/configuration/ai/channels/:channelId` 稳定 URL。
- [x] 在 `AIChannelsPage` 实现 URL 驱动的 `q/status/provider_brand/sort/page/page_size`，分类数量、搜索、筛选、排序和分页只消费服务端集合响应。
- [x] 把现有详情重排为右侧面板 Tabs，并用 URL `tab` 恢复基本信息、请求配置、模型管理、使用统计和操作日志。
- [x] 复用全部现有 mutation、Header/模型表单和发现弹窗；次级查询错误保持局部。
- [x] 渠道测试弹窗要求明确选择模型，调用现有模型测试 API；不自动选择或模拟结果。
- [x] 测试确认文案明确说明模型会被停用，成功后不自动重新启用。
- [x] 实现新增/编辑描述、API Key 重新配置、启停、删除确认和非敏感复制配置。
- [x] API Key 已配置状态只显示固定掩码提示，不增加密钥后缀字段；表单关闭后清空输入。
- [x] 使用受控品牌选择器与本地图标映射，显示协议类型、供应商品牌和“重试策略：仅手动重试”；`CUSTOM` 使用通用图标，不提供自由品牌或自动重试次数控件。
- [x] 将配置中心导航调整为内容平台、平台规则、平台 Prompt、AI 渠道与模型、用户与权限、审计日志；保留原 URL 和页面权限。
- [x] 在内容平台页增加“管理平台类型”稳定入口，避免移除独立菜单项后形成只能手输 URL 的孤立页面。
- [x] 把 AppLayout 菜单提取为权限感知的单一导航注册表，新增“搜索页面或功能…”浮层和 `⌘/Ctrl + K`；只搜索获权路由与功能关键词，不调用或伪造跨域业务搜索。
- [x] 删除或改写旧纵向详情专属 UI，确保不存在页面与面板双实现。

验证：

```bash
npm --prefix frontend test -- --run src/features/configuration/ConfigurationLayout.test.tsx src/features/configuration/ConfigurationPages.test.tsx
npm --prefix frontend test -- --run src/app/AppLayout.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend run lint
```

回滚点：路由与页面结构作为一个切片回滚，不能恢复旧详情并同时保留右侧详情。

## 5. 高保真样式与可访问性

- [x] 在 `global.css` 配置中心段增加三栏比例、工具栏、紧凑表格、状态分类、详情面板、Tabs、快捷操作和选中/悬浮样式。
- [x] 只使用现有语义变量；验证浅色、深色和系统主题。
- [x] 1570×1001 原始视口对齐原型的信息密度、间距、字体层级、圆角、边框、阴影、行高和状态反馈。
- [x] 1199px 以下改为无页面横向溢出的降级布局；验证键盘焦点、Modal、危险确认和可访问名称。
- [x] 不远程加载供应商品牌图，不添加硬编码主题色或无效全局搜索控件。

## 6. 测试与文档

- [x] 前端组件测试覆盖 URL 恢复、服务端集合参数/数量、选择、Tabs、创建/编辑、品牌/协议、测试模型选择、启停、删除、复制脱敏、统计/日志局部错误、全局导航搜索权限与普通用户守卫。
- [x] 后端测试覆盖身份字段契约与组合校验、适配器快照一致性、服务端搜索/筛选/稳定排序/分页/分类数量、统计零值/可空值/时间窗、最近测试投影、测试后停用、真实测试成功/失败、权限、CSRF、测试/发现审计、API Key/Header 脱敏和安全错误。
- [x] 更新 `.trellis/spec/backend/ai-configuration-guidelines.md`、架构/方案文档及测试文档；不重复维护 OpenAPI 和数据库字段事实。
- [x] 对实质修改的 Python 模块、函数、异常和开发者文本完成中文文档检查；前端新增文件保留文件级中文职责注释。

## 7. Playwright 真实流程与视觉验收

- [x] 先读取项目 `playwright-cli` Skill；使用 `deploy/scripts/e2e-local.sh` 启动真实 API、PostgreSQL、Redis、Celery、前端、对象存储替身和独立 `app.ai_fake_server` HTTP AI 协议服务。该服务只用于测试，不代表真实云端供应商。
- [x] 通过 UI 验证页面加载、搜索、筛选、排序、分页、渠道选择和详情切换。
- [x] 通过 UI 验证新增/编辑、API Key 重新配置、Header、模型发现/新增/编辑、连接测试成功与失败、模型/渠道启停、复制和删除确认。
- [x] 复用 E2E 通过管理员创建并完成首次改密的工程师账号，验证配置/用户/审计导航与全局搜索结果不可见、直接 URL 跳回及接口 `403`。
- [x] 收集控制台错误、页面异常、失败请求和非预期 4xx/5xx，结果必须为空或与显式失败用例精确对应。
- [x] 在 1570×1001 生成列表/详情验收截图，与原型并排检查后继续调整明显偏差。
- [x] 补充 375/768/1024/1440、浅/深/system 和键盘最小检查。

建议命令：

```bash
make dev-infra
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal REDIS_URL=redis://127.0.0.1:56379/0 make e2e
npm --prefix frontend run build
```

## 8. 最终质量门禁

- [x] 运行目标测试后再运行 `make contract-check`、相关集成测试、前端 typecheck/lint/test/build 和配置中心 E2E。
- [x] 检查 diff 不覆盖 GEO 与其他未提交改动，不包含静态假数据、固定成功响应、密钥、敏感 Header、响应正文、静默回退、重复配置源或无关重构。
- [x] 检查代码、OpenAPI、数据库、生成类型、AI 规范、测试和方案文档一致。
- [x] 输出变更摘要、验证结果、验收截图和剩余风险。
- [x] 提交前单独给出仅包含本任务文件/hunk 的提交计划并等待用户确认；不自动提交或推送。

## 实际验证记录（2026-07-22）

- `make contract-check`：通过，FastAPI/OpenAPI 递归 Schema 与前端冻结生成类型一致。
- 后端 Ruff 与 mypy：通过；AI/生成边界单测 42 项通过；AI 管理、0021 迁移与生成可靠性 PostgreSQL 集成 9 项通过。
- `test_migrations.py`：15 项中 10 项通过，5 项被并行 GEO 任务的 `0022_geo_observation_insights` downgrade 约束名错误阻断；0021 专属升级、约束、索引、可逆/有损降级测试已独立通过。
- 前端：lint、typecheck、25 项配置中心/AppLayout 组件测试与生产构建通过。
- Playwright：AI 配置管理员闭环与普通工程师权限 2 项通过；真实本机 HTTP 协议替身覆盖成功和显式 404 失败；最终 1570×1001 截图已保存至 `artifacts/ai-channels-1570x1001.png`。
- Playwright CLI：375/768/1024/1440 均无页面横向溢出；浅色、深色、system 与 `⌘K` 搜索完成最小检查。
- 既有 `mvp-flow.spec.ts` 受并行 GEO 任务同一测试内重复声明 `discovered` 阻断于解析阶段，尚未执行到本任务渠道调用片段；本任务独立 E2E 和后端真实调用链测试均已通过。

## 视觉验收返工记录（2026-07-22）

- 用户复核首版截图后确认其只完成了同类三栏结构，外层配色、玻璃层级、页面比例与列表数据密度没有按原型高保真还原；该截图不再作为验收依据。
- 经读取原始 PNG 元数据确认基准为 1570×1001，旧 1572×999 截图不再作为最终验收依据。配置中心桌面外壳按原始视口重新标定：侧栏 `(8, 8, 220, 985)`、顶栏 `(228, 8, 1334, 64)`、主面板 `(238, 84, 1312, 901)`，工作区三栏为 `188px / minmax(0, 1fr) / 366px`，工具栏 70px、表头 52px、数据行 92px。
- 新截图通过真实管理员 API 创建 6 个受控品牌渠道，其中 4 个渠道的模型经真实本地 HTTP 协议服务测试通过后显式启用，2 个保持停用；分类数量、Header/模型数量和测试状态均来自服务端投影，不使用静态表格数据或前端伪状态。
- `typecheck`、lint、生产构建通过；配置中心/AppLayout 组件测试 25 项通过；独立 AI 配置 E2E 的管理员闭环与普通工程师 403 两项通过。
- 项目 Playwright 在 E2E 内对上述桌面坐标、表头字号和行高执行断言；同一闭环切换到 390×844 后确认页面级无横向溢出，再恢复桌面继续完成失败测试、删除和普通用户 403 验证。
- 最终桌面截图保存为 `artifacts/ai-channels-1570x1001.png`，SHA-256 为 `dac563e2fb416ab10d7a065156587245119725a9e06227a617452e62c1ef4464`；移动端截图保存为 `artifacts/ai-channels-mobile-390x844.png`，SHA-256 为 `f6117f5826b9a33559f876e40cb1502b19ecd9eac6fa1f802aebbaedf46ec958`。
- 原型中的应用入口、通知和帮助按钮没有项目路由、API 或真实业务能力，本轮没有伪造无行为控件；截图中的本机 API 地址、时间、统计数量和测试查询均来自真实测试数据，允许与原型示例文案不同。
