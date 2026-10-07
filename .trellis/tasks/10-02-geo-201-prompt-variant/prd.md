# GEO-201 Task Brief：PromptVariant 契约与数据模型

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID / 发布增量 | GEO-201 / R1 |
| 状态 | done；2026-10-02 本会话用户人工审查并接受，Trellis completed |
| 负责人 | 主代理实施；候选由 fresh critical_reviewer 独立只读复核 |
| 依赖 | GEO-003=done、GEO-101=done；manifest 与两项接受记录已核对 |
| 分支 | geo/GEO-201（初始已存在） |
| PR/Commit | 未创建；不提交、推送、部署、归档 |

## 2. 目标

复用既有 QueryTopic，建立可独立审查的 GEO 实际问题变体公共 Schema、ORM 与 PostgreSQL 最终约束，显式保存点名模式、语言、地区、优先级、启用与 revision；历史引用后只能停用，禁止删除或改写问题语义。

## 3. 关联需求

CAP-GEO-02；PRD AC-TOPIC-02/03 的变体模型部分；领域模型 §3.2；页面规格 §4。不虚构未分配的 REQ 编号，不宣称完成整个问题库或运行流程。

## 4. 必读文档

已读根/后端 AGENTS、Trellis workflow、backend/guides/infra spec 索引及数据库/质量/跨层规则；GEO-003、GEO-101 任务和接受记录。用户列出的 GEO README、路线图、WBS、执行指南、模板、manifest、愿景、完整 PRD、页面规格、业务架构、领域模型、状态机、技术/数据/API/前端/质量文档和 Accepted ADR-001。当前根 OpenAPI 的结构及 QueryTopic/Catalog 组件、database 的受影响合同；QueryTopic/身份生命周期、0044、ORM、Schema、契约与迁移测试。

## 5. 当前行为

QueryTopic 存 canonical_question/intent_type/variants 字符串数组/revision；旧 variants 无独立身份、语言地区或历史守卫。无 geo_prompt_variants、回答级 Batch/Run、变体 API/UI。源码 head=0044_geo_catalog。既有 Catalog 和文章关系 GEO 成果属于起始工作，保留。基线 unit 183 passed；PostgreSQL 基线见 evidence。

## 6. 目标行为

新增一张 geo_prompt_variants；必填 QueryTopic FK、规范文本、BRANDED/UNBRANDED、语言地区、CORE/STANDARD/EXPLORATORY、revision。语义唯一包含主题/文本 SHA-256/点名/语言/地区，含停用行。数据库从规范文本生成 hash，旁路 writer 不能伪造唯一键。首次历史引用标记只能从空变为数据库时间，历史后只允许停用与对应版本递增。

## 7. 范围内

- 根公共组件与数据库合同；不新增 operation。
- 变体 ORM、Schema、无 I/O 规范化、0045 新迁移。
- 新 FK 必需的 QueryTopic 删除 blocker 与 User 创建者引用接入；不新增变体 CRUD。
- generated types 及既有 blocker 消费白名单/文案同步，无新页面。
- 迁移/唯一性/规范化/历史守卫/并发和合同测试；任务与文档证据。

## 8. 范围外

GEO-202 服务/API/问题工作区；主题字段扩展、旧 variants 自动导入；任何其他 GEO task；Batch/Run/Plan/Profile/采集/分析/指标/机会/调度/外部调用；无关重构与依赖升级。

## 9. 业务不变量

1. 既有 QueryTopic 是唯一主题主表，旧数组不作为 GEO 变体的第二写来源。
2. PostgreSQL 权威；变体独立 revision，topic_id 与创建信息不可改。
3. 规范化不猜测点名、语言或地区，不 casefold/删除标点或型号后缀。
4. 按用户本次更严格要求：首次引用后冻结语义，停用后不可重新启用。复制新变体属于 GEO-202。
5. 未建 Run，first_referenced_at 是内部不可逆事实标记；后续消费者必须在真实引用/快照创建事务中锁变体并置标记，新增 RESTRICT FK，不能猜零或把单元测试当运行流程已实现。

## 10. 契约变化

OpenAPI：GeoPromptVariant 的 create/update/revision/core response 与枚举/领域错误组件；QueryTopic blocker 增加 GEO_PROMPT_VARIANT。标准 runtime paths 不变，drift gate 不放宽。

Database：0045_geo_prompt_variants，QueryTopic/User RESTRICT FK；generated SHA-256、命名语义 UNIQUE/CHECK/index、不可逆引用与身份/历史语义守卫。无旧数据回填，禁止破坏性 downgrade。

## 11. 后端实现

无新 Router/Application Service/Worker。GEO-202 后续命令锁 User（创建追溯资格）→QueryTopic→PromptVariant（同层 UUID 排序），CAS/业务变更/revision/updated_at/审计同事务。首次引用写与快照同事务，失败回滚标记。DB 守卫覆盖旁路及行锁交错；精确 SQLSTATE+constraint 映射写入合同，未知错误不转换。

## 12. 前端实现

只同步生成组件与既有删除 blocker 接收/文案。无路由/query key/URL/页面状态变化，不创建 GEO-202 功能。

## 13. 测试计划

Unit/Contract：字段 closure、必填枚举、Unicode 文本、语言大小写/地区、PATCH omission/null、revision、生成声明与根合同对齐。PostgreSQL：空库/0044 有旧记录前滚、metadata、CHECK/FK/生成 hash、唯一含停用及维度区分、不可逆历史标记/删除/修改/停用、数据库唯一仲裁与引用/修改交错、QueryTopic/User lifecycle。E2E/真实 AI：无新 UI/外部集成，不运行。

## 14. 验收标准

- 只有一张新业务表，复用 query_topics；无 Batch/Run。
- 规范化/唯一/显式维度和 revision 在 Schema、合同、ORM、迁移一致。
- 直接 SQL 证明历史后不能改语义或删除，只能停用，标记不可撤销。
- 旧 QueryTopic/GeoObservation/Catalog 数据前滚保持；关联删除有真实 blocker。
- 指定检查实际执行并记录；状态 review，不自行 done。

## 15. 验证命令

```bash
git diff --check
make contract-check
make lint
make typecheck
make test-unit
make test-integration
uv run --project backend alembic -c backend/alembic.ini upgrade head
```

集成与 Alembic 使用专用 PostgreSQL 测试 URL；精确环境前缀/Compose 覆盖与逐项结果记录在 implement.md/evidence。

## 16. 数据和上线

只 expand，先迁移再部署可读取的代码，不新增入口或改功能开关。旧 variants 缺少点名/地区/语言事实，因此不猜测回填。downgrade 明确拒绝；前滚修复或恢复迁移前 PostgreSQL 备份。只操作隔离测试库，不迁移生产。

## 17. 风险与停止条件

主要风险是规范化漂移、并发唯一旁路、历史标记被清除、新 FK 漏生命周期。以真实 PostgreSQL 和独立复核验证。仅用户列出的无法消解业务冲突、未批准破坏性迁移、已批准指标/状态机/安全改变、必需输入/授权缺失或依赖未完成才 blocked。首次引用守卫需 GEO-301/303 接入真实运行；本任务不伪造此能力。

## 18. 完成证据

初始文件指纹/共享文件原文、manifest-before、baseline-unit 见 evidence；候选增量、各命令结果、PG 前滚和独立复核最终记 implement.md。

## 19. 后续任务

GEO-202 CRUD/API/UI；GEO-206 计划关系；GEO-301/303 真实历史 RESTRICT FK、首次引用标记与输入快照，均未实施。
