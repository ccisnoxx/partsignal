# Research: backend response contract checker 调用链

- Query: 审计 `backend/app/tools/contract_check.py` 的 `main()`、`check()`、`successful_response()`、`compare_response_contracts()` 与 `--response-report`，确认默认 `check()` 行为、完整 comparator 覆盖边界、links fail-closed、annotations 忽略边界、排序/重复输出风险及调用方。
- Scope: internal
- Date: 2026-09-03

## Findings

### 1. 入口与当前 gate 形态

- 根 `Makefile` 的 `contract-check` 在 `Makefile:16-18` 调用
  `python -m app.tools.contract_check contracts/openapi.yaml`，随后运行
  `npm --prefix frontend run api:check`；CI 在 `.github/workflows/ci.yml:57-61`
  复用 `make contract-check`。后端也在 `backend/pyproject.toml:37-39`
  暴露 `partsignal-contract-check = "app.tools.contract_check:main"`。
- `main()` 定义于 `backend/app/tools/contract_check.py:1437-1468`：解析一个可选
  positional `contract_path`（默认 `_default_contract_path()`，即
  `backend/app/tools/contract_check.py:1433-1435` 指向根
  `contracts/openapi.yaml`），以及布尔 `--response-report`
  (`:1439-1442`)。不带该 flag 时直接执行 `check(args.contract_path)`
  (`:1464`)，失败以原始字符串逐行写 stderr 并退出 1 (`:1465-1467`)，成功只打印
  固定的旧 gate 文案 (`:1468`)。
- 因此当前默认 `make contract-check` 并未调用完整 comparator：`check()` 的
  docstring 明确写着默认 gate 不接入 response comparator
  (`:1376-1378`)，父任务实施计划也把该状态定义为 Phase A 的预期行为，见
  `.trellis/tasks/08-31-non-2xx-contract-check/design.md:156-158` 和
  `implement.md:9-25`。最终激活计划要求反向改变这一点，见该父任务
  `design.md:172-176`、`implement.md:179-195`。

### 2. 默认 `check()` 的准确行为与 blind spots

`check(contract_path)` (`backend/app/tools/contract_check.py:1376-1430`) 的实际
顺序如下：

1. 延迟导入 `app` (`:1378`)，用 `yaml.safe_load()` 读取静态合同
   (`:1380`)，调用 `app.openapi()` 取得 runtime document (`:1381`)。这里没有
   `deepcopy`；只有 report 路径复制 runtime document（见第 4 节）。
2. 构建 operation map (`:1383`)，比较合同侧声明的 security schemes
   (`:1384-1394`)，但只遍历合同侧名称；runtime 额外的 scheme 不产生失败。
3. 比较 operation 集合（`(path, method)`）并把差异压成一条字符串
   (`:1395-1398`)，然后对交集逐项检查 operationId、参数、security 与
   requestBody (`:1399-1419`)。
4. response 只执行旧的首个 2xx schema 比较：先取得
   `successful_response(left_op/right_op)` (`:1420`)，解析其中
   `application/json` schema (`:1421-1426`)，仅当两侧 schema 都为 truthy 时调用
   legacy `compare_shape()` (`:1427-1429`)。没有 response comparator 调用。

这意味着默认 gate 当前不会发现：

- 非 2xx status 的缺失、额外或 shape 漂移；多个 2xx 中除遍历遇到的第一个外的
  任何响应漂移；显式 status、wildcard、`default` 的 key 差异。
- response-level `$ref`/description、body 是否存在、完整 media type 集合、空
  schema `{}` 与缺失 schema 的差异、response headers、encoding 和 204/205/304
  等 no-body 违规。
- legacy `json_schema()` 只取精确 `application/json`
  (`:143-146`)，所以 CSV/其它 media 的 body schema 不进入默认比较。
- `compare_shape()` 的旧归一化仍把 nullable type list 改成非 null 类型
  (`:108-117`)、`allOf` 只合并 properties/required 且后写覆盖同名 property
  (`:122-131`)，并只检查有限约束集合 (`:165-196`)；它不是完整 response
  comparator 的语义。

默认路径还没有统一异常处理：`check()` 的 YAML/文件/AppError 之外的异常会向上
   传播；相比之下 report 路径只捕获 `OSError`、`yaml.YAMLError` 和
   `_ComparatorError`（`backend/app/tools/contract_check.py:1446-1452`）。

### 3. `successful_response()` 与唯一生产调用方

- `successful_response(operation)` 定义在
  `backend/app/tools/contract_check.py:149-154`。它按 `operation["responses"]`
  的原始 mapping 遍历顺序，遇到 `str(code).startswith("2")` 的第一项即返回；不
  排序、不校验 status key、不检查返回对象类型，找不到则返回 `None`。
  “第一个”因此是文档插入顺序，而非数值最小或某个规范优先级；任何 malformed
  key 只要字符串以 `2` 开头也可能被当成成功响应。
- 全仓库生产代码的唯一调用点是
  `backend/app/tools/contract_check.py:1420`，位于默认 `check()` 的 response
  shortcut 中。`rg` 未发现其它 `successful_response(` 调用；测试文件只通过
  `check`/`main` 间接覆盖默认分支，没有第二个 runtime owner。
- 父任务最终 Phase F 明确要求在完整 comparator 接入 `check()` 时删除该函数和
  首个 2xx shortcut（`.trellis/tasks/08-31-non-2xx-contract-check/implement.md:190-191`）。

### 4. `compare_response_contracts()` 和 `--response-report` 调用链

- `compare_response_contracts(contract_document, runtime_document)` 位于
  `backend/app/tools/contract_check.py:1363-1373`。它只接受两个已解析 mapping，
  校验顶层 `paths` 是 mapping，然后实例化 `_ResponseComparator` 执行 `.run()`；
  不读文件、不导入 app、不写入输入（`:1366-1373`）。它只比较 response
  文档，不接管默认 check 的 request/security/operationId 检查。
- `run()` 以 `operation_map()` 产生的 `(path, method)` 为身份，先报告 operation
  一侧缺失，再对交集逐项取得两侧完整 status map (`:1311-1333`)，分别报告
  `missing_status`/`extra_status`，并对所有共有 status 调用 `_response()`
  (`:1334-1356`)。`statuses()` 将整数或精确三位数字字符串归一为字符串，允许
  `default` 和大写 `1XX`–`5XX`，拒绝其它 key，并报告规范化碰撞
  (`:362-409`)。因此完整 comparator 不再只看 2xx，且 200/201/204、422、range
  与 default 均保持独立 key。
- operation 覆盖边界来自模块常量 `HTTP_METHODS = {"get", "post", "put", "patch", "delete"}`
  (`:15`) 和 `operation_map()` (`:216-226`)；`head`、`options`、`trace` 等不在
  该 checker 的任何一侧 operation map 中，属于明确的覆盖边界。
- 共有 status 的 `_response()` (`:1139-1290`) 进行以下机器比较：
  - response ref 的 local RFC 6901 解引用、外部 ref/坏引用/循环拒绝
    (`:1143-1151`；`_resolve_local()` 位于 `:75-105`)；Response Object 字段
    校验与 links 检查 (`:1152-1165`)。
  - `content` 的 mapping、media key 小写归一化/碰撞、完整 media 集合和 schema
    存在性 (`:1027-1046`, `:1167-1189`, `:1224-1248`)；合法空 schema `{}`
    通过 key 存在性判断，不会被当成缺失。
  - 对明确 no-body status（所有 `1xx`、204、205、304）拒绝任一侧非空 content
    (`:1214-1223`)；双方均无 body 则继续比较其它 response 语义。
  - header 名大小写不敏感归一化、碰撞检测、Header ref、schema/content 互斥、
    单一 media 和序列化字段 (`:1048-1063`, `:1075-1137`, `:1257-1289`)。
  - schema 的 `$ref`/递归图、type/enum/const/default、nullability、数组/对象
    约束、properties/required、`allOf`/`anyOf`/`oneOf` 等机器结构
    (`:599-795`, `:797-944`)；`anyOf` 分支去重而 `oneOf` 保留重复分支
    (`:750-795`)。
- 该 comparator 仍不比较 request 参数、requestBody、security、operationId 或
  security scheme；这些只能由 `check()` 的 legacy 部分覆盖
  (`:1383-1419`)。此外，`Response Object` 的 `description` 必须存在且为 string，
  但内容不参与 parity（见第 6 节）。

`main()` 的 report 分支 (`backend/app/tools/contract_check.py:1443-1463`)：

1. 读取用户提供的 path、取得 `deepcopy(app.openapi())`，调用同一
   `compare_response_contracts()` (`:1444-1449`)；因此 report 与纯 comparator
   的确是同一实现，不会调用 `check()`。
2. 文件/YAML/顶层/引用/comparator 解释失败打印
   `response-report error: ...` 到 stderr，退出 2 (`:1450-1452`)。
3. 普通 drift 逐条将 failure JSON（`ensure_ascii=False`、排序 key、紧凑 separators）
   写 stderr (`:1453-1457`)；只要有 `unsupported` 或任一
   `invalid_in_*` 方向就退出 2，否则有 drift 退出 1，无 drift 退出 0
   (`:1458-1463`)。没有 filter、allowlist、baseline 或 suppress 参数。

### 5. links 的 fail-closed 证据

- `_validate_response()` 将 `links` 列入允许的 Response Object keys，以便识别而不
  把它当未知字段 (`backend/app/tools/contract_check.py:1065-1073`)；但 `_response()`
  只要任一侧出现 `links` 就无条件 `self.add("unsupported", ...)`
  (`:1164-1165`)。即使两侧 links 完全相同，也会产生 `unsupported` failure；
  没有尝试比较 link graph 或静默跳过。
- report 的 exit-code 逻辑把 `kind == "unsupported"` 映射为 2
  (`:1458-1462`)，因此未来新增 links 会 fail-closed，不能让“双方同样声明 links”
  伪装为通过。父任务的预期与该实现一致：`.trellis/tasks/08-31-non-2xx-contract-check/design.md:84-88`
  和 `prd.md:29,74` 要求 links unsupported 而非忽略。
- 现有 mutation 测试直接锁定相同 links 也失败：
  `backend/tests/unit/test_contract_check.py:314-363`，尤其 `:360-363`。

### 6. annotations 忽略边界与仍然比较的字段

- schema annotation allowlist 是 `_ResponseComparator._ANNOTATIONS =
  {"title", "description", "example", "examples", "$comment"}`
  (`backend/app/tools/contract_check.py:277-292`)；`_schema_form()` 在规范化前剔除
  这些 keys (`:633-638`)，所以 schema 的文案、标题、示例、注释变化不产生
  `schema_drift`。
- Response Object 的 `description` 被 `_validate_response()` 要求为 string
  (`:1065-1073`)，但 `_response()` 没有比较两侧 description 值；response ref 的
  `summary`/`description` sibling 由 `_resolve_local()` 允许
  (`:84-105`)，不污染目标 machine object。两侧只改 prose 的测试通过，见
  `backend/tests/unit/test_contract_check.py:47-51`。
- Header ref 的 `summary`/`description` 也可作为 annotation sibling；Header
  machine form 过滤 `_ANNOTATIONS` (`:1075-1083`)。Header content 中
  `example`、`examples`、`encoding` 属于允许字段，但比较路径只把 schema 和
  `encoding` 放入 form；example(s) 不参与比较（`:1101-1129`）。普通 response
  media object 同样只检查 schema、encoding 及未知 machine keys；`example(s)` 被
  排除且不比较 (`:1228-1249`)。
- 忽略 annotation 不等于忽略未知机器字段：schema 未知 key 会触发 unsupported
  (`:633-637`)，Response Object 未知 key 触发 unsupported (`:1066-1071`)，Header
  未知 key 触发 unsupported (`:1082-1093`)，media object 未知 key 触发
  unsupported (`:1228-1238`)。
- 保留比较的 schema machine fields 包括 `default`、`format`、read/write flags、
  discriminator、deprecated、数值/长度/数组/对象约束及组合等，具体 key 白名单见
  `:280-327`，规范化和递归比较见 `:647-795`。父任务也明确要求 annotation-only
  差异不制造噪声、而机器字段不得静默丢弃（`design.md:84-108`）。

### 7. 排序、聚合与重复输出风险

- `self.add()` 每次直接 append 一条 failure，未做去重
  (`backend/app/tools/contract_check.py:334-360`)。`run()` 末尾只按
  `(pointer, kind, direction, message)` 排序 (`:1357-1360`)，不按 failure payload
  去重；同一 pointer/kind/direction/message 的重复项会原样保留。
- `_response()` 对 contract/runtime 两侧分别解析和校验
  (`:1143-1163`)，随后仍继续检查 links、content、headers
  (`:1164-1212`)。所以单个坏 response 可能同时输出多条 unsupported/invalid
  failure；两侧都有同样坏形状时会得到两条不同 direction 记录，而坏 content/header
  还可能叠加后续 media/header 差异。该行为是 fail-closed，但 report 不是“一条
  root-cause 一条输出”。
- `statuses()` 在规范化碰撞时 append 一条 `status_collision` 后仍保留首项
  (`:399-409`)；两侧各自碰撞时会产生两条 side-specific failure。类似地，mapping
  key 差异是每个 key 各 append 一条（`:1291-1309`），不是一个聚合 set failure。
- `--response-report` 对 `report_failures` 逐条打印，没有去重或二次聚合
  (`:1453-1457`)。排序只由 comparator 的四字段 key 保证；该 key 不包含
  `contract`/`runtime` payload，因此 key 相同的项目保留构造顺序。大部分 operation、
  status、media、header 遍历已显式排序，但 equal-key duplicate 仍有稳定性/可读性
  风险。
- 默认 `check()` 没有最后排序：它直接返回 `legacy_failures`
  (`:1430`)，`main()` 按产生顺序打印 (`:1465-1466`)。其中
  `compare_shape()` 的 constraint 集合是 set (`:177-196`)，
  `compare_parameters()` 也遍历 set constraint keys (`:257-274`)，因此多个
  legacy failure 的文本顺序可能受 set iteration 影响；这与新 comparator 的
  pointer sort 是两套输出语义。

### 8. 相关规范/父任务证据与边界结论

- 父任务要求完整 status、body/media/schema/header、ref/composition/nullable
  parity、稳定 RFC 6901 diagnostics、annotation 忽略和 links unsupported，见
  `.trellis/tasks/08-31-non-2xx-contract-check/prd.md:24-34,63-79`；checker 当前
  的 `compare_response_contracts()` 已覆盖这些 response 维度的 Phase A 报告路径，
  但默认 `check()` 尚未接入，正是本任务 Phase F 的唯一切换点。
- 父任务设计的 checker 分层要求 pure comparator 接收两个 document，I/O 层的
  `check()` 读取合同、复制 `app.openapi()` 后调用 pure comparator，见
  `.trellis/tasks/08-31-non-2xx-contract-check/design.md:20-34`。当前实际实现与
  其中的 I/O 目标仍有一个可见差异：report 做 `deepcopy` (`:1448`)，默认
  `check()` 未复制 (`:1380-1381`) 且尚未调用 comparator。
- 父设计列出的公开规范参考是 OpenAPI 3.1 Responses Object 与 FastAPI additional
  responses：`.trellis/tasks/08-31-non-2xx-contract-check/design.md:186-191`；本审计
  未增加外部版本判断。项目依赖约束为 FastAPI `>=0.115,<1`
  (`backend/pyproject.toml:6-24`)，父任务另以本地 FastAPI 0.139.0 行为作为同步依据
  (`design.md:128-139`)。

## Caveats / Not Found

- 按 Trellis researcher 的角色隔离要求，本次未读取父任务的 `implement.jsonl` /
  `check.jsonl`，也未读取或修改任何其它任务的 JSONL；它们是实现/检查代理的 context
  manifest，不属于本研究可加载的材料。父任务的 `prd.md`、`design.md`、`implement.md`
  已读取并按上述行号引用。
- 未运行 `make contract-check`、pytest 或其它会产生缓存/构建副作用的验证命令；本
  文件结论基于完整 checker 源码、现有单元测试静态证据、Makefile/CI 调用点和父任务
  规划材料。未发现 `successful_response()` 的其它生产调用方，也未发现 response
  comparator 被默认 `check()` 间接调用的路径。
- `operation_map()` 仅纳入五种 HTTP method 是当前 checker 的明确边界；本研究没有
  断言项目路由是否实际存在 `head`/`options`/`trace` operation。
