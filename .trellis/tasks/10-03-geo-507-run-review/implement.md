# GEO-507 实施与验证证据

## 交付状态

仅实施GEO-507。启动时GEO-506已done且有人工接受，507 planned→in_progress；本地验证与独立复核完成后仅交付review，不能自行done。当前分支geo/GEO-507；不提交、不推送、不创建PR、不发布、不迁移生产数据库。

## 实现与合同

POST /api/v1/geo/observation-runs/{run_id}/review接入ADMIN/ENGINEER、session/CSRF，闭合请求复用501的四栏修正与decision规则。Review时间和reviewer由服务端生成；Service锁后校验current成功analysis、expected_run_revision和修正归属。新增Review、Run revision、首NEEDS_REVIEW完成、Batch刷新与受控成功审计同一事务。

Run详情在原RR快照中返回所有机器revision/四类结果、Review历史、current selection和effective_results。latest Review整体替换旧修正，CONFIRMED恢复机器；人工claim结论不复用机器confidence。旧分析和旧Review保留；new pointer使旧Review仅作历史。current gate未放行时metric_eligible=false/GEO_REVIEW_REQUIRED，通过时仍null/完整资格尚未实现。列表needs_review与详情使用相同current原因及Review存在性。

0056_geo_run_review下接0055，只替换Run guard，不加表/列、不回填历史、不改旧迁移。终态只在同事务新建本Run/current analysis Review时可revision+1；NEEDS_REVIEW首次完成额外只改status/finished_at，不能夹带采集字段。旧Review不能授权新的终态更新。非空0055历史前滚行JSON完全相等，空库到head及ORM比较由现有迁移检查覆盖；降级55000安全停止，关闭写入口并前向修复。

写命令RC锁序User(NO KEY UPDATE)→Batch→Run→Analysis，复用最新active/改密/角色检查与舍弃鉴权heartbeat规则。旧analysis优先409 GEO_REVIEW_STALE_ANALYSIS，旧revision409 REVISION_CONFLICT，无成功analysis409 GEO_ANALYSIS_NOT_AVAILABLE；非法生命周期409 INVALID_STATE_TRANSITION；四栏schema/归属或无事实可判定claim为422 VALIDATION_ERROR。精确23514/constraint映射已登记错误，其余保持失败并回滚，不吞未知错误。无Idempotency-Key；重复旧revision409，不自动重放。

没有外部AI/网络采集或新凭据；内部单租户既有身份。审计只run/analysis/review ID和decision，不记录comment、correction、原答案或事实全文。原始Answer/Citation、机器子结果和旧Review均未更新。

前端只重生成OpenAPI类型、补受影响fixture；无新路由、query key、URL状态或页面交互。GEO-508页面与GEO-601完整指标/汇总、Opportunity、Browser均未实施。

## 验证过程及当前结果

基线unit通过，选定分析/Worker/并发/读取PG43项通过。所有精确argv、退出码和完整输出保存在evidence各同名json/log。

新权限/并发/旧review supersede/correction schema、不可变、scope、读RR、固定查询与非空前滚26项PG通过；独立复核的workflow反例修复后相关34项PG通过。完整unit后端3341、前端1141通过；contract-check、lint/typecheck和diff-check通过。最终候选完整integration为972 passed、25 warnings，退出0（466.27秒）；23/25条计数差异来自纳入新增迁移metadata检查，既有SQLAlchemy循环外键排序/dialect_options警告保留，未作为通过证明。

初次失败均保留：0056 CASE条件缺括号导致迁移语法失败；审计review字段未登记；fixture未bind强事实引用、混用前滚与head夹具、虚构产品当前别名丢失；查询SQLAlchemy共同基类类型推断；新API影响冻结operation/response计数；前端fixture遗漏selection.run_id。分别修正后定向或相应门禁通过，没有放宽业务/安全合同。

完整integration首轮两个失败已定位旧测试的head/downgrade期望仍0055；只更新升到head的期望为0056，固定测试0055迁移自身的检查保持0055；两项定向复验通过；首轮完整输出确认2 failed、969 passed，准确失败原因为0055 head/downgrade冻结期望，修正后的最终完整复验972项全部通过，退出0。

独立只读critical_reviewer发现：历史Run NEEDS_REVIEW而新成功analysis不再有review原因时，旧workflow仍要求复核。新增真实重分析反例先红（REVIEW_REQUIRED vs COMPLETED）后绿；读取只在当前gate已放行且有pointer时投影COMPLETED/VIEW_OBSERVATION，持久Run状态不改。独立复核已结束，最终未发现剩余阻断项；记录见evidence/independent-review.md。审计Bundle 20261003T211849Z-geo-507-79848a92 已finalize并verify，Digest JSON/Markdown在evidence保存，不把运行时completed等同验收通过。

## 边界与限制

尚未运行浏览器/UI E2E：507只交付API与读模型，实际权限/CSRF/revision/current选择由真实HTTP session+PG测试覆盖；页面由508实施。未运行真实外部provider、生产迁移、发布或破坏性downgrade；都是明确范围外。金标R4整体页面验收与业务MetricEligibility留后续任务。

历史0054分析若无0055引用分类，不猜测补值，只返回实际集合与citation_classification_complete=false。完整指标资格仍null，不能据review_gate_passed=true推断全指标资格。

## 任务内变更与保留证据

起始dirty/untracked的哈希在evidence/baseline-files.json；相关前像在evidence/before。遗漏备份的前端fixture由精确逆补丁恢复，SHA256与起始哈希一致后才作为前像。task-only.diff相对这些前像生成；scope-candidate.json已证实无删除、仅任务内路径变化。任务内37个源码/合同/测试/文档文件见evidence/changed-files.md；文档包全部SHA256校验通过，仅重算6个本任务改动项。manifest与Trellis task均为review，未修改其他任务、不自行done。

## 最终逐项命令

| 命令 | 最终结果 | 原始证据 |
|---|---|---|
| git diff --check | 退出0 | evidence/diff-final.json/log |
| make contract-check | 退出0，221个operation与generated严格一致 | evidence/contract-check.json/log |
| make lint | 退出0，后端ruff/前端eslint | evidence/current-static.json/log |
| make typecheck | 退出0，177个后端源码与前端tsc | evidence/current-static.json/log |
| make test-unit | 退出0，后端3341/前端1141 | evidence/candidate-unit.json/log |
| make test-integration COMPOSE='docker compose -p partsignal-geo507-validation -f .trellis/tasks/10-03-geo-507-run-review/evidence/validation-compose.yaml' | 退出0，972项通过 | evidence/integration-final.json/log |

完整集成首轮2 failed/969 passed和初次静态/Schema/fixture失败均保留；后续修复没有放宽权限、不可变、CSRF、审计或事实校验。无未运行的最低要求命令。定向权限/并发/supersede/correction schema、读一致性、前滚和回滚命令完整argv见validation-summary.json，未把收集或运行中状态计为通过。

独立复核覆盖限制：没有专门编排鉴权后等待User锁期间停用/改密的交错；锁后populate_existing重验已由独立源码复核，实际HTTP停用/改密失败测试通过。无确认缺陷，不以此虚构更多测试需求。

最终收尾：git diff --check再次退出0；scope-final.json确认37个预期路径、无额外修改/删除，其他API和0054/0055源码不变。隔离Compose服务已down --remove-orphans（退出0），不影响其他项目服务，保留任务数据卷以便复现；无仍在运行的本任务测试或子代理。

### 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-507 的实现与测试证据。”据此将 manifest 的 GEO-507 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，记录完成日期、接受范围和依据，并同步 Task Brief 当前状态。

以上实施记录、review_note 和 evidence 中的 review 状态保留为提交人工验收时的历史记录；既有测试结果、独立复核范围和验证限制不作改写。本次只记录 GEO-507 验收，不修改其他任务状态、不实施后续任务、不提交或归档；SHA256SUMS 仅同步 manifest 条目。收尾运行 git diff --check，实际结果在本次最终回复报告。
