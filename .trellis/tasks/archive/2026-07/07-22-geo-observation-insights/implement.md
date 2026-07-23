# GEO 观测分析洞察实施计划

## 执行边界

- 用户已于 2026-07-22 批准三份规划材料，任务已运行 `task.py start` 并处于 `in_progress`。
- 当前 Codex `dispatch_mode=auto`：用户批准并激活任务后，主会话按 Trellis 流程调度 `trellis-implement` 和 `trellis-check` 子 Agent；`implement.jsonl` 与 `check.jsonl` 已维护真实 spec/research 上下文。
- 不创建分支、不提交、不推送。需要提交时先给出精确文件范围、提交说明和验证结果，等待用户确认。
- 当前工作树包含 `07-20-geo-observation-records` 的用户改动。实施前必须把它当作受保护基线重新验证，禁止用回退、重写或旧版本文件消除冲突。
- 已确认“人工观测为权威 + 关联 `query_topic_id` + 补采逐篇发现/提及/引用/准确性事实”、全部分析规则、原生打印导出、不实现顶部全局搜索，以及“内容主题”精确映射 `ContentTask.content_angle`。用户后续改变口径时先回到规划阶段修订本文件，不在实现中临时猜测。

## 实施顺序

### 0. 规划和基线门禁

- [ ] 确认 `prd.md` 已通过 convergence pass，不存在未解决问题、临时 brainstorm 段落或重复口径。
- [ ] 确认 `design.md` 不存在“推荐/候选/待确认”残留；已批准的数据集、关系级单位、严格阶段、排行、覆盖、建议、导出、顶部搜索和内容主题映射保持不变。
- [ ] 用户最终批准后运行 `python3 ./.trellis/scripts/task.py start 07-22-geo-observation-insights`，再完整读取 `prd.md`、`design.md`、`implement.md` 和前后端相关 spec。
- [ ] 确认主目录仍在 `main`，记录 `git status --short`；把本任务文件与已有用户改动分开审查，不清理未知文件。
- [ ] 运行现有 GEO 基线：契约检查、GEO 后端目标测试、`GeoObservationsPage` 单测和前端构建。若 `07-20` 基线失败，先报告真实失败并判断是否属于前置任务，不用本任务逻辑掩盖。

质量点：没有用户批准的产品口径、数据库影响或导出格式不得进入步骤 1。

### 1. 先冻结数据与 OpenAPI 契约

依赖：步骤 0 完成。

- [ ] 在 `backend/app/schemas/geo_files.py` 更新 `GeoObservationCreate`、`GeoArticleResultCreate/Out` 和 `ManualGeoObservationOut`，增加已批准的 `query_topic_id`、逐篇发现/提及/引用/准确性和 D2a 严格阶段约束；历史投影保持真实可空。
- [ ] 定义固定的 `GeoInsights` 响应 Schema：筛选选项、周期、五类趋势、平台表现、漏斗、三类排行、问题覆盖、建议和数据完整性；不使用 `dict[str, Any]`、候选字段或开放业务 key。
- [ ] 在 `contracts/openapi.yaml` 新增 `GET /api/v1/geo-insights` 的六类筛选、响应和错误语义；同步 `/geo-metrics` 的 `legacy_*` 明确命名和空分母 nullable 变化。
- [ ] 导出使用已确认的浏览器原生打印路由，OpenAPI 不增加伪导出或服务端文件生成 API。
- [ ] 运行 `make contract-generate` 生成 `frontend/src/shared/api/schema.d.ts`，运行 `make contract-check`，不得手改生成文件。

质量点：响应每个率都携带分子/分母；每个排行/建议都携带稳定 ID 与依据；历史未知字段明确 nullable 和排除规则。

### 2. 实现数据库迁移和写入不变量

依赖：步骤 1 契约明确。

- [ ] 新建单个 Alembic revision，调整 `MANUAL_ARTICLE_SEARCH` Check Constraint，允许并要求新人工观测关联真实 `query_topic_id`。
- [ ] 在 `geo_observation_publications` 增加 D1 批准的 nullable 发现/提及/引用/准确性字段；保留现有主键、推荐状态和追加式历史。
- [ ] 数据库层为枚举、三值历史数据和严格累计关系增加 Check Constraint/触发器：`cited ⇒ RECOMMENDED ⇒ mentioned ⇒ discovered`，且最后“结果准确”只统计满足全部前序条件的 `ACCURATE`；不得仅依赖前端。
- [ ] 迁移不回填旧行。升级后旧行保持 `NULL`；新写入由服务和数据库要求完整。
- [ ] 更新 `backend/app/models/geo_files.py` 映射，保持单一字段所有者，不给人工观测根复制逐篇事实。
- [ ] 增加迁移测试：旧数据升级后原值不变、新列为 `NULL`、新约束拒绝非法写入、downgrade 在有新事实时按项目规则拒绝或明确要求备份。

质量点：未知历史事实没有默认 `false`、`0` 或从推荐状态推导；追加式纠正和发布候选完整性不被削弱。

### 3. 扩展人工登记与更正服务

依赖：步骤 2 模型可用。

- [ ] 在 `create_geo_observation()` 复用现有产品、当前全部公开发布、唯一逐篇结果、证据和纠正链校验，增加问题主题存在性及逐篇阶段事实校验。
- [ ] 更正固定产品、GEO 平台、实际搜索问题和经批准的问题主题语义；重新读取当前候选并要求用户重新提交全部阶段事实和证据。
- [ ] `geo_observations_out()` 批量投影新增字段；旧关系返回真实 `null`，不兼容猜测。
- [ ] 更新 `GeoObservationForm.tsx`：选择真实 QueryTopic，并逐篇填写发现、提及、推荐、引用和准确性；明确说明严格阶段和旧数据差异。
- [ ] 保持提交成功后的现有列表/指标/Dashboard 失效，并增加洞察查询失效；失败不关闭表单或显示成功。

质量点：现有推荐状态仍只有一个写入位置；前端可见性不替代 `EngineerUser + CSRF`；没有固定成功或截图推理。

### 4. 实现服务端权威洞察聚合

依赖：步骤 2–3 的事实契约稳定。

- [ ] 新增责任明确的 `GeoInsightFilters`，复用现有日期、链尾和安全文本匹配构件；不扩大列表专用 `GeoObservationFilters` 的职责，不复制条件表达式。
- [ ] 构建一个基础 SQL 范围：当前人工观测 → 逐篇关系 → 发布 → 内容任务/版本 → 内容平台 → QueryTopic，六类筛选只在这里应用一次。
- [ ] 用 SQL 条件聚合计算当前/前周期五类指标和每日点；空分母返回 `null`，前值 0 的变化返回不可计算状态。
- [ ] “未推荐内容数量”按当前周期完整关系中的 `publication_record_id` 去重，使用 `count > 0 AND bool_or(RECOMMENDED) = false` 等等价 PostgreSQL 条件；每日点在对应日期子集应用同一公式。
- [ ] 按 GEO 平台计算观测去重数和同口径四率；精确字符串分组，不做别名归并。
- [ ] 按已批准的严格累计关系计算六阶段漏斗和相邻转化率，并返回“人工观测 × 发布内容关系”的统一单位说明。
- [ ] 计算三类内容 Top 5；服务端应用稳定 ID 次排序、最小样本、比较期和长期阈值，响应返回依据。
- [ ] “表现最佳”只接纳当前周期至少 3 次完整观测的发布内容，固定按引用率、推荐率、提及率、观测次数降序和 `publication_record_id` 升序取前 5；不引入综合分。
- [ ] “表现下降”比较当前周期和紧邻等长周期，两期均至少 3 次完整观测；任一引用率/推荐率/提及率下降至少 10 个百分点即候选，按最大单项下降、三项固定顺序、当前观测次数和 ID 稳定排序，返回触发依据。
- [ ] “长期未提及”只在当前周期至少 30 天时计算；要求发布满 30 天、当前至少 3 次完整观测且零提及，读取同一非时间筛选下的更早历史只确定最近提及时间，并按持续天数、观测次数和 ID 稳定排序。
- [ ] 以 QueryTopic 全集和明确关联观测计算覆盖矩阵：按问题+GEO 平台+观测去重，任一逐篇提及即命中；3 次样本门槛后按 60%/30% 分级，0–2 次返回 `INSUFFICIENT_DATA`。未关联人工记录只进入 `data_quality` 排除数。
- [ ] 运行有限的确定性建议规则，按优先级、影响量、规则码、ID 稳定排序；缺事实的规则跳过并写明不可用原因。
- [ ] 实现已批准的高/中/低规则及同对象同因抑制：长期未提及、内容/平台 20/10 个百分点下降、从未推荐内容、未覆盖/偶尔命中/数据不足问题组合；固定返回触发值、阈值和关联对象。
- [ ] 生成稳定筛选选项：内容平台/发布/问题使用 ID，GEO 平台/内容角度使用精确字符串；未知筛选 ID 显式失败。
- [ ] 把现有 `get_geo_metrics()` 改为 SQL 聚合并使用明确 `legacy_*` 字段；它与人工洞察只复用相同的链尾/筛选构件。人工关系推荐公式若被两个接口消费，则只保留一个关系级聚合函数；移除旧的全量 Python 列表公式。
- [ ] 在 `backend/app/routers/observation.py` 接入 `GET /geo-insights`，路由只做参数校验和调用服务。

质量点：筛选只应用一次；没有 N+1；所有区块同一当前周期/比较期；没有客户端公式或第二套指标函数。

### 5. 锁定后端契约和业务测试

依赖：步骤 4 完成，前端尚未消费。

- [ ] 在 `backend/tests/integration/test_publication_review_closure.py` 或更聚焦的现有 GEO 测试模块中准备真实 PostgreSQL 图：两个周期、多个 GEO/内容平台、多个 QueryTopic、多个发布、纠正链、完整和不完整历史记录。
- [ ] 覆盖六类筛选单独及关键组合，断言所有区块同步变化且默认只看链尾。
- [ ] 覆盖五类当前/前值、日序列、空分母 `null`、前值 0、UTC 首尾、稳定点顺序；特别验证同一内容一次推荐即可从周期“未推荐内容数量”中排除。
- [ ] 覆盖平台分组、漏斗阶段及转化、三个排行、最小样本/阈值/稳定次排序；“表现最佳”覆盖 2/3 次样本边界及全部同值时的 ID 次排序。
- [ ] “表现下降”覆盖双周期 2/3 次样本边界、9.99/10 个百分点边界、单项下降伴随其他项改善、最大下降同值和 ID 次排序。
- [ ] “长期未提及”覆盖 29/30 天周期、发布 29/30 天、2/3 次观测、曾提及、从未提及、相同持续天数和短周期不可用原因。
- [ ] 覆盖 QueryTopic 全集中的未覆盖问题、未关联历史排除、覆盖阈值边界。
- [ ] 覆盖同一观测多篇提及只记一次、2/3 次样本、29.99%/30%/59.99%/60% 边界和 `INSUFFICIENT_DATA` 不补零。
- [ ] 覆盖每条建议规则、优先级边界、稳定排序和缺数据跳过。
- [ ] 覆盖 9.99/10/19.99/20 个百分点优先级边界、同因抑制、影响关系数和 `rule_code`/关联 ID 稳定排序，不断言 AI 或静态文案。
- [ ] 覆盖新人工登记/更正、非法阶段组合、缺问题主题、历史 `NULL` 不被补值、无权限/CSRF。
- [ ] 运行迁移、契约和 GEO 目标测试，必要时用 `EXPLAIN` 检查聚合；只有实证慢查询才增加索引并同步数据库文档。

质量点：测试断言真实数据库事实和 API 响应，不在测试中复写同一公式制造同源断言，不用 SQLite 替代 PostgreSQL 约束。

### 6. 接入前端路由、导航和查询层

依赖：步骤 1、4 契约通过。

- [ ] 在 `frontend/src/app/routeLoaders.ts` 和 `App.tsx` 注册 `/observations/insights` 与 `/observations/insights/print`，更新预取列表。
- [ ] 在 `AppLayout.tsx` 的 GEO 分组增加“分析洞察”；保留 192px 紧凑壳、响应式 Drawer 和现有用户操作区。
- [ ] 把观测记录页的局部页签改成真实 `NavLink`；新增洞察页同样复用，不维护两套选中状态。
- [ ] 在 `queryKeys.ts`/`queryOptions.ts` 增加包含全部筛选的 `geo.insights(filters)`；登记成功失效统一 GEO 前缀。
- [ ] 在功能目录实现最小 `GeoInsightFilters` URL 解析/序列化：默认近 30 天、合法值保留、筛选变化原子更新、重置恢复默认、折叠状态可恢复。

质量点：复制 URL 后页面与请求一致；无效参数不触发兼容字段轮询；页面与打印路由使用同一查询选项。

### 7. 实现分析页面真实交互

依赖：步骤 6 数据层可用。

- [ ] 新增 `GeoInsightsPage.tsx`，只发起一个洞察查询并按响应编排筛选、趋势、平台、漏斗、排行、覆盖和建议。
- [ ] 筛选选项直接消费服务端稳定投影；所有 Select 保存 ID/精确字符串，显示文本不反向作为业务键。
- [ ] 为页面和每个不可用区块复用 `QueryFailure`、`QueryLoading`、`NoData`；展示 `data_quality` 排除数量和原因。
- [ ] 用原生 SVG 实现五张趋势图及日期 Tooltip；点值来自响应，空点断线，鼠标与键盘均可触发。
- [ ] 用 CSS/原生 SVG 实现漏斗柱与转化标签；不得在前端重新算相邻转化。
- [ ] 平台表现和内容排行使用 Ant Table/`TableRegion`，平台无可信 Logo 时用文字/中性标识；内容入口链接到真实发布详情。
- [ ] 问题覆盖矩阵使用文字状态、图例和主题色；建议首页显示前 5，“查看全部建议”打开同一响应中的完整列表。
- [ ] 本任务不添加顶部全局搜索框；页面搜索只使用已批准的问题和发布内容筛选。

质量点：组件只格式化服务端数值；没有 `Math` 业务公式、静态 rows 或随机 SVG；错误不会转换成空数据。

### 8. 实现高保真视觉和响应式

依赖：步骤 7 DOM 稳定后开始，避免为临时结构写样式。

- [ ] 在 `frontend/src/styles/global.css` 新增限定 `.geo-insights-*` 的 token 化样式，不改其他页面的通用尺寸除非共享布局确有批准变化。
- [ ] 先在 1570×1001 对齐六个主要区域：导航/页头、筛选、趋势、平台+漏斗、排行、问题+建议。
- [ ] 对齐卡片边框/阴影/圆角、12–14px 信息层级、图表线宽/点/渐变、状态色、Tooltip、悬浮和聚焦反馈。
- [ ] 1440×900 调整为仍保持高密度；1024×768 重排网格并让表格/矩阵局部滚动，不让整页横向溢出。
- [ ] 检查 light/dark/system、200% 缩放、减少动效、键盘焦点和对比度。

质量点：不通过绝对定位硬贴截图；不伪造通知、Logo、内容或指标；不引入新设计 token 层。

### 9. 实现经批准的报告导出

依赖：步骤 7–8 页面数据和视觉稳定。

打印方案：

- [ ] 增加打印视图，复用同一洞察查询和只读区块，包含筛选摘要、生成时间、数据完整性和全部主要结果。
- [ ] “导出洞察报告”携带当前完整查询参数打开打印视图，并调用浏览器打印；打印 CSS 隐藏交互控件、保留图表/表格可读性。
- [ ] 无数据、部分不可用和请求失败在打印页保持真实说明；不生成空白成功文件。

### 10. 前端单测和真实 Playwright 验收

依赖：步骤 7–9 完成。

- [ ] 新增 `GeoInsightsPage.test.tsx`：默认/URL/重置/折叠、六类筛选请求、空/错/部分不可用、Tooltip、入口和建议列表。
- [ ] 断言前端展示服务端已算值，不在测试 helper 重算公式；打印/下载操作携带全部筛选。
- [ ] 更新现有 GEO 测试，覆盖登记新增事实和 `/geo-metrics` nullable 行为，保留观测记录既有新建/更正/详情行为。
- [ ] 使用真实本地栈和项目 `playwright-cli`，不 `page.route` 固定业务响应；执行页面加载、筛选、重置、折叠、趋势悬浮/键盘 Tooltip、排行内容入口、查看全部建议和导出。
- [ ] 收集 `pageerror`、console error、失败请求和意外 4xx/5xx；只允许用例明确触发并断言的错误。
- [ ] 设置 1570×1001 保存全页截图，按六个区域与原型比较并记录/修正明显位置和尺寸差异；再验证 1440×900、1024×768。

质量点：启动服务器不算验收；截图和交互来自真实 API/数据库；系统打印对话框不作为唯一成功证据。

### 11. 文档、全量门禁和 diff 审计

依赖：功能和验收完成。

- [ ] 更新 `contracts/database.md` 的新增事实、历史 `NULL`、链尾聚合和迁移/回滚语义。
- [ ] 更新 `docs/GEO多平台内容运营系统方案设计.md` 的分析洞察、指标公式、筛选、权限、导出和当前实现；删除与实现冲突的“无分析/无导出入口”陈述。
- [ ] 如真实 E2E/截图命令变化，更新 `docs/testing.md`；否则在交付中说明无需更新。
- [ ] 运行目标测试、契约、lint、typecheck、前端构建及受影响构建；任何失败先找根因，不跳过断言或增加 silent fallback。
- [ ] 检查 `git diff --check`、`git status --short --branch` 和完整 diff，排除重复公式、第二数据源、N+1、猜测字段、手写生成类型、无关改动、英文开发者可见文本和未说明行为变化。
- [ ] 向用户提供变更摘要、精确验证结果、1570×1001 截图、已知视觉差异和剩余风险；不提交。

## 计划验证命令

实施时先读取项目脚本的实际命令；当前已确认可用的基线命令如下。

### 契约和目标后端测试

```bash
make contract-generate
make contract-check

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/unit/test_contract.py -q
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_publication_review_closure.py -k 'geo or insight' -q
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_migrations.py -k geo -q
```

### 前端目标检查

```bash
npm --prefix frontend run test -- GeoObservationsPage GeoInsightsPage
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
```

如果 `package.json` 没有独立 `typecheck`/`lint` 脚本，改用项目现有 `make typecheck`/`make lint`，不临时新增重复脚本。

### 真实本地栈和 E2E

```bash
make dev-infra
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 \
PLAYWRIGHT_HTML_OPEN=never \
deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts
```

使用项目 `playwright-cli` 连接运行中的真实页面，执行 snapshot、find/已知 selector、console、requests、交互和截图。需要视觉证据才截图，不用截图替代语义检查。

### 最终检查

```bash
git diff --check
git status --short --branch
git diff -- contracts/openapi.yaml contracts/database.md backend frontend docs \
  .trellis/tasks/07-22-geo-observation-insights
```

## 高风险文件与回滚点

- `backend/alembic/versions/*geo*`、`backend/app/models/geo_files.py`：未知历史事实和新写约束风险最高；迁移测试通过前不进入洞察聚合。
- `contracts/openapi.yaml`、`backend/app/schemas/geo_files.py`：新增读模型较大，先冻结契约并生成类型，不允许前后端各自兼容。
- `backend/app/services/geo_observation.py`：共享筛选、链尾和公式是根不变量；任何页面问题都回到这里修正，不在前端补公式。
- `GeoObservationForm.tsx`：补采字段会改变新写入契约；旧记录仍只读，纠正必须追加且不能自动复制未知值。
- `AppLayout.tsx`、`global.css`：只做 GEO 导航和局部样式；已确认本任务不扩大公共布局职责以实现全局搜索。
- 已写入的新阶段事实不可通过自动 downgrade 删除；使用前向修复或迁移前备份，不执行破坏性清理。

## 启动实施前复核

- [ ] PRD 无未解决问题章节，D1–D5 保留在 Approved Decisions。
- [ ] R1–R10 每项在实施步骤中有明确所有者和验证。
- [ ] AC1–AC12 均能由后端测试、前端测试、Playwright 或截图人工检查验证。
- [ ] `design.md` 不再含候选字段、未批准阈值或两套数据口径。
- [ ] 当前任务仍为 `planning`，用户明确说可以开始实现后才激活。

## 2026-07-23 提交前复核

- 用户已批准 `geo-observation-records → geo-observation-insights` 的受控提交顺序。
- `make contract-check`、迁移定向测试、GEO PostgreSQL 定向集成测试、`test_geo_insights.py`、`GeoObservationsPage`/`GeoInsightsPage` 前端测试、前端 lint、typecheck 和 build 已通过。
- 已保存 1570×1001、1440×900、1024×768 和 390×844 的真实验收截图；洞察使用原生 SVG/CSS 和浏览器打印能力，未新增图表、PDF 或字体依赖。
- 整条 `mvp-flow` 当前只在被排除的 Prompt 预览模型异步选择处阻断；失败快照显示 GEO 步骤尚未执行，不构成 GEO 回归证据。规则与 Prompt 代码及测试 hunk 继续排除。
