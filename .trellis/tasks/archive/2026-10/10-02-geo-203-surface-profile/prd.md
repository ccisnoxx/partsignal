# GEO-203 Task Brief：EngineSurface 与 CollectionProfile

## 1. 基本信息

- Task ID：GEO-203；发布增量 R1；负责人：当前 Codex 主代理。
- 当前状态：completed（人工验收完成，manifest=done）；分支 geo/GEO-203；base main；无 commit/PR/发布。
- 依赖：GEO-004、GEO-101 在 manifest 均为 done，Trellis completed 且有人工接受依据。

## 2. 目标

建立 EngineSurface 与 CollectionProfile 的公共数据组件、PostgreSQL 合同、ORM 和 Schema，明确模式、能力、合规、AI model 归属与非敏感 settings，供后续 Registry 和管理接口使用。

## 3. 关联需求

CAP-GEO-03；REQ-GEO-SEC-001 的合规数据部分；AC-SEC-01/02 的响应与配置数据边界。运行资格、权限端点和自动执行不是本任务已实现能力。

## 4. 必读文档

已读取用户指定的 README、roadmap、WBS、execution-guide、task-template、manifest、三个产品文档、三个业务文档、technical 01/02/03/04/07、Accepted ADR-001；根/后端/前端 AGENTS、Trellis workflow、backend spec 索引和相关数据库/AI/质量规范。当前权威为 contracts/openapi.yaml、contracts/database.md；当前相关源码是 models/ai_generation.py、models/geo_prompt_variants.py、schemas/base.py、schemas/geo_prompt_variants.py、0045 迁移及其测试。依赖任务与 GEO-201/202 记录用于区分当前实现。

## 5. 当前行为

已有文章关系 GEO、Catalog、问题变体和加密 AI 配置。无 EngineSurface/Profile 表、组件、Service、Router、UI 或 Collector。起始 head=0045_geo_prompt_variants；工作区有大量先前未提交改动，初始状态/指纹见 evidence。相关单元基线148项、PG基线16项通过，2条既有SQLAlchemy metadata warnings。

## 6. 目标行为

两表及公共数据组件一致。MANUAL/BROWSER 的 AI 引用为空；API 两引用同空或指向同渠道模型。三种 settings 闭合，只有布尔/数值参数；能力六键闭合，answer_text=true，不伪造单次观测。新资源默认停用；Profile 默认 UNTESTED。

## 7. 范围内

- [x] OpenAPI 数据组件、ORM、0046 迁移、Pydantic Schema与generated types。
- [x] 模式/能力/settings/枚举/FK/唯一性/revision/迁移与敏感数据测试。
- [x] 新 created_by 接入已有 User 删除引用统计，保持真实 FK 与投影一致。
- [x] 更新受影响文档、manifest、校验哈希及证据。

## 8. 范围外

GEO-204 registry/validate_profile/功能开关资格；GEO-205 CRUD API、动作投影和页面；连接测试、Browser session存储；Plan、Batch/Run、外部采集、分析、指标和机会。无依赖升级、真实AI调用、生产迁移或Git提交。

## 9. 业务不变量

PostgreSQL唯一状态权威；两类主数据与发布PlatformProfile独立；凭据由既有AI配置拥有。模型归属由复合MATCH FULL FK保证；AI删除保留Profile并成对清空引用。历史配置快照由未来消费者冻结。配置合法不等于可执行资格。未知枚举、未知settings/capability键和secret字段明确拒绝。

## 10. 契约变化

OpenAPI只新增标准components数据组件，无待执行假端点；Create与完整配置Update按collection_mode判别；Update必填expected_revision，Surface/Profile身份与创建元数据不可写。Out按模式返回非敏感配置与追溯信息。Database新增两表、命名CHECK/UNIQUE/FK/index；AIModel新增UNIQUE(id,channel_id)供复合FK；0046仅增量DDL。first_referenced_at为Surface内部不可逆历史锁存，未来真实Run同事务接入，不是Run本身。

## 11. 后端实现

无新Router/Application Service/Query/Worker/Collector。Schema仅建立结构合同，不查DB或注册adapter。两资源独立revision；创建0，有效变更+1/no-op不增；数据库守卫不自动承担命令事务或审计。未来锁序User→AIChannel→AIModel→Surface→Profile，所有写命令在锁后重读并CAS，资格归GEO-204/205。现有User引用批量查询增加两表；未知数据库异常不宽泛映射。

## 12. 前端实现

只重生成schema.d.ts；无路由/query key/URL/状态/组件/E2E变化。

## 13. 测试计划

Unit/Contract：三模式有效与非法组合、闭合settings/能力、枚举、必填环境、Update revision、Schema声明一致、响应secret缺失。PG：0045有数据前滚、空库head、ORM/metadata、直接SQL CHECK、跨channel FK、SET NULL、User/Surface RESTRICT、唯一性与revision反例。没有UI/Collector可验收，不新增无业务边界E2E。

## 14. 验收

1. 相同模式组合被Schema和DB一致接受/拒绝。
2. Profile不持久化或输出secret、Cookie、Header、session资料。
3. Model与Channel真实归属不能伪造；删除不会删除Profile。
4. 0045到0046及空库前滚通过，旧数据不变；没有未来任务实现。

## 15. 验证命令

`git diff --check`、`make contract-check`、`make lint`、`make typecheck`、`make test-unit`、隔离COMPOSE override的`make test-integration`、`uv run --project backend alembic -c backend/alembic.ini upgrade head`，另加模式/FK/迁移定向测试。实际命令/退出码写evidence，不把未执行或skip视为通过。

## 16. 数据和上线

默认不开新自动能力；新主数据is_active=false、Profile UNTESTED。无历史回填、seed、生产迁移；只在专用PostgreSQL16验证。downgrade明确拒绝删除新表，恢复用前滚修复或备份。验证容器/volume结束清理并恢复起始Colima状态。

## 17. 风险与开放问题

早期PRD字段枚举同步详细领域/data定义，非业务边界变更。API允许adapter-only空引用，注册与资格在GEO-204判定，无自动回退。合规启用和测试失效策略后续实施。只在用户列明五类阻断条件出现时blocked。

## 18. 完成证据

详见implement.md与evidence；实施交付时manifest=review，不自行done或归档；人工验收完成记录见末尾。独立只读复核验证公共合同、SET NULL、secret和迁移风险。

## 19. 后续任务

GEO-204、GEO-205及后续计划/运行任务；本次不实施。

## 实施交付状态（人工验收前）

2026-10-02：本地门禁完成，manifest与Task均review；独立复核两项P2已修正、55项合同/61项定向PG、1042后端/940前端单元、541PG全套通过。详见implement.md，等待人工验收，无completedAt、commit或生产发布。

## 人工验收完成 — 2026-10-02

本会话用户已人工审查并接受 GEO-203 的实现与测试证据。manifest 从 review 更新为 done；Trellis 从 review 更新为 completed，completedAt=2026-10-02。验收范围、接受者和依据见 task.json 与 implement.md。其他任务状态、既有实现与原始测试证据保持不变，本次不实施后续任务、不提交或归档。
