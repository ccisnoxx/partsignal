# Frontend V2 New GEO Observation 技术设计

## 状态与设计原则

本设计已完成现状审计并获最终批准：保持当前人工逐篇结果合同，recommendation/citation 不进入本 Task。

采用最小增量：复用既有页面基础设施和后端资格判断，不新增 creation-options read model、幂等框架、跨域万能上传组件或 Observation Detail 占位页。

## 审计结论

### 1. `GeoObservationCreate` 是否完整覆盖蓝图

| 蓝图数据 | 当前合同 | 结论 |
|---|---|---|
| Product、Query Topic、platform、search query、tested time、notes | 已覆盖 | 可直接实现 |
| Published Article 关联 | `article_results[].published_article_id` | 已覆盖 |
| discovered、mentioned、accuracy | 当前每文章字段 | 已覆盖 |
| evidence attachments | `attachment_file_ids` | 已覆盖 |
| correction 链 | `supersedes_id` | 新建页必须省略 |
| recommendation、citation | 迁移 0029 后已从人工结果移除 | 按方案 A 明确排除，不恢复迁移或兼容字段 |

权威证据位于 `contracts/openapi.yaml` 的 `GeoObservationCreate` / `GeoArticleResultCreate`、`contracts/database.md` 的 0029 记录、`backend/app/schemas/geo_files.py` 与 `.trellis/spec/backend/database-guidelines.md`。

### 2. 候选权威接口

- Product：`GET /api/v1/products`，按用户输入服务端搜索和分页。
- Query Topic：`GET /api/v1/query-topics`，读取当前权威 Topic 集合。
- Published Article：`GET /api/v1/geo-observation-publications?product_id=...`。该服务与 POST 使用同一资格规则；通用 `/published-articles` 不是替代品。
- 附件：`POST /files/upload-intents` → 对象存储 transfer → `POST /files/{file_id}/complete`；失败时按现有协议 abort 或重试 complete。
- GEO platform：当前没有候选实体或配置接口，使用当前合同中的自由文本字段。

### 3. creation-options read model

不需要。首屏 Product 与 Query Topic 可并行读取；Published Article 候选天然依赖 Product 选择，且 POST 在事务内重新锁定并比较完整集合。不存在多个互不一致分页接口的浏览器 join，也没有需要单快照解决的真实 waterfall。只有未来审计出现至少两个必须同快照读取且客户端无法组合的权威数据源时才重新评估。

### 4. `Idempotency-Key`

本 Task 不增加。当前 POST、OpenAPI 和数据库没有幂等键合同或存储，同类同步数据库创建页也只做 pending 防重。页面以同步提交引用和 mutation `isPending` 阻止双击、Enter 重复和并发调用；失败后由用户明确重试，不自动 replay。

这不声称具备跨请求幂等性。响应丢失后的人工重试风险记录在 PRD，若要消除必须单独批准持久化幂等合同。

### 5. 成功 handoff

Observation Detail 尚未实现，因此成功后：

1. 清除表单 dirty 状态；
2. invalidates `geoKeys.lists()`；
3. invalidates 受影响 Product detail query；
4. 导航到 `/geo/observations?page=1&pageSize=20`。

不注册 `$observationId` route、不创建占位页面、不伪造列表行。列表按 `tested_at` 排序时新记录未必位于第一页，这是既有 canonical list 语义，不在客户端伪造排序结果。

### 6. append-only 与不可变规则

- 新建页的 payload 类型在页面边界排除 `supersedes_id`，创建请求不发送该字段。
- 页面不读取既有 Observation、不提供编辑或 correction 操作、不复用 correction 文案。
- 后端继续作为资格、完整候选集合、附件状态和权限的最终权威。
- 对 `GEO_PUBLICATIONS_CHANGED` 只重新获取候选，不自动重提；不得绕过事务校验。
- 不增加 PATCH/PUT，不修改已批准事实、原 Observation 或历史链。

## 页面结构

### Route 与入口

- 新增 lazy route：`/_app/geo/observations/new.tsx`。
- 在现有 Observation List 页增加“新建 Observation”主操作，目标为 canonical new route。
- route 只组合依赖、mutation 与 cache invalidation；GEO 域组件负责表单行为。

### Workspace 分区

- Context：Product、Query Topic、GEO platform、tested time。
- Main：search query 与 Published Article 事实字段组。
- Reference：evidence attachments、notes 与创建约束提示。
- Footer：`StickyActionBar` 的 Cancel/Create。

`WorkspaceShell` 在宽屏呈现三列，在较窄 viewport 使用既有 tabs。Published Article 使用 semantic fieldset/card grid；桌面可对齐为列，窄屏纵向堆叠，不引入 DataTable。

## 数据与状态流

```text
进入页面
  ├─ products(search,page) ─┐
  └─ query-topics ──────────┴─> Workspace 可填写
                                 │
选择 Product ─> geo-observation-publications(product_id)
                                 │
完成附件上传 ────────────────────┤
                                 v
客户端验证 ─> POST geo-observations ─> 后端事务重验候选/附件/权限
                                 │
                      success ───┴─> invalidate + canonical list
                      409 ─────────> 明确刷新候选，不自动重提
```

- URL 不承载未提交表单草稿；Back/Forward 返回时按新页面重新初始化。
- Product 改变时清除上一个 Product 的 article result 集合并加载新候选，避免跨产品残留。
- 候选刷新按 Published Article ID 保留仍有效的已填字段；新增候选保持未选择，失效候选移除。
- dirty 判定覆盖所有表单值和已完成附件引用。pending 状态不被误认为 dirty 状态。

## 校验与错误映射

- Zod 只镜像当前必要合同：UUID、trim 后非空 platform/query、有效时间、完整唯一候选集合、显式布尔值、可选 accuracy、唯一附件 ID。
- `notes` 保持服务端允许空字符串的现状，不新增前端业务限制。
- 已知服务端 location 映射到 FormField；数组/候选行错误映射到对应 Published Article fieldset。
- 无法可靠定位的 issue 保留在 ErrorSummary，并显示服务端 message 与 `request_id`。
- 401/403/404/409/422 保持原始语义；没有 broad catch、静默默认或 success fallback。
- OpenAPI 为 create POST 补齐实际结构化错误响应，再机械再生成 V1/V2 schema；不修改旧 V1 业务 UI。

## 上传设计

现有 SHA-256 与对象存储 PUT/POST transfer 只位于 publication 域组件内。为避免 GEO 跨域导入或复制 I/O 实现，先把这两个无业务判断的纯协议函数提取到一个窄 `shared/api/file-transfer.ts`；既有 Publication 与新 GEO uploader 共同调用它。intent/complete/abort 的领域错误仍由各自 API owner 映射，不创建共享 UI、状态机或万能 Upload framework。

GEO 页面拥有一个窄 `GeoEvidenceUpload` 组件。状态仅包含 selected/uploading/transferred/completing/verified/error，complete 失败可从同一 intent 重试。

取消表单只移除本地引用；现有后端对已 VERIFIED 但未引用截图文件没有即时清理合同，因此不在本 Task 猜测删除 API 或加入跨域补偿逻辑。

## 精确文件范围

### 当前合同方案

| 动作 | 文件 |
|---|---|
| 修改 | `contracts/openapi.yaml` |
| 修改 | `backend/tests/unit/test_contract.py` |
| 机械生成 | `frontend-v2/src/shared/api/generated/schema.d.ts` |
| 机械生成 | `frontend/src/shared/api/schema.d.ts` |
| 修改 | `frontend-v2/src/domains/geo/geo.api.ts` |
| 修改 | `frontend-v2/src/domains/geo/geo.api.test.ts` |
| 新增 | `frontend-v2/src/shared/api/file-transfer.ts` |
| 新增 | `frontend-v2/src/shared/api/file-transfer.test.ts` |
| 修改 | `frontend-v2/src/domains/publication/publication-evidence-upload.tsx` |
| 修改 | `frontend-v2/src/domains/publication/publication-evidence-upload.test.tsx` |
| 新增 | `frontend-v2/src/domains/geo/new-geo-observation.model.ts` |
| 新增 | `frontend-v2/src/domains/geo/new-geo-observation.model.test.ts` |
| 新增 | `frontend-v2/src/domains/geo/geo-evidence-upload.tsx` |
| 新增 | `frontend-v2/src/domains/geo/geo-evidence-upload.test.tsx` |
| 新增 | `frontend-v2/src/domains/geo/new-geo-observation-page.tsx` |
| 修改 | `frontend-v2/src/domains/geo/geo-observation-list-page.tsx` |
| 修改 | `frontend-v2/src/domains/geo/geo-observation-list-page.test.tsx` |
| 新增 | `frontend-v2/src/routes/_app/geo/observations/new.tsx` |
| 机械生成 | `frontend-v2/src/routeTree.gen.ts` |
| 新增 | `frontend-v2/tests/e2e/fixtures/new-geo.fixture.ts` |
| 新增 | `frontend-v2/tests/e2e/new-geo-observation.spec.ts` |
| 修改 | `docs/frontend-v2/05-business-actions-state-and-api-contract.md` |
| 修改 | `docs/frontend-v2/07-migration-plan.md` |
| 修改 | `docs/frontend-v2/08-testing-quality-and-acceptance.md` |

`docs/frontend-v2/09-architecture-decisions.md` 不修改：ADR-015 已规定只有真实 waterfall 才新增 read model，ADR-014/ADR-030 已覆盖 URL/cache 与 GEO canonical route 边界，本 Task 没有新增架构决策。若实现审计证明某个预列文件没有行为或权威事实变化，则从范围中删除，不为清单本身制造文件。

## 回滚与残余风险

- 前端 route、域文件和 OpenAPI 响应声明均为可删除的增量；不修改数据库时无数据回滚。
- 后端候选可能在用户填写期间变化，409 刷新流程是预期并发控制，不通过客户端兼容逻辑隐藏。
- 上传完成但创建取消的未引用文件生命周期是现存边界风险，记录但不扩展本 Task。
