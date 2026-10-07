# GEO-803 实施与本地验收证据

## 交付状态与依赖

GEO-803 / R7，分支 `geo/GEO-803`。开始前核对 GEO-801、GEO-402 的 manifest 均为 done，及各自人工接受记录；本任务由 planned → in_progress → review，等待人工接受，未标 done。没有提交、推送、PR、生产启用或真实平台调用。

必读文档、当前合同差异与编码前十二项 preflight 已完成，Task Brief 为 [prd.md](prd.md)。只实现 WBS 的本地模拟站与 Browser Adapter 合同；当前生产 Browser Collector 骨架、会话边界和既有 API Collector 保持原样。

## 实现和责任边界

- `tests/browser-fixture`：标准库 HTTP listener，随机回环端口，按 UUID 配置17种场景。真实可交互 DOM 覆盖流式增量、350ms长暂停、提前完成标志、晚到引用、无引用/未知元数据、临时聊天、登录/过期、提交前后 selector 漂移、挑战、空答案/超时、敏感 UI。人工指定原文及三个原始引用位置，重复 URL 保留，不调用真实 AI。
- 测试专用参考 Adapter 只在 `browser-collector/tests/support`，不进入 src、生产镜像或 Registry。DOM 完成、loading 消失、正文/引用/元数据持续稳定联合判定；发送/接收等待限时，套件另有120秒外层总超时。没有固定 sleep 等待回答、模糊 selector 回退或失败伪成功。
- 可复用工厂合同检查现有结果/失败字段、原问题、真实 POST 数、授权回调、页面/Context 释放、会话隔离、未知元数据 null 和敏感值边界。故意部分答案、漏引用、重发、吞错和泄漏驱动必须被拒绝；不是仅给参考实现添加成功断言。
- Python 入口导入既有 `CollectedAnswer` / `CollectorFailure` 及 canary 扫描器，18份结果逐项经后端 Pydantic 权威类型校验，无第二套公开 schema。结果只在本轮临时 JSONL 中存在，打印日志前扫描全部临时产物及 stdout/stderr，退出删除临时目录。
- CI 增加独立包 npm ci；`make e2e` 先执行合同。固定既有 Playwright 1.61.1 官方 Linux runtime，非 root、Chromium sandbox、只读根、cap_drop ALL、既有 seccomp 与 network none。只挂 Browser 包、fixture、本轮输出，不挂整个仓库、.env、业务数据库/Redis、密钥或真实 Cookie。CI 依赖下载与业务测试访问分开，合同运行仅回环。

## 修改清单

本任务增量由初始 SHA256 清单逐文件核对；开始时已有大量前序未提交工作，不以 HEAD diff 冒充本任务独立 diff。

| 文件 | 本任务变更 |
|---|---|
| tests/browser-fixture/server.mjs | 本地模拟站、UUID/实例隔离、真实计数及低敏感哈希观测 |
| tests/browser-fixture/index.html | 虚构 AI 页面与敏感区/登录/挑战 DOM |
| tests/browser-fixture/fixture.js | 场景、流式/引用延迟、selector/登录/挑战/敏感UI |
| tests/browser-fixture/README.md | 私有测试协议、工厂接入、错误语义、网络与生命周期说明 |
| browser-collector/tests/support/reference-adapter.mjs | 测试专用参考 Adapter |
| browser-collector/tests/support/adapter-contract.mjs | 可复用工厂合同与安全断言 |
| browser-collector/tests/contracts/local-adapter.test.mjs | 27项合同/反例/隔离与网络检查 |
| deploy/scripts/test-geo-browser-contract.py | 本地/无网络容器执行、权威类型与敏感扫描、精确清理 |
| Makefile | 专用 target、e2e 前置接线 |
| .github/workflows/ci.yml | 独立包安装与 Linux 隔离选项；原前端 cache/shard 保留 |
| .trellis/spec/infra/ci-execution.md | 同步独立Browser依赖安装与本地隔离合同；事件/前端规范不变 |
| browser-collector/package.json | 新增维护源码语法检查；依赖/lock不变 |
| browser-collector/README.md | 合同入口及范围说明 |
| docs/geo-monitoring/README.md | GEO-803 已交付能力与证据入口 |
| docs/geo-monitoring/03-technical/07-testing-and-quality.md | 本地合同落地与覆盖边界 |
| docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md | 本地 Browser 部分需求追踪 |
| docs/geo-monitoring/04-delivery/task-manifest.yaml | 只更新803的执行、review及证据 |
| docs/geo-monitoring/CHANGELOG.md | 803 review记录 |
| docs/geo-monitoring/SHA256SUMS | 仅同步本任务改动的5份文档 |
| .trellis/tasks/10-05-geo-803-browser-contract/prd.md、task.json、implement.md、evidence/ | Task Brief、状态和完整验证证据 |

## 合同、迁移和业务不变量

OpenAPI、数据库合同、generated类型、Alembic源码及业务 backend/frontend 与初始 SHA256 相同。本任务无新 revision、DDL、历史回填或业务库前滚。现有 head 为 `0063_geo_browser_sessions`；根 E2E 在4个独立临时 PostgreSQL 库从既有迁移前滚至0063，全部清理成功，不能称为本任务数据迁移或生产升级。

PG业务唯一来源、Redis稳定ID、Router/Service事务所有权、锁序/revision/lease/不可变历史/指标状态机均不改变。fixture的内存计数只用于测试观测，不拥有业务状态；重复 POST 如实计数，不去重。模拟请求只含原问题，不附带监测对象/事实/分析信息。

`before_send` 必须在真实 POST 前且仅一次；拒绝原样传播并零发送。发送后的超时映射 `COLLECTOR_UNKNOWN_OUTCOME / RECEIVE / UNKNOWN`，挑战/登录失效保守 UNKNOWN 且停止；提交前登录/selector/挑战为 NOT_STARTED；空答案/结果 selector 歧义为 PARSE / COMPLETED。COMPLETED 是模拟站完成输出，不是业务 Run 成功。不猜HTTP状态、Retry-After、费用或用量，不自动重试。

## 安全、敏感资料和并发生命周期

每 case 新 UUID + 独立 Context；已登录仅导入内存虚构 Cookie，匿名不继承；敏感 UI 有真实可见的虚构账号/支付/Cookie canary和localStorage。Adapter仅提取回答区域，不输出全页DOM、截图、trace、视频或storage_state，不接生产证据存储。错误断言不展开实际值；日志/产物在输出前做原文、URL、JSON/base64形式敏感扫描。

HTTP精确fixture origin白名单、WS主动关闭、service worker停用、CSP和CI OS network none共同限制访问；引用仅保存.invalid文本不导航。正常路径 finally 关闭page/context/browser/server；外层超时先TERM再限时KILL本轮进程组，容器按本轮随机owner标签查出精确ID清理，失败非零。最终检查无残留owner容器或geo803临时目录。多实例相同UUID互不影响，重复真实POST计数可被合同拒绝。

没有产品前端路由、query key、URL、页面状态或生成类型变化；fixture 是独立虚构应用。没有为测试放宽权限、CSRF、SSRF、TLS、凭据、审计或生产 STOP。

## 实际验证

| 实际命令 | 结果及证据 |
|---|---|
| `npm --prefix browser-collector test && npm --prefix browser-collector run typecheck`（编码前） | exit0，13 Node测试/checkJs；baseline.md |
| `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_browser_boundary.py backend/tests/unit/test_geo_collector_contract.py backend/tests/unit/test_geo_collector_suite.py -q`（编码前） | exit0，113通过；baseline.md |
| `make test-geo-browser-contract`（首次） | exit2，26通过/1失败；被中止外部导航的错误页尚在提交，后续本地导航竞争；contract-initial.log。改为关闭被拒绝页面并新建本地页面，保持网络拒绝不变 |
| `make test-geo-browser-contract`（最终） | exit0，27通过/0跳过；18份权威值对象通过，secret_scan=0；contract-host-final.log |
| `make test-geo-browser-contract GEO_BROWSER_CONTRACT_CONTAINER=1`（最终） | exit0，27通过/0跳过；Linux非root真实Chromium sandbox/network none、18份权威类型通过；contract-container-final.log。首次容器通过后收紧挂载及清理，最终重跑通过 |
| `make contract-check` | exit0，运行时OpenAPI完整一致、generated一致；contract-check.log |
| `make lint` | exit0，Browser所有新源码语法、backend Ruff、frontend ESLint；lint.log |
| `UV_CACHE_DIR=.cache/uv uv run --project backend ruff check deploy/scripts/test-geo-browser-contract.py` | exit0，最终Python入口通过 |
| `make typecheck` | exit0，既有Browser checkJs、backend mypy239源文件、frontend tsc；typecheck.log。新测试JS是语法+执行验证，未声称纳入现有src-only checkJs |
| `make test-unit` | exit0，13 Browser / 3726 backend / 1285 frontend通过；test-unit.log |
| `make e2e`（DATABASE_URL指本地55432开发库，REDIS_URL指本地56379/14） | exit0；前置本地27项通过；隔离真实栈32通过；GEO enabled/api-disabled/monitoring-disabled各1通过/1按mode跳过；前端产物498通过/74按现有项目配置跳过；secret_scan=0，临时库/Redis键/端口/存储清理成功；e2e.log |
| CI YAML静态解析与逐项断言 | exit0，唯一手动触发、frontend缓存/安装、两路分片、Redis step14/job15和其余工作流正文均保持；ci-static-check.json |
| `git diff --check` 及新增未跟踪文件空白检查 | 最终结果见evidence/final-checks.json，未将未执行检查记为通过 |

成功结果复用：最终入口收紧后单独重跑本机/Linux合同；其余业务代码/合同/依赖未变，不重复完整E2E。全量unit/lint/typecheck遵循GEO任务执行文档，完整E2E为用户指定最低门禁；未追加不相关回归或性能矩阵。

## 未运行范围、限制与收敛

未调用真实AI平台、受控staging或生产；未触发远程CI。Linux本地隔离运行验证CI合同执行方式，但不声称远程工作流已成功。未单独运行make build（E2E已经tsc+Vite production build），未另跑全量集成/性能/独立完整verify：无业务/持久化变更，现有合同、基线边界、全量unit与用户要求的E2E已有相称证据。E2E跳过节点是既有项目/模式选择，按实数报告，不算通过。

参考Adapter只是工厂合同的本地检验对象，不是GEO-804生产跨语言接口，不证明真实平台健康、实际登录/人工授权、生产发送隔离或持久化幂等。敏感UI验证提取边界；生产截图裁剪、证据捕获/存储仍为805。外层超时/取消的异常路径作源码审查，未故意耗尽120秒进行故障注入。

自审全部本任务源码、接线及状态差异，结合初始文件哈希证明其他工作未覆盖。此测试基础设施没有实质更改公开业务/持久化/权限边界，不触发该类独立复核门禁；未委派，不声称独立审查。所有新维护源码低于500行。

文档包 `01-product/02-geo-core-prd.md` 的旧SHA条目在开始前已失配，正文哈希未变，本任务保留该历史问题；本任务变动5份文档的SHA已同步并逐项验证。详情见checksum证据，不扩大为PRD修改。

后续仅记录：804依赖802/803，需要合规批准后的首个真实界面Adapter、生产边界接线及受控staging smoke；805负责生产敏感证据；806/807负责管理与试点。本任务未实施这些能力。

## 人工验收完成 — 2026-10-05

本会话用户明确表示：“我已经人工审查并接受 GEO-803 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-05。既有review阶段实现、测试结果、首次失败与覆盖限制保留为验收前历史，不改写已有验证结论，不重复运行功能测试。

本次只收尾GEO-803，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS只同步manifest条目。验收前状态保存于evidence/acceptance-before.json；收尾git diff --check精确命令与结果保存于evidence/acceptance-diff-check.json/log。
