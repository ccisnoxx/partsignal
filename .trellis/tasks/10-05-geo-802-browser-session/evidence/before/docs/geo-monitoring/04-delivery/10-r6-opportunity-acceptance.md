# R6 / GEO-707 机会闭环验收

日期：2026-10-04。GEO-706 已 done、Trellis completed 且经人工接受。GEO-707 按 manifest 状态交付，本报告不代表生产上线或人工验收已完成。

## 纵向行为与证据

- 五个 CORE / UNBRANDED / OWN_PRODUCT PRIMARY 合格基线 Run，通过真实确定性分析与机会规则得到 natural_visibility=0/5、TOPIC_COVERAGE_GAP。
- 认领后，既有内容领域服务创建关联产品、主题及批准事实的 ContentTask；内容发布完成后机会保持 IN_PROGRESS。
- 严格 RETEST 完整复制原五个 cell、输入和规则，冻结首次 trigger、baseline 及真实分析/复核身份；前后实际产品/模型/版本相同。
- 五个复测有效样本提及产品，比较为 5/5、RECOVERED，仍声明 NOT_ESTABLISHED，不自动解决。只有用户显式提交最新 revision、选择批次、fingerprint 与非空原因后 RESOLVED。
- 原机会来源、批准事实、原始回答和冻结基线保留；处理历史追加且不可变。

## 审计补齐

首次真正 CREATED 记录 geo_opportunity.opened，与机会/来源/evaluation 同事务；重放、并发竞争输家及 UPDATED 不重复。审计异常使全部写入 rollback。认领、内容转化、复测及显式解决分别保留 acknowledged/action_linked/geo.retest.created/resolved。

审计只保存 ID、revision、状态及数量等最小安全事实，处理原因与回答/事实/内容正文不进入审计。前端同步登记创建/复测动作与四个复测 facts；未登记字段仍显式失败。真实栈最终截图只展示安全审计，无 trace/video。

## 验证结果

GEO-707 实现及本地验收证据已收敛，manifest/Trellis 为 **review**，等待人工接受。原始失败保留，不把完整命令退出2改称通过；精确argv、退出码、耗时和完整日志见 [实施证据](../../../.trellis/tasks/10-04-geo-707-r6-acceptance/implement.md) 及任务 evidence。

| 检查 | 实际结果 |
| --- | --- |
| `git diff --check`、`make lint`、`make typecheck`、`make contract-check` | 退出0；最后E2E测试断言修改另做前端lint/typecheck退出0 |
| `make test-unit` / 实际执行的 `npm --prefix frontend run test` | 后端3658、前端1266通过 |
| `make test-integration` | 首轮1123通过/2处旧审计断言失败；包含opened后，完整verify内同一目标1125通过 |
| 定向PG / frontend审计model | 真规则纵向、rollback、702幂等/并发/更新13通过；工作台7通过；审计model23通过 |
| `make e2e` | 首轮29通过/2处旧读取取消断言失败；精确路径修正后verify内真实栈31通过，包含707闭环；GEO enabled/API-disabled/monitoring-disabled三阶段各1通过/1条件跳过 |
| 页面fixture | 完整verify内497通过/72条件跳过/1焦点时序失败；trace确认跨断点布局替换编辑器，测试先等待对应布局后定向两个项目2通过 |
| `make verify` | 完整命令退出2，耗时2060.717秒，停止于上述fixture失败；成功目标证据复用、焦点修正定向通过后，剩余门禁续跑退出0、耗时57.356秒 |
| 十万Run性能 / build | 完整verify内通过；五场景P95为0.150/0.257/0.256/2.883/1.539秒，两镜像构建通过；707未改查询实现 |
| 部署脚本、E2E生命周期、secret-artifact、开发/生产Compose配置 | verify剩余门禁续跑全部通过；仅本地自检，没有部署生产 |
| 审计脱敏和E2E产物 | 五段审计无正文/原因/凭据；各浏览器阶段secret_scan=0，最后定向clean；失败诊断日志临时下载签名已遮蔽 |

续跑显式复用 `contract-check/lint/typecheck/test-unit/test-integration/test-geo-performance/build/build-frontend/e2e`，实际命令保存在 `evidence/verify-remaining.json`。没有在最后测试断言修正后再次从头执行完整make e2e或无跳过make verify；未变的成功检查复用，受影响用例定向验证。页面fixture的72项按真实栈/运行模式条件跳过，真实栈与GEO模式另行运行，不作为未执行检查通过。

独立只读critical_reviewer未发现已确认缺陷，范围为永久审计写入和PG候选，未复核最终浏览器或全部门禁。异常用例注入append_audit入口，未单独注入实际INSERT/commit失败。validated子代理Digest为3计划/3验收/1独立复核，无活跃Worker或未知写入；audit-finalize与audit-verify通过。

## 覆盖边界和限制

Playwright 使用独占本地随机 PostgreSQL、Redis DB14、真实 API/分析 Worker、本地上传服务与虚构人工回答，不使用真实 AI 平台。已有页面操作通过 UI；当前无创建页面的 ContentTask 行动与 RETEST 通过公共 API 编排。本次没有新增这两种页面，也不宣称创建工作流全部可从页面发起。

机会评估沿用702内部应用服务，测试seed验证独占库归属与虚构输入后显式调用。707没有新增评估HTTP入口、生产自动评估调度或启用生产能力。

全局审计筛选对其他前序 GEO 未登记动作仍按既有安全策略隐藏并提示；707 验证五段动作列表、当前动作及详情的安全投影，未补齐所有历史动作消费者。

无 OpenAPI wire shape 或新 Alembic revision；当前 head 0062，空测试库前滚由真实PG夹具验证。无历史回填、生产迁移/上线、Browser Adapter、生产保留、新规则或 GEO-901/902。R6 门禁实际状态必须与实施记录和 manifest 一致；后续任务由各自依赖及人工接受规则决定。

永久审计写入后的恢复需保留后端动作白名单与前端消费登记；可以停止新评估写入，不能为了回退清除历史或移除其读取登记。
