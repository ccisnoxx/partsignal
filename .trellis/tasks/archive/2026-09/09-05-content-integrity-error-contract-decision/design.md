# Design: Content/Generation IntegrityError 合同决策

## 1. 设计原则

本设计把数据库constraint视为最终并发权威，但不把“可识别constraint”自动等同于“可恢复领域错误”。判定依次回答三个问题：

1. 精确diagnostics能否确定是哪条约束？
2. 约束本身是否足以证明一个稳定、面向用户或worker可执行的结果？
3. command/worker能否在rollback后验证canonical winner且不制造第二次副作用？

只有三项都满足才replay；仅前两项满足且存在稳定blocker语义时映射为领域错误；否则unknown或worker显式失败。

## 2. 分类算法

### 2.1 HTTP command

1. command按现有precheck/lock/idempotency lookup运行；precheck只是顺序路径优化，PostgreSQL仍为最终authority。
2. 仅在本command明确拥有的flush/commit边界捕获`IntegrityError`。
3. 从`error.orig.sqlstate`和`error.orig.diag.constraint_name`读取结构化diagnostics；任一缺失或不在精确allowlist，立即re-raise原异常。
4. 对已知pair执行root rollback。
5. 若是幂等约束，按冻结identity回查winner：same identity返回winner；different identity抛既有409；winner缺失re-raise原异常。
6. 若是业务状态约束，抛冻结的`AppError`；不得按数据库message构造响应。
7. unknown进入T1已恢复的default 500，不新增`REVISION_CONFLICT`或稳定500 envelope。

### 2.2 generation worker

1. Job UUID、Job行锁/status与source lookup是worker identity owner；HTTP Idempotency-Key不进入worker。
2. provider前已有`source_job_id`版本时，沿用当前顺序replay并将Job收敛为SUCCEEDED。
3. provider后的final transaction包含ContentVersion、task pointer/revision、Job success与provider metadata。
4. final transaction的任何unknown/唯一性异常先rollback；`uq_content_versions_source_job_id`也不例外，因为标准Job锁下该冲突不能由合法双worker产生，约束名不足以证明winner的pointer/identity完整性。
5. rollback后只提交Job`FAILED/GENERATION_FAILED`并清lease；不返回HTTP 409、不重新dispatch、不再调用provider。

## 3. 关键合同决策

### 3.1 幂等资源

#### 普通 Content Task

ordinary identity由`product_id/fact_version_id/platform_profile_id`和“非GEO source kind”共同决定。同key same ordinary identity可201 replay；任一identity不同为409`IDEMPOTENCY_CONFLICT`。由于GEO也写同一全表key，T4-C只允许普通incoming command辨别并拒绝GEO winner；不得顺手修改GEO incoming command，其反向策略留T5-C。

#### Generation Job

沿用`_GenerationJobIdentity`，覆盖GENERATE create/retry。GENERATE retry当前把latest-job检查放在key lookup之前，导致第一次retry已创建新Job后，同previous/key的顺序请求错误返回`INVALID_STATE_TRANSITION`。目标顺序冻结为：previous存在/合同可重试/FAILED、Task仍OPEN、旧GENERATE snapshot有效是replay也必须满足的前置；随后计算identity并lookup。same key/same identity立即202 replay；只有没有winner时才执行latest-job、当前facts/product资格等新建专用检查。different key仍受latest-job规则约束，same key/different identity返回409`IDEMPOTENCY_CONFLICT`。

同Task同identity请求由Task锁串行，应由顺序lookup重放；跨Taskdifferent identity才是正常可达的真实unique race。same-identity exact constraint catch通过test-only受控sentinel验证。Humanization现有两constraint allowlist、active-source错误、旧snapshot先验和winner-missing行为保持不变。

### 3.2 Content Version identity

- `source_job_id`：保留provider前existing lookup的顺序replay；final unique failure标记FAILED，不新增post-error replay。
- `(task_id, version)`：所有正常owner已锁Task后`max+1`，因此constraint failure是allocator/owner不变量故障；HTTP unknown、worker FAILED。

这两项组成一个后续Task，因为它们共同定义ContentVersion identity和generation worker finalization边界，但不包含review状态。

### 3.3 Content Version review state

- pending partial unique表达已冻结的“每任务至多一个待审核版本”，可以精确恢复为新409 `CONTENT_REVIEW_PENDING`。
- approved partial unique不能映射：正常业务允许先supersede旧approved再approve新版本，若constraint仍失败则无法安全选择winner。

两项由同一`transition_content_version` owner和同一transaction处理，组成一个后续Task；其单一review目标是“review状态唯一性与整笔rollback”。

### 3.4 Fact Version

- `(product_id, version)`是allocator不变量，保持unknown。
- pending partial unique与当前precheck的`FACT_REVIEW_PENDING`语义完全相同，复用既有码。

两项由同一`submit_fact_review` owner处理，组成一个后续Task。

### 3.5 Publication/GEO边界

`source_published_content_issue_id`当前顺序precheck已有`REPAIR_TASK_EXISTS`，但其database race mapper不在T4-C获批范围。GEO incoming的共享ContentTask key策略也留给T5-C。T4-C research记录这些交叉owner只为防止后续普通ContentTask实现错误replay，不能据此修改publication/GEO代码或文档。

## 4. 公共错误合同

| 场景 | HTTP | code | message | details | request ID | 前端恢复 |
|---|---:|---|---|---|---|---|
| Content Task异identity | 409 | `IDEMPOTENCY_CONFLICT` | `幂等键已用于另一内容任务创建请求` | `{}` | 当前request写入body/header | 保留表单、废弃key、显式再次提交 |
| Generation Job异identity | 409 | `IDEMPOTENCY_CONFLICT` | `幂等键已用于另一生成请求` | `{}` | 当前request写入body/header | 废弃command key、显示错误、显式再次提交 |
| Humanization活动源 | 409 | `HUMANIZATION_ALREADY_ACTIVE` | `该源版本已有活动自然化作业` | `{}` | 当前request写入body/header | 展示canonical blocker，不自动replay |
| Content已有pending | 409 | `CONTENT_REVIEW_PENDING` | `该任务已有待审核内容版本` | `{}` | 当前request写入body/header | 保留审核备注/request ID，显式reload，不重复POST |
| Product已有pending事实 | 409 | `FACT_REVIEW_PENDING` | `该产品已有待审核事实版本` | `{}` | 当前request写入body/header | 刷新canonical workspace，不自动再次提交 |

same-identity replay分别返回既有201 ContentTask或202 GenerationJob，不产生ErrorEnvelope。所有unknown HTTP均为非稳定500，不在上表新增公共合同。

## 5. 事务与副作用设计

| owner | root transaction / 已提交边界 | 冲突rollback必须恢复 | rollback后唯一允许动作 |
|---|---|---|---|
| `create_content_task` | request Session；Task flush/commit | 新Task及所有未提交副作用；当前路径无version/review/audit/dispatch | 幂等winner回查或原异常上抛 |
| `_create_job` callers | request Session；Job commit后才dispatch | 新Job及任何未提交副作用；不得dispatch | 幂等winner回查、稳定409或原异常 |
| `process_generation_job` | RUNNING/attempt已在provider前提交；finalization另一个transaction | final ContentVersion、pointer/revision、Job success/provider metadata | 只提交Job FAILED并清lease |
| `transition_content_version` submit | request Session final commit | target status/revision、ContentReviewRecord；无AuditLog | 稳定pending 409或原异常 |
| `transition_content_version` approve | request Session；旧approved先flush但未commit | 旧approved状态/revision、target状态/revision、ReviewRecord、SUCCESS AuditLog | 原异常/default500 |
| `submit_fact_review` | request Session final commit | FactVersion、FactReviewRecord；不改workspace revision；无AuditLog/dispatch | pending 409或原异常 |

失败映射不得写“失败AuditLog”来伪装成功可观测性；新增审计本身是另一项业务合同。

## 6. 合同与文档同步策略

### 6.1 不变的结构面

相关operation已声明所需409，`ErrorDetail.code`是开放string，`details`是开放object。因此本T4-C推荐的映射均不改变：

- `contracts/openapi.yaml`的status/schema；
- runtime response metadata status set；
- `frontend/src/shared/api/generated/schema.d.ts`；
- request ID middleware与ErrorEnvelope形状；
- `contracts/database.md`的表/约束结构。

任何implementation若发现必须改变上述结构，应停止并回到新的contract decision，不能把结构变更伪装成“生成文件同步”。

### 6.2 必须更新的稳定语义

- GENERATE idempotency、Content Task ordinary race、Content pending与Fact pending的精确diagnostics规则进入`.trellis/spec/backend/error-handling.md`；必要的owner-lock/rollback约束进入`database-guidelines.md`。
- 新`CONTENT_REVIEW_PENDING`及显式reload/no replay语义进入Frontend V2业务动作合同。实际submit consumer是Content Editor：补`content-editor-page.tsx`、必要model和`content-editor-page.test.tsx`的code-aware恢复；Review Page只负责approve/request-changes，不能替代submit测试。
- ContentTask ordinary source-kind成为canonical identity的一部分后，同步澄清`contracts/database.md:37`；只描述ordinary incoming，不批准GEO incoming mapper。
- 复用既有码且Frontend V2已明确的场景只做一致性核对；不要为无schema变化强制生成client diff。
- unknown 500不得加入OpenAPI、runtime metadata或generated error union。

## 7. 测试设计

每个implementation Task都先用最小unit diagnostics matrix证明分类器只接受exact pair，再用真实PostgreSQL证明catalog/conname、race或受控constraint sentinel，最后用service/HTTP/worker/frontend稳定边界证明行为和副作用。

并发测试使用两个独立Session/连接、event/barrier和有界timeout；禁止用sleep建立时序，禁止mock `IntegrityError`替代真实PG。若生产行锁使合法race不可达，测试可以在不改生产锁/schema的前提下用test-only flush event或受控competitor触发最终constraint，且必须同时保留“正常锁能串行”的对照。

required gate按各Task限定；repository-wide backend/frontend suite只作为optional，除非后续变更实际触及共享contract、database、permission或release gate。

## 8. 方案取舍

- 未选择“所有unique都409”：version allocator和approved约束不能给出安全用户动作。
- 未选择“所有worker source冲突都replay”：标准Job锁使该flush冲突本身是异常信号，且constraint name不足以证明已提交winner的pointer/identity原子完整。
- 未复用`INVALID_STATE_TRANSITION`表示另一pending：目标版本可能仍是合法DRAFT，真正blocker是同Task已有pending；新码更准确。
- 未给新码加OpenAPI enum：现有公共schema有意使用开放string；增加enum会扩大为全局合同变更。
- 未合并为一个T4大型implementation：五个后续Task分别按稳定command/worker owner和独立验证目标切分。

## 9. 风险与停止条件

- current-head真实PG catalog名称与推导不一致：停止implementation，先修正本决策，不做message fallback。
- 普通ContentTask source-kind安全判定需要改变GEO incoming或共享helper语义：停止并转T5-C。
- 新`CONTENT_REVIEW_PENDING`需要改变ErrorEnvelope/status或generated code union：停止并另建公共合同Task。
- 同一required gate最多两轮repair→targeted re-check；第二轮仍失败则报告证据与剩余选择，不扩大mapper。
