# 完整 Response Comparator 核心设计

## 1. 边界

Phase A 只建立可复用的 response 比较能力：

```text
parsed contract document ─┐
                          ├─ compare_response_contracts() ── stable failures
parsed runtime document ──┘

contract path + app.openapi() ── --response-report ── same comparator

existing check() ── existing request/security/first-2xx path（Phase A 保持）
```

纯 comparator 不依赖 FastAPI app 和文件系统。`--response-report` 只负责加载冻结文档、取得 `deepcopy(app.openapi())` 并转交纯层；它不能过滤 operation 或把非零漂移转换成成功。默认 `check()` 直到父规划 Phase F 才切换。

## 2. Operation 与 status

沿用 `(path, method)` operation identity 和现有 operation map，不改变 path-level parameter merge、request body 或 security 语义。response comparator 对共享 operation 的完整 response key set 执行：

- YAML integer 与精确三位数字字符串规范化为 `100`–`599` 字符串。
- `default` 只接受小写，range 只接受大写 `1XX`–`5XX`。
- 显式 status、range、default 分别保留；同 document 规范化碰撞失败。
- 对双方共有的每个 key 递归比较，所有 2xx 与非 2xx 同路。

## 3. Resolver 与图安全

response、schema、header 三类 local ref 分别在各自 document 中解析，支持 RFC 6901 `~0`/`~1`。resolver 返回展开语义并保留使用位置/目标位置供诊断；不比较 ref 名称。

外部 ref、坏 pointer 与不支持的 Reference Object sibling 显式失败。递归 schema 以双方 document-node pair 的 visited 状态比较；相同 pair 再入视为已经比较，不删除真实递归结构，也不污染输入 document。

## 4. Response 与 Header Object

response 比较顺序：

1. 解析 response ref。
2. 规范化 content：缺失或空 mapping 都是 no body，非法非 mapping/null 失败。
3. 比较完整 media key set；media type 规范大小写但不把 wildcard 与具体类型判等。
4. 比较每个 media 的 schema 存在性；`{}` 是存在且接受任意实例的 schema。
5. 比较完整 response header 集合和 Header Object。

数值 `<200`、204、205、304 与 `1XX` wildcard 禁止 content。协议非法性独立于双方相等性，因此双方都声明 body 仍失败。

Header name lower-case canonicalize，碰撞失败。Header entry 支持 inline 或 local component ref；必须恰选 schema/content，content 恰有一个 media。比较适用的 required/deprecated/style/explode 及其规范默认值；description/example(s) 不参与。

## 5. Schema canonical form

schema comparator 递归保留：

- object properties、required、additionalProperties、object constraints；
- array items/prefixItems/contains 与 array constraints；
- scalar type、format、enum/const、pattern、数值/长度约束；
- default、readOnly/writeOnly、discriminator、deprecated 等已冻结机器字段。

规范化规则：

- `const: X` 与单值 enum 等价；enum/required/type array 无序。
- `type: [T, "null"]` 与等价 OpenAPI 3.1 null union 保留 nullability；旧式 `nullable` fail closed。
- `anyOf` 分支排序并可去重；`oneOf` 分支排序但保留 multiplicity。
- `allOf` 仅在 object projection、property 语义和 additionalProperties 闭包均可安全合并时展开；否则保留排序后的 intersection。
- `additionalProperties` 缺省与 true 等价；false/schema 分别保留。
- 已知 annotation allowlist 移除；其余未知机器 key 和 links 报 unsupported。

## 6. Diagnostics 与 CLI

failure 以 RFC 6901 Pointer 定位到 operation/status/media/header/schema path，附 contract/runtime 方向，并按 pointer、failure kind、双方值稳定排序。一次调用返回全部 failures。

CLI 支持：

```text
python -m app.tools.contract_check [contract-path]
python -m app.tools.contract_check --response-report [contract-path]
```

第一种保持现有默认 gate；第二种只调用新 comparator 并在 drift 时退出 1。参数错误或 schema/ref unsupported 使用与普通合同失败不同的稳定非零退出，不输出 traceback 作为预期诊断合同。

## 7. 测试策略与回滚

`backend/tests/unit/test_contract_check.py` 使用最小 synthetic documents 逐类 mutation，不复制 production canonicalizer。另建最小 FastAPI app 验证锁定版本的自动 422 行为；不得连接数据库、Redis 或 provider。

Phase A 回滚只涉及 checker 新能力和聚焦测试。因为默认 `check()` 未切换，回滚不影响合同、runtime OpenAPI 或 CI 现有行为。
