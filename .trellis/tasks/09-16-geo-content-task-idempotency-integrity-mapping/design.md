# Design：GEO Content Task 幂等 IntegrityError 精确恢复

## 1. Current-head evidence

`create_geo_optimization_content_task` 当前先获取与ordinary command共享的
`content-task-create:{idempotency_key}` transaction advisory lock，再按key查询`ContentTask`。已提交
winner只有在task三字段与六个GEO source字段全部相等且source存在时replay；否则返回既有
`IDEMPOTENCY_CONFLICT`。

新建路径先调用`add_locked_content_task`，该helper在返回前立即flush ContentTask；随后GEO owner才把
`ContentTaskGeoSource`加入Session，并由`commit()`隐式flush source。因此：

```text
advisory lock -> existing lookup -> resource locks -> recompute insight
                                               -> ContentTask INSERT/flush
                                               -> add GEO source -> commit
```

目标unique必然在source尚未进入pending前由ContentTask flush命中。当前缺口只是该flush没有exact
`IntegrityError` recovery；task/source已经处于同一root transaction，不需要改变helper或schema。

## 2. Local classifier and catch boundary

在`geo_observation.py`增加command-local私有classifier，只接受：

```text
orig.sqlstate == "23505"
orig.diag.constraint_name == "uq_content_tasks_idempotency_key"
```

catch只包围`add_locked_content_task(...)`：

```text
ContentTask INSERT/flush
  ├─ exact pair -> root rollback -> load winner -> tri-state identity decision
  └─ anything else -> raise original IntegrityError

add GEO source -> commit
  └─ any failure -> unknown/request-owner rollback; never enter idempotency mapper
```

不从ordinary owner导入私有classifier，不建立shared registry，也不移动`add_locked_content_task`的事务责任。
classifier不负责rollback、查询、HTTP或异常构造。

## 3. Winner identity tri-state

GEO owner内使用私有、无副作用的identity判定，明确区分`same / different / unverifiable`。

### 3.1 ContentTask layer

- `product_id/fact_version_id/platform_profile_id`任一缺失：`unverifiable`。
- 三字段完整且没有`ContentTaskGeoSource`：可证明ordinary kind，`different`。
- 三字段完整且存在source：进入source layer。

`platform_profile_id`因`ON DELETE SET NULL`真实可空，不能因为ORM通常从非空请求创建就假定历史winner完整。

### 3.2 GEO source layer

先验证source自身能否证明所属rule identity：

- 内容规则：必须有article，topic/platform必须为空；
- 覆盖规则：article必须为空，topic/platform必须非空；
- rule/date等数据库非空字段在测试替身或损坏数据中缺失时同样`unverifiable`。

current-head `0037`已删除早期宽松identity CHECK，并允许article FK级联`SET NULL`；因此内容型历史source的
article为空是合法生命周期结果，但不足以证明原始幂等identity，必须`unverifiable`。

source形状完整后：task三字段与source六字段全等为`same`；任一可证明字段不同为`different`。
`basis_snapshot`和actor不是identity，但winner snapshot不得被恢复路径修改。

### 3.3 Exact-race decision table

| rollback后winner | decision |
|---|---|
| 不存在 | 重新抛最初`IntegrityError` |
| task identity不完整 | 重新抛最初`IntegrityError` |
| 完整task、无source | `409 IDEMPOTENCY_CONFLICT`（ordinary winner） |
| source存在但必要identity不完整 | 重新抛最初`IntegrityError` |
| 完整同GEO identity | 返回canonical winner |
| 完整但kind/任一字段不同 | `409 IDEMPOTENCY_CONFLICT` |

顺序precheck保持当前实现语义，不为没有原始异常的损坏数据发明第二套unknown异常类型。

## 4. Transaction and side effects

- exact loser的failed Session只能由GEO command root `rollback()`恢复；rollback前禁止查询winner。
- rollback撤销候选task及所有pending state；winner重查使用同一Session和原key。
- replay/conflict不commit、不写source、不改winner。
- source flush或commit失败由request Session owner cleanup；direct-service测试显式rollback。
- GEO优化task创建不写AuditLog、ContentVersion、GEO observation relation或revision；失败快照仍覆盖这些表和
  task的status/revision/current pointer，防止未来副作用漂移。

## 5. PostgreSQL proof and concurrency model

### 5.1 Catalog/diagnostics sentinel

在upgrade到current head的临时PostgreSQL中查询`pg_constraint/pg_class/pg_attribute`与
`pg_get_constraintdef`，证明名称、表、唯一列、`contype='u'`和`condeferrable=false`。真实duplicate
INSERT必须返回目标exact pair；ORM/migration文本不能替代运行时证据。

### 5.2 Compliant concurrency

两个独立Session执行同key同GEO identity。使用connection-local statement event、backend PID与
`pg_stat_activity/pg_blocking_pids`证明loser等待共享advisory lock，且等待期间没有发送ContentTask
INSERT。winner commit后loser通过existing lookup replay；最终一次task INSERT、一个task、一个source。

### 5.3 Test-only bypass race

旁路只作用于参与测试连接，并只跳过制造最终数据库race所必需的advisory/precheck。资格资源锁、GEO
insight复算、真实task INSERT、FK/CHECK/trigger/unique保持生效。由于ContentTask的三个FK与production
product/fact/platform `FOR UPDATE`存在锁冲突，证据按资源是否共享拆成两种，不把任意等待误述为unique wait。

#### 共享target资源：已提交winner race

same GEO、只改变source identity、ordinary/GEO跨kind都共享product/fact/platform。若winner先flush未提交，
其FK `KEY SHARE`会阻止loser取得production `FOR UPDATE`；若loser先锁资源，winner flush又会被FK阻止，双方
无法按“loser等待unique INSERT”的顺序稳定执行。

测试在首次key lookup后、调用原production资源锁helper前，给worker增加connection-local、test-only
PostgreSQL advisory latch：

1. coordinator持有test latch；worker完成precheck后在数据库等待该latch，monitor核对query、wait event与PID；
2. bypass winner在独立Session写入完整task/source并commit；
3. coordinator释放latch；worker继续执行未削弱的production资源锁、insight复算和真实task INSERT；
4. INSERT收到真实exact pair，mapper rollback并按same GEO replay、source差异或跨kind conflict裁决。

该latch只提供可观察的数据库race排序，不伪装成unique wait，也不替代真实diagnostics。

#### 不共享target资源：真实unique INSERT wait

不同task identity使用另一组product/fact/platform，winner未提交时不会阻塞loser的production资源锁。loser可到达
真实`INSERT INTO content_tasks`并等待winner的unique仲裁；monitor必须核对目标INSERT、Lock event和指定
blocker PID。winner commit后loser收到同一exact pair并返回conflict。

ordinary loser + 完整GEO winner也在`test_geo_insights.py`用第一种latch调用unchanged
`create_content_task`证明；既有ordinary integration只证明反向guard和真实duplicate diagnostics，不声称具有
双worker等待证据。

两种矩阵共同覆盖same GEO、每个target/source字段不同、ordinary/GEO双向、winner missing、task/source不完整
与unknown diagnostics；任何场景都不绕过production资源锁或FK。

## 6. HTTP and failure evidence

- exact conflict通过真实route/request dependency返回既有409四字段ErrorEnvelope；与precheck逐字段对账，
  body/header/入站request ID一致。
- unknown HTTP使用真实非目标PostgreSQL失败（优先source CHECK/FK或catch-scope sentinel），
  `raise_server_exceptions=False`只断言500与敏感信息不泄漏，不冻结body/media type。
- known reuse必须在测试额外rollback之前，用同一Session查询winner并完成另一健康命令；unknown direct-service
  捕获原异常对象后由测试显式rollback再证明reuse。
- 快照在独立verify Session中比较完整winner task/source/basis、task pointer/revision/status、相关relation、
  version/review/audit计数，避免只看行数遗漏覆盖修改。

## 7. Contract and documentation impact

- `contracts/openapi.yaml`、router、runtime metadata、request-ID middleware、generated client和frontend不变。
- `contracts/database.md`补充GEO owner对同一named unique的exact恢复，以及ordinary/GEO双向身份与source历史
  不完整时fail closed。
- `database-guidelines.md`补充GEO局部owner、tri-state、真实并发与原子性。
- `error-handling.md`补充catch scope、known root rollback、unknown原抛/no-leak和Session reuse。
- 不把test-only hook、barrier实现或pytest collection问题写成稳定生产合同。

## 8. Protected-owner strategy

preflight记录完整working-tree/index baseline。实现后：

- 对clean protected owner执行`git diff --exit-code HEAD -- ...`；
- 对当前已dirty的路径（包括范围外`frontend/AGENTS.md`等）比较preflight/candidate path status与diff fingerprint，
  只证明本Task没有新增差异，不覆盖或清理用户工作；
- allowlist单独执行`git diff --check`并逐路径审查。

任何OpenAPI/runtime/generated/frontend、ordinary owner、schema/migration新增差异都触发stop condition。

## 9. Rollback boundary

planning阶段只有当前Task工件与父child bookkeeping，没有生产候选变更。实施获批后，只撤销本Task
implementation allowlist内可识别的候选diff；不回退T1、T5-I1..I3、T5-C、ordinary已归档成果或任何
用户dirty/staged文件。catalog/schema不符时保留unknown并停止，不添加兼容alias。
