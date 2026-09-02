# GEO 响应 Schema Identity Authority 修复：技术设计

## 1. Gap 与 Authoritative Owner

冻结 OpenAPI 的 public component identity 是 `LegacyGeoObservation` / `ManualGeoObservation`；runtime Pydantic class identity 目前多出 `Out`。两侧字段结构相同，但 discriminator mapping URI 是 machine contract，不能作为 annotation 忽略。

真实 owner 是 `backend/app/schemas/geo_files.py` 的两个 class definition。Router 只引用 union，service 只实例化/检查 model；在 route 中硬编码 schema 或在 comparator 中忽略 mapping 都会绕过 owner。

## 2. Canonical Class + Compatibility Alias

最小实现：

```python
class LegacyGeoObservation(ContractModel):
    ...

class ManualGeoObservation(ContractModel):
    ...

LegacyGeoObservationOut = LegacyGeoObservation
ManualGeoObservationOut = ManualGeoObservation

GeoObservationOut = Annotated[
    LegacyGeoObservation | ManualGeoObservation,
    Field(discriminator="observation_kind"),
]
```

直接 alias 保证旧名称与 canonical class 是同一对象：没有 subclass、额外 schema、validator 复制、serialization 分支或第二 source of truth。现有 service 无需修改，其 `model_validate()`、`isinstance()` 和 imports 继续指向同一 class。

内存模拟使用真实 `geo_files.py` 内容和真实 FastAPI app 装配验证了此方案：runtime component keys 变为 canonical names，旧 key 消失，5-operation success projection comparator 返回 `[]`。

## 3. Impact Closure

按 runtime success response 的递归 `$ref` closure，共 5 个 operation：

| Method/path | operationId | Success | 影响方式 |
|---|---|---|---|
| GET `/api/v1/geo-observations` | `listGeoObservations` | 200 `GeoObservationList` | list items 的 discriminated union |
| POST `/api/v1/geo-observations` | `createGeoObservation` | 201 `GeoObservation` | direct discriminated union |
| GET `/api/v1/geo-observations/{observation_id}` | `getGeoObservation` | 200 `GeoObservation` | direct discriminated union |
| GET `/api/v1/geo-observations/{observation_id}/detail` | `getGeoObservationDetail` | 200 `GeoObservationDetail` | detail 内嵌 legacy/manual observation |
| GET `/api/v1/geo-observations/{observation_id}/correction-context` | `getGeoObservationCorrectionContext` | 200 `GeoObservationCorrectionContext` | correction history 内嵌 manual observation |

前三个当前产生 comparator failure；后两个纳入闭包回归，防止 component key 迁移造成新 drift。

## 4. Test Design

在 `backend/tests/unit/test_runtime_response_metadata.py` 增加独立 schema identity 测试区：

- 显式 5-operation tuple 与唯一性/存在性断言；
- success-only projection helper 或对现有 projection 的最小扩展；
- static/runtime 保留完整 components 后调用 production comparator，直接断言 `[]`；
- 断言 runtime canonical component keys、旧 key 不存在；
- 断言两个 compatibility alias 分别 `is` canonical class；
- 以现有 model fixture/最小合法值验证旧 alias 与 canonical class 得到相同 `model_dump(mode="json")`；不得复制完整 service projection。

另运行既有 `test_contract.py::test_geo_observation_list_accepts_page_size_from_query_string`，证明真实 HTTP query/read serialization 仍为 200；运行相关 static schema/detail tests 和现有 response-schema instance tests，防止影响已修复 composition。

## 5. Contract 与 Generated Decision

- `contracts/openapi.yaml` 已拥有正确 canonical component names，不修改。
- generated client 来源于 static OpenAPI，当前也已使用 canonical names，不重新生成、不手改；`api:check` 可作为 optional evidence。
- 不更新 `.trellis/spec/`：本 Task 直接应用 `error-handling.md` 已有“以可满足 public authority 为准、优先 Pydantic公开默认路径、禁止 duplicate schema/custom private hook”规则，没有新增长期约定。
- 不修改业务设计或数据库文档，因为 wire payload、数据模型和流程均不变。

## 6. Global Report 与 Dependency Order

当前全局 197 failures = Wave 3 的 155 missing status + 39 automatic-422 schema drift + 本 Task 的 3 success identity drift。

此前置完成后的可验证中间态必须是 194 failures、退出 1；随后 Wave 3 同步 error metadata 后变为 0/退出 0。Phase X 同时更新 static/runtime 400/Header 并保持 0，Phase F 最后激活默认 gate。

顺序：

```text
GEO schema identity prerequisite
  → Runtime Metadata Wave 3
    → Phase X
      → Phase F
```

## 7. Rollback 与 Commit Boundary

回滚只恢复两个 canonical class name、两个 direct alias 和相应 test hunk；不回滚静态合同/generated、composition repair、Wave 1/2、service 或父计划。因为旧 names 仍是 aliases，正常回滚前后 actual payload 均不变。

默认 commit 精确包含：

- `backend/app/schemas/geo_files.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `.trellis/tasks/08-31-non-2xx-contract-check/task.json`
- `.trellis/tasks/08-31-non-2xx-contract-check/implement.md`
- 本 Task 的 8 个 planning/research artifacts

Wave 3 task artifacts 保持未暂存；如新增验证记录，必须先更新 commit plan 并重新获得用户确认。
