# GEO Core V1.0：人工优先渐进发布 Runbook（GEO-906 历史 / R9A）

本文是 GEO R8 的执行与验收补充。生产发布所有者仍为[Production Runbook](../../Hostdzire部署上线流程.md)、[部署附录](../../Hostdzire部署附录.md)及仓库 `deploy/scripts/deploy.sh`、`activate-production.sh`、`prepare-production-data.py`。本文不授权远端操作，不另建发布执行器。当前生产阶段 **NOT_STARTED**；缺目标、固定候选及人工批准时停止在发布准备。

范围依据 [ADR-006](../05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)：R6 → R8，以 [MANUAL SOP](../02-business/05-manual-geo-observation-sop.md)完成回答级观测；804～807 deferred/post-core，不阻断核心。不把真实 Browser Adapter、截图或登录探针写成已实现。Browser 必须持续 false，服务/profile 不启用且无生产会话。

## 0. V1.0 Go / No-Go

首发范围现由 [Accepted ADR-007](../05-decisions/ADR-007-manual-first-v1-release-scope.md) 和 [统一能力矩阵](../01-product/05-v1-release-capability-matrix.md)冻结；ADR-006 的 Browser 延期继续有效。GEO-1001 NO-GO、R0—R8 的人工接受和 GEO-906 原始生产证据保留。当前生产 NOT_STARTED，必需现场项 NOT_VERIFIED；本次文档冻结不产生新的现场结果。

**进入生产 prepare 的前提是 R9A 修复与固定候选闭合；进入 expand/deploy/enable 还必须分别满足其阶段输入和授权。Go 是实际证据判定，不是任务计数或开关值推断。**

| 门禁 | Go 所需证据 | 当前结论/收口任务 |
|---|---|---|
| 范围与任务接受 | ADR-007 Accepted；1002～1009 已人工接受，候选包含全部修复；范围外能力披露 | GEO-1002 交付 review；后续 planned，当前 NOT_MET |
| Browser production 硬禁止 | Settings/启动预检/profile-overlay 明确拒绝 true/显式启动，负例通过且独立复核；现场三进程 false、零服务/profile/会话/材料 | NOT_MET / NOT_VERIFIED；1003/1010 |
| Catalog 当前身份 | 正确锁序及锁内 active/ADMIN/改密重验；真实 PG 角色变化竞态拒绝且零业务写入，独立复核 | NOT_MET；1004 |
| CRON 禁用与既存治理 | 禁止 CRON Plan 新建/全部写命令/首次 run、PLAN 建批及 scheduled 新窗口，稳定 409；历史配置/状态/快照只读，无写动作且页面明确不调度；MANUAL 入口正常 | GEO-1005 本地实现交付 review；目标/候选历史清点及投影现场证据 NOT_VERIFIED（1010）；不要求自动到期入口 |
| Opportunity 显式评估 | ADMIN 经实际受保护入口评估，非管理员/资格关闭拒绝，重复触发去重、来源可追溯；无周期或隐式触发 | GEO-1006 本地实现交付 review；同候选现场实际入口证据 NOT_VERIFIED（1010）；测试 seed 不替代入口 |
| 能力真实性 | 现有报告/三类 CSV/API 与页面说明一致；未实现 CSV/UI/重分析/占位明确不可用，无依据无引用不推断 | NOT_VERIFIED；1007 |
| 升级失败恢复 | 未 initialized 的 UPGRADE_DEPLOYING/PREPARED artifact 失败可安全前向/阶段恢复；身份/兼容/维护锁/再次失败拒绝演练和独立复核 | 本地修复见 GEO-1007 Trellis（delivery 1008），已 review，待人工接受；固定候选及目标恢复仍 NOT_VERIFIED（1009/1010） |
| 固定候选 | clean main=origin/main；commit/archive/release manifest/images/schema/tracked hashes 一致；同候选完整 make verify exit 0，失败/skip/限制明列 | NOT_VERIFIED；1009；旧本地成功日志不替代新候选 |
| 目标配置与安全 | 精确目标/入口/权限，API/Worker/Beat 重建实际值一致；API 初始 false、显式评估资格准确；CSRF/SSRF/secret/页面安全及全应用 AI/OSS Gate | NOT_VERIFIED；1010；不输出秘密 |
| 目标备份/容量/监控/恢复 | DB/OSS/适用密钥成套备份与隔离扫描；目标规格/代表负载/冻结阈值及告警观察期；目标安全停止、升级失败恢复与恢复后对账 | NOT_VERIFIED；1010；904/905/906 done 不证明现场 |
| 正式 MANUAL 与内部试运行 | 真实批准样本→原文/引用/证据→确定性分析→必要复核→指标/现有报告→管理员显式评估→Action/Retest API→严格比较/显式解决；人群/时长/反馈与业务签署 | NOT_VERIFIED；1010；不把 API 操作写成全程页面 |
| 阶段批准与最终签署 | 同候选/目标 expand/deploy/enable、访问开放及停止/恢复所需批准；GEO-1010 必需门禁全部 MET，业务/运维签署 | NOT_VERIFIED；当前 NO-GO；未具名者不得补造 |

任何必需项 NOT_MET、NOT_VERIFIED、缺失、失败或缺批准均 No-Go，并保存失败/未知和具体恢复输入。Go 不授权超出已批准范围的公开流量、API 启用、实际材料删除或 Browser 试点。GEO-1010 完成先 review；done 需用户接受，阶段操作仍遵守相应授权。

V1.0 不要求真实 Browser Adapter、CRON 到期自动创建、Opportunity 自动周期评估、Opportunity CSV、完整 Action/Retest 页面或公共管理员重分析；这些排除项不单独阻断，但“未实现能力被描述为可用”、CRON 假 ACTIVE 或缺手动评估入口仍阻断。没有可观测依据时“无引用”推断禁止，UNKNOWN/不适用不能变成零表现。现有分析/补投递/租约恢复扫描继续执行，不能关闭整个 Beat 来冒充业务调度禁用。

GEO-1010 必须另建绑定目标/候选/时间的低敏 readiness 和 Go/No-Go 记录，引用阶段批准、1003～1009 修复/候选证据、现场检查和签署。[旧 production-readiness](../../../.trellis/tasks/10-05-geo-906-rollout/evidence/production-readiness.yaml)是原始历史证据，不改 null/NOT_VERIFIED 或旧缺口来制造通过；模板和策略值不是现场事实。

## 1. 入场与证据

每次执行从[发布记录模板](../04-delivery/geo-906-release-record.template.yaml)复制一份低敏记录到对应任务 evidence，填实际目标、UTC 时间、负责人及受保护材料引用。模板不是实际 candidate manifest，也不是批准。未知用 null/NOT_VERIFIED，不能补 false、0 或 N/A。

| 门禁 | 进入下一阶段所需证据 |
|---|---|
| 依赖 | manifest 的 903/904/905/906 历史 done 与接受记录保留；V1.0 还需 1002～1009 done，不能豁免 904 现场及 905 容量未验证项 |
| 目标 | 精确环境、获准访问入口、运行 project/网络 owner、配置与数据归属；SSH 身份冲突即停止 |
| 候选 | clean main = origin/main = 完整 commit；确定性 git archive；不可覆盖 release ID、manifest、镜像 ID/RepoDigest 与 tracked-file 校验和 |
| 备份 | GEO-903 同一静默窗口的 DB/对象/适用密钥/运行配置成套备份，摘要和隔离恢复扫描；密钥另存受保护通道 |
| 容量 | 目标硬件、容器限额、代表性负载与冻结阈值；并发维持 1，不能把本地十路 prefork 约 801MiB 采样当作 production 1GiB 余量证明 |
| 批准 | expand/deploy/enable 各自审批人、目标、候选、窗口、操作范围、停止/恢复负责人和批准记录引用；改变目标或候选须重新批准 |
| 全应用外部服务 | 真实 AI/OSS 配置与既有门禁；GEO API 关闭不免除 activation 的 `PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET` |

dirty GEO 分支只用于实现，不能生成正式 candidate。生成 candidate 必须在另一份已批准、已推送的 clean main 中使用既有 `create-release-manifest.py`；不使用测试绕过变量，不为准备材料提交或推送当前树。记录引用 producer 的原始 manifest，不复制或编造 image ID/commit。GEO-1006 当前本地候选的 schema head 为 `0066_geo_manual_evaluation`；该加法迁移只新增管理员评估回执及不可变守卫，不回填或改写既有业务历史。正式 candidate 必须包含已接受的迁移并按实际 head 核对。

现有发布入口把前滚和应用部署合在一次 `deploy.sh` 内。执行该入口前必须同时具备 expand 与 deploy 批准；不能通过手工迁移/Compose up 拆开或绕过维护锁和持久阶段。GEO 使用已有数据的 upgrade，不执行 clean-init/quarantine/物理删除。

## 2. 阶段及退出条件

| 阶段 | 操作和退出条件 | 失败后的安全状态 |
|---|---|---|
| prepare | 冻结目标/候选/审批；实际 Browser 负证据；备份/隔离恢复；本地门禁与容量边界明确 | 无生产写入，保持 NOT_STARTED |
| expand | 维护入口阻断新写入；暂停 Beat、按在途结果静默 consumer；一致性集合完成；由已批准 deploy 入口前滚至 0066、配置/完整性检查成功 | 保留维护响应、失败现场与原 schema/数据；不 downgrade |
| deploy | 同一入口验证 candidate/tracked files/镜像，部署 API/Frontend；Worker/Scheduler 尚未激活；回环 live/ready、前端与安全检查通过 | 保持维护；prepared 阶段不支持既有 frontend-only 回滚，按下文阶段限制停止 |
| enable 内部 | 单独批准须覆盖保护配置切换和同候选再次 deploy；在 UPGRADE_PREPARED 重入 deploy 重建 API，再 activate 启动 Worker/Beat；三进程一致、分析/恢复扫描通过后限定试用范围 | 停新写入和异步发布；保留证据，不开放公网 |
| observation / release | 负责人签署内部试用、冻结观察期和停止阈值；回环/公网/权限/核心结果完成；单独批准 Nginx 写入及 reload 后开放；观察期通过才能提交 review | 停止扩量，恢复维护，依批准恢复；不自行 done |

“渐进”以已批准的操作者、计划与批次范围、时间窗口和人工放量控制。仓库没有租户灰度百分比/白名单 feature flag；本任务不声称具有这些机制。若现有维护入口/访问控制无法限制获准人群，先解决批准范围与现有能力的差异，不能开放给所有用户代替内部试用。

阶段使用批准包在受保护通道配置 `ENV_FILE`、`PARTSIGNAL_VERSION`、backend/frontend image、`PARTSIGNAL_DATA_ROOT`、`PARTSIGNAL_RELEASE_MANIFEST` 与 `PARTSIGNAL_IMAGE_DELIVERY_MODE`。不把 .env/DSN/密钥写到工单或命令记录。project 固定 `partsignal-staging`，名称不等于环境语义；权威 Compose 为 `deploy/compose.prod.yaml`，不追加 Browser/session overlay。

批准和检查完成后，唯一应用入口为：

```sh
# 在获准目标的固定 candidate 目录、已加载保护发布配置时执行。
PARTSIGNAL_DEPLOY_MODE=upgrade deploy/scripts/deploy.sh
# 此时阶段必须为 UPGRADE_PREPARED，尚未 activate。
# 单独 enable 批准须包含配置切换与再次 deploy：在保护通道将 MANUAL 配置改为获准值。
# 同一 manifest 重入 deploy，保持维护状态，由原所有者重建 API 并重新核对完整性/health。
PARTSIGNAL_DEPLOY_MODE=upgrade deploy/scripts/deploy.sh
# 真实外部服务 Gate 和实际配置验收完成之后，按同一 enable 批准执行。
PARTSIGNAL_DEPLOY_MODE=upgrade deploy/scripts/activate-production.sh
# 分别验证回环与批准的公网 URL；此脚本只验 live/ready。
deploy/scripts/smoke.sh http://127.0.0.1:19000
```

现有入口内部持有维护锁、核对 upgrade-prepared 与镜像并记录持久阶段。`activate-production.sh` 只 up Worker/Scheduler，不重建 API；因此不能省略配置切换后的再次 deploy。`begin_upgrade` 仅在 UPGRADE_DEPLOYING/UPGRADE_PREPARED 接受同候选重入；PRODUCTION_INITIALIZED 明确拒绝相同 candidate 的 deploy/activate。不要提前以全关闭配置 activate，否则后续 enable 必须准备新 release 身份与新批准再走完整 upgrade。

升级完成不自动授权开放 Nginx；配置切换也不替代三进程重建与现场验证。Nginx 写入、`nginx -t` 和 reload 按 Production 所有者逐项批准。健康 smoke 不能替代 GEO 业务验收。

## 3. 配置与 Browser 零启用

| 配置 | expand/deploy | 获批 MANUAL enable |
|---|---|---|
| GEO_MONITORING_ENABLED | false | true，实际三进程一致 |
| GEO_API_COLLECTION_ENABLED | false | false；API 必须另有平台/输入/合规批准，不能作为 MANUAL 的兜底 |
| GEO_BROWSER_COLLECTION_ENABLED | **false；production 硬禁止 true** | **false；production 硬禁止 true** |
| GEO_OPPORTUNITY_EVALUATION_ENABLED | false | GEO-1006 显式入口验收且批准后 true；只授权管理员评估，无自动周期/隐式触发 |
| MANUAL Collection | 随总开关不开放新写入 | 启用；无独立 MANUAL 配置键 |
| CRON Plan | 禁止新建/启用 | 历史只读披露、不删除或回写状态；禁止从当前 Plan 首次建批，不接到期调度 |
| Opportunity 自动调度 | 不注册周期/隐式触发 | 关闭；不把评估资格开关当自动调度开关 |
| GEO_RETENTION_DRY_RUN | true | true；实际删除与期限另需数据负责人批准 |
| CELERY_CONCURRENCY | 1 | 1；提升需目标容量证据和批准 |

API/Worker/Beat 从 runtime env_file 读取共享 Settings，设置在启动时生效；编辑文件不证明运行进程已改变。Compose 的 Browser profile/开关还受部署 shell/`--env-file` 影响，必须同时核对实际启动 argv/profile、容器、overlay/mount 与进程配置。仅记录四个布尔值/摘要，不输出完整 `docker compose config`、inspect/env 或秘密路径。

GEO-1003 必须先交付 production 硬禁止的负例和启动边界证据；当前默认 false 尚不足。GEO-1005 已将 CRON 新建、全部历史 Plan 写命令与首次 run、PLAN 建批及 scheduled 新窗口收口；GEO-1010 必须证明同候选现场命令拒绝、历史只读与 UNSUPPORTED_SCHEDULE 披露，不能把存储 ACTIVE 当作调度可用，也不要求篡改历史为非 ACTIVE；GEO-1006 必须证明评估资格仅经显式管理员入口消费，没有自动周期/隐式触发。

生产负证据必须绑定同一目标/候选/时点并包含：

1. API/Worker/Beat 的实际 GEO_BROWSER_COLLECTION_ENABLED 均为 false。
2. 没有启动 geo-browser service、Browser Compose profile 或 session overlay；没有 Browser 私钥、服务能力或会话卷挂载。
3. 已有 Browser Profile 无启用项（记录计数），不会因当前 UI 隐藏而遗漏后端资格。
4. PG `geo_browser_sessions` 所有历史/撤销行计数及现存材料库存；核心“无生产会话”要求总行数 0，不能只查活动行。会话 root、临时/未引用密文与适用文件也需检查；没有表不是迁移成功后的合格证据。
5. API 批准 inventory 和模式开关仍关闭；不使用内部 factory 中未批准的 `openai-compatible-chat`。

Browser 清理/恢复仅当服务/profile/overlay 未部署且 PG 总行数 0、受保护库存确认无材料时可记 **N/A**，附上述证据。任何材料存在都先按 802/901/903 保护、撤销、PURGE 或成套恢复；不得为取得“零会话”删除不可变历史。无法证实即 NOT_VERIFIED，停止核心 enable，延期不豁免材料责任。

### 3.1 CRON 历史清点与验证（GEO-1005）

在获准的目标读取权限下，使用只读事务记录低敏计数（不输出名称、表达式、正文或配置）：

```sql
BEGIN READ ONLY;
SELECT status, count(*) FROM geo_monitoring_plans
WHERE schedule_kind = 'CRON' GROUP BY status ORDER BY status;
SELECT count(*) FROM geo_observation_batches WHERE trigger_type = 'SCHEDULED';
COMMIT;
```

同候选 API 列表/详情应把每个 CRON 投影为 UNSUPPORTED_SCHEDULE / VIEW_HISTORY、空 available_actions 和 GEO_PLAN_CRON_UNSUPPORTED run reason；UI 显示历史只读与无自动运行，原存储状态仅作历史字段。未知现场计数为 NOT_VERIFIED，不能填零。无 DELETE/UPDATE/批量停用脚本，不清理或改写历史，也不把 CRON 转为 MANUAL。

负例仅在授权的隔离验证范围调用：合法 CRON create、activate/resume、update/copy/delete/archive、run 与 PLAN Batch 均应明确 409 GEO_PLAN_CRON_UNSUPPORTED，CAS/鉴权失败仍按原合同裁决；前后数据库摘要一致，无 Batch/Run/Redis/成功审计副作用。正例通过 MANUAL create/activate/run 与 AD_HOC 创建证明人工入口正常。不要对目标反复做写探针来代替本地测试。

人工 Retest 保留现有独立入口：严格复制已提交基线，历史 plan_id/CRON 快照仅作来源，trigger_type=RETEST，不执行当前 Plan，不改原计划或快照；可比性/权限/外发门禁继续生效。它不属于本节禁止的 PLAN/scheduled 建批，不应为治理 CRON 而删除或改写基线。

确认 Beat 注册表没有到期建批扫描；现有分析/恢复/补投递仍保留。历史同窗口回执重放仅返回原 batch，不产生执行。恢复备份后同样运行清点及投影验证，不补跑错过窗口。此变更无 DDL/数据回填；代码回退不会改历史，但会重新暴露旧 CRON 写入能力，首发候选不能因此继续开放。

## 4. MANUAL 正式闭环与内部试用

由 ADMIN 与 ENGINEER 在获准范围按 SOP 操作，记录稳定 ID、revision、聚合摘要和审计引用；真实业务正文、Cookie/账号材料与原始回答留在受控产品/材料存储，不复制到验收报告。

| 顺序 | 必须观察到的真实行为 |
|---|---|
| 冻结输入 | 既有对象/批准事实、Topic/Variant、MANUAL Profile 和 Plan 创建预览/批次；服务端矩阵与冻结输入一致 |
| 录入/提交 | 真实问题和非空回答、引用来源/采集环境准确；草稿保存后正式提交；提交证据不可原地修改，unknown usage/cost 不补零 |
| 分析/复核 | Worker 处理已提交观察并形成当前 revision；需复核样本由人工追加有效复核；旧 revision 的复核不挪作当前资格 |
| 指标/下钻 | Overview/Insights/Report 按已验收分母、时间、模式和证据来源计算；失败不当未提及；报告/CSV 权限、低敏和公式注入边界不变 |
| 机会/行动 | ADMIN 经 GEO-1006 的真实受保护入口显式 evaluate 产生可解释机会，人工使用现有 Action API 并查看结果；AI 仅草稿，不直接发布；入口见 §4.1 |
| 同口径复测 | 既有公共 API 创建 action/retest（创建 UI 未完整接线时不伪称页面完成）；保存冻结 baseline 和 comparability，完整结果后显式 resolve |
| 拒绝/恢复 | 错角色、CSRF、stale revision、重复提交保留既有错误；未知外发结果不自动重发；安全停止后能恢复 MANUAL 分析，无历史修改 |

至少一批实际生产 MANUAL 闭环及内部使用者反馈，由业务验收人签署；冻结试用人群/问题样本/时长/缺陷处理负责人。本地假数据 E2E 只证明实现边界，不证明正式试用或真实采集质量。外部人工采集仍须遵守平台许可，不要求普通测试访问真实外部 AI。

当前生产 Plan cron 批次扫描和自动 opportunity evaluator **未接线**。ADR-007 明确将它们移出 V1.0，能力矩阵保留 deferred/not implemented 的事实；首发改为 GEO-1005 的 CRON 禁用/既存治理与 GEO-1006 的管理员显式评估门禁。Beat tick/健康不能证明业务执行，手工评估也不证明周期执行；旧 906 NOT_MET 原文保留，本次不改写其历史。

### 4.1 管理员显式机会评估（GEO-1006）

内部试运行每次机会评估由 ADMIN 明确执行 `POST /api/v1/geo/opportunities/evaluate`。该接口使用现有登录会话，必须携带会话绑定的 `X-CSRF-Token` 和独立 `Idempotency-Key`（8～128 个非空白可打印 ASCII 字符）；ENGINEER 不能执行。没有评估操作页面，使用获准的管理 API 客户端。不要将会话、CSRF 或幂等键写入命令历史、报告或审计证据。

执行前确认当前进程的 `GEO_MONITORING_ENABLED` 与 `GEO_OPPORTUNITY_EVALUATION_ENABLED` 均为 true；这只授予显式评估资格，不启动周期任务。ADMIN 从现有 `GET /api/v1/geo/rules` 读取并明确选择规则 revision；也可使用已有历史 revision，不会被当前规则指针替换。窗口必须带时区，UTC 半开 `[date_from,date_to)`、不超过31天。

请求示例仅说明结构，不是现场授权或业务样本：

```json
{
  "scope": "ALL",
  "date_from": "2026-10-01T00:00:00Z",
  "date_to": "2026-10-06T00:00:00Z",
  "rule_set_revision": 1,
  "subject_ids": [],
  "engine_surface_ids": [],
  "collection_profile_ids": [],
  "collection_modes": ["MANUAL"]
}
```

ALL 评估所选模式窗口内全部观测，不能带实体过滤。限定评估时使用 FILTERED，Subject/Surface/Profile 至少一类非空，各类最多50 UUID；跨类取交集，同类集合取并集。省略 collection_modes 表示全部历史模式，内部 MANUAL 试运行应显式选 MANUAL。服务仍使用既有有效分析/复核资格及完整治理分母，不通过过滤隐藏失败打断或质量缺口。

保存低敏回执 `evaluation_run_id`、`rule_set_revision`、`as_of`、`evaluated_cells`、`created`、`existing_reused`、`skipped`、`unavailable_reasons` 与 `replayed`。evaluated_cells 按规则×范围评估结果计数，包括无候选规则结果；三类数量互斥且总和等于 evaluated_cells。不可用原因有原因代码和结果数：例如 NO_CANDIDATES、INSUFFICIENT_SAMPLE、THRESHOLD_NOT_CONFIGURED；不可用/缺依据不等于零表现。首次触发证据及后续追加来源仍可通过机会详情追溯。

网络中断或响应丢失时，同一管理员以完全相同规范参数和原 key 重试，服务返回原回执及原 as_of、replayed=true，不再次评估、不追加成功审计。同 key 变参返回409 IDEMPOTENCY_CONFLICT；需要主动评估新观测或新复核时使用新 key，开放机会与相同结果沿既有 identity/指纹复用。key 按管理员隔离，不将另一管理员的同 key 当作全局重放。角色/停用/改密或开关已关闭时，重放同样拒绝。

评估只记录机会和评估证据；Action 和 Retest 仍由人工分别调用已有接口，不自动执行，不注册 Beat/CRON 或任何周期调度，也不在采集提交、指标读取或报表读取时隐式触发。成功 `geo_opportunity.evaluated` 审计仅保留范围、规则 revision、计数、原因代码、as_of 和请求摘要；失败整体回滚，重放无重复审计。

候选需先前滚到0066；加法迁移保留既有历史，回执不可修改或删除，downgrade 安全停止。故障时先关闭评估资格并保留失败现场，使用前向修复或迁移前成套备份恢复，不清除回执/审计来重新执行。GEO-1010 仍须在获准目标/候选上证明真实入口、重复触发、拒绝与 MANUAL 闭环；本地 PostgreSQL 测试不替代现场试运行。

## 5. 监控与停止

按[观测资产说明](../../../deploy/observability/geo/README.md)接入已有受保护监控，实际验证 exporter 新鲜度、Worker/Beat 本机 health、PG/Broker、四类 recovery/dispatch 扫描及故障信号。CLI 不新增公共 HTTP 端点：

```sh
python -m app.geo_observability snapshot
python -m app.geo_observability metrics
python -m app.geo_observability health worker
python -m app.geo_observability health scheduler
```

命令在已配置的获准容器内运行；保存低敏摘要和时间，受保护 UUID 定位材料不进入公共指标标签。业务低表现与系统错误分开，MANUAL 待录入不当自动积压。未观察 operation 为 null/NaN，不把零/Beat 活跃当任务完成。

观察期开始前由值班和验收负责人冻结时长、采样间隔、容量与可用性阈值。GEO-902 的 90 秒进程心跳、180 秒快照/扫描、600 秒自动待处理和持续时间是起始规则，不能当作生产已校准 SLO。错误率、OOM/重启、对象完整性、预算/未知费用、MANUAL 分析时延、复核资格和队列年龄分别保存实际样本；未冻结即停止扩量。Browser 打开/出现服务或会话、权限/完整性破坏、不可变历史变化、重复外发、迁移/恢复失败为立即停止条件。

获准停止演练按以下顺序，并分别记录进入/退出、在途 ID、发送账本和观察结果：

1. 恢复维护入口，阻止新业务写入/批次；停止 Beat 发布。配置文件的 false 不能取消已执行调用。
2. 读取受保护 PG/运维快照，区分采集和分析 lease、SENT/UNKNOWN 与未发送；等待已发请求有界结束，记录无法确认结果，不重试外部请求。
3. 有界 warm stop Worker；若超时，保留未知状态/失败现场，由负责人决定安全停止。停止 API/Worker/Beat，PG/Redis 和持久阶段保留，确认无 consumer 和业务写入口。保护配置改为总/API/Browser false、新 retention dry-run；进程已停止时不宣称 Settings 已加载或 health 正常。不要手工 Compose up 绕过发布所有者恢复 API。
4. 保留 PG 状态、Answer/Analysis/Review/Publishing 历史、审计和不可变证据；Redis 队列不作为恢复业务权威，不清表、重置终态或把 SENT/UNKNOWN 改 PENDING。
5. 核对停止窗口无新外发/新批次和秘密泄漏；监控关闭状态与未观察事实正确，无假成功。现有非 GEO 全应用业务也受停 consumer 影响，审批必须覆盖这一影响。

只关闭 API/BROWSER 不会停 MANUAL 分析；完整停止须关闭总开关并停相应 consumer。恢复必须先核对持久阶段：尚未 initialized 的同候选可在批准后重入 deploy→activate；已 PRODUCTION_INITIALIZED 的候选不得再次 activate，必须从 clean main 准备新的不可变 release ID/manifest/镜像身份（可保留已验证的源码 commit），按新批准完整 upgrade→activate。两条路径均沿原维护锁/身份/完整性/迁移所有者，不删除状态文件，不增加直接 up 旁路。

恢复 MANUAL 的保护配置为总开关 true、API/Browser false及获准机会资格；在 deploy 前配置并重建三进程，核对实际值、既有分析恢复与回环 smoke。准备新 candidate 的时间和审批必须纳入停止/恢复窗口；没有这一候选与批准时保持维护和停止，不声称可即时恢复。

## 6. 恢复、回滚与验收签署

[GEO-903 恢复 Runbook](./09-backup-recovery-runbook.md)是 DB/对象/适用密钥恢复所有者。先在新建、单次 owner 的隔离目标验证认证摘要、schema、全表与 Run/指标一致性、对象存在/hash、凭据可解密和调度窗口去重；演练不启动 consumer、不写生产 OSS。生产数据恢复需另有精确目标与数据恢复批准，先保留失败现场并停止所有新写入。

旧镜像只有明确支持当前 schema 和安全合同才可恢复；单纯切 tag 或 current 链接不等于恢复。Frontend 仅在 **PRODUCTION_INITIALIZED** 使用既有 `rollback-production-frontend.sh`（内部 verify-rollback-frontend/mark-frontend-rollback）与已冻结 V2 镜像的正式流程；backend 不兼容则保留维护并前向修复。

**前滚/部署尚处 UPGRADE_DEPLOYING 或 UPGRADE_PREPARED 时，frontend-only 回滚仍不可用，另一候选 begin-upgrade 仍拒绝。** 环境问题可批准同一 immutable candidate 重入；artifact 修复须按[部署附录显式前向恢复](../../Hostdzire部署附录.md#未初始化升级的显式前向恢复)执行 recover-upgrade。同 schema/全部迁移树（含镜像内内容）一致，全服务停止，旧/新 manifest、archive 和 image 身份完整验证，记录批准和原子候选接管；仍 deploying，重新通过完整 deploy/验收/activate，失败保持 maintenance。跨 schema/修改迁移或证据缺失继续停止。使用[升级恢复证据模板](../04-delivery/geo-1007-upgrade-recovery.template.yaml)；本地演练不代表现场恢复或首发 Go。用户本次称 GEO-1007，delivery 中同范围仍为 GEO-1008，不重编号。

GEO upgrade 不能误用 clean-init 的 quarantine restore。默认不 Alembic downgrade，不删除 tombstone/发送账本/审计历史，不恢复 Redis/Beat 文件冒充业务重放。

快照之后发生的外部请求不可随 DB 恢复回退；须先对账发送事实，SENT/UNKNOWN 不自动重发，存在未覆盖外发即暂停 consumer。实际切换/停止/恢复后再运行 smoke 和正式 MANUAL 分析验收，形成前后材料，恢复失败继续维护状态，不宣称 rollback 成功。

V1.0 最终证据进入 GEO-1010 新 readiness/Go-No-Go 记录：candidate、前滚、Browser 硬禁止/现场负证据、CRON 治理、真实管理员评估、MANUAL 闭环/内部试用、监控容量/观察期、目标恢复/停止与全部开放缺口。按 §0 逐项判定，必需证据不足即 NO-GO；完成先 review，人工接受才 done。缺必需输入/授权时 blocked，不填造证据。GEO-906 已人工接受 done，但其[原验收报告](../04-delivery/13-r8-core-release-acceptance.md)和生产未知保留，不再修改历史状态；R0—R8 done/deferred 不改。
