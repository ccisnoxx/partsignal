# Task Brief：GEO 浏览器延期与人工优先核心版范围调整

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID | geo-browser-scope-adjustment（治理任务，不新增 GEO 编号） |
| 发布增量 | 核心 R8；R7 剩余任务 post-core |
| 状态 | review；文档/治理本地验证完成，等待人工验收 |
| 负责人 | 当前主代理实施；后续 Browser 业务负责人待指定 |
| 分支 | geo/GEO-804，沿用进入任务时已有分支 |
| 依赖 | GEO-801/802/803 done；本任务不执行 R8 业务任务 |
| PR/Commit | 无；未授权提交、推送或上线 |

## 2. 目标

落实用户已明确接受的产品决策：MANUAL 回答级观测成为核心版正式采集方式，Browser 自动采集延期，R6 直接进入 R8；保留目标设计和已完成基础设施。

## 3. 关联需求

CAP-GEO-05/06/10/14/16；GEO-804～807 的延期治理；GEO-901/903/904/906 的条件性验收。

## 4. 必读文档

根 AGENTS、Trellis workflow/spec、GEO README、核心 PRD、业务架构/状态机、技术架构、路线图、WBS、manifest、ADR-005，以及 GEO-801～804 的任务记录。805～807 尚无 Trellis 实施任务。补充阅读部署/质量/愿景/追踪矩阵/执行提示词及当前 MANUAL Schema、服务、表单、指标资格、Browser 开关和 Compose。

## 5. 当前行为

801/802/803 已接受 done，分别交付隔离骨架、加密会话、完全本地模拟合同。804 因平台批准范围和 staging smoke 授权/入口缺失而 blocked，没有真实 Adapter。805～807 planned、没有实施记录。R8 DAG 不直接依赖 R7，但路线图、PRD 首发和会话恢复形成隐式要求。现有 MANUAL 使用冻结环境、单截图引用和可选文本证据；没有独立 URL 缺失原因字段。

## 6. 目标行为

新增 Accepted ADR-006，明确覆盖 ADR-005 的旧完整首发条件，保留其安全门禁。804～807 deferred/post-core，记录原因、恢复条件、责任说明。901/903 的 Browser 项可条件性 N/A；904/906 必须验证 Browser 关闭且生产无会话。SOP 只描述真实可用录入流程。

## 7. 范围内

- 决策、产品/业务/技术文档、发布路径、任务状态与提示词一致性。
- 人工观测 SOP、内部链接、摘要、YAML/状态/DAG/默认关闭验证。
- 804 当前状态转延期，保留原始阻断/基线证据。

## 8. 范围外

不实现真实或模拟豆包/DeepSeek/元宝 Adapter；不改源代码、运行配置、合同、迁移、MANUAL/API 行为、公式或历史；不执行生产/R8 验收，不访问第三方账号/Cookie/网络；不删除 801～803。

## 9. 业务不变量

PostgreSQL 状态权威、服务端资格/状态机/公式、不可变回答及追加复核不变。模式/环境不混合；未知版本不猜测；冻结证据不能补写。deferred 表示产品延期，不表示完成，也不自动恢复执行或授权。

## 10. 契约变化

OpenAPI/database/Alembic 无变化、无前滚/回填。仅交付治理 manifest 状态枚举增加 deferred，不是业务状态枚举。

## 11. 后端实现

无。事务、锁序、lease、revision、幂等、并发、错误映射保持现状。

## 12. 前端实现

无路由、query key、URL、页面或 generated 类型变更。SOP 明确实际表单与冻结上下文、单截图限制。

## 13. 测试计划

YAML 解析、状态合法、ID/依赖有效、无循环、R8 不可达 deferred、801～803 完整条目保持；Trellis validate/list 接受 deferred；Markdown 内部路径/锚点检查及基线差异；文档摘要；源码/配置保持；git diff --check。配置未修改，不要求重复 Settings/Compose 行为测试。先保存文档与源码起点证据。

## 14. 验收标准

用户要求的四个延期任务、四项 R8 条件、R6→R8、正式 MANUAL 与 SOP 全部一致；所有本轮链接有效；无伪造负责人、审批人、时间或完成记录。

## 15. 验证命令

本任务 evidence/validate.py（项目已有 PyYAML）；python3 .trellis/scripts/task.py validate；task.py list --status deferred --json；shasum -a 256 -c SHA256SUMS；git diff --check；实际命令和结果写 implement.md。

## 16. 数据和上线

不部署、不读生产数据库。核心上线由 GEO-906 后续实测 Browser false、profile 服务未启用、无生产会话/密钥挂载。未部署 R7 的恢复 N/A 必须有部署清单和会话检查依据，不能免除现存材料的保护和清理。

## 17. 风险与开放问题

历史提示词/ADR 仍可能保留旧首发门禁；用 ADR-006 替代关系和当前提示词修订消解。URL 不可见时保存截图/原因，不伪造 URL，不把部分引用当完整样本；无法满足当前结构合同时保留草稿补证，不改变指标资格。

## 18. 完成证据

本任务 implement.md/evidence；原804记录追加延期决策。本地完成只进入 review，不自行 done；ADR 接受依据是本会话用户明确产品决策。

## 19. 后续任务

901～906 按原 DAG 执行；804～807 满足产品重新排期、责任/平台合规、受控 staging 人工授权等条件后逐项恢复，本任务不实施。
