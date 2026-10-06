# GEO-005 实施与验证证据

日期：2026-10-01。Task Brief：[prd.md](./prd.md)。分支 `geo/GEO-005`；源码 HEAD `cd88fbf61d65018f7eb1a47b9f0f379ed47e3814`。仅实现 R0 的测试数据基础设施，不提交、推送、部署或归档。

## 1. 门禁、现状与实施边界

- 开始时 GEO-005 为 planned，唯一依赖 GEO-003=done；其 Trellis completed 及人工接受证据已核对。五份 ADR 均为 Accepted。没有触发用户指定的 blocked 条件。
- 已输出 12 项 preflight。当前实现是文章关系级 GeoObservation/GeoInsights，目标回答级运行、采集、分析和指标仍未实现；本轮不把测试文件标签当作未来 API 枚举或状态机，不冻结未裁决的指标分母。
- 按任务模板创建本任务 Task Brief，planned → in_progress；交付后进入 review，等待人工验收，不自行 done。未启动 GEO-402/GEO-501。
- 初始已存在 GEO-004 配置、部署脚本、Makefile 和多项 GEO 文档/任务的未提交工作。初始状态与指纹见 [initial-state.json](./evidence/initial-state.json)；Makefile 原内容单独保存。最终审计核对本任务以外的已跟踪改动、公共合同和 manifest 其余条目。

## 2. 实际交付

唯一语料目录为 `backend/tests/fixtures/geo_analysis/v1`：2 个虚构产品、6 个监测身份、2 份 PUBLIC/APPROVED Markdown 事实、4 个问题、13 个回答、4 条原始引用及 13 份独立人工金标。回答和金标逐一对应，固定 UTC 时间；重复引用不去重，未知 web search、无可靠推荐位置及歧义提及保留 null。

13 个场景覆盖精确型号、型号后缀、大小写/连字符、歧义别名、否定提及、仅列举、有序推荐、无序推荐、条件替代、参数冲突、事实不足、注入文本及中英混合。金标包括提及、推荐/位置、声明/verdict/severity、引用来源/对象和复核原因；摘录来自原回答，判断依据与对应虚构事实人工核对。没有实现分析器、公式、Collector 或 fake provider。

| 修改文件 | 职责 |
|---|---|
| `backend/tests/fixtures/geo_analysis/README.md` | 格式权威、版本规则、敏感数据规则、加载与后续转换边界 |
| `backend/tests/fixtures/geo_analysis/v1/corpus.json` | 原始虚构产品/身份/事实/问题/回答/引用 |
| `backend/tests/fixtures/geo_analysis/v1/gold/analysis.json` | 与原始证据分离的人工预期 |
| `backend/tests/fixtures/geo_analysis/v1/schema.json` | Draft 2020-12 严格文件格式；声明式 schema 的行数例外 |
| `backend/tests/geo_fixtures.py` | 测试加载、Schema、关联与敏感数据校验的唯一所有者 |
| `backend/tests/unit/test_geo_fixtures.py` | 加载、隔离和真实格式/关联/隐私反例，27 项 |
| `frontend/src/test/geo-fixtures.ts` | Node 测试运行时读同源 JSON，返回 unknown 和独立对象 |
| `frontend/src/test/geo-fixtures.test.ts` | 同源加载、null/引用顺序及修改隔离，2 项 |
| `deploy/scripts/check-geo-fixtures.py` | 离线 CLI，失败非零且不回显数据 |
| `Makefile` | 新增 test-geo-fixtures，接入 test-deploy-scripts；保留 GEO-004 原有行 |
| `docs/geo-monitoring/README.md` | fixture 与本任务证据导航 |
| `docs/geo-monitoring/03-technical/07-testing-and-quality.md` | R0 fixture 已实现与后续分析验收的边界 |
| `docs/geo-monitoring/CHANGELOG.md` | GEO-005 实施及实际验证记录 |
| `docs/geo-monitoring/04-delivery/task-manifest.yaml` | 仅 GEO-005 状态和证据入口 |
| `docs/geo-monitoring/SHA256SUMS` | 仅本轮修改的 GEO 文档哈希 |
| 本任务目录 | Task Brief、任务状态、实施记录、原始命令输出及审计证据 |

## 3. 契约、迁移与业务不变量

- OpenAPI operation/schema/enum/error code、generated API 类型、数据库合同和 ORM 无变更。测试 JSON Schema 是文件合同，不能替代公共协议。
- 未增加 Alembic revision，源码 head 仍为 `0043_geo_platform_identity`；无前滚、回填或历史数据迁移，也没有运行数据库迁移。只新增测试文件，不触及历史 GEO/Publishing 保留与不可变规则。
- Router、Application Service、事务、锁顺序、revision、业务状态转换、幂等、并发、错误映射和 Redis 消息均无变化。无 PostgreSQL 写入，无外部 I/O。加载器不缓存可变对象，每次读取/解析，非法输入明确抛 GeoFixtureError；CLI 返回 1，错误不打印值。
- 前端路由、query key、URL/search 状态、页面加载/空/错误/权限状态均无变化。辅助入口仅供 Node 测试，业务响应继续消费 generated OpenAPI 类型。没有 API DTO、状态机或指标公式副本。

## 4. 安全与隐私证据

新增语料全部手工虚构，没有真实公司、客户、平台响应、产品机密、凭据、Cookie 或生产 URL。只允许 HTTPS 的专用 `geo-fixture-*.test` 主机及子域名，禁止 userinfo、端口、query、fragment 和反斜杠；不解析 DNS、不请求 URL。JSON Schema 禁止额外字段，文字与 Markdown 扫描拒绝敏感凭据/会话标记及非测试 HTTP(S) 地址，关联校验拒绝跨产品事实、无原文证据、断裂/重复身份及丢失/去重引用。

敏感标记反例只在内存中合成无效标记，未保存真实凭据；测试验证错误不回显 URL、未知字段和值。未放宽 CSRF、SSRF、TLS、权限、审计或不可变边界；没有新增真实 AI/外部平台调用。扫描不能证明任意内容完全无敏感数据，不能替代人工来源/内容审查；本轮人工核对新增语料与金标，未宣称通用 DLP。

## 5. 基线与实际验证

基线记录见 [baseline.json](./evidence/baseline.json)：contract-check 通过，现有 GEO 后端定向 53 项、前端 2 文件/13 项通过。基线是在新增实现前取得；没有将环境缺口描述为通过。

完整原始执行记录见 [commands.json](./evidence/commands.json) 和 [前端边界修正后的记录](./evidence/final-frontend-commands.json)。以下为最终相关结果：

| 命令 | 实际结果 |
|---|---|
| `git diff --check` | exit 0；最终审计另用临时 index 检查本任务新增文件，保留实际 index |
| `make contract-check` | exit 0；公共合同与生成类型无修改 |
| `make lint` | exit 0；前端边界修正后重跑通过 |
| `make typecheck` | exit 0；mypy 80 源文件与前端 tsc 通过，修正后重跑通过 |
| `make test-unit` | exit 0；后端 821 项、前端 92 文件/863 项通过，修正后重跑通过 |
| `npm --prefix frontend run test` | exit 0；92 文件/863 项通过，修正后重跑通过 |
| `npm --prefix frontend run typecheck` | exit 0；修正后重跑通过 |
| `make test-deploy-scripts` | exit 2；前置 frontend Docker build 无法连接 `/var/run/docker.sock`，其余 recipe 未运行 |
| `make test-geo-fixtures` | exit 0；schema/关系/敏感数据离线校验，13 份 gold，外部调用 0 |
| `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_fixtures.py` | exit 0；27 项通过 |
| `npm --prefix frontend run test -- src/test/geo-fixtures.test.ts` | exit 0；2 项通过，修正后重跑通过 |
| `UV_CACHE_DIR=.cache/uv uv run --project backend ruff check deploy/scripts/check-geo-fixtures.py` | exit 0 |
| `npm --prefix frontend run build` | exit 0；初始本地构建通过，但不能单独证明 frontend-only 容器上下文 |
| `python3 .trellis/tasks/10-01-geo-005-fixtures-gold/evidence/check-frontend-context.py` | exit 0；只复制前端源码至临时目录，复用已安装 node_modules，无 backend 邻目录 |

本地完整 frontend build 通过后，代码审查发现静态 backend JSON import 超出 Docker 的 frontend-only 构建上下文。已改为 Node 测试运行时读取，不复制语料、不扩展 Docker context；定向测试与受影响检查重跑。隔离构建用真实 frontend 源码和已安装工具链验证缺少 backend 邻目录的边界，不等同 Docker 镜像测试。

## 6. 环境阻断、未运行验证与限制

`make test-deploy-scripts` 确实执行并失败于前置构建；原始错误见 [test-deploy-scripts.log](./evidence/test-deploy-scripts.log)。本机 Docker socket 不存在，没有改安全条件、删除前置测试或重复无依据重试。新 fixture CLI 已单独通过；部署脚本后续整套测试和真实 frontend 容器仍未验证。下一步是在具有可用 Docker daemon 的环境重跑同一命令。

未运行 PostgreSQL/Worker 集成、迁移演练、真实栈 E2E、浏览器矩阵和 make verify：本任务没有修改对应行为、持久化、协议或用户旅程，也不是 R0 发布操作；用户要求的本任务命令已实际运行。隔离前端构建通过但有现有 Markdown editor chunk 大于 500 kB 的体积提示；本任务未改相关页面。金标加载通过不证明未实现分析器的准确性或注入抵抗；无最终指标金标、运行分母、provider 错误矩阵或 fake provider。

## 7. 最终状态与后续

最终 diff/工作树/公共合同指纹、Makefile 相对初始状态差异、其他任务未变、相对链接及文档哈希证据见 evidence/final-audit.json 与相邻日志。未委派，未使用子代理；本轮为测试数据基础设施，没有需要独立高风险业务复核的变更，未把自查表述为独立验收。

Task Brief 与 task.json/manifest 进入 review，completedAt 留空；等待人工验收。GEO-402 建设 fake provider 与 GEO-501 分析合同分别继续 planned。本任务没有提前实施两者或其他 GEO 任务。

## 8. 人工验收完成 — 2026-10-01

本会话用户明确表示：“我已经人工审查并接受 GEO-005 的实现与测试证据。”据此将 manifest 的 GEO-005 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，记录完成日期、接受范围和依据，并同步 Task Brief 当前状态。

以上实施记录、review_note 和 evidence 中的 review 状态保留为提交人工验收时的历史记录。人工接受不将 Docker 环境阻断、未运行的部署脚本后续测试或真实容器验证改写为通过。本次只记录 GEO-005 验收，不修改其他任务状态、不实施后续任务、不提交或归档；SHA256SUMS 仅同步 manifest 条目。收尾运行 git diff --check，实际结果在本次最终回复报告。
