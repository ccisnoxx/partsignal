# GEO-206 Task Brief：MonitoringPlan 数据契约

## 1. 基本信息

Task ID GEO-206；R1；completed（2026-10-02 本会话用户人工验收；manifest=done）；主代理实施根合同与集成，候选变更完成后独立只读复核。依赖 GEO-202/GEO-205 均为 done，Trellis completed 且已记录用户接受。当前分支 geo/GEO-206；不提交、推送或发布。

## 2. 目标

提供只保存计划配置的 MonitoringPlan 数据契约、四表 ORM/Alembic 与闭合 Pydantic Schema；真实关系具备数据库最终防线和现有资源删除阻断，为后续矩阵/API 提供稳定输入。

## 3. 关联需求

CAP-GEO-04/16；PRD 9.3、10.2、AC-PLAN-04 的配置边界；领域模型3.4，数据架构4.2/4.3，WBS GEO-206完整行。矩阵、启用资格、命令状态机由后续任务验收。

## 4. 必读文档

根及backend/frontend AGENTS，.trellis/workflow与相关spec；用户列明的18份GEO文档按结构及完整相关章节读取，任务行完整读取；Accepted ADR-001；GEO-202/205 Task和人工接受记录；当前根合同、0045/0046、相关Schema/ORM/查询/删除服务与测试。目标与当前实现分开记录。

## 5. 当前行为

head=0046；Catalog、问题变体、Surface/Profile已存在；无Plan表/Schema/API。Subject计划计数为0；Prompt/Profile删除未接入Plan。前置任务有大量未提交修改；evidence/before与initial-hashes保存本任务起点。

## 6. 目标行为

Plan拥有name/description/status/repeat_count/schedule_kind/cron_expression/timezone/budget_limit/rule_set_revision/revision、创建/修改追溯；Subject角色PRIMARY/COMPETITOR/REFERENCE，prompt和profile集合显式UUID。所有已提交Plan至少一个PRIMARY、prompt、profile；关系唯一、外键删除阻断；没有运行状态、结果、Batch/Run或外部请求。

## 7. 范围内

四表与具名CHECK/PK/FK/index，提交时完整性；公共数据组件Create/完整Update/Out/revision request；现有资源删除预检、批量投影、精确FK映射及最小前端token文案；User创建/修改追溯删除阻断；迁移与定向测试/文档。

## 8. 范围外

GEO-207矩阵/费用/资格预览，GEO-208 Plan Service/Router/状态转换/actions/审计，GEO-209页面，GEO-301 Batch/Run；调度执行/外部采集、指标/机会；依赖升级、身份体系、生产数据迁移与无关重构。

## 9. 不变量

PG唯一业务源；关系可在同事务内替换，提交不能为空；至少一个PRIMARY不按Subject类型推断。Plan只是当前配置，不冻结Prompt/Profile或写first_referenced_at；停用资源可保留关系，当前活动/资格由207/208持锁检查。归档配置只读；revision由未来Application Service拥有，不由Router或关系触发器自增。

## 10. 契约变化

OpenAPI只新增数据组件，不增加Plan endpoint/预览；现有删除blocker加入MONITORING_PLAN，Profile DELETE登记409 GEO_PROFILE_IN_USE。DB新增0047_geo_monitoring_plans（down=0046）、Plan+三关系表；Plan→关系CASCADE限显式聚合删除，关系→资源RESTRICT；creator/updater→users RESTRICT。无回填/历史改写；downgrade明确拒绝，前向修复或恢复备份。

## 11. 后端实现

完整配置输入在Schema边界校验重复/PRIMARY/repeat/预算/五字段Cron/IANA时区；Cron复用已安装Celery crontab，不实现调度器。DB跨行完整性由DEFERRABLE INITIALLY DEFERRED约束触发器保证，关系写串行化父Plan，支持同事务替换与RR写偏斜阻断。ORM只注册表与字段；Plan业务命令/锁序/CAS属于208。当前Subject/Prompt/Profile删除仍沿原锁序，在锁内查真实引用；mapper只按精确SQLSTATE+FK。用户引用查询增加两个追溯列。固定批量读取，无N+1/敏感配置加载。

## 12. 前端实现

仅重生成OpenAPI类型及新增删除token文案。无Plan路由、query key、URL状态、表单或状态机。

## 13. 测试计划

Unit/Contract：字段边界、三集合/PRIMARY/重复、Cron/timezone、预算精度、只读/未知字段拒绝及JSON Schema对应。PG：0046现有数据与空库前滚、metadata、CHECK/关系PK/FK、提交缺集合、合法替换、归档拒绝、并发删除最后PRIMARY、已有API阻断和User追溯。普通测试不访问provider。

## 14. 验收标准

任意已提交Plan满足至少一PRIMARY/一prompt/一profile；关系内相同资源不重复。repeat1..10；CRON必须有效五字段且MANUAL_ONLY不保存Cron；budget JSON只用非负十进制字符串（8位整数/6位小数）或null，内部Decimal/DB numeric(14,6)；timezone显式IANA；revision非负创建0。配置表和响应无运行状态。真实引用阻断Subject/Prompt/Profile/User删除，无成功审计残留。

## 15. 验证命令

基线：UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_prompt_variant_contract.py backend/tests/unit/test_geo_surface_contract.py backend/tests/unit/test_contract.py；显式专用PG的test_geo_prompt_variants.py/test_geo_surfaces_profiles.py。

最终：git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration（专用COMPOSE）；显式APP_ENV=test DATABASE_URL指向本任务空库的 uv run --project backend alembic -c backend/alembic.ini upgrade head。日志/exit逐项记evidence；不把未运行写为通过。

## 16. 数据和上线

仅新增四表/函数/触发器；无自动seed/旧GEO搬迁/生产写入。新端点尚未开放，开关不变。测试project partsignal-geo206-validation，PG55446/Redis56386/fake-oss19006独占；结束清理专用volumes并恢复起始Colima停止/default context。

## 17. 风险与开放问题

PRD产品范围字段是用户概念；当前具体领域/数据架构明确使用Subject/PromptVariant/Profile及MANUAL_ONLY/CRON，无业务冲突。跨行CHECK不能表达集合最少值，必须真实事务反例。触发器只最终完整性/只读保证，不实现后续状态机。仅用户列出的业务冲突/破坏迁移/改变批准边界/必需授权或输入缺失/依赖未完成可blocked；环境失败记录具体证据。

## 18. 完成证据

基线、最终门禁、独立只读复核、实际增量diff和审计Digest记implement/evidence；manifest与Trellis已按planned→in_progress→review更新、completedAt=null，不归档或done。

## 19. 后续任务

GEO-207→GEO-208→GEO-209；GEO-301及以后，仅列出。
