# 完整 Response 合同门禁实施计划

## Final Integration State

本 Task 已作为 3E 集成父任务完成九个直属子任务；没有直接承载跨 19+ 文件、162 operation 的单体实现 diff。父任务只拥有来源要求、波次依赖、最终集成验收和零漂移关闭条件，本次收尾不修改任何产品代码、公共合同、generated client、数据库合同或业务设计文档。

主要阶段提交：`4ccd6ea7`、`8dffb1ac`、`7be5b979`、`377570a9`、`eb22dc68`、`89245be8`、`562d2bce`、`cbb39f87`、`7e539c88`、`8f29f329`、`000a0d27`。父任务最终 Review 发现的 HTTP method coverage gap 由独立修复提交 `b2bc3c6` 关闭。

## Phase A：Comparator Core

唯一目标：建立可独立 mutation-test 的完整 response comparator，不切换 live gate。

预期文件（2）：

- `backend/app/tools/contract_check.py`
- `backend/tests/unit/test_contract_check.py`（新建聚焦测试，避免继续扩大现有 1144 行合同测试）

执行清单：

- [x] 抽出 document-level pure comparator，保留现有 operation/request/security 检查。
- [x] 实现 status、response、header/media/schema normalization 和 RFC 6901 diagnostics。
- [x] 增加 synthetic mutation matrix 与 FastAPI 0.139.0 最小 app 测试；覆盖 header ref/碰撞/schema-content 互斥和保留 `oneOf` 重复分支。
- [x] Phase A 增加调用同一纯 comparator 的 `--response-report` 只读诊断入口；全量漂移时非零退出，不支持 filter、suppress 或 allowlist；Phase F 已删除该入口。
- [x] Phase A 保持 `check()` 旧路径且没有添加 ignored status/path、漂移 baseline 或 permanent report-only success；Phase F 才完成默认门禁切换。
- [x] reviewer 独立检查 comparator 盲点和测试是否复制实现；父任务最终 Review 新发现的方法盲区亦已通过独立修复关闭。

Required validation：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract_check.py
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/tools/contract_check.py backend/tests/unit/test_contract_check.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app/tools/contract_check.py
```

## Phase B：Frozen Contract Authority Reconciliation

唯一目标：让冻结 OpenAPI 描述已经存在且有证据的 HTTP 行为；不修改实际业务行为。

预期文件（3–4）：

- `contracts/openapi.yaml`
- `frontend/src/shared/api/generated/schema.d.ts`（只通过 `api:generate` 生成）
- `backend/tests/unit/test_contract.py`
- 必要时新增一份 task research authority matrix；不增加生产代码。

执行清单：

- [x] 逐 operation 复核现有和缺失的 401/403/404/409/422/5xx，保存精确 final matrix。
- [x] 建立 response-header authority matrix：全局 `X-Request-ID`、两个 CSV `Content-Disposition` 进入 parity；login/logout 多实例 `Set-Cookie` 明确由 HTTP sentinel 保证，不伪造单值 OpenAPI schema。
- [x] 用实际 handler sentinel 冻结 ErrorEnvelope 的 `code/message/details/request_id` 均 required，并同步静态 schema。
- [x] 删除 `testAIModel` 不会逃逸的 502/504；补 `completeFileUpload` 的 503 及其他已证明状态。
- [x] 冻结 health nullable、GEO discriminator、generation union 与 CSV header/media 的正确公共语义；composition authority 与 GEO identity 的后续独立修复完成标准实例和 canonical identity 收敛。
- [x] 单独 review 并冻结 `X-Request-ID` request Header、400 response 及所有 response 同名 Header 的 final matrix；static/runtime 同步由 Phase X 完成。
- [x] 重新生成 client，并更新因精确 response sets 改变而失效的静态合同测试。
- [x] critical reviewer 检查公共合同没有批量猜测、行为变更或丢失既有响应。

Required validation：

```bash
npm --prefix frontend run api:generate
npm --prefix frontend run api:check
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check contracts/openapi.yaml
```

说明：这一阶段旧 checker 仍可能全绿，但不得把它当完整 response gate；验收重点是 authority matrix、generated diff 和静态合同一致。

## Phase C：Runtime Metadata Wave 1

唯一目标：同步 foundation/configuration/identity/files 的 runtime response metadata。

预期生产文件（6–7）：

- `backend/app/schemas/common.py`
- `backend/app/errors.py`
- `backend/app/main.py`
- `backend/app/routers/configuration.py`
- `backend/app/routers/identity.py`
- `backend/app/routers/files.py`
- 其他必要的对应定向测试文件

执行清单：

- [x] 建立唯一 `ErrorEnvelope` wire schema 与 response metadata helper。
- [x] 同步 health、auth/users/audit、configuration/AI、files 的 61 个 operation status。
- [x] 修正两个 CSV response 的 media/header runtime metadata。
- [x] 验证显式 422 均指向项目 ErrorEnvelope，实际非法输入行为不变。
- [x] reviewer 检查没有把共享 helper 变成全 operation 状态模板。

## Phase D：Runtime Metadata Wave 2

唯一目标：同步 product/content runtime response metadata。

预期生产文件（3）及定向测试：

- `backend/app/routers/product_facts.py`
- `backend/app/routers/planning.py`
- `backend/app/routers/production.py`

逐 operation 对照 Phase B final matrix；只改 decorator metadata，不改 service、权限、状态转换、事务或错误映射。Wave 2 的 58-operation projection 与 Wave 1 回归均已零差异。

## Phase E：Runtime Metadata Wave 3

唯一目标：同步 publication/GEO/workbench runtime response metadata。

预期生产文件（3）及定向测试：

- `backend/app/routers/publication.py`
- `backend/app/routers/observation.py`
- `backend/app/routers/workbench.py`

逐 operation 对照 Phase B final matrix；`discoverAIChannelModels`/`testAIModel`、ready/logo/file 5xx 等特殊 owner 保留行为差异，没有套统一模板。GEO identity 与 Publication event-time 前置修复完成后，Wave 3 及 Wave 1/2/3 联合覆盖 162 个 operation 并零差异。

Wave 1–3 每波 Required validation（当前子任务只运行自己的 `wave_N`，同时回归此前完成的 wave）：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py backend/tests/unit/test_contract_check.py \
  -k 'runtime_response_metadata_wave_1'
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py backend/tests/unit/test_contract_check.py \
  -k 'runtime_response_metadata_wave_1 or runtime_response_metadata_wave_2'
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py backend/tests/unit/test_contract_check.py \
  -k 'runtime_response_metadata_wave_1 or runtime_response_metadata_wave_2 or runtime_response_metadata_wave_3'
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/routers backend/app/errors.py backend/app/schemas/common.py backend/app/main.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
```

每个 wave 子任务把自己的测试 marker/参数限定为 authority matrix 中该 wave 拥有的全部 operation，并要求该集合零漂移；不得只挑代表 operation。另运行以下无 filter 的全量诊断保存 task evidence，不把输出复制为 checker allowlist/baseline。Wave 1/2 与 GEO schema-identity prerequisite 完成后仍有后续 operation-specific drift，预期退出 1；Wave 3 是最后一组 operation-specific response drift，完成后预期零差异并退出 0。Phase X 必须同时同步 static/runtime 的 400 与 response Header，从 0 开始并保持 0；Phase F 只激活已零漂移的默认门禁：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  --response-report contracts/openapi.yaml
```

下一波只在前一波 domain-zero 测试和 review 通过后开始。

## Phase X：Cross-cutting Request Context Metadata

唯一目标：同步 middleware 实际拥有的全局 X-Request-ID request/response Header 与非法值 400；不改变 middleware、Cookie 或业务错误行为。

预期文件（6–7）：

- `contracts/openapi.yaml`
- `frontend/src/shared/api/generated/schema.d.ts`（只通过 `api:generate` 生成）
- `backend/app/main.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_request_context.py`
- `backend/tests/unit/test_identity_response_headers.py`（新建，锁定 login/logout 多实例 Cookie）
- 必要时 `backend/tests/unit/test_contract_check.py` 的跨切面 metadata 定向断言

执行清单：

- [x] 按 Phase B 已批准 matrix 同步冻结合同与 runtime OpenAPI：从 request-context 代码自身的共享常量/metadata owner 为全部 162 个 operation 声明 X-Request-ID request Header、400 ErrorEnvelope 与每个 response 的 X-Request-ID Header。
- [x] runtime owner 不读取 `contracts/openapi.yaml`，不修改 operation-specific status owner，不用 `default`/`4XX` 掩盖显式 400。
- [x] HTTP sentinel 证明非法 Header 返回 400 ErrorEnvelope、正常和错误响应都回写 request id。
- [x] login/logout sentinel 证明两个 `Set-Cookie` 实例及关键安全属性保持；不把它们伪装成单值 OpenAPI Header。
- [x] 在三个 domain wave 已完成的前提下，全量 `--response-report` 零漂移；Phase F 只切换默认门禁，没有承担 metadata 修复。

Required validation：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_request_context.py \
  backend/tests/unit/test_identity_response_headers.py \
  backend/tests/unit/test_contract_check.py -k 'request_context or response_header'
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/main.py backend/tests/unit/test_request_context.py \
  backend/tests/unit/test_identity_response_headers.py backend/tests/unit/test_contract_check.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app/main.py
npm --prefix frontend run api:generate
npm --prefix frontend run api:check
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check \
  --response-report contracts/openapi.yaml
```

## Phase F：Final Gate Activation

唯一目标：把已经验证的 comparator 接入现有 `check()`，使同一 `make contract-check` 成为完整 response 门禁。

预期文件（2，Makefile/CI 预计零改动）：

- `backend/app/tools/contract_check.py`
- `backend/tests/unit/test_contract_check.py`

执行清单：

- [x] `check()` 调用完整 response comparator，删除 `successful_response()` 和首个 2xx shortcut。
- [x] 删除任何仅供过渡的 report-only 入口；保留纯 comparator 测试 seam。
- [x] 确认完整 162 operation status/media/header/schema 零漂移，并由独立修复确认 checker 覆盖八种 OpenAPI operation 方法。
- [x] `make contract-check` 先执行 backend gate，再执行同一 frontend generated check。
- [x] 检查 `.github/workflows/ci.yml` 仍通过 `make contract-check` 调用同一门禁，不复制命令。
- [x] trellis-check 全范围审查和 release-gate 独立只读 Review 均已通过。

## Required Final Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract_check.py backend/tests/unit/test_contract.py
make contract-check
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/tools/contract_check.py backend/app/errors.py backend/app/schemas/common.py backend/app/main.py backend/app/routers backend/tests/unit/test_contract.py backend/tests/unit/test_contract_check.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run api:check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-31-non-2xx-contract-check
! rg -n '[[:blank:]]+$' .trellis/tasks/08-31-non-2xx-contract-check
```

Required behavioral sentinels：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_request_context.py \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_identity_response_headers.py
```

这些 sentinels 只证明现有真实 400/401/403/422 envelope 等边界未被 metadata 同步改变；不会为每个业务 error code 复制一套 E2E。

## Optional Full-suite Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
npm --prefix frontend run test
make typecheck
```

本次父任务收尾未运行完整 backend unit suite、完整 frontend test、`make typecheck`、完整 build、Playwright 或 `make verify`，不把这些检查写成通过。原因是 Phase F 已在 `000a0d27` 候选上完成正式 full-scope gate；后续唯一相关代码变化 `b2bc3c6` 只扩充 checker 方法枚举，并已运行两个定向 pytest、Ruff、独立 Review 及一次 `make contract-check`。三个 runtime wave、schema authority 与 request-context 子任务已经分别运行各自 required 定向/集成证据。

## Final Closeout Evidence

- Phase F 正式 gate：契约单元测试 121 passed；request-context/runtime metadata 相关测试 352 passed；`make contract-check`、Ruff、mypy、frontend `api:check`、Phase F Trellis validate 和旧符号扫描通过。
- 方法覆盖修复：定向测试 68 passed、runtime frozen-operation 快照 1 passed、独立合并 re-check 69 passed、Ruff 通过；`make contract-check` 只运行一次并通过；最终 release-gate targeted re-review 无未解决 MEDIUM+。
- 当前轻量核对：父任务 `task.py validate`、父任务文档 trailing-whitespace、九个直属 child archive/status/parent、独立方法修复 archive/status、关键提交 ancestry 与 Git 范围核对均通过。
- 当前 static/runtime inventory：两侧均为 162 operation、1023 response、162 request Header、162 显式 400、1023 response Header；operation key、operationId 与 status 集合一致；OpenAPI `Set-Cookie` 和 Response Object `links` 均为 0。
- `000a0d27` 后相关变化只有 `b2bc3c6` 的 checker、定向测试和 backend error-handling spec；公共 OpenAPI、runtime metadata、generated client、Makefile 与 CI 未变，并由新的 `make contract-check` 继续证明当前一致。
- 任务外 `.gitignore`、`backend/app/schemas/configuration.py` 与 543 个 staged artifacts 删除在所有工作/归档提交中保持隔离。
- 文档一致性判断：本次父任务收尾不改变功能、业务规则、权限、数据模型、API、配置或部署行为，因此无需修改公共合同、generated client、`contracts/database.md` 或业务设计文档。

## File/Review Budget

当前可确认的文件下限为 19：checker 1、root OpenAPI 1、generated client 1、error schema/metadata/main 3、9 个 router、backend tests 至少 4（checker、contract、request context、identity Cookie）。跨切面 metadata 若经 review 需要独立 owner，文件数再增加 1；各 wave 不得以这一估算拒绝必要的既有 domain behavior test 更新。

涉及 operation 约 158 个已有 status/shape drift，另有 162 个 operation 的 middleware 400/Header 同步；因此禁止把全部变化压成一个提交或一个实现 Task。每个子任务必须只提交自己的文件 owner，并由主代理复核全量 diff，既有 dirty files/artifacts 始终排除。

## Rollback Points

- Phase A 可独立回滚，不影响 live gate。
- Phase B 是公共合同变更，回滚必须同时回滚 OpenAPI、generated 和静态测试，不能只回滚生成物。
- Phase C–E 每波只回滚对应 router metadata；共享 ErrorEnvelope owner 在后续 wave 使用后不得单独删除。
- Phase X 只回滚跨切面 OpenAPI metadata 与定向测试，不改变 middleware 的既有 request-id/Cookie 行为。
- Phase F 只有在 Phase B–E 与 Phase X 全量零漂移时进入；失败时回滚 activation，不恢复 allowlist、baseline 或 contract overlay。

## Pre-start Review Checklist

- [x] 人工确认当前 Task 作为集成父任务，先创建 Phase A 子任务而非启动父任务。
- [x] 人工确认 headers 进入机器合同，links 采用 unsupported fail-closed，annotation 字段不比较。
- [x] 人工确认 `testAIModel` 以现有 200 失败投影为权威，不在 3E 改业务行为。
- [x] 人工确认 `X-Request-ID` request/response Header 与 400 进入跨切面同步，`Set-Cookie` 留在多实例 HTTP sentinel。
- [x] 人工确认 `ErrorDetail.details` 按实际 handler 改为 required。
- [x] 人工确认 public contract 变更与 generated client 影响范围。
- [x] 父 Task 未被启动；`v2-live-readonly-acceptance` 始终保持当前 `in_progress` Task。
