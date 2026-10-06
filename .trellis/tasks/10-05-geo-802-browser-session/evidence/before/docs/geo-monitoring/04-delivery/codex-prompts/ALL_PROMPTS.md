# PartSignal GEO 全部后续任务 Codex 提示词（GEO-003～GEO-906）

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 任务来源 | `docs/geo-monitoring/04-delivery/task-manifest.yaml` V1.0 |
| 已完成前提 | GEO-001、GEO-002 |
| 后续任务数量 | 69 |
| 使用方式 | 一次复制一个任务提示词给 Codex；一个任务一个分支/PR |

## 重要规则

1. 不要把本文件整份粘贴给 Codex；每次只复制一个 `GEO-NNN` 区块。
2. 只有依赖任务在当前仓库 `task-manifest.yaml` 中均为 `done`，才执行该任务。
3. Codex 完成后把任务置为 `review`；由你人工验收后再使用收尾提示词改为 `done`。
4. 若你的当前仓库文档、任务依赖或 ADR 已在 GEO-001/GEO-002 中修订，以仓库当前版本为准。
5. 真实平台、staging、恢复演练和生产上线任务必须保留人工授权门禁，Codex 不得伪造执行结果。

## 任务索引

| ID | 阶段 | 标题 | 依赖 |
|---|---|---|---|
| [GEO-003](#geo-003) | R0 | 冻结当前 GEO 实现与契约基线 | GEO-001, GEO-002 |
| [GEO-004](#geo-004) | R0 | 增加 GEO 渐进启用配置和安全默认值 | GEO-003 |
| [GEO-005](#geo-005) | R0 | 建立 GEO 测试夹具和金标目录 | GEO-003 |
| [GEO-101](#geo-101) | R1 | 定义 GEO Catalog 公共契约与数据库合同 | GEO-003, GEO-002 |
| [GEO-102](#geo-102) | R1 | 实现 GEO Catalog ORM 与 Alembic | GEO-101 |
| [GEO-103](#geo-103) | R1 | 实现 GEO Catalog Schema 与领域策略 | GEO-101, GEO-102 |
| [GEO-104](#geo-104) | R1 | 实现 GEO Catalog 应用服务和 API | GEO-103 |
| [GEO-105](#geo-105) | R1 | 实现监测对象、竞品、别名和域名管理页面 | GEO-104 |
| [GEO-106](#geo-106) | R1 | 完成 Catalog 纵向验收和产品引导 | GEO-105 |
| [GEO-201](#geo-201) | R1 | 定义并实现 PromptVariant 契约与数据模型 | GEO-003, GEO-101 |
| [GEO-202](#geo-202) | R1 | 实现问题变体服务、API 和前端工作区 | GEO-201 |
| [GEO-203](#geo-203) | R1 | 定义并实现 EngineSurface 与 CollectionProfile 数据契约 | GEO-004, GEO-101 |
| [GEO-204](#geo-204) | R1 | 建立 Collector Registry 和 Profile 资格策略 | GEO-203 |
| [GEO-205](#geo-205) | R1 | 实现观测面/Profile 管理 API 和页面 | GEO-204 |
| [GEO-206](#geo-206) | R1 | 定义并实现 MonitoringPlan 数据契约 | GEO-202, GEO-205 |
| [GEO-207](#geo-207) | R1 | 实现服务端运行矩阵预览和费用覆盖 | GEO-206, GEO-204 |
| [GEO-208](#geo-208) | R1 | 实现 Plan 命令、查询、状态机和 API | GEO-207 |
| [GEO-209](#geo-209) | R1 | 实现监测计划列表和向导 | GEO-208 |
| [GEO-301](#geo-301) | R2 | 定义 Batch/Run 公共契约与数据库模型 | GEO-208, GEO-002 |
| [GEO-302](#geo-302) | R2 | 实现 Batch/Run 状态策略与动作投影 | GEO-301 |
| [GEO-303](#geo-303) | R2 | 实现批次工厂、计划快照和创建幂等 | GEO-302, GEO-207 |
| [GEO-304](#geo-304) | R2 | 定义并实现 AnswerSnapshot、Citation 与证据关联 | GEO-301 |
| [GEO-305](#geo-305) | R2 | 实现 MANUAL 草稿和正式提交 | GEO-303, GEO-304 |
| [GEO-306](#geo-306) | R2 | 实现 Batch/Run 列表与详情读模型 | GEO-303, GEO-305 |
| [GEO-307](#geo-307) | R2 | 实现运行中心、人工录入和详情页面 | GEO-306 |
| [GEO-308](#geo-308) | R2 | 完成 R2 并发、不可变和兼容性验收 | GEO-307 |
| [GEO-401](#geo-401) | R3 | 定义 GeoCollector 协议和稳定错误模型 | GEO-204, GEO-301 |
| [GEO-402](#geo-402) | R3 | 实现 GEO fake provider 和 Collector 合同套件 | GEO-401, GEO-005 |
| [GEO-403](#geo-403) | R3 | 实现 API Profile 连接测试和能力验证 | GEO-402, GEO-205 |
| [GEO-404](#geo-404) | R3 | 实现 OpenAI-compatible GEO Collector | GEO-401, GEO-403 |
| [GEO-405](#geo-405) | R3 | 实现采集 Worker、lease、dispatch 和补投递 | GEO-303, GEO-404, GEO-004 |
| [GEO-406](#geo-406) | R3 | 实现 external_call_state 与 at-most-once 恢复 | GEO-405 |
| [GEO-407](#geo-407) | R3 | 实现引用、usage、cost、预算和 profile rate limit | GEO-405, GEO-406 |
| [GEO-408](#geo-408) | R3 | 完成 API 自动观测 UI 和纵向验收 | GEO-407, GEO-307 |
| [GEO-501](#geo-501) | R4 | 定义 AnalysisRevision、Mention、Recommendation、Claim、Review 契约和表 | GEO-304, GEO-005 |
| [GEO-502](#geo-502) | R4 | 实现监测对象别名快照和确定性提及识别 | GEO-501, GEO-106 |
| [GEO-503](#geo-503) | R4 | 实现推荐分类和可靠位置识别 | GEO-501, GEO-502 |
| [GEO-504](#geo-504) | R4 | 实现引用归属和来源类别分析 | GEO-501, GEO-106, GEO-304 |
| [GEO-505](#geo-505) | R4 | 实现声明提取、事实版本装配和准确性评估 | GEO-501, GEO-502 |
| [GEO-506](#geo-506) | R4 | 实现 Analysis Worker 和 revision 生命周期 | GEO-502, GEO-503, GEO-504, GEO-505, GEO-405 |
| [GEO-507](#geo-507) | R4 | 实现人工复核策略、API 和当前结果选择 | GEO-506 |
| [GEO-508](#geo-508) | R4 | 实现分析/复核前端并完成 R4 金标验收 | GEO-507 |
| [GEO-601](#geo-601) | R5 | 实现 MetricEligibility、样本等级和公式库 | GEO-507 |
| [GEO-602](#geo-602) | R5 | 实现 GEO Overview 读模型和 API | GEO-601 |
| [GEO-603](#geo-603) | R5 | 实现趋势、竞品 SOV 和问题/平台覆盖 | GEO-601 |
| [GEO-604](#geo-604) | R5 | 实现引用、事实风险和数据质量洞察 | GEO-601, GEO-504, GEO-505 |
| [GEO-605](#geo-605) | R5 | 实现总览和分析洞察前端 | GEO-602, GEO-603, GEO-604 |
| [GEO-606](#geo-606) | R5 | 实现打印报告和安全 CSV 导出 | GEO-605 |
| [GEO-607](#geo-607) | R5 | 完成洞察性能、索引和 R5 验收 | GEO-606 |
| [GEO-701](#geo-701) | R6 | 定义 GEO 规则集契约和配置 | GEO-601 |
| [GEO-702](#geo-702) | R6 | 实现 Opportunity 数据模型、identity 和评估器 | GEO-701, GEO-603, GEO-604 |
| [GEO-703](#geo-703) | R6 | 实现 Opportunity API、读模型和工作台 | GEO-702 |
| [GEO-704](#geo-704) | R6 | 集成事实修订、内容任务和发布修复行动 | GEO-703 |
| [GEO-705](#geo-705) | R6 | 实现 RetestPlanner、基线冻结和可比性门禁 | GEO-704, GEO-303 |
| [GEO-706](#geo-706) | R6 | 实现干预前后比较和机会解决流程 | GEO-705, GEO-605 |
| [GEO-707](#geo-707) | R6 | 完成机会闭环 E2E、审计和 R6 验收 | GEO-706 |
| [GEO-801](#geo-801) | R7 | 建立独立 Browser Collector 服务骨架和 Compose profile | GEO-408, GEO-002 |
| [GEO-802](#geo-802) | R7 | 实现浏览器会话加密引用和撤销流程 | GEO-801 |
| [GEO-803](#geo-803) | R7 | 建设本地模拟 AI 产品和 Browser Adapter 合同套件 | GEO-801, GEO-402 |
| [GEO-804](#geo-804) | R7 | 实现第一个合规批准的真实界面 Adapter | GEO-802, GEO-803 |
| [GEO-805](#geo-805) | R7 | 实现浏览器证据捕获、敏感裁剪和对象存储提交 | GEO-804, GEO-304 |
| [GEO-806](#geo-806) | R7 | 实现 Browser Profile 健康、频率、kill switch 和管理 UI | GEO-805, GEO-205 |
| [GEO-807](#geo-807) | R7 | 执行真实平台小规模试点和人工交叉验收 | GEO-806 |
| [GEO-901](#geo-901) | R8 | 实现 GEO 数据保留、归档和清理任务 | GEO-707 |
| [GEO-902](#geo-902) | R8 | 完善运行、成本、失败和积压可观察性 | GEO-408, GEO-607, GEO-707 |
| [GEO-903](#geo-903) | R8 | 完成数据库、OSS、密钥和会话备份恢复演练 | GEO-901, GEO-902 |
| [GEO-904](#geo-904) | R8 | 执行 GEO 安全与合规专项复核 | GEO-903 |
| [GEO-905](#geo-905) | R8 | 完成大数据量性能和容量硬化 | GEO-607, GEO-902 |
| [GEO-906](#geo-906) | R8 | 执行生产渐进上线、最终验收和文档状态更新 | GEO-903, GEO-904, GEO-905 |

# R0

# GEO-003 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 冻结当前 GEO 实现与契约基线 |
| 阶段 | R0 |
| 依赖 | GEO-001, GEO-002 |
| 建议分支 | `geo/GEO-003` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-003
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-003：冻结当前 GEO 实现与契约基线**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-003`
发布阶段：`R0`
依赖任务：GEO-001、GEO-002

## 本任务目标

盘点现有 GeoObservation、GeoInsights、路由、表、E2E、查询和迁移，生成基线清单。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-003 当前允许进入执行，并逐项确认依赖任务 GEO-001、GEO-002 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-003 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/00-governance/01-document-governance.md`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `contracts`
   - `backend`
   - `frontend`
   - `tests`

必须交付：
- 盘点现有 GeoObservation、GeoInsights、路由、表、E2E、查询和迁移，生成基线清单。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-003 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-003，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 R1 及以后业务能力；不得改变当前 GEO 业务语义。
- 本任务是只读基线盘点；不得改变业务行为、公共契约、数据库 Schema 或页面交互。
- 必须明确区分现有文章关系级 GeoObservation 与未来回答级 Batch/Run 模型。
- 若 make verify 无法完成，必须保存精确阻断和已经完成的基线证据，不能写“应当通过”。

验收条件：
- 后续任务能明确区分现有文章关系观测和新回答级观测。

## 明确范围外

- 不实现任务清单中未写入 GEO-003 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-004, GEO-005, GEO-101, GEO-201。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：运行 make verify 或记录无法运行项；保存 schema/route/test 基线。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make verify`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-003 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-003 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-004 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 增加 GEO 渐进启用配置和安全默认值 |
| 阶段 | R0 |
| 依赖 | GEO-003 |
| 建议分支 | `geo/GEO-004` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-004
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-004：增加 GEO 渐进启用配置和安全默认值**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-004`
发布阶段：`R0`
依赖任务：GEO-003

## 本任务目标

增加 GEO_MONITORING/API/BROWSER/OPPORTUNITY 功能开关及配置校验，默认关闭新自动能力。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-004 当前允许进入执行，并逐项确认依赖任务 GEO-003 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-004 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/00-governance/01-document-governance.md`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/config.py`
   - `.env.example`
   - `.env.production.example`
   - `deploy`

必须交付：
- 增加 GEO_MONITORING/API/BROWSER/OPPORTUNITY 功能开关及配置校验，默认关闭新自动能力。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-004 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-004，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 R1 及以后业务能力；不得改变当前 GEO 业务语义。
- 所有新增自动能力默认关闭；Production 不得因缺省值被意外启用。
- API、Worker、Scheduler 必须读取同一组配置；关闭时不得创建外部调用副作用。
- 不得在本任务接入任何 Collector 或真实外部平台。

验收条件：
- API/Worker/Scheduler 读取一致配置；关闭时无外部调用。

## 明确范围外

- 不实现任务清单中未写入 GEO-004 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-203, GEO-405。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Settings 单元测试、生产边界测试、Compose config。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-deploy-scripts`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-004 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-004 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-005 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 建立 GEO 测试夹具和金标目录 |
| 阶段 | R0 |
| 依赖 | GEO-003 |
| 建议分支 | `geo/GEO-005` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-005
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-005：建立 GEO 测试夹具和金标目录**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-005`
发布阶段：`R0`
依赖任务：GEO-003

## 本任务目标

创建虚构产品、问题、回答、引用和分析金标目录，定义 fixture 格式和敏感数据规则。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-005 当前允许进入执行，并逐项确认依赖任务 GEO-003 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-005 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/00-governance/01-document-governance.md`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/tests`
   - `frontend/src/test`
   - `deploy/scripts`

必须交付：
- 创建虚构产品、问题、回答、引用和分析金标目录，定义 fixture 格式和敏感数据规则。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-005 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-005，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 R1 及以后业务能力；不得改变当前 GEO 业务语义。
- Fixture 必须全部虚构，不得包含真实公司、客户、产品机密、凭据、Cookie 或生产 URL。
- Fixture 格式要可版本化并能被后续分析、指标和 E2E 复用。

验收条件：
- 后续分析和指标任务可复用稳定夹具，不含真实公司或凭据。

## 明确范围外

- 不实现任务清单中未写入 GEO-005 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-402, GEO-501。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Fixture schema 校验；最小加载测试。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make test-deploy-scripts`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-005 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-005 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# R1

# GEO-101 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 定义 GEO Catalog 公共契约与数据库合同 |
| 阶段 | R1 |
| 依赖 | GEO-003, GEO-002 |
| 建议分支 | `geo/GEO-101` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-101
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-101：定义 GEO Catalog 公共契约与数据库合同**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-101`
发布阶段：`R1`
依赖任务：GEO-003、GEO-002

## 本任务目标

定义 GeoSubject、Alias、Domain 的请求/响应、枚举、错误码、约束和删除语义。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-101 当前允许进入执行，并逐项确认依赖任务 GEO-003、GEO-002 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-101 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `contracts/openapi.yaml`
   - `contracts/database.md`

必须交付：
- 定义 GeoSubject、Alias、Domain 的请求/响应、枚举、错误码、约束和删除语义。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-101 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-101，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- 本任务只定义契约与数据库合同；不得实现 ORM、迁移、服务、Router 或前端。
- OWN_PRODUCT 只能引用现有 Product，不得复制产品事实形成第二事实源。

验收条件：
- 契约包含 revision、actions、blockers，OWN_PRODUCT 不复制 Product 事实。

## 明确范围外

- 不实现任务清单中未写入 GEO-101 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-102, GEO-103, GEO-201, GEO-203。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Contract schema tests。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-101 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-101 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-102 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 GEO Catalog ORM 与 Alembic |
| 阶段 | R1 |
| 依赖 | GEO-101 |
| 建议分支 | `geo/GEO-102` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-102
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-102：实现 GEO Catalog ORM 与 Alembic**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-102`
发布阶段：`R1`
依赖任务：GEO-101

## 本任务目标

新增 geo_subjects/aliases/domains、约束、索引和模型注册。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-102 当前允许进入执行，并逐项确认依赖任务 GEO-101 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-102 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/models`
   - `backend/alembic`

必须交付：
- 新增 geo_subjects/aliases/domains、约束、索引和模型注册。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-102 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-102，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- 本任务只实现 ORM/Alembic 与数据库约束；不得提前实现 CRUD/API/UI。
- 不得修改历史 frozen migration 或 migration_schema_v1。

验收条件：
- 当前 head 可前滚，OWN_PRODUCT 唯一和父子约束生效。

## 明确范围外

- 不实现任务清单中未写入 GEO-102 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-103。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：迁移、metadata、约束、直接 SQL 反例。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `uv run --project backend alembic -c backend/alembic.ini upgrade head`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-102 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-102 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-103 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 GEO Catalog Schema 与领域策略 |
| 阶段 | R1 |
| 依赖 | GEO-101, GEO-102 |
| 建议分支 | `geo/GEO-103` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-103
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-103：实现 GEO Catalog Schema 与领域策略**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-103`
发布阶段：`R1`
依赖任务：GEO-101、GEO-102

## 本任务目标

实现规范化、父子类型、域名、stage/actions/deletion projection。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-103 当前允许进入执行，并逐项确认依赖任务 GEO-101、GEO-102 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-103 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/schemas`
   - `backend/app/services`

必须交付：
- 实现规范化、父子类型、域名、stage/actions/deletion projection。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-103 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-103，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- 本任务只实现 Schema、规范化和领域策略；不得提前实现完整 CRUD Router 或页面。
- 非法父子关系、别名歧义和 IDNA 错误必须显式失败，不得由前端猜测。

验收条件：
- 未知类型和非法父子关系明确失败，无前端推断。

## 明确范围外

- 不实现任务清单中未写入 GEO-103 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-104。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：单元测试覆盖别名歧义、IDNA、动作。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-103 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-103 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-104 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 GEO Catalog 应用服务和 API |
| 阶段 | R1 |
| 依赖 | GEO-103 |
| 建议分支 | `geo/GEO-104` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-104
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-104：实现 GEO Catalog 应用服务和 API**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-104`
发布阶段：`R1`
依赖任务：GEO-103

## 本任务目标

CRUD、启停、删除、列表/详情、引用计数和审计。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-104 当前允许进入执行，并逐项确认依赖任务 GEO-103 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-104 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `backend/app/routers`
   - `backend/app/main.py`

必须交付：
- CRUD、启停、删除、列表/详情、引用计数和审计。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-104 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-104，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- Router 不得直接提交事务或写 ORM；Application Service 拥有锁、revision、审计和错误映射。
- IntegrityError 只能按精确 SQLSTATE + constraint name 映射。
- 不得实现 GEO-105 前端页面。

验收条件：
- 有历史引用只能停用；错误映射只认精确约束。

## 明确范围外

- 不实现任务清单中未写入 GEO-104 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-105。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：PostgreSQL 集成、并发唯一冲突、权限/CSRF。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-104 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-104 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-105 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现监测对象、竞品、别名和域名管理页面 |
| 阶段 | R1 |
| 依赖 | GEO-104 |
| 建议分支 | `geo/GEO-105` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-105
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-105：实现监测对象、竞品、别名和域名管理页面**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-105`
发布阶段：`R1`
依赖任务：GEO-104

## 本任务目标

管理员工作台、搜索筛选、详情、别名/域名、启停和阻断展示。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-105 当前允许进入执行，并逐项确认依赖任务 GEO-104 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-105 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `frontend/src/domains`
   - `frontend/src/routes`
   - `frontend/src/shared/api`

必须交付：
- 管理员工作台、搜索筛选、详情、别名/域名、启停和阻断展示。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-105 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-105，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- 前端只消费 generated OpenAPI 类型和服务端 available_actions，不复制状态机或删除资格判断。
- ENGINEER 只读；409 冲突必须保留本地表单输入。

验收条件：
- ENGINEER 只读；409 保留表单；不暴露敏感数据。

## 明确范围外

- 不实现任务清单中未写入 GEO-105 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-106。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Vitest 组件测试、generated types、路由测试。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-105 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-105 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-106 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 完成 Catalog 纵向验收和产品引导 |
| 阶段 | R1 |
| 依赖 | GEO-105 |
| 建议分支 | `geo/GEO-106` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-106
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-106：完成 Catalog 纵向验收和产品引导**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-106`
发布阶段：`R1`
依赖任务：GEO-105

## 本任务目标

E2E 创建 OWN_PRODUCT/竞品/alias/domain，补充使用说明和测试证据。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-106 当前允许进入执行，并逐项确认依赖任务 GEO-105 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-106 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/tests/integration`
   - `frontend/tests/e2e`
   - `docs`

必须交付：
- E2E 创建 OWN_PRODUCT/竞品/alias/domain，补充使用说明和测试证据。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-106 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-106，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- 本任务只补纵向 E2E、文档和验收证据，不新增 Catalog 能力。
- 必须证明建立监测身份不会改写现有 Product 事实。

验收条件：
- 可从现有 Product 建立唯一监测身份且不改变产品事实。

## 明确范围外

- 不实现任务清单中未写入 GEO-106 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-502, GEO-504。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Playwright real API；make verify 相关集合。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`
- `make verify`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-106 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-106 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-201 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 定义并实现 PromptVariant 契约与数据模型 |
| 阶段 | R1 |
| 依赖 | GEO-003, GEO-101 |
| 建议分支 | `geo/GEO-201` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-201
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-201：定义并实现 PromptVariant 契约与数据模型**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-201`
发布阶段：`R1`
依赖任务：GEO-003、GEO-101

## 本任务目标

新增 geo_prompt_variants、branded/unbranded、语言、地区、优先级、revision。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-201 当前允许进入执行，并逐项确认依赖任务 GEO-003、GEO-101 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-201 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `contracts`
   - `backend/app/models`
   - `backend/alembic`
   - `backend/app/schemas`

必须交付：
- 新增 geo_prompt_variants、branded/unbranded、语言、地区、优先级、revision。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-201 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-201，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- 复用现有 QueryTopic；不得新建第二套问题主题主表。
- 变体被运行引用后只能停用，不允许破坏历史问题语义。

验收条件：
- 复用 QueryTopic；变体被运行引用后只能停用。

## 明确范围外

- 不实现任务清单中未写入 GEO-201 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-202。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：迁移、唯一性、规范化、历史引用测试。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `uv run --project backend alembic -c backend/alembic.ini upgrade head`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-201 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-201 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-202 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现问题变体服务、API 和前端工作区 |
| 阶段 | R1 |
| 依赖 | GEO-201 |
| 建议分支 | `geo/GEO-202` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-202
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-202：实现问题变体服务、API 和前端工作区**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-202`
发布阶段：`R1`
依赖任务：GEO-201

## 本任务目标

变体 CRUD/启停、列表过滤、详情和运行入口占位。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-202 当前允许进入执行，并逐项确认依赖任务 GEO-201 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-202 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `backend/app/routers`
   - `frontend/src/domains/geo-questions`

必须交付：
- 变体 CRUD/启停、列表过滤、详情和运行入口占位。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-202 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-202，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- branded/unbranded 必须是显式字段，页面不得从问题文本自动猜测。
- 本任务不得创建 Batch/Run 或执行外部采集。

验收条件：
- 点名属性显式；页面不从文本猜测；历史语义稳定。

## 明确范围外

- 不实现任务清单中未写入 GEO-202 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-206。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：集成、权限、组件和 E2E。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-202 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-202 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-203 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 定义并实现 EngineSurface 与 CollectionProfile 数据契约 |
| 阶段 | R1 |
| 依赖 | GEO-004, GEO-101 |
| 建议分支 | `geo/GEO-203` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-203
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-203：定义并实现 EngineSurface 与 CollectionProfile 数据契约**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-203`
发布阶段：`R1`
依赖任务：GEO-004、GEO-101

## 本任务目标

新增观测面/profile、能力、模式、合规状态、AI model 引用和非敏感 settings。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-203 当前允许进入执行，并逐项确认依赖任务 GEO-004、GEO-101 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-203 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `contracts`
   - `backend/app/models`
   - `backend/alembic`
   - `backend/app/schemas`

必须交付：
- 新增观测面/profile、能力、模式、合规状态、AI model 引用和非敏感 settings。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-203 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-203，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- MANUAL/API/BROWSER 模式组合必须由数据库和 Schema 共同约束。
- Profile 响应只含非敏感配置；不得回显密钥、Cookie 或敏感 Header。

验收条件：
- MANUAL/API/BROWSER 约束明确，profile 响应不含 secret。

## 明确范围外

- 不实现任务清单中未写入 GEO-203 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-204。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：模式组合、FK、敏感字段缺失、迁移测试。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `uv run --project backend alembic -c backend/alembic.ini upgrade head`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-203 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-203 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-204 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 建立 Collector Registry 和 Profile 资格策略 |
| 阶段 | R1 |
| 依赖 | GEO-203 |
| 建议分支 | `geo/GEO-204` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-204
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-204：建立 Collector Registry 和 Profile 资格策略**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-204`
发布阶段：`R1`
依赖任务：GEO-203

## 本任务目标

adapter registry、capabilities、validate_profile、未知 adapter 和开关门禁。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-204 当前允许进入执行，并逐项确认依赖任务 GEO-203 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-204 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/collectors`
   - `backend/app/services`

必须交付：
- adapter registry、capabilities、validate_profile、未知 adapter 和开关门禁。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-204 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-204，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- Collector Registry 与资格策略必须可被 Plan preview 和 Worker 复用。
- 未知 adapter 或能力不匹配必须明确失败，不得回退到其他实现。
- 不得实际执行 provider 请求。

验收条件：
- Plan preview 与 Worker 可复用同一资格策略；未知 adapter 不回退。

## 明确范围外

- 不实现任务清单中未写入 GEO-204 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-205, GEO-207, GEO-401。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：单元 contract tests。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-204 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-204 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-205 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现观测面/Profile 管理 API 和页面 |
| 阶段 | R1 |
| 依赖 | GEO-204 |
| 建议分支 | `geo/GEO-205` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-205
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-205：实现观测面/Profile 管理 API 和页面**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-205`
发布阶段：`R1`
依赖任务：GEO-204

## 本任务目标

CRUD、启停、非敏感列表/详情、UNTESTED 状态和管理员工作台。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-205 当前允许进入执行，并逐项确认依赖任务 GEO-204 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-205 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `backend/app/routers`
   - `frontend/src/domains/geo-catalog`

必须交付：
- CRUD、启停、非敏感列表/详情、UNTESTED 状态和管理员工作台。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-205 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-205，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- BROWSER 未通过批准门禁时不可启用。
- ENGINEER 只能看非敏感摘要；管理员测试和启停不得泄露凭据。

验收条件：
- BROWSER 未批准时不可启用；ENGINEER 仅看摘要。

## 明确范围外

- 不实现任务清单中未写入 GEO-205 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-206, GEO-403, GEO-806。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：权限、CSRF、敏感回显、组件测试。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-205 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-205 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-206 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 定义并实现 MonitoringPlan 数据契约 |
| 阶段 | R1 |
| 依赖 | GEO-202, GEO-205 |
| 建议分支 | `geo/GEO-206` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-206
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-206：定义并实现 MonitoringPlan 数据契约**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-206`
发布阶段：`R1`
依赖任务：GEO-202、GEO-205

## 本任务目标

计划及 subject/prompt/profile 关系、状态、repeat、cron、budget、revision。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-206 当前允许进入执行，并逐项确认依赖任务 GEO-202、GEO-205 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-206 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `contracts`
   - `backend/app/models`
   - `backend/alembic`
   - `backend/app/schemas`

必须交付：
- 计划及 subject/prompt/profile 关系、状态、repeat、cron、budget、revision。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-206 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-206，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- Plan 只保存计划配置，不保存运行状态；至少一个 PRIMARY subject、prompt 和 profile。
- 本任务不得创建 Batch/Run。

验收条件：
- 至少一个 PRIMARY、prompt、profile；计划配置不保存运行状态。

## 明确范围外

- 不实现任务清单中未写入 GEO-206 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-207。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：迁移、CHECK、关系唯一、删除阻断。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `uv run --project backend alembic -c backend/alembic.ini upgrade head`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-206 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-206 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-207 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现服务端运行矩阵预览和费用覆盖 |
| 阶段 | R1 |
| 依赖 | GEO-206, GEO-204 |
| 建议分支 | `geo/GEO-207` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-207
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-207：实现服务端运行矩阵预览和费用覆盖**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-207`
发布阶段：`R1`
依赖任务：GEO-206、GEO-204

## 本任务目标

RunMatrixBuilder、资格 blocker/warning、manual/api/browser 数量、known/unknown cost。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-207 当前允许进入执行，并逐项确认依赖任务 GEO-206、GEO-204 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-207 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_plans.py`
   - `backend/tests`

必须交付：
- RunMatrixBuilder、资格 blocker/warning、manual/api/browser 数量、known/unknown cost。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-207 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-207，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- 最终 run_count 只由服务端 RunMatrixBuilder 计算。
- 未知费用必须保持 unknown/null，不得补成 0。
- 10×3×3 必须准确预览为 90 个运行。

验收条件：
- 10×3×3 准确返回 90；未知费用不补零。

## 明确范围外

- 不实现任务清单中未写入 GEO-207 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-208, GEO-303。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：矩阵组合、停用资源、预算、能力缺失、边界。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-207 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-207 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-208 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 Plan 命令、查询、状态机和 API |
| 阶段 | R1 |
| 依赖 | GEO-207 |
| 建议分支 | `geo/GEO-208` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-208
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-208：实现 Plan 命令、查询、状态机和 API**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-208`
发布阶段：`R1`
依赖任务：GEO-207

## 本任务目标

CRUD、preview、activate/pause/resume/archive/copy/run-now 占位、读模型、审计。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-208 当前允许进入执行，并逐项确认依赖任务 GEO-207 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-208 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `backend/app/routers`

必须交付：
- CRUD、preview、activate/pause/resume/archive/copy/run-now 占位、读模型、审计。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-208 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-208，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- 状态机、revision 和 available_actions 由服务端拥有。
- run-now 在本任务只实现文档授权的占位/命令边界，不得提前创建完整 Batch/Run。

验收条件：
- ACTIVE 修改不改变未来已创建快照；ARCHIVED 只读。

## 明确范围外

- 不实现任务清单中未写入 GEO-208 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-209, GEO-301。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：状态机、revision、并发、权限、审计。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-208 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-208 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-209 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现监测计划列表和向导 |
| 阶段 | R1 |
| 依赖 | GEO-208 |
| 建议分支 | `geo/GEO-209` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-209
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-209：实现监测计划列表和向导**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-209`
发布阶段：`R1`
依赖任务：GEO-208

## 本任务目标

分步向导、服务端预览、URL 列表、状态动作、dirty 保护。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-209 当前允许进入执行，并逐项确认依赖任务 GEO-208 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-209 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `frontend/src/domains/geo-plans`
   - `frontend/src/routes/geo`

必须交付：
- 分步向导、服务端预览、URL 列表、状态动作、dirty 保护。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-209 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-209，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得创建回答级 Batch/Run、执行外部采集、实现指标或机会评估。
- 向导最终矩阵和 blocker 必须完全使用服务端 preview。
- 前端不得计算最终 run_count；dirty 状态和 409 必须保留用户输入。

验收条件：
- 前端不计算最终 run_count；所有 blocker 可定位修正。

## 明确范围外

- 不实现任务清单中未写入 GEO-209 deliverables 的能力。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Vitest、路由、409、E2E 创建/启停计划。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`
- `make verify`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-209 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-209 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# R2

# GEO-301 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 定义 Batch/Run 公共契约与数据库模型 |
| 阶段 | R2 |
| 依赖 | GEO-208, GEO-002 |
| 建议分支 | `geo/GEO-301` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-301
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-301：定义 Batch/Run 公共契约与数据库模型**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-301`
发布阶段：`R2`
依赖任务：GEO-208、GEO-002

## 本任务目标

批次、运行、快照、attempt、lease、状态、索引和错误字段。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-301 当前允许进入执行，并逐项确认依赖任务 GEO-208、GEO-002 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-301 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `contracts`
   - `backend/app/models`
   - `backend/alembic`
   - `backend/app/schemas`

必须交付：
- 批次、运行、快照、attempt、lease、状态、索引和错误字段。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-301 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-301，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得接入真实/API Collector、机器分析、指标或机会引擎。
- 旧 GeoObservation 不迁移、不改造；新回答级 Run 使用独立模型。
- Run 输入快照不可变；Batch 状态必须能从 runs 重建。

验收条件：
- Run 输入不可变；Batch 可从 runs 重建；旧 GeoObservation 不迁移。

## 明确范围外

- 不实现任务清单中未写入 GEO-301 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-302, GEO-304, GEO-401。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：迁移、CHECK、唯一单元、终态反例。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `uv run --project backend alembic -c backend/alembic.ini upgrade head`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-301 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-301 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-302 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 Batch/Run 状态策略与动作投影 |
| 阶段 | R2 |
| 依赖 | GEO-301 |
| 建议分支 | `geo/GEO-302` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-302
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-302：实现 Batch/Run 状态策略与动作投影**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-302`
发布阶段：`R2`
依赖任务：GEO-301

## 本任务目标

合法转换、batch 状态投影、retry/cancel 资格、workflow stage/actions。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-302 当前允许进入执行，并逐项确认依赖任务 GEO-301 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-302 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `backend/tests/unit`

必须交付：
- 合法转换、batch 状态投影、retry/cancel 资格、workflow stage/actions。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-302 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-302，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得接入真实/API Collector、机器分析、指标或机会引擎。
- 前端不得从 status 自行推断动作；所有 actions/stage 由服务端投影。
- 终态不可回退，非法转换必须稳定失败。

验收条件：
- 前端无需从 status 推断动作；终态不能回退。

## 明确范围外

- 不实现任务清单中未写入 GEO-302 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-303。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：完整状态机表驱动测试。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-302 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-302 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-303 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现批次工厂、计划快照和创建幂等 |
| 阶段 | R2 |
| 依赖 | GEO-302, GEO-207 |
| 建议分支 | `geo/GEO-303` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-303
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-303：实现批次工厂、计划快照和创建幂等**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-303`
发布阶段：`R2`
依赖任务：GEO-302、GEO-207

## 本任务目标

从 plan/临时请求冻结矩阵、原子创建 batch+runs、schedule/manual identity。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-303 当前允许进入执行，并逐项确认依赖任务 GEO-302、GEO-207 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-303 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_batches.py`
   - `backend/app/routers`

必须交付：
- 从 plan/临时请求冻结矩阵、原子创建 batch+runs、schedule/manual identity。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-303 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-303，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得接入真实/API Collector、机器分析、指标或机会引擎。
- 创建 batch+runs 必须原子、幂等且无部分提交。
- 提交后 Plan/Profile/Prompt 配置变化不得改变已冻结快照。
- 必须覆盖高达 1000 runs 的创建边界。

验收条件：
- requested_run_count 与实际 runs 一致；提交后配置变化无影响。

## 明确范围外

- 不实现任务清单中未写入 GEO-303 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-305, GEO-306, GEO-405, GEO-705。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：PostgreSQL 事务、并发同键、1000 runs、无部分提交。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-303 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-303 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-304 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 定义并实现 AnswerSnapshot、Citation 与证据关联 |
| 阶段 | R2 |
| 依赖 | GEO-301 |
| 建议分支 | `geo/GEO-304` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-304
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-304：定义并实现 AnswerSnapshot、Citation 与证据关联**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-304`
发布阶段：`R2`
依赖任务：GEO-301

## 本任务目标

原始回答、哈希、引用、截图/raw payload 文件引用和不可变防线。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-304 当前允许进入执行，并逐项确认依赖任务 GEO-301 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-304 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `contracts`
   - `backend/app/models`
   - `backend/alembic`
   - `backend/app/schemas`
   - `backend/app/services/storage.py`

必须交付：
- 原始回答、哈希、引用、截图/raw payload 文件引用和不可变防线。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-304 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-304，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得接入真实/API Collector、机器分析、指标或机会引擎。
- AnswerSnapshot、Citation 和证据提交后不可修改。
- 原始证据摘要不得包含 secret；大对象通过受控文件引用保存。

验收条件：
- 原始证据提交后不可修改；secret 不进入 raw summary。

## 明确范围外

- 不实现任务清单中未写入 GEO-304 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-305, GEO-501, GEO-504, GEO-805。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：迁移、URL 规范化、文件资格、UPDATE 反例。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `uv run --project backend alembic -c backend/alembic.ini upgrade head`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-304 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-304 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-305 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 MANUAL 草稿和正式提交 |
| 阶段 | R2 |
| 依赖 | GEO-303, GEO-304 |
| 建议分支 | `geo/GEO-305` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-305
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-305：实现 MANUAL 草稿和正式提交**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-305`
发布阶段：`R2`
依赖任务：GEO-303、GEO-304

## 本任务目标

manual entry context、draft revision、submit、幂等、状态推进和分析投递占位。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-305 当前允许进入执行，并逐项确认依赖任务 GEO-303、GEO-304 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-305 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_manual_collection.py`
   - `backend/app/routers`

必须交付：
- manual entry context、draft revision、submit、幂等、状态推进和分析投递占位。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-305 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-305，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得接入真实/API Collector、机器分析、指标或机会引擎。
- 只有 MANUAL run 可保存草稿和正式提交。
- 正式提交必须一次性冻结 answer/citations/files；失败不得伪装成功。

验收条件：
- 正式提交一次冻结 answer/citations/files；失败不伪装成功。

## 明确范围外

- 不实现任务清单中未写入 GEO-305 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-306。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：并发提交、草稿冲突、证据要求、非 MANUAL 拒绝。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-305 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-305 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-306 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 Batch/Run 列表与详情读模型 |
| 阶段 | R2 |
| 依赖 | GEO-303, GEO-305 |
| 建议分支 | `geo/GEO-306` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-306
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-306：实现 Batch/Run 列表与详情读模型**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-306`
发布阶段：`R2`
依赖任务：GEO-303、GEO-305

## 本任务目标

批次 summary、run 分页、GeoRunDetail、时间线、data quality 占位。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-306 当前允许进入执行，并逐项确认依赖任务 GEO-303、GEO-305 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-306 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `backend/app/schemas`
   - `backend/app/routers`

必须交付：
- 批次 summary、run 分页、GeoRunDetail、时间线、data quality 占位。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-306 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-306，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得接入真实/API Collector、机器分析、指标或机会引擎。
- 复杂详情使用稳定读模型和固定查询数，禁止前端跨接口 join。
- 大文件只返回受控签名访问，不在 JSON 内返回原始字节。

验收条件：
- 详情单请求返回输入、证据、状态和 attempts；大文件只返回签名访问。

## 明确范围外

- 不实现任务清单中未写入 GEO-306 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-307。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：REPEATABLE READ、固定查询数、筛选分页。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-306 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-306 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-307 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现运行中心、人工录入和详情页面 |
| 阶段 | R2 |
| 依赖 | GEO-306 |
| 建议分支 | `geo/GEO-307` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-307
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-307：实现运行中心、人工录入和详情页面**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-307`
发布阶段：`R2`
依赖任务：GEO-306

## 本任务目标

批次/运行双层视图、manual editor、截图上传、引用编辑、详情证据。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-307 当前允许进入执行，并逐项确认依赖任务 GEO-306 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-307 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `frontend/src/domains/geo-runs`
   - `frontend/src/routes/geo`

必须交付：
- 批次/运行双层视图、manual editor、截图上传、引用编辑、详情证据。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-307 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-307，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得接入真实/API Collector、机器分析、指标或机会引擎。
- 筛选、分页和选中对象进入 URL；草稿留在组件状态。
- 刷新不得丢失筛选或已保存草稿；前端不复制 Run 状态机。

验收条件：
- 人工批次完整纵向通过；刷新不丢筛选或草稿。

## 明确范围外

- 不实现任务清单中未写入 GEO-307 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-308, GEO-408。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：组件、dirty、轮询、错误、Playwright。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-307 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-307 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-308 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 完成 R2 并发、不可变和兼容性验收 |
| 阶段 | R2 |
| 依赖 | GEO-307 |
| 建议分支 | `geo/GEO-308` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-308
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-308：完成 R2 并发、不可变和兼容性验收**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-308`
发布阶段：`R2`
依赖任务：GEO-307

## 本任务目标

补齐取消/提交竞态、不可变触发器、旧文章观测导航兼容和 R2 验收证据。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-308 当前允许进入执行，并逐项确认依赖任务 GEO-307 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-308 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/tests/integration`
   - `frontend/tests/e2e`
   - `docs`

必须交付：
- 补齐取消/提交竞态、不可变触发器、旧文章观测导航兼容和 R2 验收证据。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-308 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-308，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得接入真实/API Collector、机器分析、指标或机会引擎。
- 本任务是 R2 验收和兼容性收口，不得加入 API 自动采集。
- 必须证明现有文章关系 GEO 流程无回归。

验收条件：
- 现有 GEO 流程不回归，新人工回答级观测可业务试用。

## 明确范围外

- 不实现任务清单中未写入 GEO-308 deliverables 的能力。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：make verify + GEO E2E。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`
- `make verify`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-308 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-308 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# R3

# GEO-401 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 定义 GeoCollector 协议和稳定错误模型 |
| 阶段 | R3 |
| 依赖 | GEO-204, GEO-301 |
| 建议分支 | `geo/GEO-401` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-401
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-401：定义 GeoCollector 协议和稳定错误模型**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-401`
发布阶段：`R3`
依赖任务：GEO-204、GEO-301

## 本任务目标

CollectionRequest/CollectedAnswer/CollectorError、capability 和 adapter contract。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-401 当前允许进入执行，并逐项确认依赖任务 GEO-204、GEO-301 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-401 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/collectors`
   - `backend/app/schemas`
   - `docs`

必须交付：
- CollectionRequest/CollectedAnswer/CollectorError、capability 和 adapter contract。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-401 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-401，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现机器分析、业务指标、机会评估或 Browser Collector。
- Collector 不得依赖 ORM Session、提交事务或计算业务指标。
- 稳定错误必须包含 send state，以支持 at-most-once 恢复。

验收条件：
- Collector 不依赖 ORM，不提交事务，错误含 send state。

## 明确范围外

- 不实现任务清单中未写入 GEO-401 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-402, GEO-404。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：抽象 contract unit tests。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-401 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-401 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-402 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 GEO fake provider 和 Collector 合同套件 |
| 阶段 | R3 |
| 依赖 | GEO-401, GEO-005 |
| 建议分支 | `geo/GEO-402` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-402
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-402：实现 GEO fake provider 和 Collector 合同套件**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-402`
发布阶段：`R3`
依赖任务：GEO-401、GEO-005

## 本任务目标

成功、引用、429、timeout、disconnect、redirect、oversize、invalid response 模式和调用计数。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-402 当前允许进入执行，并逐项确认依赖任务 GEO-401、GEO-005 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-402 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/geo_fake_server.py`
   - `backend/tests`
   - `deploy/scripts`

必须交付：
- 成功、引用、429、timeout、disconnect、redirect、oversize、invalid response 模式和调用计数。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-402 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-402，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现机器分析、业务指标、机会评估或 Browser Collector。
- CI 只使用本地 fake provider，不访问真实外部平台。
- 必须覆盖调用计数、429、timeout、disconnect、redirect、oversize 和无效响应。
- 所有日志和产物必须通过 secret scan。

验收条件：
- CI 可证明每 attempt 调用次数和 secret 脱敏。

## 明确范围外

- 不实现任务清单中未写入 GEO-402 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-403, GEO-803。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：合同套件自身测试。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-deploy-scripts`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-402 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-402 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-403 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 API Profile 连接测试和能力验证 |
| 阶段 | R3 |
| 依赖 | GEO-402, GEO-205 |
| 建议分支 | `geo/GEO-403` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-403
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-403：实现 API Profile 连接测试和能力验证**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-403`
发布阶段：`R3`
依赖任务：GEO-402、GEO-205

## 本任务目标

管理员 test 命令、状态、错误摘要、模型/profile 资格失效规则。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-403 当前允许进入执行，并逐项确认依赖任务 GEO-402、GEO-205 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-403 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `backend/app/routers`
   - `frontend/src/domains/geo-catalog`

必须交付：
- 管理员 test 命令、状态、错误摘要、模型/profile 资格失效规则。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-403 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-403，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现机器分析、业务指标、机会评估或 Browser Collector。
- 连接测试不创建业务 Run，不计入业务指标，成功后不自动启用 Profile。
- 必须复用安全 pinned transport 和能力验证。

验收条件：
- 测试不创建业务 run；成功不自动启用 profile。

## 明确范围外

- 不实现任务清单中未写入 GEO-403 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-404。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：真实 pinned transport fake HTTPS、前端状态。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-403 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-403 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-404 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 OpenAI-compatible GEO Collector |
| 阶段 | R3 |
| 依赖 | GEO-401, GEO-403 |
| 建议分支 | `geo/GEO-404` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-404
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-404：实现 OpenAI-compatible GEO Collector**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-404`
发布阶段：`R3`
依赖任务：GEO-401、GEO-403

## 本任务目标

无品牌污染的 user prompt 请求、回答/引用/usage/cost 解析、严格大小和错误。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-404 当前允许进入执行，并逐项确认依赖任务 GEO-401、GEO-403 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-404 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/collectors/openai_compatible.py`

必须交付：
- 无品牌污染的 user prompt 请求、回答/引用/usage/cost 解析、严格大小和错误。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-404 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-404，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现机器分析、业务指标、机会评估或 Browser Collector。
- 不得复用内容生成的 GeneratedDraft 四字段解析器。
- 监测请求不得注入品牌结论；未知搜索状态和费用保持 null。
- 保持 SSRF、TLS、重定向和响应上限边界。

验收条件：
- 不复用 GeneratedDraft 解析；未知搜索/费用为 null。

## 明确范围外

- 不实现任务清单中未写入 GEO-404 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-405。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Collector contract、SSRF/TLS/响应金标。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-404 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-404 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-405 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现采集 Worker、lease、dispatch 和补投递 |
| 阶段 | R3 |
| 依赖 | GEO-303, GEO-404, GEO-004 |
| 建议分支 | `geo/GEO-405` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-405
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-405：实现采集 Worker、lease、dispatch 和补投递**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-405`
发布阶段：`R3`
依赖任务：GEO-303、GEO-404、GEO-004

## 本任务目标

claim、RUNNING、调用、结果提交、PENDING redispatch、expired lease 扫描。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-405 当前允许进入执行，并逐项确认依赖任务 GEO-303、GEO-404、GEO-004 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-405 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/worker.py`
   - `backend/app/services/geo_runs.py`
   - `backend/app/services/geo_dispatch.py`

必须交付：
- claim、RUNNING、调用、结果提交、PENDING redispatch、expired lease 扫描。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-405 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-405，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现机器分析、业务指标、机会评估或 Browser Collector。
- Redis 消息只能携带 run ID；Worker 每一步重新加载数据库权威状态。
- 重复消息不得重复调用 provider。
- 发送后的失败不得由补投递机制自动重发。

验收条件：
- 消息仅携带 run ID；重复消息不重复调用。

## 明确范围外

- 不实现任务清单中未写入 GEO-405 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-406, GEO-407, GEO-506。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：真实 Redis/Celery 集成。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-405 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-405 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-406 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 external_call_state 与 at-most-once 恢复 |
| 阶段 | R3 |
| 依赖 | GEO-405 |
| 建议分支 | `geo/GEO-406` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-406
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-406：实现 external_call_state 与 at-most-once 恢复**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-406`
发布阶段：`R3`
依赖任务：GEO-405

## 本任务目标

NOT_STARTED/SENT/UNKNOWN/COMPLETED 持久化、崩溃恢复、迟到结果和显式 retry attempt。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-406 当前允许进入执行，并逐项确认依赖任务 GEO-405 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-406 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `backend/tests/integration`

必须交付：
- NOT_STARTED/SENT/UNKNOWN/COMPLETED 持久化、崩溃恢复、迟到结果和显式 retry attempt。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-406 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-406，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现机器分析、业务指标、机会评估或 Browser Collector。
- NOT_STARTED/SENT/UNKNOWN/COMPLETED 状态必须持久化。
- 请求一旦发送，任何未知结果都不得自动重发；再次调用只能显式创建新 attempt。
- 迟到结果不能覆盖已经提交的终态。

验收条件：
- 发送后任何失败不自动重发；原 attempt 终态保留。

## 明确范围外

- 不实现任务清单中未写入 GEO-406 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-407。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：发送前/后崩溃、UNKNOWN、success late result、并发 retry。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-406 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-406 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-407 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现引用、usage、cost、预算和 profile rate limit |
| 阶段 | R3 |
| 依赖 | GEO-405, GEO-406 |
| 建议分支 | `geo/GEO-407` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-407
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-407：实现引用、usage、cost、预算和 profile rate limit**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-407`
发布阶段：`R3`
依赖任务：GEO-405、GEO-406

## 本任务目标

保存采集元数据、费用覆盖、batch/day budget、并发预留和 rate limit。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-407 当前允许进入执行，并逐项确认依赖任务 GEO-405、GEO-406 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-407 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `backend/app/models`
   - `backend/tests`

必须交付：
- 保存采集元数据、费用覆盖、batch/day budget、并发预留和 rate limit。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-407 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-407，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现机器分析、业务指标、机会评估或 Browser Collector。
- 未知费用不得当作 0；预算判断必须在服务端并具有并发最终防线。
- rate limit 和预算失败不能产生部分业务结果。

验收条件：
- 未知费用不当 0；预算判断不是前端独有。

## 明确范围外

- 不实现任务清单中未写入 GEO-407 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-408。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：预算并发、未知费用、429、限速。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-407 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-407 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-408 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 完成 API 自动观测 UI 和纵向验收 |
| 阶段 | R3 |
| 依赖 | GEO-407, GEO-307 |
| 建议分支 | `geo/GEO-408` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-408
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-408：完成 API 自动观测 UI 和纵向验收**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-408`
发布阶段：`R3`
依赖任务：GEO-407、GEO-307

## 本任务目标

自动 run 状态轮询、费用/usage/错误/重试展示、API E2E 和运维说明。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-408 当前允许进入执行，并逐项确认依赖任务 GEO-407、GEO-307 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-408 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `frontend/src/domains/geo-runs`
   - `frontend/tests/e2e`
   - `docs`

必须交付：
- 自动 run 状态轮询、费用/usage/错误/重试展示、API E2E 和运维说明。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-408 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-408，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现机器分析、业务指标、机会评估或 Browser Collector。
- E2E 使用真实本地栈和 fake provider；不得使用真实供应商。
- 功能开关关闭时必须证明没有外部调用。

验收条件：
- R3 业务演示全部通过，功能开关关闭时无外部调用。

## 明确范围外

- 不实现任务清单中未写入 GEO-408 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-801, GEO-902。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Playwright real stack + fake provider。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`
- `make verify`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-408 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-408 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# R4

# GEO-501 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 定义 AnalysisRevision、Mention、Recommendation、Claim、Review 契约和表 |
| 阶段 | R4 |
| 依赖 | GEO-304, GEO-005 |
| 建议分支 | `geo/GEO-501` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-501
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-501：定义 AnalysisRevision、Mention、Recommendation、Claim、Review 契约和表**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-501`
发布阶段：`R4`
依赖任务：GEO-304、GEO-005

## 本任务目标

分析 revision、子结果、review、current pointer/选择规则和不可变约束。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-501 当前允许进入执行，并逐项确认依赖任务 GEO-304、GEO-005 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-501 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `contracts`
   - `backend/app/models`
   - `backend/alembic`
   - `backend/app/schemas`

必须交付：
- 分析 revision、子结果、review、current pointer/选择规则和不可变约束。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-501 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-501，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现汇总指标、Opportunity 规则或 Browser Collector。
- 原始证据、机器分析 revision 和人工复核必须分离。
- 分析 revision 不可变且可追溯，旧 revision 不得被覆盖。

验收条件：
- 原始证据与分析分离；revision 可追溯。

## 明确范围外

- 不实现任务清单中未写入 GEO-501 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-502, GEO-503, GEO-504, GEO-505。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：迁移、unique、UPDATE/DELETE 反例。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `uv run --project backend alembic -c backend/alembic.ini upgrade head`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-501 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-501 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-502 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现监测对象别名快照和确定性提及识别 |
| 阶段 | R4 |
| 依赖 | GEO-501, GEO-106 |
| 建议分支 | `geo/GEO-502` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-502
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-502：实现监测对象别名快照和确定性提及识别**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-502`
发布阶段：`R4`
依赖任务：GEO-501、GEO-106

## 本任务目标

中英文、型号边界、大小写/连字符、否定上下文和歧义原因。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-502 当前允许进入执行，并逐项确认依赖任务 GEO-501、GEO-106 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-502 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_analysis.py`
   - `backend/tests/fixtures/geo_analysis`

必须交付：
- 中英文、型号边界、大小写/连字符、否定上下文和歧义原因。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-502 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-502，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现汇总指标、Opportunity 规则或 Browser Collector。
- 同一别名映射多个 subject 时必须进入歧义/复核，不得任意选择。
- 型号边界、大小写、连字符、中文上下文和否定语境必须由金标覆盖。

验收条件：
- 同别名歧义触发复核，不任意选择 subject。

## 明确范围外

- 不实现任务清单中未写入 GEO-502 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-503, GEO-505, GEO-506。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：金标单元测试。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-502 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-502 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-503 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现推荐分类和可靠位置识别 |
| 阶段 | R4 |
| 依赖 | GEO-501, GEO-502 |
| 建议分支 | `geo/GEO-503` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-503
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-503：实现推荐分类和可靠位置识别**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-503`
发布阶段：`R4`
依赖任务：GEO-501、GEO-502

## 本任务目标

RECOMMENDED/CONSIDERED/NOT_RECOMMENDED/UNKNOWN、rank 和依据。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-503 当前允许进入执行，并逐项确认依赖任务 GEO-501、GEO-502 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-503 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_analysis.py`

必须交付：
- RECOMMENDED/CONSIDERED/NOT_RECOMMENDED/UNKNOWN、rank 和依据。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-503 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-503，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现汇总指标、Opportunity 规则或 Browser Collector。
- 名称出现不等于推荐；无法可靠确定顺序时 rank 必须为 null。
- 必须区分 RECOMMENDED、CONSIDERED、NOT_RECOMMENDED 和 UNKNOWN。

验收条件：
- 名称出现不自动等于推荐；无可靠顺序 rank 为 null。

## 明确范围外

- 不实现任务清单中未写入 GEO-503 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-506。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：列举、否定、有序/无序、多竞品金标。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-503 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-503 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-504 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现引用归属和来源类别分析 |
| 阶段 | R4 |
| 依赖 | GEO-501, GEO-106, GEO-304 |
| 建议分支 | `geo/GEO-504` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-504
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-504：实现引用归属和来源类别分析**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-504`
发布阶段：`R4`
依赖任务：GEO-501、GEO-106、GEO-304

## 本任务目标

自有/竞品域名、来源类别、歧义、规则版本。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-504 当前允许进入执行，并逐项确认依赖任务 GEO-501、GEO-106、GEO-304 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-504 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_analysis.py`

必须交付：
- 自有/竞品域名、来源类别、歧义、规则版本。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-504 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-504，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现汇总指标、Opportunity 规则或 Browser Collector。
- 域名归属基于规范 hostname 和边界匹配，禁止字符串 contains。
- 原始 Citation 始终是权威证据；分类结果是可版本化分析。

验收条件：
- 不使用字符串 contains 误判；引用仍以原始记录为权威。

## 明确范围外

- 不实现任务清单中未写入 GEO-504 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-506, GEO-604。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：hostname 边界、子域名、IDNA、共享域名、人工修正。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-504 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-504 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-505 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现声明提取、事实版本装配和准确性评估 |
| 阶段 | R4 |
| 依赖 | GEO-501, GEO-502 |
| 建议分支 | `geo/GEO-505` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-505
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-505：实现声明提取、事实版本装配和准确性评估**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-505`
发布阶段：`R4`
依赖任务：GEO-501、GEO-502

## 本任务目标

claim types、FactVersion 资格、verdict、severity、UNJUDGEABLE 和关键替代关系门禁。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-505 当前允许进入执行，并逐项确认依赖任务 GEO-501、GEO-502 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-505 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_claims.py`
   - `backend/tests/fixtures`

必须交付：
- claim types、FactVersion 资格、verdict、severity、UNJUDGEABLE 和关键替代关系门禁。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-505 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-505，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现汇总指标、Opportunity 规则或 Browser Collector。
- 准确性评估只使用符合资格的 APPROVED FactVersion。
- 受限事实不得为了分析被发送到未批准第三方。
- 事实不足时必须返回 UNJUDGEABLE，不得猜测。

验收条件：
- 只用 APPROVED FactVersion；受限事实不被外发。

## 明确范围外

- 不实现任务清单中未写入 GEO-505 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-506, GEO-604。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：参数、封装、认证、条件替代、事实不足金标。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-505 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-505 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-506 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 Analysis Worker 和 revision 生命周期 |
| 阶段 | R4 |
| 依赖 | GEO-502, GEO-503, GEO-504, GEO-505, GEO-405 |
| 建议分支 | `geo/GEO-506` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-506
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-506：实现 Analysis Worker 和 revision 生命周期**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-506`
发布阶段：`R4`
依赖任务：GEO-502、GEO-503、GEO-504、GEO-505、GEO-405

## 本任务目标

COLLECTED claim、revision、结果原子写入、review reasons、run 状态推进、reanalyze。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-506 当前允许进入执行，并逐项确认依赖任务 GEO-502、GEO-503、GEO-504、GEO-505、GEO-405 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-506 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/worker.py`
   - `backend/app/services/geo_analysis.py`

必须交付：
- COLLECTED claim、revision、结果原子写入、review reasons、run 状态推进、reanalyze。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-506 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-506，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现汇总指标、Opportunity 规则或 Browser Collector。
- 分析失败不得丢失 AnswerSnapshot；分析任务必须按 input hash 幂等。
- 结果写入、current pointer 和 Run 状态推进必须具备原子边界。

验收条件：
- 分析失败不丢 AnswerSnapshot；相同 input hash 幂等。

## 明确范围外

- 不实现任务清单中未写入 GEO-506 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-507。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Worker 集成、失败、重复任务、迟到结果。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-506 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-506 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-507 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现人工复核策略、API 和当前结果选择 |
| 阶段 | R4 |
| 依赖 | GEO-506 |
| 建议分支 | `geo/GEO-507` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-507
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-507：实现人工复核策略、API 和当前结果选择**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-507`
发布阶段：`R4`
依赖任务：GEO-506

## 本任务目标

confirm/correct、stale revision、追加式 review、current reviewed projection。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-507 当前允许进入执行，并逐项确认依赖任务 GEO-506 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-507 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_reviews.py`
   - `backend/app/routers`

必须交付：
- confirm/correct、stale revision、追加式 review、current reviewed projection。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-507 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-507，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现汇总指标、Opportunity 规则或 Browser Collector。
- NEEDS_REVIEW 且未完成复核的结果不得进入业务指标。
- 人工修正追加保存，原机器结果和旧 review 必须保留。

验收条件：
- NEEDS_REVIEW 未复核不进入业务指标；原机器结果保留。

## 明确范围外

- 不实现任务清单中未写入 GEO-507 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-508, GEO-601。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：权限、并发、旧 review supersede、correction schema。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-507 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-507 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-508 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现分析/复核前端并完成 R4 金标验收 |
| 阶段 | R4 |
| 依赖 | GEO-507 |
| 建议分支 | `geo/GEO-508` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-508
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-508：实现分析/复核前端并完成 R4 金标验收**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-508`
发布阶段：`R4`
依赖任务：GEO-507

## 本任务目标

详情分析区、声明表、修正表单、历史、E2E 和分析器质量报告。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-508 当前允许进入执行，并逐项确认依赖任务 GEO-507 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-508 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `frontend/src/domains/geo-runs`
   - `backend/tests`
   - `frontend/tests/e2e`

必须交付：
- 详情分析区、声明表、修正表单、历史、E2E 和分析器质量报告。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-508 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-508，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现汇总指标、Opportunity 规则或 Browser Collector。
- 页面必须支持从原文追溯到机器分析、人工复核和历史 revision。
- 严重错误不能通过无操作的默认确认跳过人工处理。

验收条件：
- 用户可追溯原文→分析→复核，严重错误必须人工处理。

## 明确范围外

- 不实现任务清单中未写入 GEO-508 deliverables 的能力。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Vitest、Playwright、全部金标。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`
- `make verify`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-508 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-508 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# R5

# GEO-601 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 MetricEligibility、样本等级和公式库 |
| 阶段 | R5 |
| 依赖 | GEO-507 |
| 建议分支 | `geo/GEO-601` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-601
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-601：实现 MetricEligibility、样本等级和公式库**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-601`
发布阶段：`R5`
依赖任务：GEO-507

## 本任务目标

通用资格、可比维度、比率结构、visibility/recommendation/SOV/citation/accuracy/stability。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-601 当前允许进入执行，并逐项确认依赖任务 GEO-507 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-601 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_metrics.py`
   - `backend/tests/unit`

必须交付：
- 通用资格、可比维度、比率结构、visibility/recommendation/SOV/citation/accuracy/stability。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-601 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-601，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Opportunity 行动闭环、Browser Collector 或生产启用。
- 无分母返回 null；失败运行不算“未提及”。
- MANUAL/API/BROWSER、点名/非点名等不可比维度默认分开。
- 所有比率返回 value、numerator、denominator、sample level 和排除原因。

验收条件：
- 无分母 null；失败不算未提及；人工/模式默认分离。

## 明确范围外

- 不实现任务清单中未写入 GEO-601 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-602, GEO-603, GEO-604, GEO-701。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：完整金标公式测试。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-601 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-601 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-602 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 GEO Overview 读模型和 API |
| 阶段 | R5 |
| 依赖 | GEO-601 |
| 建议分支 | `geo/GEO-602` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-602
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-602：实现 GEO Overview 读模型和 API**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-602`
发布阶段：`R5`
依赖任务：GEO-601

## 本任务目标

卡片、重点产品、风险、最近批次、开放机会占位和数据质量。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-602 当前允许进入执行，并逐项确认依赖任务 GEO-601 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-602 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_overview.py`
   - `backend/app/schemas/geo_insights.py`
   - `backend/app/routers`

必须交付：
- 卡片、重点产品、风险、最近批次、开放机会占位和数据质量。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-602 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-602，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Opportunity 行动闭环、Browser Collector 或生产启用。
- Overview 所有卡片必须能下钻到组成样本并携带同一筛选。
- 复杂聚合使用一致读和固定查询数，不保存第二套权威指标。

验收条件：
- 所有卡片含分子/分母和下钻筛选。

## 明确范围外

- 不实现任务清单中未写入 GEO-602 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-605。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：REPEATABLE READ、固定查询数、筛选一致。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-602 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-602 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-603 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现趋势、竞品 SOV 和问题/平台覆盖 |
| 阶段 | R5 |
| 依赖 | GEO-601 |
| 建议分支 | `geo/GEO-603` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-603
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-603：实现趋势、竞品 SOV 和问题/平台覆盖**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-603`
发布阶段：`R5`
依赖任务：GEO-601

## 本任务目标

前周期、产品矩阵、问题覆盖、平台表现、Mention/Recommendation SOV。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-603 当前允许进入执行，并逐项确认依赖任务 GEO-601 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-603 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_metrics.py`

必须交付：
- 前周期、产品矩阵、问题覆盖、平台表现、Mention/Recommendation SOV。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-603 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-603，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Opportunity 行动闭环、Browser Collector 或生产启用。
- 竞品集合变化和样本不足必须显式导致不可比，不得静默聚合。
- 点名问题不得混入自然可见率和自然 SOV。

验收条件：
- 不可比窗口明确不可用，不静默聚合。

## 明确范围外

- 不实现任务清单中未写入 GEO-603 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-605, GEO-702。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：competitor set 变化、样本不足、点名排除。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-603 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-603 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-604 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现引用、事实风险和数据质量洞察 |
| 阶段 | R5 |
| 依赖 | GEO-601, GEO-504, GEO-505 |
| 建议分支 | `geo/GEO-604` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-604
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-604：实现引用、事实风险和数据质量洞察**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-604`
发布阶段：`R5`
依赖任务：GEO-601、GEO-504、GEO-505

## 本任务目标

域名/URL、source categories、claims、severity、排除计数、费用/版本覆盖。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-604 当前允许进入执行，并逐项确认依赖任务 GEO-601、GEO-504、GEO-505 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-604 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_metrics.py`
   - `backend/app/schemas`

必须交付：
- 域名/URL、source categories、claims、severity、排除计数、费用/版本覆盖。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-604 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-604，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Opportunity 行动闭环、Browser Collector 或生产启用。
- 摘要与明细使用同一资格和筛选，UNJUDGEABLE 不得计为错误或正确。
- 共享域名和 review backlog 必须进入数据质量说明。

验收条件：
- 摘要和明细下钻结果一致。

## 明确范围外

- 不实现任务清单中未写入 GEO-604 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-605, GEO-702。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：引用去重、共享域名、UNJUDGEABLE、review backlog。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-604 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-604 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-605 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现总览和分析洞察前端 |
| 阶段 | R5 |
| 依赖 | GEO-602, GEO-603, GEO-604 |
| 建议分支 | `geo/GEO-605` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-605
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-605：实现总览和分析洞察前端**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-605`
发布阶段：`R5`
依赖任务：GEO-602、GEO-603、GEO-604

## 本任务目标

URL 筛选、指标卡、趋势、矩阵、SOV、引用、风险、数据质量和表格替代。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-605 当前允许进入执行，并逐项确认依赖任务 GEO-602、GEO-603、GEO-604 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-605 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `frontend/src/domains/geo-insights`
   - `frontend/src/routes/geo`

必须交付：
- URL 筛选、指标卡、趋势、矩阵、SOV、引用、风险、数据质量和表格替代。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-605 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-605，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Opportunity 行动闭环、Browser Collector 或生产启用。
- 前端不计算任何业务公式；只格式化服务端结果。
- 所有筛选作用于全部区块；图表必须有可访问的表格或文本替代。

验收条件：
- 前端不计算公式；图表可访问；筛选作用于全部区块。

## 明确范围外

- 不实现任务清单中未写入 GEO-605 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-606, GEO-706。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：组件、路由、null/sample level、E2E。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-605 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-605 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-606 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现打印报告和安全 CSV 导出 |
| 阶段 | R5 |
| 依赖 | GEO-605 |
| 建议分支 | `geo/GEO-606` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-606
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-606：实现打印报告和安全 CSV 导出**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-606`
发布阶段：`R5`
依赖任务：GEO-605

## 本任务目标

报告预览、打印路由、runs/citations/claims/opportunities CSV、审计。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-606 当前允许进入执行，并逐项确认依赖任务 GEO-605 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-606 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_reports.py`
   - `backend/app/routers`
   - `frontend/src/domains/geo-reports`

必须交付：
- 报告预览、打印路由、runs/citations/claims/opportunities CSV、审计。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-606 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-606，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Opportunity 行动闭环、Browser Collector 或生产启用。
- CSV 必须防公式注入、使用字段白名单并支持流式导出。
- 报告必须显示筛选、as_of、公式和数据质量；空数据不得生成假成功报告。

验收条件：
- 报告显示筛选、as_of、公式和数据质量；空数据不伪装成功。

## 明确范围外

- 不实现任务清单中未写入 GEO-606 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-607。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：CSV 注入、字段白名单、流式、大数据、打印 E2E。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-606 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-606 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-607 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 完成洞察性能、索引和 R5 验收 |
| 阶段 | R5 |
| 依赖 | GEO-606 |
| 建议分支 | `geo/GEO-607` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-607
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-607：完成洞察性能、索引和 R5 验收**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-607`
发布阶段：`R5`
依赖任务：GEO-606

## 本任务目标

查询计划、必要索引、100k run fixture、性能证据和门禁。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-607 当前允许进入执行，并逐项确认依赖任务 GEO-606 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-607 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/alembic`
   - `backend/tests/performance`
   - `docs`

必须交付：
- 查询计划、必要索引、100k run fixture、性能证据和门禁。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-607 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-607，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Opportunity 行动闭环、Browser Collector 或生产启用。
- 性能优化不得引入不可重建、可写的第二套指标权威。
- 必须用 100k run fixture、查询计划和 N+1 证据验证常用 30 天洞察。

验收条件：
- 常用 30 天洞察达到目标，无不可重建的指标缓存。

## 明确范围外

- 不实现任务清单中未写入 GEO-607 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-902, GEO-905。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：P95 基准、N+1 检查、make verify。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `运行任务新增的性能基准和 EXPLAIN/查询计划检查`
- `make verify`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-607 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-607 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# R6

# GEO-701 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 定义 GEO 规则集契约和配置 |
| 阶段 | R6 |
| 依赖 | GEO-601 |
| 建议分支 | `geo/GEO-701` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-701
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-701：定义 GEO 规则集契约和配置**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-701`
发布阶段：`R6`
依赖任务：GEO-601

## 本任务目标

最低样本、阈值、去重窗口、复测恢复条件和规则 revision/preview。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-701 当前允许进入执行，并逐项确认依赖任务 GEO-601 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-701 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `contracts`
   - `backend/app/models or config`
   - `backend/app/schemas`
   - `frontend`

必须交付：
- 最低样本、阈值、去重窗口、复测恢复条件和规则 revision/preview。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-701 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-701，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Browser Adapter、生产数据保留或最终上线。
- 规则更新只影响未来评估；历史 Opportunity 必须保存规则快照。
- 规则 preview 与正式评估必须复用同一服务端实现。

验收条件：
- 规则更新影响未来评估，历史 opportunity 保存快照。

## 明确范围外

- 不实现任务清单中未写入 GEO-701 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-702。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Schema、权限、revision、规则 preview。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-701 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-701 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-702 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 Opportunity 数据模型、identity 和评估器 |
| 阶段 | R6 |
| 依赖 | GEO-701, GEO-603, GEO-604 |
| 建议分支 | `geo/GEO-702` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-702
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-702：实现 Opportunity 数据模型、identity 和评估器**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-702`
发布阶段：`R6`
依赖任务：GEO-701、GEO-603、GEO-604

## 本任务目标

opportunities/sources/actions、确定性 identity、初始规则、批量评估。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-702 当前允许进入执行，并逐项确认依赖任务 GEO-701、GEO-603、GEO-604 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-702 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/models`
   - `backend/alembic`
   - `backend/app/services/geo_opportunities.py`

必须交付：
- opportunities/sources/actions、确定性 identity、初始规则、批量评估。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-702 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-702，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Browser Adapter、生产数据保留或最终上线。
- Opportunity identity 必须确定性去重并支持并发最终防线。
- 样本不足或不可用时不得创建误导性机会；需记录不可用原因。

验收条件：
- 每个机会含规则、值、阈值、来源运行和不可用原因。

## 明确范围外

- 不实现任务清单中未写入 GEO-702 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-703。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：并发去重、样本不足、周期更新、状态机。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `uv run --project backend alembic -c backend/alembic.ini upgrade head`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-702 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-702 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-703 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 Opportunity API、读模型和工作台 |
| 阶段 | R6 |
| 依赖 | GEO-702 |
| 建议分支 | `geo/GEO-703` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-703
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-703：实现 Opportunity API、读模型和工作台**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-703`
发布阶段：`R6`
依赖任务：GEO-702

## 本任务目标

列表、详情、ack/dismiss、证据、状态、URL 筛选和 Drawer。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-703 当前允许进入执行，并逐项确认依赖任务 GEO-702 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-703 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/routers`
   - `backend/app/schemas`
   - `frontend/src/domains/geo-opportunities`

必须交付：
- 列表、详情、ack/dismiss、证据、状态、URL 筛选和 Drawer。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-703 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-703，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Browser Adapter、生产数据保留或最终上线。
- 状态和 available_actions 由服务端拥有。
- dismiss/resolve 必须有非空原因并保留证据。

验收条件：
- 状态和动作服务端拥有；驳回/解决需非空原因。

## 明确范围外

- 不实现任务清单中未写入 GEO-703 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-704。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：权限、revision、组件、E2E。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-703 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-703 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-704 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 集成事实修订、内容任务和发布修复行动 |
| 阶段 | R6 |
| 依赖 | GEO-703 |
| 建议分支 | `geo/GEO-704` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-704
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-704：集成事实修订、内容任务和发布修复行动**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-704`
发布阶段：`R6`
依赖任务：GEO-703

## 本任务目标

通过现有服务创建/导航行动、保存 action link 和来源快照。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-704 当前允许进入执行，并逐项确认依赖任务 GEO-703 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-704 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_opportunities.py`
   - `existing domain services`

必须交付：
- 通过现有服务创建/导航行动、保存 action link 和来源快照。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-704 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-704，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Browser Adapter、生产数据保留或最终上线。
- 创建事实修订、内容任务或发布修复必须调用现有领域服务，禁止直接修改其他领域 ORM。
- 任务完成不会自动解决 Opportunity。

验收条件：
- 不直接修改其他域 ORM；任务完成不自动解决机会。

## 明确范围外

- 不实现任务清单中未写入 GEO-704 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-705。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：跨域集成、失败回滚/可恢复、权限、审计。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-704 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-704 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-705 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 RetestPlanner、基线冻结和可比性门禁 |
| 阶段 | R6 |
| 依赖 | GEO-704, GEO-303 |
| 建议分支 | `geo/GEO-705` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-705
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-705：实现 RetestPlanner、基线冻结和可比性门禁**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-705`
发布阶段：`R6`
依赖任务：GEO-704、GEO-303

## 本任务目标

基线 snapshot、严格矩阵复现、差异列表、RETEST batch、幂等。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-705 当前允许进入执行，并逐项确认依赖任务 GEO-704、GEO-303 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-705 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services/geo_retests.py`
   - `backend/app/routers`

必须交付：
- 基线 snapshot、严格矩阵复现、差异列表、RETEST batch、幂等。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-705 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-705，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Browser Adapter、生产数据保留或最终上线。
- 复测必须严格冻结基线矩阵和可比维度。
- Profile/Variant/模型版本不可比时必须阻断或要求新基线，不得静默替换。

验收条件：
- 不可比时阻断或要求新基线，不静默替换。

## 明确范围外

- 不实现任务清单中未写入 GEO-705 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-706。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：profile/variant 不可用、模型版本变化、并发、重复复测。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-705 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-705 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-706 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现干预前后比较和机会解决流程 |
| 阶段 | R6 |
| 依赖 | GEO-705, GEO-605 |
| 建议分支 | `geo/GEO-706` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-706
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-706：实现干预前后比较和机会解决流程**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-706`
发布阶段：`R6`
依赖任务：GEO-705、GEO-605

## 本任务目标

baseline/retest metrics、样本说明、恢复规则、显式 resolve/continue。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-706 当前允许进入执行，并逐项确认依赖任务 GEO-705、GEO-605 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-706 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `frontend/src/domains/geo-opportunities`

必须交付：
- baseline/retest metrics、样本说明、恢复规则、显式 resolve/continue。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-706 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-706，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Browser Adapter、生产数据保留或最终上线。
- 页面和服务不得宣称单次前后变化具有因果关系。
- 结果必须显示样本、环境、模型和采集方式差异。

验收条件：
- 页面不宣称因果；结果含环境/模型差异。

## 明确范围外

- 不实现任务清单中未写入 GEO-706 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-707。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：前后窗口、样本不足、未恢复、人工解决。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-706 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-706 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-707 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 完成机会闭环 E2E、审计和 R6 验收 |
| 阶段 | R6 |
| 依赖 | GEO-706 |
| 建议分支 | `geo/GEO-707` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-707
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-707：完成机会闭环 E2E、审计和 R6 验收**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-707`
发布阶段：`R6`
依赖任务：GEO-706

## 本任务目标

TOPIC_COVERAGE_GAP→ContentTask→RETEST→resolve 纵向流，补齐审计。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-707 当前允许进入执行，并逐项确认依赖任务 GEO-706 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-707 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/01-product/03-information-architecture-and-page-spec.md`
   - `docs/geo-monitoring/02-business/01-business-architecture.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/03-api-contract-design.md`
   - `docs/geo-monitoring/03-technical/04-frontend-architecture.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/tests/integration`
   - `frontend/tests/e2e`
   - `docs`

必须交付：
- TOPIC_COVERAGE_GAP→ContentTask→RETEST→resolve 纵向流，补齐审计。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-707 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-707，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得实现 Browser Adapter、生产数据保留或最终上线。
- 本任务只收口“监测→行动→复测”纵向 E2E、审计和文档，不新增规则类型。
- 审计和 E2E 产物不得包含凭据或敏感正文。

验收条件：
- 核心版“监测→行动→复测”闭环可用。

## 明确范围外

- 不实现任务清单中未写入 GEO-707 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-901, GEO-902。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Playwright、make verify、审计脱敏。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make e2e`
- `make verify`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-707 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-707 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# R7

# GEO-801 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 建立独立 Browser Collector 服务骨架和 Compose profile |
| 阶段 | R7 |
| 依赖 | GEO-408, GEO-002 |
| 建议分支 | `geo/GEO-801` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-801
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-801：建立独立 Browser Collector 服务骨架和 Compose profile**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-801`
发布阶段：`R7`
依赖任务：GEO-408、GEO-002

## 本任务目标

独立镜像/服务、任务领取边界、资源/网络限制、默认关闭。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-801 当前允许进入执行，并逐项确认依赖任务 GEO-408、GEO-002 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-801 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `deploy`
   - `browser collector package`
   - `backend`

必须交付：
- 独立镜像/服务、任务领取边界、资源/网络限制、默认关闭。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-801 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-801，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得批量扩展多个真实平台，也不得跳过合规/人工授权门禁。
- Browser Collector 必须是独立服务/镜像/Profile，默认关闭并有 kill switch。
- 普通 API/Worker 镜像不得引入浏览器依赖。

验收条件：
- 普通 API/Worker 不包含浏览器依赖，kill switch 可用。

## 明确范围外

- 不实现任务清单中未写入 GEO-801 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-802, GEO-803。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：Compose config、健康、无 profile 时不启动。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-deploy-scripts`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-801 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-801 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-802 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现浏览器会话加密引用和撤销流程 |
| 阶段 | R7 |
| 依赖 | GEO-801 |
| 建议分支 | `geo/GEO-802` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-802
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-802：实现浏览器会话加密引用和撤销流程**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-802`
发布阶段：`R7`
依赖任务：GEO-801

## 本任务目标

session reference、health、人工登录导入/撤销、访问控制和审计。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-802 当前允许进入执行，并逐项确认依赖任务 GEO-801 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-802 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `object storage/secure volume`
   - `admin UI`

必须交付：
- session reference、health、人工登录导入/撤销、访问控制和审计。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-802 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-802，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得批量扩展多个真实平台，也不得跳过合规/人工授权门禁。
- Cookie 和浏览器会话不得以明文进入数据库、日志、普通 OSS、截图或任务 payload。
- 导入、访问和撤销必须受管理员权限与审计保护。

验收条件：
- Cookie 不进数据库明文、日志、普通 OSS 或截图。

## 明确范围外

- 不实现任务清单中未写入 GEO-802 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-804。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：越权、secret redaction、撤销、恢复。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-802 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-802 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-803 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 建设本地模拟 AI 产品和 Browser Adapter 合同套件 |
| 阶段 | R7 |
| 依赖 | GEO-801, GEO-402 |
| 建议分支 | `geo/GEO-803` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-803
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-803：建设本地模拟 AI 产品和 Browser Adapter 合同套件**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-803`
发布阶段：`R7`
依赖任务：GEO-801、GEO-402

## 本任务目标

streaming DOM、引用卡片、登录态、selector 变化、挑战页和敏感 UI。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-803 当前允许进入执行，并逐项确认依赖任务 GEO-801、GEO-402 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-803 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `tests/browser-fixture`
   - `browser collector tests`

必须交付：
- streaming DOM、引用卡片、登录态、selector 变化、挑战页和敏感 UI。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-803 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-803，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得批量扩展多个真实平台，也不得跳过合规/人工授权门禁。
- 合同测试必须完全本地，CI 不得访问真实第三方。
- 模拟站要覆盖 streaming DOM、selector 变化、挑战页和敏感 UI。

验收条件：
- CI 不访问真实第三方，适配器失败语义可重复。

## 明确范围外

- 不实现任务清单中未写入 GEO-803 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-804。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：完全本地 Playwright adapter contract。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make e2e`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-803 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-803 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-804 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现第一个合规批准的真实界面 Adapter |
| 阶段 | R7 |
| 依赖 | GEO-802, GEO-803 |
| 建议分支 | `geo/GEO-804` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-804
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-804：实现第一个合规批准的真实界面 Adapter**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-804`
发布阶段：`R7`
依赖任务：GEO-802、GEO-803

## 本任务目标

temporary chat、submit、stable wait、answer/citation extraction、version metadata。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-804 当前允许进入执行，并逐项确认依赖任务 GEO-802、GEO-803 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-804 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `browser collector adapters`

必须交付：
- temporary chat、submit、stable wait、answer/citation extraction、version metadata。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-804 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-804，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得批量扩展多个真实平台，也不得跳过合规/人工授权门禁。
- 只实现一个经合规批准的平台；不得绕过验证码、访问控制或反自动化保护。
- DOM 不确定或答案未稳定时必须失败，不能保存空成功。
- 真实 smoke 只能在受控 staging 且获得人工授权后执行。

验收条件：
- DOM 不确定时失败，不保存空成功；频率限制生效。

## 明确范围外

- 不实现任务清单中未写入 GEO-804 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-805。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：local contract + 受控 staging smoke。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-804 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-804 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-805 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现浏览器证据捕获、敏感裁剪和对象存储提交 |
| 阶段 | R7 |
| 依赖 | GEO-804, GEO-304 |
| 建议分支 | `geo/GEO-805` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-805
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-805：实现浏览器证据捕获、敏感裁剪和对象存储提交**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-805`
发布阶段：`R7`
依赖任务：GEO-804、GEO-304

## 本任务目标

截图、可选安全 DOM 摘要、哈希、敏感区域规则和 AnswerSnapshot 提交。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-805 当前允许进入执行，并逐项确认依赖任务 GEO-804、GEO-304 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-805 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `browser collector`
   - `backend file services`

必须交付：
- 截图、可选安全 DOM 摘要、哈希、敏感区域规则和 AnswerSnapshot 提交。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-805 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-805，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得批量扩展多个真实平台，也不得跳过合规/人工授权门禁。
- 截图和 DOM 摘要必须裁剪账号菜单、登录、支付、Cookie 和调试敏感信息。
- 对象存储失败不得产生已完成 AnswerSnapshot。

验收条件：
- 业务证据不包含账号、Cookie、支付或调试敏感信息。

## 明确范围外

- 不实现任务清单中未写入 GEO-805 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-806。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：账号菜单/登录页/失败截图、哈希、存储故障。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-805 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-805 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-806 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 Browser Profile 健康、频率、kill switch 和管理 UI |
| 阶段 | R7 |
| 依赖 | GEO-805, GEO-205 |
| 建议分支 | `geo/GEO-806` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-806
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-806：实现 Browser Profile 健康、频率、kill switch 和管理 UI**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-806`
发布阶段：`R7`
依赖任务：GEO-805、GEO-205

## 本任务目标

session health、reauth、max concurrency、rate limit、开关、运维状态。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-806 当前允许进入执行，并逐项确认依赖任务 GEO-805、GEO-205 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-806 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `frontend configuration`
   - `ops`

必须交付：
- session health、reauth、max concurrency、rate limit、开关、运维状态。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-806 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-806，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得批量扩展多个真实平台，也不得跳过合规/人工授权门禁。
- 管理员必须能立即停止新 Browser runs；会话过期和 reauth 状态必须可观察。
- 频率、并发和 kill switch 在服务端/Collector 层强制。

验收条件：
- 管理员可立即停止新浏览器运行并识别需重新登录 profile。

## 明确范围外

- 不实现任务清单中未写入 GEO-806 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-807。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：会话过期、停用、并发、UI 权限。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`
- `npm --prefix frontend run test`
- `npm --prefix frontend run typecheck`
- `make test-deploy-scripts`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-806 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-806 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-807 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 执行真实平台小规模试点和人工交叉验收 |
| 阶段 | R7 |
| 依赖 | GEO-806 |
| 建议分支 | `geo/GEO-807` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-807
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-807：执行真实平台小规模试点和人工交叉验收**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-807`
发布阶段：`R7`
依赖任务：GEO-806

## 本任务目标

批准账号、低频计划、人工/API/浏览器结果对比、停止和撤销演练。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-807 当前允许进入执行，并逐项确认依赖任务 GEO-806 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-807 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/01-product/01-product-vision-and-scope.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `staging runbook`
   - `docs`
   - `acceptance evidence`

必须交付：
- 批准账号、低频计划、人工/API/浏览器结果对比、停止和撤销演练。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-807 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-807，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得批量扩展多个真实平台，也不得跳过合规/人工授权门禁。
- 这是一项受控人工试点，不属于普通 CI。没有批准账号、频率、责任人和合规清单时必须停止并标记 blocked。
- 不得擅自启用生产 Profile；只能在明确授权的 staging 范围执行。

验收条件：
- 合规清单、数据质量、账号安全和试点报告均批准后才可生产启用。

## 明确范围外

- 不实现任务清单中未写入 GEO-807 deliverables 的能力。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：受控人工验收，不作为普通 CI。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make test-deploy-scripts`
- `make verify`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-807 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-807 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# R8

# GEO-901 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 实现 GEO 数据保留、归档和清理任务 |
| 阶段 | R8 |
| 依赖 | GEO-707 |
| 建议分支 | `geo/GEO-901` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-901
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-901：实现 GEO 数据保留、归档和清理任务**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-901`
发布阶段：`R8`
依赖任务：GEO-707

## 本任务目标

raw payload、临时草稿、无引用文件、浏览器临时数据的限批清理和墓碑。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-901 当前允许进入执行，并逐项确认依赖任务 GEO-707 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-901 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/00-governance/01-document-governance.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `backend/app/services`
   - `backend/app/worker.py`
   - `contracts/database.md`

必须交付：
- raw payload、临时草稿、无引用文件、浏览器临时数据的限批清理和墓碑。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-901 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-901，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得改变已验收业务公式或借生产硬化名义扩展新产品功能。
- 清理必须限批、可 dry-run、可观察并保护全部仍被引用的证据和指标元数据。
- 存储失败保留可重试墓碑，不得静默丢失记录。

验收条件：
- 不删除指标所需元数据和已引用证据，清理可观察。

## 明确范围外

- 不实现任务清单中未写入 GEO-901 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-903。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：保留边界、引用保护、存储故障重试、dry-run。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make contract-check`
- `make lint`
- `make typecheck`
- `make test-unit`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-901 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-901 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-902 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 完善运行、成本、失败和积压可观察性 |
| 阶段 | R8 |
| 依赖 | GEO-408, GEO-607, GEO-707 |
| 建议分支 | `geo/GEO-902` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-902
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-902：完善运行、成本、失败和积压可观察性**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-902`
发布阶段：`R8`
依赖任务：GEO-408、GEO-607、GEO-707

## 本任务目标

低敏感指标、dashboard/alerts、稳定日志字段、Scheduler/Worker health。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-902 当前允许进入执行，并逐项确认依赖任务 GEO-408、GEO-607、GEO-707 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-902 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/00-governance/01-document-governance.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `logging`
   - `metrics`
   - `ops docs`

必须交付：
- 低敏感指标、dashboard/alerts、稳定日志字段、Scheduler/Worker health。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-902 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-902，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得改变已验收业务公式或借生产硬化名义扩展新产品功能。
- 监控必须区分系统故障与业务低表现，日志仅包含低敏感稳定字段。
- 必须可定位 oldest pending、expired lease、费用异常和失败分布。

验收条件：
- 可区分业务低表现与系统故障；可定位 oldest pending/expired lease。

## 明确范围外

- 不实现任务清单中未写入 GEO-902 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-903, GEO-905。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：指标模拟、告警阈值、日志 secret scan。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-deploy-scripts`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-902 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-902 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-903 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 完成数据库、OSS、密钥和会话备份恢复演练 |
| 阶段 | R8 |
| 依赖 | GEO-901, GEO-902 |
| 建议分支 | `geo/GEO-903` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-903
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-903：完成数据库、OSS、密钥和会话备份恢复演练**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-903`
发布阶段：`R8`
依赖任务：GEO-901、GEO-902

## 本任务目标

备份清单、恢复脚本/步骤、一致性扫描、隔离恢复证据。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-903 当前允许进入执行，并逐项确认依赖任务 GEO-901、GEO-902 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-903 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/00-governance/01-document-governance.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `deploy/scripts`
   - `operations docs`
   - `test environment`

必须交付：
- 备份清单、恢复脚本/步骤、一致性扫描、隔离恢复证据。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-903 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-903，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得改变已验收业务公式或借生产硬化名义扩展新产品功能。
- 恢复演练只能在隔离环境执行，绝不能以生产主库为恢复目标。
- 数据库、OSS、AI 加密主密钥和 Browser 会话引用必须按一致性集合验证。
- 缺失对象必须明确报告，不得伪造完整恢复。

验收条件：
- 任意 Run Detail 和指标可恢复；缺失对象明确报告。

## 明确范围外

- 不实现任务清单中未写入 GEO-903 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-904, GEO-906。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：真实隔离恢复、哈希、凭据解密、调度去重。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-deploy-scripts`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-903 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-903 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-904 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 执行 GEO 安全与合规专项复核 |
| 阶段 | R8 |
| 依赖 | GEO-903 |
| 建议分支 | `geo/GEO-904` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-904
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-904：执行 GEO 安全与合规专项复核**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-904`
发布阶段：`R8`
依赖任务：GEO-903

## 本任务目标

权限、CSRF、SSRF、secret、XSS、CSV、prompt injection、browser 会话和外部平台批准检查。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-904 当前允许进入执行，并逐项确认依赖任务 GEO-903 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-904 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/00-governance/01-document-governance.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `security tests`
   - `docs`
   - `configuration`

必须交付：
- 权限、CSRF、SSRF、secret、XSS、CSV、prompt injection、browser 会话和外部平台批准检查。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-904 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-904，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得改变已验收业务公式或借生产硬化名义扩展新产品功能。
- 本任务首先是专项复核和证据汇总；不得为“通过检查”放宽安全边界。
- 未接受的高风险项必须阻断；例外必须有责任人和到期日。

验收条件：
- 无未接受的高风险项；例外有责任人和到期日。

## 明确范围外

- 不实现任务清单中未写入 GEO-904 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-906。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：全部 TEST-GEO-SEC。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-integration`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-904 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-904 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-905 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 完成大数据量性能和容量硬化 |
| 阶段 | R8 |
| 依赖 | GEO-607, GEO-902 |
| 建议分支 | `geo/GEO-905` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-905
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-905：完成大数据量性能和容量硬化**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-905`
发布阶段：`R8`
依赖任务：GEO-607、GEO-902

## 本任务目标

100k+ runs、1000 run batch、流式导出、并发 Worker、必要索引/物化策略。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-905 当前允许进入执行，并逐项确认依赖任务 GEO-607、GEO-902 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-905 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/00-governance/01-document-governance.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `indexes`
   - `query services`
   - `worker configs`
   - `performance tests`

必须交付：
- 100k+ runs、1000 run batch、流式导出、并发 Worker、必要索引/物化策略。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-905 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-905，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得改变已验收业务公式或借生产硬化名义扩展新产品功能。
- 性能优化必须以查询计划、基准和目标环境阈值为证据。
- 任何缓存或物化结果必须可重建且不能成为业务权威。

验收条件：
- 达到目标环境阈值，缓存可重建且不成为权威。

## 明确范围外

- 不实现任务清单中未写入 GEO-905 deliverables 的能力。
- 尤其不得提前实现直接后续任务：GEO-906。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：性能门禁和查询计划。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-integration`
- `运行任务新增的性能基准和 EXPLAIN/查询计划检查`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-905 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-905 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```

# GEO-906 Codex 提示词

| 字段 | 内容 |
|---|---|
| 标题 | 执行生产渐进上线、最终验收和文档状态更新 |
| 阶段 | R8 |
| 依赖 | GEO-903, GEO-904, GEO-905 |
| 建议分支 | `geo/GEO-906` |
| 任务状态结束值 | `review`，人工验收后再改 `done` |

## 使用前

```bash
cd /Users/sc/PycharmProjects/partsignal
git status --short
git switch main
git pull --ff-only
git switch -c geo/GEO-906
codex
```

> 如果你的主开发分支不是 `main`，替换为实际基线分支。若分支已存在，切换现有分支，不要重复创建。

## 复制给 Codex

```text
请实现 PartSignal GEO 任务 **GEO-906：执行生产渐进上线、最终验收和文档状态更新**。

仓库根目录：`/Users/sc/PycharmProjects/partsignal`
建议分支：`geo/GEO-906`
发布阶段：`R8`
依赖任务：GEO-903、GEO-904、GEO-905

## 本任务目标

expand/deploy/enable、内部试用、监控窗口、回滚演练、文档已实现标记。

## 开始前必须执行

1. 读取根 `AGENTS.md`、当前目录适用的子级 `AGENTS.md`、`.trellis/spec` 和现有 GEO 任务记录。
2. 打开 `docs/geo-monitoring/04-delivery/task-manifest.yaml`，确认 GEO-906 当前允许进入执行，并逐项确认依赖任务 GEO-903、GEO-904、GEO-905 均为 `done`。
3. 在 `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md` 中读取 GEO-906 的完整任务行。
4. 读取下列文档，不得仅凭任务标题编码：
   - `docs/geo-monitoring/README.md`
   - `docs/geo-monitoring/04-delivery/01-implementation-roadmap.md`
   - `docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md`
   - `docs/geo-monitoring/04-delivery/04-codex-execution-guide.md`
   - `docs/geo-monitoring/04-delivery/05-task-template.md`
   - `docs/geo-monitoring/04-delivery/task-manifest.yaml`
   - `docs/geo-monitoring/00-governance/01-document-governance.md`
   - `docs/geo-monitoring/01-product/02-geo-core-prd.md`
   - `docs/geo-monitoring/02-business/04-monitoring-methodology-and-metrics.md`
   - `docs/geo-monitoring/03-technical/01-technical-architecture.md`
   - `docs/geo-monitoring/03-technical/02-data-architecture.md`
   - `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
   - `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
   - `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
   - `docs/geo-monitoring/02-business/02-domain-model.md`
   - `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
   - `docs/geo-monitoring/05-decisions/ADR-001-extend-modular-monolith.md`
   - `docs/geo-monitoring/05-decisions/ADR-002-unified-observation-run-model.md`
   - `docs/geo-monitoring/05-decisions/ADR-003-separate-collection-analysis-review.md`
   - `docs/geo-monitoring/05-decisions/ADR-004-no-unified-geo-score.md`
   - `docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md`
5. 读取当前 `contracts/openapi.yaml`、`contracts/database.md`、相关迁移、代码和测试，确认“当前实现”与“目标文档”的差异。
6. 按 `docs/geo-monitoring/04-delivery/05-task-template.md` 和仓库现有 `.trellis` 约定创建本任务 Task Brief。
7. 运行与本任务相关的当前基线测试；若无法运行，记录精确命令、环境阻断和已获得的证据。

## 本任务范围

主要代码区域：
   - `deploy`
   - `docs`
   - `release manifest`
   - `acceptance`

必须交付：
- expand/deploy/enable、内部试用、监控窗口、回滚演练、文档已实现标记。
- 相关契约、数据库合同、迁移、测试和文档必须保持一致；只更新本任务实际涉及的层。
- 开始实施时把 GEO-906 状态更新为 `in_progress`；实现及本地验证完成后更新为 `review`，不得自行标记为 `done`。

## 不可违反的不变量

- 一次只实现 GEO-906，不得提前实现任何其他 GEO 任务。
- 保持模块化单体；PostgreSQL 是业务状态唯一来源；Redis 消息只传稳定 ID。
- Router 不拥有事务、行锁或 ORM 写入；Application Service 拥有业务不变量。
- 公共功能契约优先；前端只消费 generated OpenAPI 类型，不维护第二套状态机或指标公式。
- 不使用真实外部 AI 平台作为普通测试；CI 使用 fake provider 或本地模拟站。
- 不为通过测试放宽权限、CSRF、SSRF、TLS、凭据、不可变或审计边界。
- 不得改变已验收业务公式或借生产硬化名义扩展新产品功能。
- 生产启用必须分阶段、可停止、可回滚，并要求明确人工批准。
- 未批准 Browser Profile 必须保持关闭。
- 无法访问生产环境或缺少授权时只完成发布准备、runbook 和阻断清单，不得宣称已上线。

验收条件：
- 核心版正式可用；未批准 Browser profile 保持关闭；所有任务证据归档。

## 明确范围外

- 不实现任务清单中未写入 GEO-906 deliverables 的能力。
- 不做无关重构、不升级依赖大版本、不引入 MongoDB、Kafka、向量库或新身份系统。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖状态检查；
2. 当前行为；
3. 目标行为；
4. 当前实现与目标文档的差异；
5. 范围内和明确范围外；
6. 计划修改文件；
7. OpenAPI/数据库/Alembic 变化；
8. 事务、锁顺序、revision、状态机、幂等和并发影响；
9. 前端路由/query key/URL 状态影响（如适用）；
10. 安全、隐私、外部调用和敏感数据边界；
11. 测试计划；
12. 风险与停止条件。

只有遇到以下情况才停止并将任务标记为 `blocked`：

- 文档或已接受 ADR 存在无法消解的业务冲突；
- 需要未批准的破坏性历史数据迁移；
- 需要改变已批准指标、状态机或安全边界；
- 完成本任务必需的外部输入或人工授权缺失；
- 依赖任务实际未完成。

## 最低验证要求

任务清单指定测试：make verify、生产 smoke、恢复/停止演练。

至少运行并报告以下命令；按实际变更增加更精确的定向测试：
- `git diff --check`
- `make lint`
- `make typecheck`
- `make test-deploy-scripts`
- `make verify`

不得把未运行的命令写成通过。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. OpenAPI 和数据库合同变化；
4. Alembic revision、前滚结果和数据迁移说明；
5. 关键业务不变量如何保证；
6. 锁、幂等、并发和错误映射；
7. 安全与敏感数据边界；
8. 前端行为与页面状态（如适用）；
9. 实际运行的测试命令和逐项结果；
10. 未运行测试及具体原因；
11. Task Brief、`.trellis` 证据和 task-manifest 状态变化；
12. 已知限制；
13. 后续任务，但不要实现它们。
```

## 人工验收后使用的收尾提示词

```text
我已经人工审查并接受 GEO-906 的实现与测试证据。

请只执行以下收尾操作：

1. 将 `docs/geo-monitoring/04-delivery/task-manifest.yaml` 中 GEO-906 从 `review` 更新为 `done`；
2. 按仓库现有 `.trellis` 约定记录人工验收完成；
3. 不修改其他任务状态，不实现后续任务；
4. 运行 `git diff --check`，并报告最终修改文件和结果。
```
