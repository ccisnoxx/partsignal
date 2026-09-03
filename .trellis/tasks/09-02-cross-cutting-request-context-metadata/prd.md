# 跨切面 Request Context Metadata 同步

## Goal

依据 `backend/app/main.py` middleware 已存在的实际 HTTP 行为，在同一个可审阅变更中同步全部 162 个 static/runtime operation 的 request-context metadata：可选 `X-Request-ID` request Header、非法值 `400 ErrorEnvelope`，以及每个已声明 response 的 required `X-Request-ID` response Header。实际 middleware、Cookie、业务错误、权限、事务和状态转换行为保持不变。

本 Task 是父任务 `08-31-non-2xx-contract-check` 的 Phase X。用户已批准运行 `task.py start` 并进入实施；提交、归档、push 与 Phase F 仍不在本轮授权范围。

## Confirmed Baseline

- 2026-09-02 只读重算证明 static/runtime 均为 162 个唯一 operationId、861 个已声明 response occurrence，operation key 与 operationId 集合相同。
- 当前 static/runtime 均有 0 个 `X-Request-ID` request Parameter、0 个 `X-Request-ID` response Header、0 个显式 400；完整无 filter response report 为零差异、退出码 0。
- 三波 inventory 精确为 61 + 58 + 43 = 162，互不重叠并覆盖完整 operation 集合。
- middleware 接受缺失 Header 并生成 UUID；提供值只接受 1–100 个可打印 ASCII 字符；非法值在进入 endpoint 前返回 400 的既有 `ErrorEnvelope`；正常与错误响应均写回 Header。
- 当前 861 个 response occurrence 包括 164 个成功 occurrence（200×120、201×21、202×3、204×20）和 697 个错误 occurrence。Phase X 增加每 operation 一个 400 后总数应为 1023。
- 两个 CSV 200 response 保留 `text/csv` 与 required `Content-Disposition`；20 个 204 response 保持无 body。
- login/logout 各产生两个独立 `Set-Cookie` 实例；OpenAPI 单值 Header Object 无法准确表达，因此不声明 `Set-Cookie`，只新增 HTTP sentinel。
- 工作区存在 543 个 staged 路径、范围外 `.gitignore` 与 `backend/app/schemas/configuration.py` 修改；全部保持不动。当前 Trellis 指针仍为并行任务 `08-30-v2-live-readonly-acceptance`。

详细证据见 `research/request-context-authority-audit.md` 与 `research/generated-client-cookie-and-isolation-audit.md`。

## Requirements

1. `backend/app/main.py` 是唯一 runtime request-context metadata owner。Header 名、长度与 printable-ASCII pattern 来自 runtime 常量；builder 不得读取 `contracts/openapi.yaml`、baseline 或 allowlist。
2. runtime metadata 在 FastAPI 原始 route OpenAPI 生成后由自定义 OpenAPI builder 全量合并；不得修改 162 个 endpoint 的业务实现。
3. request Header 精确语义：`name: X-Request-ID`、`in: header`、`required: false`，schema 为 string、`minLength: 1`、`maxLength: 100`、pattern `^[\x20-\x7E]+$`。
4. 每个 operation 新增显式 400，`application/json` schema 为现有 `ErrorEnvelope`，description 沿用“业务或校验错误”；不得用 `default`、`4XX` 或第二套 error schema。
5. 每个已声明 response（含新增 400、成功、错误、204、CSV）声明 required `X-Request-ID` response Header，schema 与 request 值域相同。
6. merge 只能增加上述字段；移除 Phase X Parameter、400 和 Header 后，162 个 operation 的原 status/schema/media/Header 必须与 FastAPI 原始 schema 完全相同。
7. 不覆盖 CSV `Content-Disposition`，不给 204 增加 content，不修改 operation-specific metadata 或 route/service/permission/transaction/state/error-domain owner。
8. `contracts/openapi.yaml` 与 runtime 在同一 Task 同步；static 侧复用 component Parameter/Header/现有 ErrorResponse，并建立全部 162 operation/全部 response 的机器断言。
9. `schema.d.ts` 只能由 `npm --prefix frontend run api:generate` 生成。request Header 必须保持调用方可选，不能迫使现有 API 调用传参。
10. 扩充 `test_request_context.py`：缺失、1/100、空、101、non-ASCII、不可打印、400 envelope/header request_id 一致、正常与 endpoint 错误响应 Header。
11. 新建 `test_identity_response_headers.py`，逐实例锁定 login/logout Cookie 数量及当前 Path、SameSite、Secure、HttpOnly、Max-Age/删除语义；不得逗号合并或进入 OpenAPI parity。
12. 默认 contract check 与完整无 filter response report 均退出 0；本 Task 不启用 Phase F 默认完整 response gate。
13. 隔离现有 staged artifacts、范围外脏文件和并行 task；不得修改当前 Trellis 指针。

## Acceptance Criteria

- [ ] static/runtime operation 均为 162，operationId 唯一且集合相同；三波 61/58/43 仍完整互斥。
- [ ] 每个 operation 恰有一个可选 `X-Request-ID` header Parameter，机器语义精确一致。
- [ ] 每个 operation 有显式 400 ErrorEnvelope，无 `default`/`4XX`。
- [ ] static/runtime 各有 1023 个 response occurrence，全部有 required `X-Request-ID` Header。
- [ ] 原 861 个 response 在剥离 Phase X metadata 后完全不变；CSV Header/媒体和 20 个 204 no-body 保持。
- [ ] middleware 生成、校验、日志、`request.state`、文案和响应行为不变；完整边界测试通过。
- [ ] login/logout 各两个独立 Cookie 及属性由 sentinel 锁定，OpenAPI 不出现 `Set-Cookie`。
- [ ] generated 文件只由 canonical generator 更新，Header optional；`api:check`、typecheck 和 consumer tests 通过。
- [ ] `make contract-check` 与无 filter report 退出 0；三波 runtime metadata 回归通过。
- [ ] Ruff、mypy、Trellis validate、staged isolation 和独立只读 Review 通过。
- [ ] diff 只包含批准 touch set；543 个既有 staged 路径及范围外 dirty state 不变。

## Out of Scope

- 改变 middleware、Cookie、业务错误、权限、事务、状态转换或数据。
- 将 `Set-Cookie` 声明为失真的 OpenAPI 单值 Header。
- router/service/frontend 业务实现、数据库、视觉、生产调用或无关重构。
- baseline、allowlist、filter、overlay、ignored operation/status/path。
- Phase F、`integrity-error-domain-mapping`、`v2-live-readonly-acceptance`。

## Review Gate

Task 的三份规划与 manifests 已获用户批准，`task.py start` 已运行，当前处于 `in_progress`。完成 required validation 与独立只读 Review 后停止，未经另行批准不提交、归档、push 或开始 Phase F。
