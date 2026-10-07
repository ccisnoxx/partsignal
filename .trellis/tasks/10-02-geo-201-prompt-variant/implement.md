# GEO-201 实施与验证记录

## 状态与授权

GEO-003、GEO-101 的 manifest 和接受记录均为 done；GEO-201 满足依赖，已输出十二项 preflight 后开始实施。manifest planned→in_progress→review；Task Brief/task.json 同步 review，等待人工接受，不自行 done。当前分支原已为 geo/GEO-201；没有提交、推送、PR、生产迁移或归档。初始工作树包含 GEO-003..106 成果，按 evidence/initial-files.json、initial-status.txt、before 与 incremental.diff 区分增量。

## 当前交付

新增 geo_prompt_variants，复用 query_topics；PromptVariantCreate/Update/RevisionRequest/Out 与 closed enums/error codes，ORM 与 0045 冻结迁移一致。模式 BRANDED/UNBRANDED、语言、地区和 priority 必须显式提供；不猜测旧数组的业务维度。文本 NFKC + Unicode 空白折叠、1..8000 字符，保留大小写与型号后缀；NFKC 会规范全角标点。语言保存 lowercase，地区保存两位 uppercase ASCII（语法检查，不宣称 ISO 注册验证）。

规范文本 generated UTF8 SHA-256 与五维 UNIQUE 保证语义身份，含停用行。QueryTopic/User RESTRICT FK 分别接入现有删除预检；deletion blocker 新增 GEO_PROMPT_VARIANT，User 沿用 USER_BUSINESS_HISTORY。旧列表三个引用摘要计数字段保持原合同。

内部 first_referenced_at 是不可逆历史锁存，不是回答级 Run。首次标记要求活动且语义未变；历史后禁止语义修改、删除、清除/改写标记和重新启用，允许停用。id/topic/creator/created_at 不可变，有效配置/锁存/启停变更 revision 恰好 +1，no-op 保持 revision 与 updated_at；updated_at 单调不减。数据库最终防线使用命名 SQLSTATE 23514；精确未来 HTTP 映射义务见 contracts/database.md，未知异常不能吞掉。尚无变体 Application Service/Router，所以错误码冻结不等于新 HTTP 操作已实现。

未来消费者必须按 User→QueryTopic→PromptVariant 锁序，在真实 Run FK（RESTRICT）、输入快照、锁存/revision/updated_at 与成功审计同一事务中提交；失败回滚锁存。GEO-201 不伪造未来消费者。唯一键仲裁创建冲突，行锁/触发器仲裁引用与编辑交错。

## 迁移与安全

0045_geo_prompt_variants 紧跟 0044_geo_catalog；只增一张表及规范化/hash/守卫函数，不改旧表、不回填、不迁移旧 variants。PostgreSQL 必须 UTF8。降级主动 55000 失败，事务 DDL 保留 revision/数据，恢复依赖前向修复或迁移前备份。只在本任务隔离 PostgreSQL 16 前滚，不代表生产已迁移。

没有外部 AI/采集、DNS、HTTP、Redis 业务消息或凭据行为变化。公司内部单租户模型不变；创建者追溯只接受权威服务端身份，客户端不能提交 creator/hash/revision/引用标记。没有新增权限/CSRF/SSRF/TLS 入口、日志或审计 payload；不保存问题正文到日志。

前端仅同步 generated OpenAPI 类型、删除 blocker 白名单和文案；没有 GEO-202 路由、query key、URL 状态或页面流程。

## 实际验证与环境

Colima 初始停止且 Docker socket 不可用；启动本机 Colima 后，在专用 compose project partsignal-geo201-validation 中运行 PostgreSQL16、Redis7.4和既有fake-oss。端口127.0.0.1:55441，专用geo201-postgres volume，fake凭据；未读取生产.env或使用真实AI。Compose 覆盖只替换验证环境，不修改 Makefile 和标准 pytest 集合。所有原始命令/输出见 evidence/checks.json 和对应日志。

- 修改前 unit：183 passed；当前 QueryTopic/Catalog/迁移基线：8 passed、2条既有 SQLAlchemy metadata warnings。
- 定向 PromptVariant：27 passed，包含 13 unit +14 PostgreSQL tests；两条 metadata introspection warnings（既有循环依赖、dialect_options），比较结果无漂移。
- contract-check、lint、typecheck 已通过；unit 后端980 passed、前端926 passed/97 files。
- 首次新 Alembic 前滚发现 textsend/convert_to 为 STABLE，生成表达式不允许；固定UTF8的immutable hash函数修正。第二次发现 PL/pgSQL CASE 表达式需括号，修正后前滚成功。事务 DDL 整体回滚，失败不留下部分表或错误revision。语法失败日志保留。
- 首次定向测试3个失败均是测试代码：NFKC全角问号预期、错误Transaction.rollback API、Application Service keyword-only调用。修正测试后27 passed，没有放宽实现合同。
- 首次make lint只有新导入排序失败；修正排序后后端与前端均通过。
- 完整make test-integration：481 passed、4 warnings，314.86s；四条为Catalog及新表metadata比较的既有循环依赖/dialect_options提示，均无schema漂移。独立只读复核已结束，未确认阻断问题。

未执行 make e2e / make verify /浏览器矩阵、生产前滚或真实 Run/AI 集成：没有新用户流程、前端页面或外部集成；不声称这些门禁通过。不使用downgrade作为恢复手段；测试实际执行降级命令，验证它显式拒绝且保留head。

## 范围与后续

修改路径清单见 evidence/changed-files.json。GEO-102 的 Catalog migration fixture 显式固定0044，以继续验证其原迁移边界；新0045测试负责当前head及旧行保持，通用fresh迁移测试head更新0045。所有无关工作树文件保留。GEO-202（CRUD/API/UI）及GEO-301/303（真实引用/快照接入）仍未实施；其他task状态不改。

## 最终补测、复核与覆盖边界

- Reviewer 指出时间倒退/no-op改时刻两分支未直接实测，主代理增加真实SQL反例后，最终定向为28 passed（13 unit +15 integration），2条metadata warnings。仅测试变化，生产代码/合同未变；相关文件ruff check/format检查通过，不重复已通过的全量门禁。完整集成481和最终定向28分别记录原始日志，不混算。
- 独立critical_reviewer源码审查覆盖规范化/唯一/历史/revision/迁移/删除预检及增量前端适配，没有确认行动项。Reviewer另报告只读Python3.12.13/Unicode15.0.0与PostgreSQL16.15/UTF8对5,935个字符比对，差异0；这是复核者会话证据，主代理没有冒充重跑该命令。
- 未实测并发重复创建、反向编辑/引用和删除/创建交错。当前唯一约束、行锁、RESTRICT FK及触发器提供可信基础约束；实际引用先持锁/编辑等待方向已实测。未来API/Run写入者出现时，需在真实事务边界新增相应交错验证。
- 未实现真实Run，所以历史测试证明不可逆锁存边界，不声称真实运行端到端已实现。未来消费者同事务写入义务保留。地区只作格式验证；旧数组维度未知，不导入、不猜测。
- 首次委派前计划/派发门禁通过；fresh只读critical_reviewer实际完成，验收为通过审查交付标准。审计bundle已关闭、离线校验通过，无未知写入、未执行ready task或残留活跃Worker。audit_id：20261002T121348Z-geo-201-bfd9ad06；digest副本见evidence。
- 任务状态为review，GEO-202仍planned，GEO-003/GEO-101仍done，其他manifest状态保持初始值。证据包含基线、精确命令及exit code、失败原因、增量diff/指纹、独立复核与环境清理。

环境清理：专用Compose三个容器、network与geo201-postgres volume均已删除；docker ps确认没有其他运行容器后，Colima停止成功，恢复起始停止状态。清理日志见evidence/cleanup-compose.log、cleanup-colima.log。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-201 的实现与测试证据。”据此仅将 manifest 的 GEO-201 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief 当前状态同步更新。

以上实施章节和原始 evidence 保留人工验收前的历史状态、实际测试结果及已知限制，不将未运行检查改写为通过。本次只记录 GEO-201 验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾运行 git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
