# 完整 Response 合同门禁设计

## 1. 不变量与权威顺序

最终门禁比较两个独立产物：

```text
route/dependency/service 实际行为
        │ 证据校准
        ├── FastAPI runtime OpenAPI（运行实现声明）
        └── contracts/openapi.yaml（冻结公共合同）
                         │
                         └── frontend generated client
```

runtime OpenAPI 与冻结合同必须独立形成。任何一侧都不能读取另一侧后覆盖自己，再由 checker 宣称一致。出现差异时，实际 HTTP 行为、依赖、command/service 明确错误路径与行为测试决定修正哪一侧；不从集合多数、旧文档或错误文本猜测。

`AppError`、`validation_error_handler` 与 `error_response` 继续拥有运行时错误语义和信封。新增的 Pydantic `ErrorEnvelope` 只描述 wire schema，供 FastAPI response metadata 使用，不新增业务 error code、exception hierarchy 或第二套权限/状态逻辑。当前 handler 始终输出 `code`、`message`、`details`、`request_id`，因此四者都必须在权威 schema 中 required。

## 2. Checker 分层

### 2.1 纯比较层

新增纯函数（具体符号名可在实现 review 中确定）接收两个已解析 document，返回全部稳定排序 failures。它不 import 全局 app、不读文件，允许 synthetic mutation tests 精确验证失败能力。

### 2.2 I/O 层

`check(contract_path)` 读取 YAML、取得 `deepcopy(app.openapi())` 并调用纯比较层。复制用于防止测试或 normalization 污染 FastAPI 缓存对象。

CLI 明确解析可选 contract path；当前 Makefile 传入路径而 `main()` 忽略 argv 的行为一并收敛。默认路径仍为根 `contracts/openapi.yaml`。

### 2.3 Operation 身份

继续以 `(path, method)` 为唯一比较 key，并保留 `operationId` 相等检查。path-level parameters 按现有规则合并；本 Task 不改变 request parameter 比较语义。

## 3. Response status 规范化

每个 response key 先规范化：

- YAML 解析出的整数 key 与精确三位数字字符串统一为三位十进制字符串；合法范围为 `100`–`599`，带前导零或非三位的字符串显式失败。
- `default` 只接受规范规定的小写拼写。
- wildcard 只接受规范规定的大写 `1XX`、`2XX`、`3XX`、`4XX`、`5XX`；大小写错误属于非法合同，不自动修复。
- 同一 document 若不同原始 key 规范化后碰撞，显式失败。
- 其他 key 显式失败，不被忽略。

比较完整 key set。`422`、`4XX` 与 `default` 不等价；`200` 与 `2XX` 不等价；显式 code 与 range 同时出现时保留两个 key。OpenAPI 3.1 允许 `default` 和五类 wildcard，并规定显式 code 优先，但这种覆盖关系不能抹掉合同精度差异。

多个 2xx 不设特殊捷径：200、201、202、204 都进入同一 response comparator。

## 4. Response object 机器语义

### 4.1 `$ref`

- 支持当前 document 内的 RFC 6901 JSON Pointer，正确解码 `~0` 与 `~1`。
- response-level ref 与 schema-level ref 分别解析；比较展开后的语义，不比较 ref 文本或组件名。
- 坏 pointer、外部 ref 和无法安全处理的循环必须给出精确 failure；递归 schema 使用 visited document-node pair 防止无限展开。
- OpenAPI Reference Object 的 `summary`/`description` sibling 属于 annotation，不影响机器 shape；Schema Object 的其他 sibling 按 JSON Schema 组合语义保留。

### 4.2 Body、media 与 schema 存在性

按以下顺序比较：

1. `content` 缺失或为空 mapping 都规范化为“未声明 body”；非 mapping/null 等非法值显式失败。只有一侧存在至少一个 media type 时才是 body 存在性漂移。
2. 规范化后的完整 media type key set；type/subtype 大小写规范化，但 `application/json`、`application/*`、`application/problem+json`、`*/*` 不互相替代。
3. 每个共同 media 的 `schema` 是否存在；使用 `is None` 判断，合法空 schema `{}` 仍是“存在”。
4. 双方都有 schema 时进入统一 schema comparator。

### 4.3 No-body status

明确数值 status `<200`、204、205、304 不允许 `content`；`1XX` wildcard 同样不允许。双方无 body 时通过；即使双方都错误地声明 body，也必须报告协议错误，不能因相等而通过。`2XX` wildcard、default 和其他范围不能被整体判定为 no-body。

### 4.4 Headers

response header 名按 HTTP 大小写不敏感规则规范化；同一文档出现 `X-Foo`/`x-foo` 等规范化碰撞时显式失败。每个 entry 可为 inline Header Object 或指向本 document `#/components/headers` 的 Reference Object，按与 response ref 相同的 RFC 6901、坏引用、外部引用和循环规则展开后比较，不能比较组件名。

Header Object 必须且只能选择 `schema` 或 `content`；`content` 必须恰有一个 media type。比较 schema/content 以及 `required`、`deprecated`、`style`、`explode` 等适用于 Header Object 的序列化机器字段，并把 OpenAPI 明确规定的默认值 canonicalize；位置不适用或未知的机器字段显式失败。description、example(s) 仍按 annotation 忽略。

authority 范围分三类：

- 全局 middleware 稳定写入的 `X-Request-ID` 与 CSV `Content-Disposition` 进入冻结/runtime parity。
- `Content-Type` 由 response content media map 表达，不作为独立 header entry。
- login/logout 使用多个 `Set-Cookie`，而 OpenAPI Header Object 无法精确表达不可合并的多实例及每个 Cookie 属性；不创建失真的单值 schema。它留在 HTTP 行为 sentinel，checker 若任一文档主动声明 `Set-Cookie` 仍按普通 Header 比较并提示该 authority 限制。

### 4.5 明确不比较的字段

- 忽略：response/schema 的 `description`、`title`、`example(s)`、`$comment` 等纯文档 annotation；Pydantic 自动 title 或中文说明变化不改变 wire shape。
- 保留比较：`default`（现有 checker 已冻结）、`format`、`readOnly`、`writeOnly`、`discriminator`、`deprecated` 及其他会改变 validation、serialization 或 generated client 的机器字段。
- `links` 当前静态/runtime 均为零。本 Task 不实现 link graph 比较；若未来出现，checker 先报 unsupported machine field，不能静默放过。

## 5. Schema normalization 与比较

统一 schema comparator 对展开后的树递归处理：

- object：properties key set、required set、每个 property、additionalProperties、min/maxProperties 等。
- array：items、prefixItems、contains、min/maxItems、uniqueItems 等。
- scalar：type、format、enum/const、数值/长度/pattern 等约束。
- annotation allowlist 先移除；其余未知 key 不静默忽略，无法解释时显式报 unsupported。

语义规范化：

1. `const: X` 与单值 `enum: [X]` 统一；enum/required/type array 按无序集合 canonicalize。
2. OpenAPI 3.1 的 `type: [T, "null"]` 与等价的 `anyOf: [T, {type: "null"}]` 统一为保留 null 分支的 canonical union；nullable 与 non-nullable 必须不同。当前合同不使用 OpenAPI 3.0 的 `nullable` 关键字，若未来出现则按 unsupported/invalid schema 失败，不猜测兼容语义。
3. `anyOf` 与 `oneOf` 分别保留，不互相等价。`anyOf` 分支递归规范化后可去重并稳定排序；`oneOf` 只排序、保留重复分支的 multiplicity，因为重复分支会改变“恰好一个匹配”的有效性。mutation test 必须证明 `[string, string]` 与 `[string]` 不相等。
4. `allOf` 只在所有分支都是可安全合并的 object projection、重复 property 语义一致，且任一分支的 `additionalProperties: false` 不会拒绝其他分支新增属性时展开：properties 合并、required 取并集、`additionalProperties` 按 intersection 语义处理。闭包冲突、property 冲突或非 object constraint 保留经分支排序的 intersection 结构，不得后写覆盖。
5. `additionalProperties` 缺省与 `true` 按 JSON Schema 默认语义等价；`false` 和 schema 继续区分。
6. discriminator mapping、readOnly/writeOnly 和所有未忽略机器字段递归比较。

当前冻结合同有 15 个 `allOf`、105 个 `anyOf`、7 个 `oneOf`；实现不能仅为 ErrorEnvelope 写特例。

## 6. 诊断合同

每条 failure 使用稳定 RFC 6901 pointer，按 operation/status/media/header/property 排序；一次运行聚合全部差异。示例：

```text
/paths/~1api~1v1~1products/post/responses status key 集合漂移: missing_in_runtime=["401","403","409"], missing_in_contract=["422"]
```

```text
/paths/~1api~1v1~1users~1export/get/responses/200/content media type 集合漂移: missing_in_runtime=["text/csv"], missing_in_contract=["application/json"]
```

```text
/paths/~1api~1v1~1auth~1login/post/responses/422/content/application~1json/schema/properties/error required 漂移
```

诊断不得只写“response 不一致”；必须保留 contract/runtime 方向和 ref 解析目标，便于把修复放到权威 owner。

## 7. FastAPI 0.139.0 metadata 同步

锁定版本 FastAPI 0.139.0 的自动 422 条件为：operation 存在 path/query/header/cookie 参数或 body，并且 responses 中没有 422、4XX、default，才生成 `HTTPValidationError`。项目注册自定义 handler 不改变该 metadata。

同步策略：

- 在 `backend/app/schemas/common.py` 定义与实际 wire envelope 一致的 schema model。
- 在 `backend/app/errors.py` 复用该 model 形成纯 metadata helper；helper 只复用 shape，status 仍由 operation 明确列出。
- 401/403/404/409/5xx 按 `research/route-response-authority-audit.md` 的依赖/command/service 证据逐项同步。
- 所有真实 validation-capable operation 显式声明 422 `ErrorEnvelope`，覆盖 FastAPI 自动 `HTTPValidationError`；不得用 4XX/default 只为抑制自动 422。
- CSV operation 使用不会先生成 application/json 的 response class/metadata，并明确 text/csv、string schema 与 Content-Disposition；不改变实际下载行为。
- 只允许真正跨所有 operation 的 middleware metadata 使用集中注入；`X-Request-ID` request/response Header 与非法值 400 的 owner 必须来自 runtime 代码常量，不能读取冻结合同。多实例 `Set-Cookie` 不通过这一注入伪装为单值声明。

## 8. Authority reconciliation

当前差异按以下规则修正：

- 认证/权限依赖、CSRF、path/body validation、显式 not_found/revision/state/provider error 是实际行为证据。
- `testAIModel` 的 provider 错误被捕获后返回 200，故默认修正冻结合同，不改变命令行为。
- `completeFileUpload` 的 storage unavailable 503 是显式可逃逸行为，应补入合同/runtime metadata。
- health nullable、GEO discriminator、generation oneOf/anyOf 必须在静态合同修正 wave 中按实际 Pydantic/HTTP 行为冻结，不由 comparator 忽略。
- `ErrorEnvelope.error.details` 由 `error_response()` 始终写入，必须在静态合同、runtime schema 与 handler sentinel 中同时冻结为 required。
- 全局 X-Request-ID 400 同时涉及 request Header 与跨切面 response；作为单独同步边界写入全部 162 个 operation。所有已声明 response 的 X-Request-ID Header 同样进入 matrix；最终 activation 不得假装双方同时遗漏就是正确。
- login/logout 的两个 `Set-Cookie` 由 Response API 写入且不能安全合并，明确属于 HTTP sentinel 而非 OpenAPI parity；本 Task 不改变 Cookie 名、属性、数量或认证行为。
- 未处理 500 没有稳定业务 code/shape，不统一补默认 ErrorResponse。

## 9. 分阶段交付与回滚

### 9.1 Comparator core

只增加纯 comparator、mutation tests 与调用同一 comparator 的只读 `--response-report` 诊断入口，不接入默认 live `check()`；现有 `make contract-check` 行为保持，父 Task 明确未完成。report 对全量 drift 返回非零并稳定输出，不提供 suppress/filter/allowlist 参数。回滚只需删除新 comparator/test/report 入口，不影响 runtime 或合同。

### 9.2 Authority reconciliation

由主代理维护根 OpenAPI，逐项修正已存在行为并重新生成 client；公共合同变更需要 critical review。authority matrix 同时覆盖 status、ErrorEnvelope required 与稳定 response Header，不只比较两份 OpenAPI。若证据不足，保留为明确 blocker，不猜测状态。

### 9.3 Runtime metadata waves

按 router domain 分三波，每波只同步 metadata 和对应测试，不改 service/权限/状态/事务。每波使用完整 authority matrix 在测试中选取该 wave 拥有的全部 operation，调用同一纯 comparator 并要求该 domain 零漂移；这是阶段验收输入，不进入生产 checker，也不是忽略列表。每波另运行无 filter 的 `--response-report` 保存全量剩余差异，不把输出作为可提交 baseline 或预期值。

### 9.4 Cross-cutting request context metadata

三个 domain wave 后，用独立子任务同步 middleware 拥有的全局 X-Request-ID request/response Header 与 400；runtime owner 从同一代码常量/metadata builder 生成，不读取冻结合同。该子任务同时用 HTTP sentinel 锁定非法 Header 400、每个 response 的 request id 与 login/logout 多实例 Cookie，但不改变 Cookie 行为。

### 9.5 Final activation

所有 authority 与 metadata wave 归零后，`check()` 接入完整 comparator，删除 `successful_response()` 和旧 response shortcut。Makefile/CI 已调用同一 module，预期无需改 workflow；最终用实际命令确认。

中间阶段不长期保留 report-only 完成状态；任何未归零差异都会阻止父 Task 关闭。

## 10. 反方案

- 不采用冻结合同 overlay runtime OpenAPI：它把两个独立来源变为同一来源，checker 失去证据价值。
- 不采用 operation/status allowlist 或 drift snapshot：它把当前遗漏固化成合法状态。
- 不采用统一错误模板覆盖全部 operation：401/403/404/409/5xx 的可达性不同，`testAIModel` 已证明机械模板会产生假声明。
- 不从 service AST 自动推导 OpenAPI：捕获、转换、依赖和异常边界无法由文本搜索可靠决定。
- 不在 comparator 中删除 nullable、忽略组合或只看 JSON truthy schema：这些正是当前假绿来源。

## 11. 外部规范依据

- OpenAPI 3.1.0 Responses Object：`https://spec.openapis.org/oas/v3.1.0.html#responses-object`。
- FastAPI additional responses：`https://fastapi.tiangolo.com/advanced/additional-responses/`。

本设计对 FastAPI 行为的最终证据仍是锁定的 0.139.0 本地源码与最小 app 回归；外部文档只用于解释公开规范。
