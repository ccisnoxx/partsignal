# Response Schema Composition 权威修订设计

## 1. 设计目标与权威顺序

本 Task 修复公共 response schema 的可满足性，不改变 HTTP 行为。权威顺序固定为：

1. `contracts/openapi.yaml` 定义公共 wire schema；
2. Pydantic model 定义运行时 validation、serialization 与 runtime OpenAPI schema；
3. `frontend/src/shared/api/generated/schema.d.ts` 只能由公共合同生成；
4. comparator 证明两份 response metadata 一致，标准 JSON Schema validator 独立证明真实 instance 可被两份 schema 接受。

前序 `09-01-runtime-response-metadata-wave-1` 保持暂停。本 Task 只接管其 custom schema hook、相关测试 hunk 与 `.trellis/spec/backend/error-handling.md` 中被本次 authority correction 推翻的指导；不接管 route status、ErrorEnvelope、CSV/health metadata 等 Phase C 工作。

## 2. 唯一 Composition 决策

全部 15 个派生 component 改为完整展平且关闭的 object schema：

- 把基础和派生层级的 `properties` 合并到一个 object；
- `required` 为各层 required 的去重并集；
- 在最终完整 object 上声明 `additionalProperties: false`；
- 保留每个字段原有 type、format、nullable、enum、description 与约束；
- 基础 component 本身继续是独立 closed object；派生 component 不再通过 `allOf` 引用它。

不采用开放基础对象配合 `unevaluatedProperties: false` 的方案。当前 runtime owner 使用 `ContractModel(extra="forbid")`，默认即可生成与实际 validation/serialization 一致的展平 closed object；保留 composition 会继续要求 custom hook，并额外扩大 Pydantic、OpenAPI generator、comparator 与 TypeScript generator 的语义表面。

## 3. Component、Runtime Owner 与改动责任

| 公共 component | Runtime owner | 计划动作 |
|---|---|---|
| `AuditLogDetail` | `backend/app/schemas/common.py::AuditLogDetail` | 合同展平；移除为旧合同增加的 custom schema hook，保留模型字段和 validator 行为。 |
| `QueryTopic`、`QueryTopicListItem` | `backend/app/schemas/configuration.py::QueryTopicOut/QueryTopicListItem` | 合同展平；默认 runtime 已展平，只验证不改写模型。 |
| `PlatformLogoUpload` | `backend/app/schemas/configuration.py::PlatformLogoUpload` | 合同展平；移除 custom schema hook；保留 `PlatformLogoUploadOut` 兼容 import alias 与 discriminator identity。 |
| `PlatformPromptUpdate`、`PlatformPromptListItem`、`PlatformPromptDetail` | `backend/app/schemas/configuration.py` 对应同名类 | 合同展平；移除 ListItem/Detail custom hooks；Update 与默认 schema 只验证。 |
| `ContentTask`、`ContentTaskListItem`、`GenerationJobDetail` | `backend/app/schemas/content.py::ContentTaskOut/ContentTaskListItem/GenerationJobDetail` | 合同展平；默认 runtime 已展平，只验证不改写模型。 |
| `PlatformAccount` | `backend/app/schemas/publication.py::PlatformAccountOut` | 合同展平；默认 runtime 已展平，只验证不改写模型。 |
| 四个 `GeoInsight*` 派生 component | `backend/app/schemas/geo_files.py` 对应派生类 | 合同展平；默认 runtime 已展平，只验证不改写模型。 |

`backend/app/schemas/content.py`、`publication.py` 与 `geo_files.py` 是 instance/runtime owner 和 review 对象，但不是预期产品代码 touch set。若实现时发现必须修改这些文件才能达到已批准合同，须停止并回到设计审查，不能把额外运行时变化静默并入。

## 4. 公共合同修订规则

合同逐 component 人工按 authority 字段合并，不新增持久化 rewrite script。实现时使用结构化测试证明以下不变量，避免依赖 YAML 文本顺序：

- 15 个 component 不含 `allOf`；
- 每个 component 的 properties 与所有原层级字段集合完全相同；
- required 集合与原层级 required 并集完全相同；
- `type: object` 与 `additionalProperties: false` 明确存在；
- component 引用它们的 37 个 operation 不改变 response status、media type、Header 或 success root。

本 Task 不借机展平其余 `$ref`、`oneOf`、`anyOf`，也不调整字段描述、命名、排序或其他 annotation。

## 5. Runtime Schema 收敛

删除 `common.py` 和 `configuration.py` 中为复制旧 `allOf` 形状引入的 `__get_pydantic_json_schema__`、Pydantic private handler 访问与硬编码 ref 注册逻辑。模型继承、字段定义、validator、`model_validate()` 与 `model_dump(mode="json")` 保持不变。

`PlatformLogoUpload` / `PlatformLogoExternal` 的公共 component identity 与 `PlatformLogoUploadOut` / `PlatformLogoExternalOut` 兼容 import alias 继续保留，因为这些名称已用于 runtime discriminator 与既有 service import；本 Task 不创建另一组 schema class 或 wire mapping。

`backend/tests/unit/test_runtime_response_metadata.py` 当前同时拥有 Phase C operation metadata 与旧 custom-hook sentinel。只修改后者的精确 hunk，使其断言默认展平、closed schema 和 ref closure；不得改动 Phase C 的 status matrix、ErrorEnvelope、CSV 或 health 测试。

## 6. Standards-based Instance Validation

在 backend `dev` optional dependency 增加 `jsonschema>=4.23,<5` 并更新 `backend/uv.lock`。新增 `backend/tests/unit/test_response_schema_instances.py`：

1. 以完整 static/runtime OpenAPI document 建立 Draft 2020-12 `referencing.Registry/Resource`；
2. 使用 `Draft202012Validator` 与 format checker 解析各 document 内 `$ref`；
3. 为 15 个 component family 由真实 Pydantic model 构造最小合法对象，并以 `model_dump(mode="json")` 作为唯一正例 payload；
4. 同一个 payload 分别验证 static component 与对应 runtime component；
5. 每个 component 的 payload 增加一个未知字段，断言 static/runtime 两侧均拒绝；
6. 对已有业务 model validator 的对象，fixture 必须满足真实领域约束，不绕过 `model_validate()`，不复制生产 validation。

测试内部可以维护“公共 component → runtime component/model/fixture”显式矩阵，但不得从 research 文档加载期望，也不得成为生产 runtime dependency。

## 7. 37-operation Comparator 验收

`research/allof-authority-defect.md` 的 37 个 operation 是 review inventory；测试代码维护同样的显式 operationId 集合，并先证明集合唯一、全部存在于 static/runtime 文档。

随后把两份 OpenAPI 各自投影为：

- 只保留 37 个 operation；
- 每个 operation 只保留受本 Task 影响的 2xx response；
- 保留 comparator 解析 schema 所需的完整 components。

把两个投影直接交给生产 `compare_response_contracts()`，断言完整 failure list 为 `[]`。不得按 failure kind、component、path 或 message 过滤，也不得修改 `backend/app/tools/contract_check.py`、增加 baseline/allowlist/overlay 或 production instance-validation 分支。

全局 `--response-report` 仍以无过滤方式运行。退出码 1 代表 Phase D/E/X 等后续 metadata drift 尚未完成，是允许的中间态；退出码 2 必须阻断；若退出码 0，则需确认不是意外扩大本 Task 范围后才能接受。

## 8. Generated Client 与 Consumer 边界

修改 `contracts/openapi.yaml` 后只运行：

```bash
npm --prefix frontend run api:generate
```

生成结果预期把 15 个相关 TypeScript intersections 改为与 runtime wire owner 一致的完整 object 类型。不得手改 generated 文件。13 个类型与旧 intersection 严格双向可赋值；`ContentTask` / `ContentTaskListItem` 的旧基础分支把 `platform_profile_id` 错误收窄为非空，展平后按派生/runtime owner 修正为 nullable。该 generated 类型修订反映既有真实 payload，不改变 HTTP 行为。运行 `api:check`、全量 frontend typecheck 与受影响 audit/platform/prompt model tests；如任何 frontend consumer 必须修改才能编译或保持行为，停止并拆出独立任务，本 Task 不修改 consumer。

## 9. Spec 与文档同步

修订 `.trellis/spec/backend/error-handling.md` 中“为匹配冻结 schema 使用 custom JSON Schema hook”的过时指导：先以 standards-based instance validation 确认公共 schema 可满足，再以默认 Pydantic schema 为优先；不得通过私有 API 镜像不可满足合同。

不修改 `contracts/database.md`、业务设计文档、Makefile 或 CI：本 Task 不改变数据库、业务规则或验证入口。决策历史留在本 Task 与暂停 Phase C Task，不在多个长期文档重复 15/37 清单。

## 10. Dirty Tree、提交与恢复

- 开始实现前记录 `git status --short` 和本 Task 权威文件 hash；已有 556 项 dirty changes 全部视为用户/其他任务资产。
- 对 `common.py`、`configuration.py`、`test_runtime_response_metadata.py` 与 backend spec 使用 hunk-level owner 审查，只接管本设计列明的 hook/测试/指导。
- 不暂存、不提交、不回退其他文件；完成验证后先展示精确 commit plan，再等用户批准。
- 若修订不能在不改变真实 payload 的前提下成立，停止并保留诊断证据；不退回 custom composition workaround。
- 本 Task 通过后只解除 Phase C 的 blocker，Phase C 必须重新规划/复核后再继续，不能在同一 Task 顺带恢复实现。
