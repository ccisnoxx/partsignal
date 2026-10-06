# GEO-005 Task Brief：建立 GEO 测试夹具和金标目录

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID / 发布增量 | GEO-005 / R0 |
| 状态 | done（2026-10-01 用户人工审查并接受实现与测试证据；Trellis 为 completed；保留已记录的 Docker 验证缺口） |
| 负责人 | 本会话主代理；本任务不委派 |
| 依赖 | GEO-003=done；Trellis completed，保存了用户人工验收依据 |
| 分支 | geo/GEO-005（开始时已存在） |
| PR/Commit | 未创建；不提交、推送、部署或归档 |

## 2. 目标

交付全部虚构、离线、可版本化的产品、问题、回答、引用及分析金标，使后续分析、指标和 E2E 可以引用稳定语料，并能显式拒绝格式漂移、断裂引用及敏感数据。

## 3. 关联需求

GEO-005 属于 R0 测试基础设施；WBS 未分配独立 CAP/REQ，不虚构编号。对应测试质量策略 §2、§6，以及 PRD AC-ANA-01～05 和 ADR-003 的原始引用与派生归属分离约束。此处只提供测试数据，不宣称分析能力已实现。

## 4. 必读文档

已读取根/后端/前端 AGENTS、Trellis workflow 与相关 spec 索引、质量及前端目录规范；GEO README、治理、愿景、PRD、领域模型、状态机、技术架构、质量策略；路线图、完整 WBS GEO-005 行、执行指南、任务模板与 manifest；五份 Accepted ADR；GEO-002/003/004 任务状态及 GEO-003 验收/基线证据。当前依据为 contracts/openapi.yaml 的 GEO/QueryTopic operation 和 schema、contracts/database.md 的 GEO/事实/历史不变量、现有 ORM/Schema/service/test/frontend API，以及 0007/0029/0043 迁移源码。

## 5. 当前行为

- 现有 GeoObservation 只新增 MANUAL_ARTICLE_SEARCH，逐篇保存 discovered/mentioned/可空 accuracy；历史 LEGACY_MODEL_RESULT 只读。
- GeoInsights 使用 MANUAL_OBSERVATION_PUBLICATION_RELATION；更正追加链，Application Service 拥有事务和锁。
- canonical frontend 使用 generated OpenAPI 类型和 geo.api.ts 的 query key。
- 无共享 backend/tests/fixtures/geo_analysis 目录；现有后端、组件与 E2E 夹具分散，部分历史测试使用真实平台名称，不在本任务改写历史测试。
- 回答级 Run、分析器、指标资格、Collector 仍为后续目标。GEO-004 配置已完成，不代表新业务已存在。

## 6. 目标行为

- 单一 v1 JSON 语料与独立 gold 目录，固定版本、ID、UTC 时间、PUBLIC 虚构事实 Markdown。
- 严格 JSON Schema、唯一 ID/跨文件引用/证据摘录/事实归属/URL 与敏感信息检查；失败不回显正文或值。
- Python 最小加载和前端测试加载同一文件，每次返回独立数据，原始回答/引用与派生金标分离。
- 13 个基础分析场景可复用（有序/无序推荐分别一例）；金标是人工预期，不运行分析器、公式或 provider。

## 7. 范围内

- [x] backend/tests/fixtures/geo_analysis：版本化语料、schema、gold、加载校验和格式/隐私规则。
- [x] backend/tests/unit：schema、加载、关键失败与测试隔离验证。
- [x] frontend/src/test：同源语料读取和最小加载测试。
- [x] deploy/scripts：离线校验入口；Makefile 的必要入口接线。
- [x] GEO 导航、质量策略、CHANGELOG、SHA256SUMS、manifest 与本任务证据。

## 8. 范围外

GEO-402 fake provider/Collector 合同套件与网络失败矩阵；GEO-501 ORM/API/AnalysisRevision/Review；任何 R1+ 业务、监测计划、采集、分析算法、指标公式、机会、真实 provider、生产/数据库操作；无关历史夹具清理、依赖升级、迁移和安全边界变更。

## 9. 业务不变量

1. 所有新增语料手工虚构，不使用真实公司、客户、产品机密、凭据、Cookie、生产 URL。
2. 只允许 HTTPS 的专用 .test 主机，禁止 userinfo、端口和 query；只读字符串，不请求 URL。
3. 事实只有 Markdown；用于后续外发的虚构事实显式 PUBLIC/APPROVED；事实不足保留 UNJUDGEABLE。
4. 原始引用只存采集字段，归属/分类属于独立 gold；不改旧文章模型或分母。
5. 前端 test 数据不是 API DTO，不进入运行时；未来协议转换仍使用 generated OpenAPI 类型。

## 10. 契约变化

### OpenAPI

无 operation/schema/enum/error code/revision 变化。JSON Schema 仅为测试文件格式，不能替代公共合同。

### Database

无表/列/索引/FK/trigger/Alembic revision 或数据迁移；当前源码 head 0043_geo_platform_identity 保持不变。无需前滚/回填，未执行 DB 迁移。

## 11. 后端实现

Router/Application Service/Read Model/Worker/Collector 不修改。测试加载器只读取 JSON，使用已安装 jsonschema，禁止未知版本/额外字段/无效引用，返回新对象。CLI 错误只给文件类别/字段位置，保持非零退出，不输出敏感值。

## 12. 前端实现

只在 src/test 的 Node 测试运行时读取同源语料，返回 unknown，由消费者显式转换；不手写 API DTO。前端构建不静态依赖 Docker 上下文之外的 backend JSON。不改变路由、search params、query key、组件、页面状态、权限、dirty 或可访问性。

## 13. 测试计划

- Unit：schema/最小加载、版本/未知字段/重复 ID/悬空引用/事实归属/摘录失配/非测试域名/敏感标记等反例；独立加载防止修改传播。
- Contract：make contract-check，公共合同保持无 diff。
- Frontend：定向同源最小加载，完整 npm test/typecheck 与指定根命令。
- Ops：离线 CLI 与 make test-deploy-scripts；遇 Docker 环境错误保留实际命令、退出码和阶段。
- PostgreSQL/Worker/E2E：没有改变相关业务边界，不新增或模拟这类验收。

## 14. 验收标准

1. 格式明确版本、固定身份与时间，未知字段/版本显式失败。
2. 产品/问题/回答/引用/gold 均可加载，关联完整，金标覆盖 13 个基础场景。
3. 全部新增语料人工虚构，检查不包含生产域名、凭据或 Cookie；扫描与人工审查配合，工具不冒称能识别所有真实名称。
4. 后端和前端读取同一数据并保持 null、顺序与隔离；不增加业务算法。
5. 实际验证有逐项结果，manifest 和 Trellis 最终 review，不自行 done。

## 15. 验证命令

基线：现有 GEO 后端 unit 与前端 model/typed API；现有 contract-check。最低门禁：git diff --check；make contract-check；make lint；make typecheck；make test-unit；npm --prefix frontend run test；npm --prefix frontend run typecheck；make test-deploy-scripts。实现后增加 fixture CLI、backend unit 和 frontend loader 定向测试。

## 16. 数据和上线

没有业务上线、开关、迁移或历史回填。只删除本任务新增夹具/loader/test/CLI 并恢复文档及 Makefile 本任务片段即可撤销；保护其他未提交工作。新语料的破坏性格式变化进入新 major 目录，不静默覆盖既有预期。

## 17. 风险与开放问题

| 风险/问题 | 处理 |
|---|---|
| 目标文档枚举/指标仍有后续待裁决项 | 采用 ADR-003 已接受的不变量与 fixture 局部标注；不冻结未来 API、状态和指标公式 |
| 复制语料导致漂移 | backend fixtures 为唯一来源，前端测试直接加载 |
| 扫描无法证明所有名称虚构 | 本轮手工创作/人工 diff 审查，严格字段与 URL 限制，不宣称通用 DLP |
| Docker 环境可能不可用 | 运行指定命令并保存实际阻断，不放宽门禁，不扩展到环境修复 |

仅用户列出的五种条件触发 blocked；基线测试环境限制本身按要求记录，不将其冒充依赖未完成。

## 18. 完成证据

实施、命令/退出码/日志、最终 diff 与工作树审计见 [implement.md](./implement.md) 和 evidence/。后端 821、前端 863 项测试通过；fixture 定向 27+2 项通过，frontend-only 临时目录构建通过。make test-deploy-scripts 在前置镜像构建因 Docker socket 缺失失败，后续 recipe 未运行。无 PR/Commit、Alembic 或真实数据库/浏览器验收。状态变更：planned → in_progress → review，等待人工验收。

## 19. 后续任务

直接后续 GEO-402、GEO-501 保持 planned；分析/指标任务分别完善对应金标和业务合同，本轮不实施。
