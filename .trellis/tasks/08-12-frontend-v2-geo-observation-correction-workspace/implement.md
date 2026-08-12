# Frontend V2 GEO Observation Correction Workspace — 实施计划

## 1. 执行前提

- 当前仅完成规划，不创建分支、不修改生产代码、不提交、不归档、不推送。
- 用户批准本计划后，确认基线仍为 `main`，再创建临时分支：

```bash
git switch -c codex/frontend-v2-geo-observation-correction-workspace
```

- 该分支只承载本 Task。完成、审批并合并回 `main` 后删除本地分支；没有推送则不存在远端分支需要删除。
- 若执行中发现必须改数据库、另增写入协议或改变公开现有响应，停止并先请求确认。

## 2. 预计修改文件

### 契约与后端

- `contracts/openapi.yaml`
- `backend/app/schemas/geo_files.py`
- `backend/app/services/geo_observation.py`
- `backend/app/routers/observation.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/integration/test_geo_observation_correction.py`（新增）

### 生成类型

- `frontend/src/shared/api/schema.d.ts`
- `frontend-v2/src/shared/api/generated/schema.d.ts`

### Frontend V2

- `frontend-v2/src/domains/geo/geo.api.ts`
- `frontend-v2/src/domains/geo/geo.api.test.ts`
- `frontend-v2/src/domains/geo/geo-observation-correction.model.ts`（新增）
- `frontend-v2/src/domains/geo/geo-observation-correction.model.test.ts`（新增）
- `frontend-v2/src/domains/geo/geo-observation-correction-page.tsx`（新增）
- `frontend-v2/src/domains/geo/geo-observation-correction-page.test.tsx`（新增）
- `frontend-v2/src/routes/_app/geo/observations/$observationId_.correct.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（生成）
- `frontend-v2/tests/e2e/fixtures/geo-correction.fixture.ts`（新增）
- `frontend-v2/tests/e2e/geo-observation-correction.spec.ts`（新增）

### 权威文档

- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`

### 明确不修改

- `contracts/database.md`：没有持久化或不可变规则变化。
- Frontend V1：只作为现有业务参考。
- `geo-evidence-upload.tsx`、Detail 页面和 design-system 组件：优先原样复用；只有测试证明现有公开能力不足时才在本 Task 内做最小调整并说明。
- 任何 Topics、Insights、Print、Optimization 或通用框架文件。

## 3. 实施步骤

### Step 1：扩展 OpenAPI 读取契约

1. 增加 correction-context GET、operationId、响应和标准错误。
2. 增加 `GeoObservationCorrectionContext`，组合现有 `ManualGeoObservationDetail`、`GeoArticleResult` 和 `GeoObservationDetailQueryTopic`。
3. 不改 `GeoObservationCreate`；确认 `supersedes_id` 仍是唯一更正写入入口。

完成条件：契约可生成，两套 schema.d.ts 仅出现预期新增，无手工编辑生成文件。

### Step 2：实现后端上下文

1. 在 schema 中增加组合响应模型。
2. 在 service 中复用现有 Detail 投影、链尾与候选查询；不复制更正链遍历。
3. 同一 `REPEATABLE READ` 请求内校验 actor 的尾节点 `CORRECT`，按候选 ID 合成初始事实，并按 Topic 空值规则提供 options。
4. 新 router 复用现有账号类型检查和错误契约。

完成条件：历史 ID 返回明确尾、无权限/Legacy/坏链显式失败、当前候选不由客户端拼接、查询复杂度不随链长度线性增长。

### Step 3：补齐后端与契约回归

1. 扩展 OpenAPI contract test。
2. 新增 correction 集成测试，覆盖 context 和复用 POST 的关键业务不变量。
3. 明确验证数据库中原节点、原结果和历史证据未被修改；失败路径不产生新 Observation。

完成条件：AC1、AC4、AC5、AC7、AC10 的服务端边界有直接测试。

### Step 4：生成并核对类型

1. 运行 Frontend V2 和 V1 的 API 生成命令。
2. 再运行一次生成，确认无额外 diff。
3. 核对新 response 没有 handwritten cast、备用字段或第二类型系统。

完成条件：OpenAPI 是唯一 API 类型来源，V1 仍通过 typecheck。

### Step 5：增加 Frontend V2 API 与 model

1. 增加 correction-context query key/options/fetcher。
2. 实现严格上下文断言；组合调用现有 Detail 断言，不接受宽松兼容字段。
3. 实现 Correction 专用 form schema、初值、payload 和冲突刷新合并。
4. payload 只从上下文注入冻结字段/尾 ID，只从表单取本次可编辑字段和新证据。
5. 增加 model/API tests。

完成条件：AC4、AC5、AC6、AC7、AC9、AC10 可由纯函数/API 单测证明的部分全部覆盖。

### Step 6：实现页面与 route

1. 新 route loader 获取上下文，基于服务端尾 ID canonical replace。
2. 使用 `WorkspaceShell` 组合只读 Original/Tail、当前事实表单、新证据和 Notes。
3. 接入 DirtyGuard、StickyActionBar、同步提交锁、错误摘要与焦点恢复。
4. 实现两类 409 的过期状态和显式刷新；确保 route replace 不 remount/reset 表单。
5. POST 成功后按响应 ID 导航新 Detail，并按设计失效缓存。

完成条件：AC2、AC3、AC6、AC8、AC9、AC11、AC13 的页面行为通过组件测试。

### Step 7：增加严格 Production Fixture Playwright

1. 新增专用严格 fixture，逐个声明 auth、context、upload、POST、Detail 等允许请求；其他请求立即失败。
2. 覆盖 Detail `CORRECT` 入口、直接访问/刷新/历史 replace、成功交接、DirtyGuard、重复提交、两类 409、权限变化、上传失败/重试。
3. 在 375、768、1024、1440 px 检查无横向溢出、StickyActionBar 可达、键盘与焦点行为。

完成条件：AC1—AC13 的浏览器可观察部分由新 spec 或现有 List/Detail spec 覆盖。

### Step 8：同步权威文档

1. `05`：记录 correction context、权限、字段冻结、冲突不重放和成功交接。
2. `07`：将 Correction Workspace 标记为已迁移并保留真实栈 GEO E2E 后续项。
3. `08`：登记 strict fixture、四档宽度、冲突/上传/焦点覆盖。
4. `09`：新增 ADR，记录“组合 Detail 的更正上下文 + 通用 append POST”，明确未采用客户端拼接、新命令和通用 Form 抽象。

完成条件：代码、契约、测试与文档对同一当前设计无矛盾。

### Step 9：验证、diff 审查与交付

1. 按第 5 节运行 required validation；失败只修复与本 Task 有因果关系的问题。
2. 审查 diff：无原地更新、无自动重放、无历史证据混入、无客户端权限推断、无宽松字段兼容、无不必要抽象或依赖、无无关改动。
3. 检查新/改 Python 的中文 docstring、异常文本和开发者可见输出；不为显然代码补机械注释。
4. 汇报变更、验证、跳过的 optional checks 与残余风险；提交前另给出 commit plan 并等待用户确认。

## 4. 验收与测试映射

| 验收项 | 主要验证 |
|---|---|
| AC1–AC2 | backend correction integration；route/page tests；List/Detail/Correction Playwright |
| AC3–AC6 | correction model/page tests；Correction Playwright 四档宽度 |
| AC7–AC10 | backend correction integration；model payload tests；POST fixture assertions |
| AC11–AC12 | page accessibility tests；strict Production Fixture Playwright |
| AC13 | page mutation/cache tests；成功 handoff Playwright |
| AC14 | contract tests、双生成、typecheck/build、文档 diff 审查 |
| AC15 | List/Detail/Correction fixture 接口衔接；真实栈 E2E 明确保留为后续 |

## 5. 验证命令

### Required validation

以下命令直接覆盖本 Task 的公开契约、服务端不变量、页面逻辑和浏览器行为：

```bash
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate
make contract-check
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py -q

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_geo_observation_correction.py \
  backend/tests/integration/test_geo_observation_detail.py -q

npm --prefix frontend-v2 run test -- \
  src/domains/geo/geo.api.test.ts \
  src/domains/geo/new-geo-observation.model.test.ts \
  src/domains/geo/geo-observation-detail.model.test.ts \
  src/domains/geo/geo-observation-correction.model.test.ts \
  src/domains/geo/geo-observation-correction-page.test.tsx \
  src/domains/geo/geo-evidence-upload.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend run typecheck

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/geo-observations.spec.ts \
  tests/e2e/geo-observation-detail.spec.ts \
  tests/e2e/geo-observation-correction.spec.ts

git diff --check
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-12-frontend-v2-geo-observation-correction-workspace
```

说明：连续第二次运行两条 generation 命令后应不再产生新增 diff。后端集成命令使用项目既有 PostgreSQL 测试实例；若实例未启动，先按仓库现有测试环境命令启动，不把环境失败误判为代码失败。

### Optional full-suite validation

以下检查覆盖面更大，但本 Task 不修改数据库、权限框架、共享状态机或发布准备，因此不是完成条件；时间允许或 required check 暗示共享回归时再运行：

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-unit
make test-integration
make verify
```

明确不运行本 Task 尚未存在的真实服务 GEO 全链 E2E；其缺口和风险在交付摘要中保留给后续独立 Task。

## 6. 残余风险与止损点

- 当前 Published Article 在用户编辑期间变化仍可能触发 409；设计通过显式刷新与服务端最终校验处理，不尝试隐藏竞争条件。
- 完成上传但未成功创建 Observation 的文件继续遵循现有上传生命周期；本 Task 不新增垃圾回收协议。
- 页面级 fixture 证明浏览器状态机，不替代后续真实对象存储、数据库和权限链的全栈编排。
- 若 canonical replace 在现有 TanStack Router 生命周期中导致组件状态重建，优先在现有 route/page 边界内修复并增加回归测试；不引入全局草稿 store。

## 7. 回滚

本 Task 只新增一个读取 endpoint、一个 Frontend V2 route/page 和相应文档/测试。若实现需回滚，删除新 route/page/context endpoint 与新增 schema，重新生成两套类型，并恢复四份文档即可；现有 POST、数据库记录和 V1 不受影响。任何已经成功追加的 Correction 属于合法不可变业务历史，不作为代码回滚对象。
