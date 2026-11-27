# GEO-103 Task Brief：GEO Catalog Schema 与领域策略

## 1. 基本信息

GEO-103 / R1；状态 done，2026-10-02 本会话用户人工审查并接受实现与测试证据；负责人主代理；分支 geo/GEO-103；依赖 GEO-101、GEO-102 均 done，manifest 与人工接受记录一致。无提交、PR、部署或归档授权。

## 2. 目标

让后端按已接受 Catalog 合同完成请求校验、规范化、父子类型守卫、别名歧义判断及 stage/actions/deletion 投影；不依赖前端推断。

## 3. 关联需求

CAP-GEO-01、REQ-GEO-SUBJECT-002～004；REQ-GEO-SUBJECT-001 复用已实现数据库唯一性，005 的历史快照属于未来消费者义务。

## 4. 必读文档

已读取根/ backend AGENTS、.trellis/workflow、backend spec 索引及动作/错误/数据库相关规范；GEO-101/102 PRD、设计与接受记录；用户列出的 GEO README、路线图、WBS 完整任务行、执行指南、模板、manifest、产品愿景/PRD/页面、业务架构/领域模型/状态机、技术架构/数据/API/前端/测试、Accepted ADR-001。详细语义以 contracts/openapi.yaml Catalog components 及 contracts/database.md Catalog 完整章节为权威。当前实现为 0044、geo_catalog ORM 和相关合同/metadata/迁移测试。

## 5. 当前行为

三表及 0044 已实现；公共组件与 12 个 CONTRACT_ONLY 操作已冻结。无 Catalog Schema/Policy/CRUD/API/UI/Worker。旧文章关系 GEO 独立保留。工作树包含前序未提交成果，evidence/initial-hashes.json 固定起始范围。相关基线命令：UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_contract.py backend/tests/unit/test_geo_catalog_metadata.py backend/tests/unit/test_contract.py backend/tests/unit/test_contract_check.py，163 passed，evidence/baseline.log。

## 6. 目标行为

闭合判别请求拒绝未知类型、事实副本和服务端字段；PATCH 省略保留、指定 nullable 字段可清空，空 PATCH 拒绝。NFKC/Unicode 空白/casefold 保留型号标点；语言显式受控且小写；IDNA2008/UTS #46 non-transitional/STD3 严格 round-trip。父级匹配真实品牌类型，未知/自引用显式失败。ADMIN/ENGINEER 动作、stage、删除引用和当前 Product 名称由同一后端投影产生。

## 7. 范围内

- Catalog 请求/响应、枚举与聚合版本 Schema。
- 无写入的规范化、类型/父级、别名候选歧义、动作/删除策略及显式 ORM→响应转换。
- 单元/公共实例合同测试、指定命令、相关实施状态文档及证据。
- 将现有 idna 安装版声明为直接依赖，不升级大版本。

## 8. 范围外

GEO-104 CRUD/Application write service/Router/审计/生命周期接线，GEO-105/106 UI/E2E，全部后续 GEO 任务。无回答级 Batch/Run、采集、答案匹配分析器、指标、机会、真实外部平台、新基础设施或无关重构。

## 9. 不变量

OWN_PRODUCT 不持久化 Product 名称或事实；跨 Subject 重复别名可登记但歧义不能任选；域名精确匹配且不发网络请求；Subject 是唯一子字典 revision owner；历史引用禁止物理删除；投影不是授权；未知状态/输入显式失败。

## 10. 契约变化

按现有 OpenAPI 实施，标准 paths 保持未接线；无新 operation、数据库列、索引或 revision。contracts/database.md 仅更新实施状态。head=0044_geo_catalog，无历史回填或破坏性迁移。

## 11. 后端与并发

规范化为无 I/O 函数；policy 只消费显式领域输入；projector 显式接收完整 ORM 关联和引用事实，不逐行查询、不写 ORM。GEO-104 负责批量一致读、锁内重验 revision/真实父级、Product→品牌→Subject→子项锁序、CAS、成功审计及 SQLSTATE+constraint 映射。本任务不实现 commit/flush/rollback/锁、不自动重放、不递增 revision。

## 12. 前端

无页面、路由/query key/URL 改动；generated 类型仍以根合同为唯一来源。不新增前端状态机。

## 13. 测试计划

Unit：规范化与长度扩张、别名候选歧义、IDNA/语言、所有类型/父级组合、PATCH 省略/null、动作与 blocker、Product 实时只读投影。Contract：真实 Pydantic dump 在根 OpenAPI 验证，未知字段和非法实例失败。Integration：指定 make 目标使用独立 PostgreSQL/Redis/fake-oss，无 SQLite。无新增 UI/Worker，E2E 不适用。候选若涉及合同/安全实质风险，fresh 只读复核。

## 14. 验收

未知类型、非法父子及 IDNA 错误明确失败；不任意选择歧义对象；ADMIN 删除与真实 blocker 一致，ENGINEER 无写动作；没有提前接线 Router。最低命令有实际结果，manifest/Trellis 仅置 review。

## 15. 验证命令

基线命令见第 5 节；定向 pytest；git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration（隔离 Compose 覆盖配置，精确命令写实施记录）。

## 16. 数据与上线

不开启配置、不操作生产库、不迁移历史数据。策略可随代码回退；三表既有迁移的恢复仍为前滚修复/迁移前备份。

## 17. 风险与停止条件

风险：型号误归并、错误 IDNA 容错、PATCH 省略/null、动作/引用不一致。通过领域单元与标准合同实例验证。仅用户明确五类条件（不可消解业务/ADR冲突、破坏性未批准历史迁移、已批准边界变化、必需输入/授权缺失、依赖实际未完成）blocked；环境验证缺口精确记录并继续独立工作。

## 18. 完成证据

已完成 98 项定向、9 个入口/30 组件机器声明对照、lint/typecheck、后端 953/前端 863 单元及 PostgreSQL 427 集成；首次 P2 修正后经第二次 fresh 只读复核解除。原始命令、scope/diff、复核及结果见 implement.md/evidence；未执行检查不声明通过。

## 19. 后续任务

人工接受 GEO-103 后，GEO-104 实施 CRUD/Router、事务/锁/revision/审计及 Product/User 生命周期；本任务不实施后续任务。
