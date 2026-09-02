# 运行时响应元数据 Wave 3

## Goal

同步 `publication`、`observation`、`workbench` 三个真实 FastAPI router 的 operation-specific runtime response metadata，使其与 Phase B `final-response-authority-matrix.jsonl` 及当前冻结公共合同一致；实际 HTTP status、body、Header、权限、校验、事务、状态转换和 error-domain mapping 保持不变。

本 Task 是父任务 `08-31-non-2xx-contract-check` 的 Phase E。用户已批准并已运行 `task.py start`，当前进入生产实现；提交、归档与 Phase X 仍需按各自边界另行处理。

## Confirmed Inventory

- 由三个实际 `APIRouter.routes`、`app.openapi()`、冻结 `contracts/openapi.yaml` 和 Phase B matrix 四方按 `(path, method, operationId)` 联结，得到 **43** 个唯一 operation：`publication=30`、`observation=12`、`workbench=1`；四方均完整存在且无重复。
- Phase B status occurrence：`200=34`、`201=6`、`204=3`、`401=43`、`403=43`、`404=32`、`409=37`、`422=39`；无 5xx、`4XX`、`default` 或其他状态。
- 39 个 operation 必须显式声明 422；4 个不得声明 422：`listPublicationReadyItems`、`getPublicationWorkbenchSummary`、`getDashboardSummary`、`getWorkbench`。
- 全部 success response 的 operation-specific Header 为 none；34 个 200 与 6 个 201 为 `application/json`，3 个 204 为 no-body。
- 前置完成后的启动基线中，全局 response comparator 共 194 条差异，全部属于 Wave 3：155 条 `missing_status`（401×43、403×43、404×32、409×37）和 39 条自动 422 `schema_drift`；GEO success drift 已归零。完整 inventory 与 owner 见 `research/wave-3-operation-ownership.md`。

## Approved Dependency Decisions

1. `listGeoObservations` 200、`getGeoObservation` 200、`createGeoObservation` 201 存在既有 success schema identity drift：冻结 schema discriminator 指向 `LegacyGeoObservation` / `ManualGeoObservation`，runtime 指向 `LegacyGeoObservationOut` / `ManualGeoObservationOut`。payload 字段形状等价，但 production comparator 正确地把 discriminator mapping URI 视为机器合同，因而不能仅靠添加 `error_responses(...)` 达成 Wave 3 投影零差异。
2. 该缺口的权威 owner 是 `backend/app/schemas/geo_files.py` 的两个 Pydantic class identity，不是三个 route decorator。独立前置 Task 已由 commit `89245be8` 完成 canonical identity 修复、验证和归档，同时保留现有 `*Out` import alias 与 wire payload；本 Task 不再修改该 schema 文件。
3. 当前无 filter 全局 `--response-report` 的 194 条差异与 Wave 3 投影完全相同。Phase X 的 400 和 `X-Request-ID` response Header 当前在冻结合同与 runtime OpenAPI 中均未声明，且 response comparator 不比较 request Header。因此 Wave 3 真正零差异后，退出码为 **0**、剩余差异为 **0**。用户已批准这一预期，父任务实施计划已同步修正；不得为维持旧的退出 1 而留下 drift 或提前单边写入 Phase X metadata。

## Requirements

1. 仅在前置 schema identity 决策解决后，逐 decorator 按 ownership matrix 显式传入该 operation 自己的 `responses=error_responses(...)`；不得按 router、HTTP method、依赖类型或相邻 route 推断或批量模板化 status。
2. 复用 `backend/app/schemas/common.py::ErrorEnvelope` 与 `backend/app/errors.py::error_responses`；不得新增第二套错误模型、错误码、默认 status 集合、fallback 或 error-domain mapping。
3. 401/403/404/409/422 只改变 OpenAPI metadata。现有 `CurrentUser`、`CsrfProtected`、`assert_account_types`、route/service `AppError`、`RequestValidationError` handler、`IntegrityError` handler 与真实逃逸/转换保持不变。
4. 保留 publication package/account/work/result/verification/issue/repair/permanent-delete 流程的权限、revision、idempotency、冲突、事务和状态转换；特别保留 verification 在换版后拒绝的 409 与持久状态不变。
5. 保留 GEO observation list/detail/correction/create/delete、topic/publication association、metrics/insights/optimization 的角色、追加式更正链、筛选 422、404/409 owner 与事务语义。
6. 保留 workbench 的认证共享读取、`REPEATABLE READ` 快照、聚合 read model、空分母语义与 malformed GEO projection 409。
7. success status/schema/media/Header 必须逐 operation 与冻结合同相同。3 个 204 不得出现 body；全部 43 个 operation 不得新增 operation-specific response Header 或 5xx。
8. operation-specific metadata 与 Phase X 严格分离：本 Task 不声明 optional request `X-Request-ID`、非法值 400、任何 response 的 `X-Request-ID` Header，也不修改 login/logout 多实例 `Set-Cookie`。
9. `backend/tests/unit/test_runtime_response_metadata.py` 必须显式维护 Wave 3 的 43 个 operationId、三组精确数量与逐 operation status authority；测试期望不得从 runtime、matrix research、baseline、allowlist、filter、overlay 或 ignored operation/status/path 动态生成。
10. Wave 3 static/runtime 投影保留完整 components 后调用 production `compare_response_contracts()`，直接断言完整 failure list 为 `[]`；同时独立回归 Wave 1 的 61 个和 Wave 2 的 58 个 operation 投影。
11. 使用最小 HTTP/integration sentinels 证明 metadata 改动未绕开认证、角色、CSRF、输入 422、publication verification 409、workbench snapshot 与 GEO read behavior。若 AST/diff 出现 decorator/import/test 以外的行为变化，立即停止并回到设计审查。
12. 不修改合同、generated client、共享 error owner、comparator、service、permission、transaction、数据库、Phase X/F、integrity mapping、frontend 或生产数据。
13. 完成一次独立只读逐 operation review；只允许一次完整 review 和最多一次受影响路径复核。复核仍有 MEDIUM 及以上问题或同一问题未解决时停止。
14. 现有 545 项基线脏状态全部保留；不得恢复、删除、格式化、暂存或提交 `.gitignore`、543 个删除项、`backend/app/schemas/configuration.py` 或其他未授权文件。提交前必须按精确文件列表暂存并核对 staged scope，且另行取得用户提交批准。

## Acceptance Criteria

- [x] 已获批准的前置 Task `09-02-geo-response-schema-identity-repair` 完成并通过验证；本 Task 不以 duplicate schema、OpenAPI overlay、comparator 放宽或已知 drift 绕过它。
- [x] 43 个 operation 的 router/method/path/operationId/success/status/422/特殊状态/runtime owner 与 research matrix 一致，分组精确为 30/12/1。
- [x] 43 个 runtime response status set 与 Phase B authority 精确相同；39 个 422 和其余全部 error response 均引用唯一 `ErrorEnvelope`，4 个 no-422 operation 不出现 422。
- [x] 34 个 200、6 个 201、3 个 204 的 schema/media/Header 精确匹配；3 个 204 无 body，Wave 3 无 5xx、`4XX`、`default` 或 operation-specific Header。
- [x] Wave 3 完整投影 comparator 返回 `[]`；Wave 1 61-operation 与 Wave 2 58-operation 投影也分别返回 `[]`。
- [x] required HTTP/behavior sentinels通过，且 production diff 仅含三个 router decorator/import；未改变 endpoint body、dependency、service call、权限、事务、状态转换或 error mapping。
- [x] 无 filter 全局 report 的实际退出码和完整剩余差异被记录；结果为 0/零差异。
- [x] `contracts/openapi.yaml`、generated client、共享 helper/ErrorEnvelope、schema composition、Phase X/F、service 与并行 `v2-live-readonly-acceptance` 均无 Task diff。
- [x] required validation、Trellis validate、scope/diff/trailing-whitespace gates 与独立只读 review 通过。
- [x] 提交计划只包含经批准的三个 router、一个 metadata test 和本 Task artifacts；既有脏文件明确排除且未被暂存。

## Notes

本 Task 已按批准运行 `task.py start` 并进入实施。GEO schema identity 前置修复 `89245be8` 与 publication event-time 前置修复 `562d2bce` 均已完成并归档；在当前 HEAD `08cec203` 上恢复后，四个 PostgreSQL sentinels、全部 required validation 与无 filter 全局 response report 均通过。当前只等待 Wave 3 工作提交批准；未修改并行 Task，后续顺序保持 Wave 3 → Phase X → Phase F。
