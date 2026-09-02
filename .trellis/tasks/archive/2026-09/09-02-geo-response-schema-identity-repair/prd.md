# GEO 响应 Schema Identity Authority 修复

## Goal

把 GEO observation runtime OpenAPI 的两个 Pydantic component identity 从 `LegacyGeoObservationOut` / `ManualGeoObservationOut` 对齐到冻结公共合同的 `LegacyGeoObservation` / `ManualGeoObservation`，同时保留现有 `*Out` Python import alias、字段约束、validation、serialization 和实际 HTTP payload。

本 Task 是 `09-02-runtime-response-metadata-wave-3` 的独立前置子任务，二者共同隶属于父任务 `08-31-non-2xx-contract-check`。用户于 2026-09-02 批准创建此前置任务，随后批准运行 `task.py start` 并进入实施；当前实施、required validation、独立只读 Review 与精确提交计划均已获批准。

## Confirmed Facts

- runtime OpenAPI 当前只注册 `LegacyGeoObservationOut` / `ManualGeoObservationOut`，冻结合同与 generated client 只公开 `LegacyGeoObservation` / `ManualGeoObservation`。
- 受这两个 component 传递影响的 success operation 共 5 个：`listGeoObservations`、`createGeoObservation`、`getGeoObservation`、`getGeoObservationDetail`、`getGeoObservationCorrectionContext`。
- production comparator 当前只在前三个 operation 报告 3 条 discriminator mapping URI drift；后两个 operation 的结构解析当前等价，但仍引用相同 runtime component identity，属于必须一起验证的影响闭包。
- `backend/app/services/geo_observation.py` 继续通过 `LegacyGeoObservationOut` / `ManualGeoObservationOut` 调用 `model_validate()` 与 `isinstance()`；删除旧 Python 名称会破坏内部兼容。
- 只在源码定义时把 class canonical name 改为无 `Out` 名称，并把旧名称赋值为同一 class object 的 alias，可使 runtime OpenAPI 只生成冻结合同名称。只读内存模拟已证明：两个 alias identity 均保持，5-operation success projection 的 production comparator 从 3 条差异变为 `[]`。
- 静态 OpenAPI 和 generated client 已经使用正确 canonical names；它们不是本缺口的修改 owner。

## Requirements

1. 在 `backend/app/schemas/geo_files.py` 将两个 class 定义的 canonical identity 改为 `LegacyGeoObservation` 与 `ManualGeoObservation`。
2. 在构造 `GeoObservationOut` union 前，保留 `LegacyGeoObservationOut = LegacyGeoObservation`、`ManualGeoObservationOut = ManualGeoObservation` 的直接兼容 alias；不得用 subclass、wrapper、duplicate model 或 custom JSON Schema hook。
3. `GeoObservationOut` discriminated union 必须引用 canonical classes，使 runtime component keys、`oneOf` refs 与 discriminator mapping URI 与冻结合同一致。
4. 现有 service 和 schema 内部对 `*Out` 名称的 import、`model_validate()`、`isinstance()` 与类型注解继续工作；alias 必须是同一个 class object，不引入第二份 validation/schema owner。
5. 不改变任何字段、required、default、validator、serialization、response model、actual payload、HTTP status/media/Header、permission、transaction、GEO state、service 或 error mapping。
6. 测试显式覆盖 5 个受影响 success operation，而不仅是当前报错的 3 个；双方投影只保留相关 2xx response、完整 components，然后调用 production `compare_response_contracts()` 并直接断言 `[]`。
7. 测试同时断言 canonical runtime components 存在、旧 `*Out` component keys 不存在、alias object identity 保持，并用真实 model validation/serialization 或既有 HTTP sentinel 证明 wire 行为不变。
8. 不修改 `contracts/openapi.yaml`、generated client、router metadata、response composition authority、comparator、service、数据库、frontend consumer 或 Phase X/F。
9. 无 filter 全局 report 在此前置完成但 Wave 3 未实施时应精确剩余 194 条差异：155 `missing_status` 和 39 条 422 `schema_drift`，退出码 1；不得保存为 baseline/allowlist 或使用 filter/overlay/ignored item。
10. 完成一次独立只读 review，检查 public component identity、alias compatibility、5-operation closure、实际行为保持和精确 scope；只允许一次完整 review和最多一次受影响路径复核。
11. 完整保留现有 dirty tree 和 Wave 3 planning artifacts；提交只按精确文件列表暂存，另行取得用户批准。

## Acceptance Criteria

- [x] runtime components 精确包含 `LegacyGeoObservation`、`ManualGeoObservation`，不包含对应 `*Out` component key。
- [x] `LegacyGeoObservationOut is LegacyGeoObservation` 且 `ManualGeoObservationOut is ManualGeoObservation`；现有 service imports/type checks/model validation 继续通过。
- [x] 5 个受影响 success operation 的 static/runtime projection 经 production comparator 返回 `[]`。
- [x] 当前 3 条 success discriminator mapping URI drift 全部消失，且不新增其他 success/status/media/Header drift。
- [x] 真实 model dump 与最小 GEO HTTP/read sentinels 保持既有 payload、validation 和角色行为。
- [x] 全局 report 精确为 194 failures（155 missing status + 39 schema drift），退出码 1；全部剩余差异属于尚未实施的 Wave 3 error metadata。
- [x] `contracts/openapi.yaml`、generated client、三个 Wave 3 router、service、comparator、Phase X/F 与并行 Task 均无本 Task diff。
- [x] required validation、scope/diff gate、Trellis validate 与独立 read-only review 通过。
- [x] 提交前展示精确 commit plan 并取得用户确认；不自动 archive、push 或启动 Wave 3。

## Out of Scope

- Wave 3 的 43 个 route `error_responses(...)` metadata 与 status tests。
- 再次修改 response schema composition、公共 OpenAPI、generated client 或 frontend consumer。
- GEO service、projection、permission、transaction、state transition、数据库或实际 payload。
- Phase X 的 request/response `X-Request-ID` 与 400；Phase F gate activation。
- `.gitignore`、artifacts 删除、`backend/app/schemas/configuration.py`、并行 `v2-live-readonly-acceptance` 或其他无关 dirty file。
