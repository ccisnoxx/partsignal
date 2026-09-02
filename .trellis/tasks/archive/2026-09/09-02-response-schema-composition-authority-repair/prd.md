# Response Schema Composition 权威修订

## Goal

修正 Phase B 冻结 OpenAPI 中“关闭基础对象通过 `allOf` 增加派生字段”导致的不可满足 response schema，同步 generated client 与 FastAPI/Pydantic runtime schema，并用标准 JSON Schema 2020-12 instance validation 证明真实 model dump 可被公共合同接受；实际 HTTP payload、状态、权限、service、事务和 error-domain mapping 保持不变。

本 Task 是父任务 `08-31-non-2xx-contract-check` 的 Phase B authority correction。前序 `09-01-runtime-response-metadata-wave-1` 已暂停，现有未提交实现作为诊断现场保留，不在本规划阶段回退、提交或继续修复。

## Confirmed Facts

- critical review 已证明 `AuditLogDetail`、`PlatformLogoUpload`、`PlatformPromptListItem`、`PlatformPromptDetail` 当前 `allOf` schema 无法接受其真实成功 payload；runtime 与冻结合同同时错误时，response comparator 仍会返回空列表。
- 完整扫描发现冻结合同共有 15 个 `allOf` component，全部通过 `$ref` 指向 `additionalProperties: false` 的基础对象后再增加新字段；因此同类缺陷不是 Wave 1 的 4 个 component 特例。
- 15 个 component 经引用闭包影响 37 个成功 operation，跨越 identity、planning、configuration、production、publication、GEO 等后续 wave。精确清单见 `research/allof-authority-defect.md`。
- Pydantic `ContractModel(extra="forbid")` 默认生成展平、完整且关闭的派生 object schema；这与真实 validation/serialization 一致，不需要自定义 JSON Schema hook。
- 当前暂停候选为了匹配旧冻结合同增加了自定义 schema hook；其中 ref 注册修复依赖 Pydantic 私有 handler API并导致 required mypy gate 失败。正确 authority 修订应删除这些 hook，而不是继续包装私有 API。
- `contracts/openapi.yaml` 与 generated client 当前仍保持 Phase B 提交版本；现有 public generated types 把相关派生类型表达为 TypeScript intersections。
- backend dev dependencies 尚无 standards-based JSON Schema validator。`jsonschema`/`referencing` 可提供 Draft 2020-12 instance validation，若采用必须只加入 dev extra 并更新 `backend/uv.lock`。
- 主工作区在 `main` 且有 556 项未提交变化；除明确 Task touch set 外全部保持不动。
- 用户已批准一次性修复全部 15 个 component / 37 个 operation；本 Task 不保留局部 4-component 方案或待决范围。

## Requirements

1. 全部 15 个不可满足 `allOf` component 必须改为一个完整展平 object：合并基础与派生 properties、required 取并集，并在完整对象上保留 `additionalProperties: false`。基础公共 component 继续独立关闭，不引入开放 wrapper 或第二套 wire schema。
2. 不采用 `unevaluatedProperties` 组合方案：当前 Pydantic 默认 owner 已能产生正确展平 schema，继续保留 composition 会要求自定义 schema hook，并扩大 generator/comparator/client 的组合语义复杂度。
3. runtime schema 必须回到 Pydantic 的公开默认生成路径；删除本缺陷引入的 `__get_pydantic_json_schema__` hook、私有 handler 访问和硬编码 component ref。为保持冻结公共 discriminator identity，可保留经 review 的模型命名/兼容 import alias，但不得改变字段、validation、serialization 或实际 response payload。
4. `contracts/openapi.yaml` 是唯一可编辑公共合同；`frontend/src/shared/api/generated/schema.d.ts` 只能由 `npm --prefix frontend run api:generate` 更新，不得手改。generated diff 必须只涉及相关 intersection 展平及 generator 必然变化；其中 `ContentTask` / `ContentTaskListItem.platform_profile_id` 从旧 intersection 的错误非空收窄恢复为 runtime owner 已有的 nullable response，不属于实际 payload 扩张。
5. 增加 standards-based Draft 2020-12 instance validation：至少用真实 Pydantic `model_dump(mode="json")` 覆盖每个修复 component family，并同时验证冻结 component 与 runtime component；关闭对象的额外字段必须有负例。
6. 增加完整受影响 operation inventory。测试可把双方文档各自投影为 37 个 operation 的相关成功 response 后调用生产 comparator，并直接断言 failures 为空；不得按 failure kind 过滤、增加 baseline/allowlist/overlay 或修改 production comparator。
7. 静态合同测试必须从旧 `allOf` 结构断言改为完整 properties/required/closure 断言；测试不得读取 research 清单作为产品期望。
8. generated type 更新后必须运行 canonical frontend typecheck 和受影响 audit/platform/prompt model tests；如现有 consumer 需要业务代码适配，停止并拆分，不在本 Task 修改页面或 API 调用。
9. 不改变任何 operation response status/media/Header、ErrorEnvelope、route dependency、permission、CSRF、service、transaction、状态转换或实际 error-domain mapping。
10. 当前暂停的 Phase C 只有在本 Task 的合同、runtime、generated、instance validation 与独立 review 全部通过后才能重新规划恢复；本 Task 不归档或提交 Phase C 的 route metadata 工作。

## Acceptance Criteria

- [ ] 已识别的 15 个不可满足 `allOf` component 均为完整展平 closed object，不再以关闭基础对象加派生字段。
- [ ] 对每个修复 component，真实 Pydantic model dump 同时通过冻结 OpenAPI 与 runtime OpenAPI 的 Draft 2020-12 validation；额外字段负例被双方拒绝。
- [ ] 受影响成功 operation inventory 精确且唯一；各自只投影相关成功 response 后，完整 comparator 返回 `[]`。
- [ ] runtime 不含为匹配旧缺陷而增加的 schema hook、Pydantic 私有 handler 访问、硬编码 component URI 或依赖完整 app route 闭包的 definition 注册。
- [ ] `model_validate()`、`model_dump(mode="json")`、discriminator 与兼容 import alias 的定向 sentinel 通过，实际 HTTP payload 不变。
- [ ] generated client 仅由 `api:generate` 产生，`api:check`、frontend typecheck 与受影响 model tests 通过；不修改 frontend consumer。
- [ ] backend lock、contract tests、instance tests、runtime metadata tests、contract comparator tests、ruff 与 mypy required gates 通过。
- [ ] 无 filter 的全局 response report 仍可因 Phase D/E/X 未完成而返回 1，但不得再包含本 Task 修复 component 的 success schema drift；退出 2 阻断。
- [ ] diff 不含 service、router status metadata、permission、transaction、状态转换、error mapping、Makefile、CI、数据库、生产调用或无关 dirty artifact。
- [ ] `trellis-check` 和独立 `critical_reviewer` 均确认 schema 可满足性、真实 instance、generated client 与 runtime owner 一致；Review 不把“两侧相同”误当成 instance-valid。

## Out of Scope

- Phase C/D/E/X/F 的 response status/Header metadata 工作。
- 修改实际 HTTP payload、状态、业务 error code、权限、validation 入口、事务或状态转换。
- production comparator 的 instance validator、filter、baseline、allowlist、overlay 或 frozen-contract runtime 注入。
- frontend 页面、组件、API consumer、数据库 migration、provider/storage、部署、CI 和生产数据。
- 与本缺陷无关的 schema annotation、命名、描述、排序或其他 OpenAPI 清理。

## Scope Decision

2026-09-02 用户批准一次性修复全部 15 个 component / 37 个 operation。该决定以同一个 JSON Schema 可满足性不变量收敛跨 wave 缺陷；本 Task 不接受只修复 critical review 首先发现的 4 个 component 的降级实现。
