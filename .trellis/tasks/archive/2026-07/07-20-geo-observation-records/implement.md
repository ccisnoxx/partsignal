# GEO 观测记录页面实施计划

## 执行边界

- 当前任务保持 `planning`，只有用户评审并批准 `prd.md`、`design.md`、本文件后才运行 `task.py start`。
- 本任务是一个强耦合的契约到页面垂直切片：列表、指标、详情和纠正共享同一观测契约与验收流程，不拆分需要重复契约协调的子任务。
- Inline 模式由主线程直接实现和验证，不维护 `implement.jsonl`/`check.jsonl`，不调度实施或检查子 Agent。
- 不创建分支，不提交、不推送；提交前单独给出文件范围、提交说明和验证结果，等待用户确认。

## 实施顺序

### 0. 实施前门禁

- [ ] 用户明确批准三份规划材料并允许进入实施阶段。
- [ ] 运行 `trellis-before-dev`，重新读取本任务 `prd.md`、`design.md`、`implement.md` 和前后端相关 `.trellis/spec/`。
- [ ] 确认主工作目录仍在 `main`，检查并隔离用户新增的未识别变更；不得覆盖或纳入无关文件。
- [ ] 重新运行 `make contract-check` 和现有 GEO 前端测试，确保实施起点仍然通过。

### 1. 先冻结 OpenAPI 与后端 Schema

依赖：步骤 0 完成。先定契约，前后端不各自猜字段。

- [ ] 在 `backend/app/schemas/geo_files.py` 增加 GEO 操作枚举、列表分页元数据和共同只读投影字段；人工写入 Schema 保持不变。
- [ ] 在 `contracts/openapi.yaml` 同步列表查询参数、`GeoObservationList` 分页字段、详情路径、`ActorSummary` 引用、`is_current` 和 `available_actions`。
- [ ] 明确筛选参数的类型专属语义、默认 `include_history=false`、稳定排序和错误响应。
- [ ] 运行 `make contract-generate` 更新 `frontend/src/shared/api/schema.d.ts`，然后运行 `make contract-check`；不得手改生成文件。

质量点：OpenAPI 与 FastAPI 递归 Schema 一致；没有人工回答摘要、导出、分析、数据库字段或前端兼容 DTO。

### 2. 实现服务端共享筛选、分页与详情

依赖：步骤 1 的契约已通过检查。

- [ ] 在 `backend/app/services/geo_observation.py` 增加受类型约束的 `GeoObservationFilters` 和链尾条件，列表与指标共用；不用字典候选字段或模糊 fallback。
- [ ] 用 `EXISTS` 处理 Citation、发布关联和逐篇结论筛选，避免多对多 JOIN 扰乱计数和分页。
- [ ] 实现 `count + stable order + offset/limit`，默认 `tested_at DESC, id ASC`，最大每页 100。
- [ ] 将当前逐行 `observation_out()` 改为批量投影：一次当前页加载附件、文章结果、Citation/发布关联、产品、记录人和下一条纠正关系；详情复用同一投影。
- [ ] 在 `backend/app/routers/observation.py` 接入共享筛选依赖，扩展列表与指标并新增详情路由。
- [ ] 服务端根据当前用户、人工观测类型和链尾状态返回 `available_actions=[CORRECT]`；写接口仍重复执行 `EngineerUser`、CSRF 和现有业务校验。
- [ ] 让指标使用共享筛选后的两类观测集合；保留 null 比率，不补零。

质量点：默认列表与指标都只看链尾；`include_history=true` 可读完整历史；单条详情不受当前列表筛选影响；不存在 N+1 行查询或第二套查询口径。

### 3. 锁定后端行为测试

依赖：步骤 2 完成；先用集成测试固定根不变量，再改页面。

- [ ] 在 `backend/tests/integration/test_publication_review_closure.py` 的现有 PostgreSQL/FastAPI 真实路径中补充 GEO 测试，复用已有产品、发布、文件和用户准备能力。
- [ ] 覆盖：分页总数与 20/50/100 上限、同时间稳定排序、时间升降序、默认链尾与完整历史、仅本人/记录人、两类专属筛选、关联发布筛选、列表与指标一致。
- [ ] 覆盖：详情正常/404、产品和记录人投影、附件/关联结果完整、当前状态和 `available_actions`。
- [ ] 覆盖：工程师纠正成功、已纠正目标 409、历史模型不可纠正、无权限与 CSRF 拒绝、不完整当前候选和无效截图继续失败。
- [ ] 运行目标集成测试和 `backend/tests/unit/test_contract.py`。

质量点：测试断言真实响应和数据库追加历史，不用固定成功服务替代业务校验。

### 4. 参数化前端数据层和路由

依赖：步骤 1 生成类型和步骤 2 API 可用。

- [ ] 在 `frontend/src/shared/api/queryKeys.ts` 与 `queryOptions.ts` 增加列表、指标和详情的完整参数化查询键；筛选参数变化必须产生不同缓存键。
- [ ] 在 `frontend/src/app/App.tsx` 增加 `/observations/:observationId/correct`，保持 `/observations` 为主页面。
- [ ] 在 `frontend/src/app/AppLayout.tsx` 把 GEO 观测改为仅含“观测记录”的二级菜单，并为 GEO 路由应用已有紧凑工作台壳；不加入分析洞察入口。
- [ ] 在功能目录内实现 URL 参数解析/序列化；默认、重置和清除语义与 PRD R3 一致，筛选变化回第 1 页，关闭 Drawer 保留其他参数。

质量点：刷新、前进/后退和复制 URL 可恢复列表状态；非法参数不会触发候选字段轮询或静默使用另一套字段。

### 5. 重构并实现观测记录页面

依赖：步骤 4 完成。

- [ ] 保留 `GeoObservationsPage.tsx` 作为页面编排，替换全量前端分页为服务端分页，并增加 5 张真实指标卡。
- [ ] 实现两行响应式筛选区、仅看本人、包含历史、重置和清除；类型专属控件和“不适用”语义清晰。
- [ ] 实现观测时间排序、20/50/100 分页、总数、局部横向滚动、空/加载/错误状态和现有模式的列设置。
- [ ] 默认列按 PRD R4 呈现；长问题仅表格省略，状态使用 `StatusTag` 并显示文字。
- [ ] 行点击和查看按钮写入 `record` 参数；行菜单只在 `available_actions` 允许时显示纠正。

质量点：不保留旧的行展开详情或前端全量分页作为并行实现；不新增导出按钮。

### 6. 实现详情 Drawer 和真实附件预览

依赖：步骤 5 的选中记录状态和步骤 2 的详情接口。

- [ ] 新建 `frontend/src/features/geo-observations/GeoObservationDrawer.tsx`，按 URL ID 请求详情，提供加载、404、重试和关闭行为。
- [ ] 分型展示公共信息、历史模型摘要/结论、人工观测契约说明/逐篇结果、关联发布、备注和记录信息。
- [ ] 对所选记录的附件按需请求现有文件详情与短期下载地址；图片预览，非图片下载，单个失败明确展示。
- [ ] 历史模型的 `publication_record_ids` 使用现有发布详情接口获取真实标题/平台/URL；普通 Citation 只显示其真实 URL 和来源类型。
- [ ] Drawer 桌面无静态假数据，移动端全宽；关闭后焦点和列表 URL 状态可恢复。

质量点：详情不允许原地改备注或补截图；人工记录不生成回答摘要。

### 7. 复用新建表单并增加纠正模式

依赖：步骤 2 操作投影与步骤 6 详情可用。

- [ ] 从现有页面提取 `GeoObservationForm.tsx`，保留真实产品、发布候选、逐篇结论、上传和 POST 流程，不引入表单配置框架。
- [ ] 新建模式维持现有写入契约；纠正模式先加载目标详情，要求 `available_actions` 含 `CORRECT`，固定产品/平台/搜索词并传 `supersedes_id`。
- [ ] 纠正重新加载当前发布候选，要求用户填写当前全部逐篇结果、测试时间、新截图和备注；不静默复制旧候选结果。
- [ ] 成功后失效列表、指标、详情和 Dashboard 查询，回到保留筛选的列表并选中新记录；403/409/422 显示现有服务端错误。

质量点：前端可见性不是权限控制；提交中禁止重复写入，失败不关闭表单或显示成功。

### 8. 局部视觉和响应式实现

依赖：步骤 5–7 的 DOM 结构稳定后进行，避免先写失效样式。

- [ ] 在 `frontend/src/styles/global.css` 增加限定 `.geo-observations-*` 的布局、5 卡网格、筛选网格、密集表格和 Drawer 样式，全部使用现有 `--ps-*` token。
- [ ] 复用紧凑工作台壳实现约 192px 侧栏、62px 顶栏和 18–24px 内容间距；不影响其他工作页面。
- [ ] 在 1582×995 调整卡片比例、两行筛选、40–44px 表格行高和约 340–380px Drawer，和原型逐区对比。
- [ ] 补齐 375、768、1024、1440、200% 缩放、light/dark/system；小屏筛选纵向排列，表格局部滚动，Drawer 全宽。
- [ ] 检查键盘焦点、按钮名称、文本对比度、状态非纯颜色表达和减少动效偏好。

质量点：不硬编码第三方 Logo，不引入新 token 系统或全局页面重构。

### 9. 前端单测与真实 Playwright 验收

依赖：步骤 5–8 完成。

- [ ] 扩展 `GeoObservationsPage.test.tsx`，覆盖默认/重置/清除 URL、筛选请求参数、页码与排序、列设置、仅本人、列表错误和操作能力。
- [ ] 覆盖 Drawer 两种观测类型、人工摘要说明、附件失败、详情 404，以及新建/纠正请求体与 409 错误保持表单。
- [ ] 修改 `frontend/tests/e2e/mvp-flow.spec.ts` 的 GEO 段：准备条件可调用真实 API，但新建、筛选、排序、分页、详情、截图预览和纠正必须通过页面操作；禁止 `page.route` 固定响应。
- [ ] E2E 收集 `pageerror`、失败请求和 4xx/5xx 响应；只允许用例明确触发并断言的错误。
- [ ] 设置 1582×995，保存列表态和详情态截图到 Playwright 测试产物；与用户原型并排核对 AC9，记录确认过的差异，不将临时签名 URL或登录状态加入仓库。
- [ ] 使用项目 `playwright-cli` 对运行中的真实页面复查 snapshot、console、requests 和关键点击；需要用户查看时保持浏览器窗口打开。

质量点：启动服务不算验收，必须完成真实页面调用；截图数据来自真实本地 API，不用静态行填满原型。

### 10. 文档、全量质量门禁和 diff 审计

依赖：所有行为测试完成。

- [ ] 更新 `contracts/database.md` 的纠正链尾/历史查询语义并明确无结构迁移；更新 `docs/GEO多平台内容运营系统方案设计.md` 的当前实现。
- [ ] 如 E2E 命令、截图或诊断流程有变化，同步 `docs/testing.md`；否则在交付说明中明确无需更新。
- [ ] 运行下列验证命令；任何失败先定位根因，不添加静默 fallback 或跳过断言。
- [ ] 检查 `git diff --check`、`git status --short` 和完整 diff，排除症状补丁、重复实现、N+1、手写契约、无关文件、英文开发者可见文本和未说明行为变化。
- [ ] 确认没有 Alembic 文件、新依赖、分析/导出入口、人工摘要或详情写操作。
- [ ] 向用户汇报变更、验证、原型差异和残余风险；如用户要求提交，先提交计划并等待确认。

## 验证命令

### 契约与目标测试

```bash
make contract-generate
make contract-check

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/unit/test_contract.py -q
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_publication_review_closure.py -k geo -q

npm --prefix frontend run test -- GeoObservationsPage
```

### 静态检查与构建

```bash
make lint
make typecheck
npm --prefix frontend run build
make build
```

### 真实 E2E

```bash
make dev-infra
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 \
PLAYWRIGHT_HTML_OPEN=never \
deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts
```

在 E2E 用例内用 `page.setViewportSize({ width: 1582, height: 995 })` 捕获列表态和详情态。需要交互诊断时，按项目 `playwright-cli` 流程连接运行中的本地页面，执行 snapshot、`console`、`requests` 和截图检查；不得用仅启动服务器替代真实调用。

### 最终检查

```bash
git diff --check
git status --short --branch
git diff -- contracts/openapi.yaml contracts/database.md backend frontend docs .trellis/tasks/07-20-geo-observation-records
```

## 高风险文件与回滚点

- `contracts/openapi.yaml` / `backend/app/schemas/geo_files.py`：先用 `make contract-check` 锁定；不允许前后端分别兼容不同形状。
- `backend/app/services/geo_observation.py` / `backend/app/routers/observation.py`：共享筛选、链尾和投影是核心风险；集成测试通过前不进入页面切换。
- `frontend/src/features/geo-observations/*`：删除旧全量分页和行展开后再接新实现，避免双路径；新建/纠正表单失败时可独立回退，不影响只读列表契约。
- `frontend/src/app/AppLayout.tsx` / `frontend/src/styles/global.css`：样式必须用 GEO 限定选择器；若视觉回归只回退局部 class，不改其他页面。
- 没有数据库迁移，回滚不需要数据回填或删除；已创建的纠正观测是合法追加历史，不执行破坏性清理。

## 启动实施前复核

- [ ] PRD 的每个 R1–R8 均在实施步骤中有所有者和验证项。
- [ ] AC1–AC10 均可由测试、Playwright 或明确人工截图检查验证。
- [ ] `prd.md` 无待确认产品问题，`design.md` 无猜测字段或第二套结构。
- [ ] 用户已明确说可以进入实施阶段；否则保持任务为 `planning`。

## 2026-07-23 提交前复核

- 用户已批准把本任务作为 `geo-observation-insights` 的显式前置并直接按序提交。
- `make contract-check`、GEO PostgreSQL 定向集成测试、`GeoObservationsPage`/`GeoInsightsPage` 前端测试、前端 lint、typecheck 和 build 已通过。
- 真实主流程 E2E 已实现 GEO 记录与洞察验收步骤；本轮整条用例在此前的 Prompt 预览异步模型选择处被阻断，该 Prompt hunk 按用户要求继续排除，不以修改 Prompt 业务代码掩盖。
- 当前记录页与后续洞察任务共享人工观测契约和服务实现，按批准顺序提交；规则、Prompt、Trellis 运行时和 `.playwright-cli/` 临时产物均不纳入。
