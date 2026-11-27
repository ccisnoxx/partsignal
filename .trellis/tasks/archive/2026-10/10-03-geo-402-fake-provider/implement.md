# GEO-402 实施与验证证据

日期 2026-10-03；分支 geo/GEO-402；交付 review，等待人工接受。Task Brief：[prd.md](prd.md)。未提交、推送、部署或归档，未启动其他 GEO 任务。

## 执行资格、基线与范围

开始时 manifest GEO-402=planned，依赖 GEO-401/GEO-005 均 done，Trellis completed 与人工接受记录相符。按 WBS 完整任务行实施 R3 的 fake provider 和 Collector 合同套件；不存在用户指定的 blocked 条件。创建 Task Brief、输出 12 项 preflight 后进入 in_progress，最终 review，不自行 done。

已读取根与后端 AGENTS、Trellis workflow、相关 spec、依赖任务与用户列出的目标文档；大型 PRD/业务/数据/API 文档按目录结构及本任务完整相关章节读取。当前代码权威为 GEO-401 不可变协议/值/稳定错误、GEO-204 Registry、GEO-005 语料、既有 pinned HTTP。OpenAPI Run/Profile/Answer 组件、数据库 corresponding 章节和 0048/0050/0051 迁移保持原样。相关基线 166 passed，见 [baseline.log](evidence/baseline.log)。

技术文档将调度扫描误归 GEO-402；WBS/manifest 一致限定 fake provider 与合同套件，修正文档说明而不实现扫描。不复用保存请求全文且承载内容草稿协议的 ai_fake_server，不扩大到 GEO-403/404 或 Browser。

## 实现及文件归属

| 文件 | 本任务变化 |
|---|---|
| backend/app/geo_fake_server.py | 独立回环 TCP 服务、闭合场景/控制端点、真实故障、计数/hash、线程与连接生命周期 |
| backend/tests/geo_collector_contract.py | 可复用成功/失败矩阵、单次发送/回调/请求哈希断言与安全诊断、canary scan |
| backend/tests/geo_reference_collector.py | 仅供套件自测的本地驱动，不是生产 adapter；受控字段构造结果 |
| backend/tests/geo_network_guard.py | 只对新合同测试启用，禁止非回环 DNS/TCP |
| backend/tests/unit/test_geo_fake_provider.py | 真实协议/故障、统计/并发/实例隔离、控制端点与泄漏反例 |
| backend/tests/unit/test_geo_collector_suite.py | 正常驱动及故意重试/redirect/异常泄漏、scan fail-closed 自测 |
| backend/tests/fixtures/geo_provider/README.md | 测试协议、模式/字段、复用方式、敏感及未来验收边界 |
| deploy/scripts/test-geo-collector-contract.py | 本地 CI 入口；先扫描整轮输出/临时产物再输出，支持额外证据目录 |
| Makefile | test-geo-collector-contract target，test-deploy-scripts 增加新套件，保留前序 recipes |
| docs/geo-monitoring/README.md | 新能力、使用说明与任务证据导航 |
| docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md | 本任务现状/复用边界及调度任务编号纠正 |
| docs/geo-monitoring/03-technical/07-testing-and-quality.md | 本地 TCP/套件/secret scan 的实测与未覆盖边界 |
| docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md | REQ-GEO-EVIDENCE-005 本地实测及业务 API/audit 未覆盖说明 |
| docs/geo-monitoring/04-delivery/task-manifest.yaml | 仅 GEO-402 planned → in_progress → review 与证据引用 |
| docs/geo-monitoring/SHA256SUMS | 仅本任务修改的 GEO 文档对应哈希 |
| .trellis/tasks/10-03-geo-402-fake-provider/ | Brief、状态、命令/失败诊断/最终审计与恢复证据 |

## 合同、迁移与不变量

无公共 OpenAPI、数据库合同、ORM、Alembic revision 或 generated 类型改动。源码 head 仍是 0051_geo_manual_collection，没有执行数据库前滚、回填或生产迁移；不存在需回滚的数据变更。fake 独立控制协议不属于 /api/v1/geo，不接入 app.main、Registry、Compose 或业务开关。

Router/Application Service 事务、业务行锁顺序、revision、状态机、幂等、权限、CSRF、SSRF、TLS、文件资格、不可变及审计均不改变。PostgreSQL 仍为业务权威，Redis 消息不增加内容。替身内存只是测试观测，不能用作 Run 状态或发送许可。

计数由实例 owner 持互斥锁追加，随后释放锁进行 I/O；同 UUID 重复发送 count 如实累加，并发 12 个真实请求全部保留。返回统计副本，外部修改不能改变计数。每个新的 attempt UUID 独立，拒绝授权/配置时零请求。统计只保留 UUID/count/正文 SHA256/字节数及实例 redirect trap 计数，不保存 Header 或问题全文。套件检测真实重发、跟随重定向与敏感异常的故意违规驱动，不能依赖 fake 去重。

正常结果保留完整原文、实际引用位置 1/3 和重复 URL；搜索三态、usage/cost unknown 和 partial token 保留不猜测。429 完整响应的 Retry-After 仅为新 attempt 元数据；超时/断连明确 UNKNOWN，大小超限保持 SENT，完整无效结果为 COMPLETED/PARSE；这些状态不等于业务提交成功。错误沿用既有闭合 CollectorError，不增加 HTTP 或业务错误映射。

## 安全、生命周期和前端

服务只绑定 127.0.0.1，场景无自定义 URL/任意 Header/代码执行入口；测试守卫阻止非回环 DNS/TCP。真实 TCP 模式区别于 ASGI Mock，限额同时覆盖 Content-Length 和 chunked。连接有超时，delay 可在停止时唤醒，服务关闭 join 请求线程；实际 CLI 启动/health/SIGINT 验证通过。

测试只使用 GEO-005 虚构语料及内存生成的 API/Header/Cookie canary，确认这些值真实经过成功和错误响应后，再证明结果、统计、固定错误、日志和 JSON 产物中不存在值。敏感 raw/debug/Header 不保留，不存响应正文；access/error/非法 method 诊断不回显输入。scan 检查原值和 URL/JSON/Base64 形式，扫描失败非零且在输出前抑制日志；另有故意污染文件的 fail-closed 自测。扫描是本任务 canary 与已知值检查，不宣称通用 DLP 或生产审计集成。

所有本任务 evidence 和日志执行最终扫描，见 evidence/secret-scan.log。未泄露真实 secret，未改变网络或凭据安全默认值。无前端路由、query key、URL、页面状态、组件或用户流程改动。

## 实际验证

| 命令 | 结果/证据 |
|---|---|
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_collector_contract.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_fixtures.py backend/tests/unit/test_pinned_http.py | 基线 exit 0，166 passed；baseline.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend python deploy/scripts/test-geo-collector-contract.py --scan-root .trellis/tasks/10-03-geo-402-fake-provider/evidence | exit 0，57 passed；tests=0 secret_scan=0 external_network=blocked；contract-final.log |
| git diff --check | exit 0；diff-check.log；另检查全部本任务新增源码/文档，不改真实 index |
| make lint | exit 0；后端 Ruff 与前端 ESLint；lint.log |
| make typecheck | exit 0；mypy 146 source files 与前端 tsc；typecheck.log |
| make test-unit | exit 0；后端 2852 passed，前端 119 files / 1121 passed；test-unit.log |
| make test-deploy-scripts | exit 2；前置 build-frontend 因缺少 /var/run/docker.sock 失败，后续 recipes 未运行；test-deploy-scripts.log |
| make contract-check | exit 0；runtime 合同与 generated OpenAPI 类型一致；contract-check.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend ruff check deploy/scripts/test-geo-collector-contract.py | exit 0；deploy-script-lint.log（根 lint 只覆盖 backend/前端） |
| 本地 Python subprocess 调用 python -m app.geo_fake_server --port 0 --mode 429，GET /health，SIGINT，communicate 有界清理 | exit 0；cli-smoke.log 保存结果 |
| 本任务 owned source diff/初始指纹/manifest 非本任务项比较、文档哈希和 secret scan | final-audit.json、validation-results.json 与对应日志 |

初始 suite 调试先出现 fixture 字段名错误（questions/answers 使用 text，不是业务 DTO 字段），27 failed / 24 passed；修正真实 fixture 合同映射后 51 passed。额外新增 CI 网络守卫/控制错误/scan fail-closed/真实 secret wire 覆盖后最终 57 passed。mypy 的标准库 override 参数与无效 ignore、Ruff 格式问题均在代码 owner 修正，最终指定检查通过。原始失败日志保留，不把中间失败或未运行检查写成通过。

## 未执行项、限制与恢复

完整部署脚本 recipe 与真实 frontend 镜像未运行；下一步在 Docker Engine 可用环境执行同一 make test-deploy-scripts。没有为通过检查删除前置构建、放宽安全门禁或尝试无依据环境修复。该环境缺口不属于用户规定的五种业务 blocked 条件，保留在 review。

未运行远端 CI、make verify、PostgreSQL/Redis/Celery/Worker 集成、迁移演练、Browser 或真实栈 E2E：本任务没有改变对应业务/持久化/旅程，且尚非 R3 阶段发布。CI 接线已在代码实现，本地结果不代表远端执行。生产 TLS/SSRF、真实 adapter、业务 API/audit、Worker lease/发送隔离/重复消息/迟到结果仍由 GEO-403/404/405/406 与安全任务验证。

fake 单进程，退出清空计数；没有跨进程/持久化保证。统计仅计完整请求的接收，不证明送出后尚未到达 provider 的字节数；这类未知结果须由生产 transport/Worker 后续处理。原始异常/正文不进入安全摘要。撤销本任务仅删除新增测试文件并恢复本任务文档/Makefile 片段，保护前序未提交工作，无数据库回滚。

## 最终审计、状态与后续

起始工作树及所有已存在文件哈希、Makefile/文档基线见 evidence/。最终逐个核对，OpenAPI/数据库/Alembic/前端及其他初始文件未变化，manifest 除 GEO-402 外所有条目相等，依赖保持 done，后续任务仍 planned。审计明细见 final-audit.json。

本任务无需修改高后果业务合同或状态安全边界；没有委派或独立只读复核，不把自查称为独立验收。任务状态 planned → in_progress → review，task.json completedAt 保持 null。没有提交、PR、推送或归档。

后续 GEO-403 管理连接测试、GEO-404 生产 Collector、GEO-405/406 Worker/恢复和 GEO-803 Browser 合同分别按 manifest 推进，本轮没有实施。

## 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-402 的实现与测试证据。”据此仅将
manifest 的 GEO-402 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，
completedAt=2026-10-03，并记录接受者、范围与依据；Task Brief 当前状态同步更新。
验收范围为本地 fake provider、Collector 合同套件及以上实现与测试证据，不包含生产
adapter、Worker、Browser 或其他 GEO 任务。

以上实施章节及原始 evidence 保留人工验收前的历史状态、实际测试结果和已知限制。
make test-deploy-scripts 因 Docker socket 缺失在前置构建失败，后续 recipes 未运行；
本次验收不将此项或其他未运行检查改写为通过。本次只记录 GEO-402 验收，不修改
其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾运行 git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
