# GEO-1005 实施与验证

## 边界审计与实现

- Schema 保留 MANUAL_ONLY/CRON、有效五字段表达式、IANA 时区和完整配置约束，以读取现存 Plan 和不可变快照。数据库 status 不新增、不回填。
- Plan policy 统一版本守卫：409 GEO_PLAN_CRON_UNSUPPORTED，明确 V1.0 不支持。新建 CRON、MANUAL 改 CRON、全部历史 CRON 写命令和首次 run/PLAN Batch 拒绝；鉴权、CSRF、锁序、CAS、rollback 继续由既有 owner 维护。
- 历史 CRON 保留 status/config/revision/关系与快照，详情/列表 UNSUPPORTED_SCHEDULE / VIEW_HISTORY、空动作、SCHEDULE_UNSUPPORTED 删除阻断和明确 run reason；原 ACTIVE 是历史元数据，不作运行承诺。
- 从当前 Plan 配置首次创建批次在 freeze_current_rules、引用锁存和业务 INSERT 之前拒绝 CRON，内部 scheduled 首次窗口也被拒绝。已有幂等/同窗口回执只读重放，不重新投递。Beat/Worker 到期任务未改、未接线。
- 前端向导只允许 MANUAL_ONLY；详情/列表/直接 edit URL 显示历史只读。运行中心创建器向服务端仅查询 MANUAL_ONLY，并消费不支持调度的服务端投影禁选旧缓存项。
- OpenAPI、数据库合同、PRD、Runbook、能力矩阵、ADR 产品澄清及必要现行说明更新；旧 GEO-1001/906 审计和生产未知不改写。历史治理采用只读清点/披露，按本次明确指示不原地停用。

独立复核核对 geo_retests.create_retest 与冻结基线合同后，收窄了原文“禁止首次建批”的笼统表述。现有 Retest 是人工调用的独立 Batch 命令：从已提交、不可变的基线 Batch 复制严格矩阵，创建 trigger_type=RETEST 的批次。原 plan_id 和 CRON 快照仅作来源追溯，不读取或执行当前 CRON Plan、不改写原计划或快照，不伪装成 SCHEDULED；既有可比性、权限及外发门禁继续裁决。未修改 Retest 实现或扩大禁用范围。

## 已取得验证

- 后端定向单元：test_geo_plan_management.py、test_geo_monitoring_plan_contract.py、test_geo_batch_creation_contract.py，共 111 项通过。原 schema 表达式/组合合同、MANUAL 转换、CRON 全状态只读投影覆盖。
- 真实 PostgreSQL 16/API：test_geo_cron_boundary.py、test_geo_plan_api.py、test_geo_plan_reads.py、test_geo_batch_creation.py，共 30 个独立用例。首轮 20 pass、10 fail（新测试准备错误），修正后 11 项定向重验全部通过（包含首轮已经通过且 fixture 受影响的 MANUAL 正例）；其余成功结果复用。覆盖两种身份创建、全状态历史修改/复制/删除/启用/恢复/首次 run 与 PLAN Batch、MANUAL→CRON、并发首次窗口、历史同窗口并发重放、MANUAL create/activate/run 和 AD_HOC。
- 拒绝路径对 Plan/关系/Prompt/Surface/Profile/规则当前及 revision/Batch/Run/幂等记录/批次主体/审计全表摘要比对无变更，并拦截 Redis execute_command 与 dispatch_created_batch；MANUAL 人工采集正例也拦截 Redis。
- 后端受影响源码 Ruff、5 个文件 mypy 通过；FastAPI runtime/OpenAPI contract-check 通过。前端全项目 typecheck、Plan 所属文件 ESLint、api:generate/api:check 通过。最终 Retest 边界文案收口后再次通过 API 生成一致性、runtime contract、运行中心 5 项和所属 ESLint；没有行为代码变化，复用其余成功验证。
- Plan 领域组件/模型/向导/API 测试 89 项、5 文件全通过且无 skip；新历史 CRON 回归在修改前实现上确认失败。运行中心组件测试 5 项通过，受影响两个文件 ESLint 通过；mock 参数断言改为结构匹配以适配 openapi-fetch 重载类型。
- 真实栈 plans-real-stack.spec.ts / foundation-desktop：1 项通过；包括八步 MANUAL 创建、启停恢复、配置修订、复制、归档删除、URL/刷新持久化与 CRON 不可选。production frontend build 同轮通过；秘密扫描 clean；Redis DB13、端口、随机测试库和临时文件清理成功。
- 文档 SHA-256 清单同步并通过校验；任务 context validate 通过。

## 失败与覆盖界限

- 首轮 PG 摘要误用了不存在的 geo_rule_sets；已改为真实 geo_rule_set_revisions/geo_rule_set_current。历史 batch INSERT 后须重新读取 HAS_BATCH_HISTORY 投影，fixture 已修正。原失败日志保留。
- 首轮前端类型检查/E2E build 被新增测试断言类型阻断（spy 参数 never 与 Testing Library exact/toBeFocused）；已修正，真实栈 build 与行为检查重新通过。失败与清理日志保留。
- 全树 git diff --check 有既存 GEO-1001 审计文件尾空格（未修改该文件）；本任务 patch 单独检查。未运行全仓 make verify、完整浏览器矩阵或完整 backup/restore 套件；GEO-1009/1010 的同候选完整门禁及生产现场验证仍独立需要。
- recovery fixture 调整为测试专用历史 INSERT，使用完整人工冻结输入和真实数据库守卫，不旁路生产版本 policy；相同 helper 已由定向历史 batch/replay 测试验证，恢复实现未变。
- 无生产操作、数据库迁移、提交、推送、发布或到期任务接线。MANUAL_ONLY 是当前协议对产品 MANUAL 的表达。

## 收尾

已置 Trellis task 与 manifest GEO-1005 为 review；等待人工接受，不自行 done、归档或提交。fresh critical_reviewer 独立只读复核未确认阻断发现，详见 [复核记录](evidence/independent-review.md)。

审计 Bundle `20261006T043057Z-geo-1005-a8585a73` 已关闭并 audit-verify 通过：2 个计划校验通过、2 次执行验收通过、1 次独立复核、0 异常、0 残留活跃 Worker。[SUBAGENT_EXECUTION_DIGEST](evidence/SUBAGENT_EXECUTION_DIGEST.md) 为工具直接渲染；配置快照不冒充运行时独立回报。

保留的明确覆盖限制：历史 CRON 浏览器布局/焦点未做真实栈验收（组件覆盖详情/直接 edit）；已有手工回执关联历史 CRON 与 CRON 来源基线人工 RETEST 未新增 PG 专项（调用链/不可变合同只读核对）。完整 backup/restore、全仓 make verify、浏览器矩阵与生产清点/同候选现场证据未执行。GEO-1009/1010 门禁独立需要，发布 NO-GO 保留。

[验证清单](evidence/validation-results.json) 与原始失败/修正日志均保留。`review-source-hashes.json` 是初始派发候选，`review-final-source-hashes.json` 是已复核增量和治理状态后的最终候选；两者不混用。任务开始前的无关工作树修改保留；本任务 39 个源码/合同/文档文件的 before/after patch 单独检查无 whitespace 问题，完整树既有 GEO-1001 审计尾空格未改。
