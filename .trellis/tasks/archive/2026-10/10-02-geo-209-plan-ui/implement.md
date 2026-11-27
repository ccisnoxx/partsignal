# GEO-209 实施与验证

当前：review。实现、本地验证、独立复核与证据收尾完成，等待人工验收；不得自行标记done。完整verify/e2e保留三项范围外既有用例失败，已准确分类，不宣称全仓门禁通过。GEO-208在实施前manifest为done，Trellis已人工接受completed，R1允许执行。本任务使用现有geo/GEO-209分支，无commit/push/发布。

## 实现与范围

`/geo/plans` 列表/详情、八步完整配置向导、服务端preview、状态确认、复制/删除、URL恢复和dirty保护。选项分页搜索、跨页保持、缺失ID可移除，角色显式选择。新计划只创建DISABLED，启用单独确认，ACTIVE修订使用既有PATCH CAS，ARCHIVED只读仅COPY。未知费用保持null与覆盖说明；不在前端计算最终run_count、状态机或指标。不创建Batch/Run，不执行采集/调度/指标/机会，不实现其他GEO任务。

## 合同、数据库与迁移

根OpenAPI、generated schema、contracts/database.md、ORM与Alembic均无本任务变更；前端API wire类型仅从generated导入。既有head为0047_geo_monitoring_plans，隔离E2E每次从空库成功upgrade head；无新revision、回填、历史修改或生产前滚。完整门禁中的迁移测试另见最终日志。

## 状态、事务、锁、幂等与并发

事务、锁和授权继续由GEO-208 Application Service维护，Router/前端不拥有事务/ORM写入。既有锁序User→Channel→Model→Product→品牌Subject→非品牌Subject→Topic→Variant→Surface→Profile→Plan，资源按UUID；服务端锁后重验revision与资格，写RC、读RR。本任务只传当前expected_revision，不新增幂等键或存储；同步在途锁防双发、retry=false且不自动重放失败命令。no-op和实际revision增长均显示canonical响应。

preview绑定完整草稿快照、同步代次与请求身份，输入变化失效旧结果，包含忽略abort与ABA反例。草稿/提交基线独立于Query，后台成功/失败不reset。编辑409显式读取只更新基线、展示远端完整配置供比较、重新preview后手动save；新建409保留输入、显式重新preview后手动create。状态/复制409独立冻结，关闭/重开/被动更新不能解冻，仅显式reload成功后重新确认。发送前和每次await后的principal/mounted/当前动作与revision守卫，写后先取消列表/详情旧GET再canonical写缓存，删除清URL后不重新读取404详情。

## URL、页面与安全

URL：q/status/schedule_kind/sort/page/page_size/selected/new/edit；默认省略、UUID规范化，创建/编辑身份互斥。同一身份筛选/分页保留草稿，切换/关闭/Back/离开和beforeunload由DirtyGuard保护。query key由plans.api.ts的planKeys唯一注册；Route仅规范URL与prefetch/composition。列表和详情覆盖加载、空/筛选空、403/404、读取失败、冲突及完成反馈；运行固定NOT_IMPLEMENTED说明。每个blocker显示字段/资源/关联资源，并定位步骤或打开既有资源配置。

沿用ADMIN/ENGINEER、现有会话/CSRF/CORS/principal边界，preview同样CSRF。Profile选择只取非敏感summary，不读取凭据配置；422只映射loc/msg，不显示input/context。R1真实栈明确仅开启监测总开关，API/浏览器采集及机会评估关闭，生产默认值不变。真实栈使用独立PostgreSQL临时数据库、Redis DB14、本地fake AI与storage；新业务写入经UI，登录/账号与首次改密仅作验收先决。产物scan为clean；相关失败不放宽权限、CSRF、资格或写取消边界。

## 实际验证

最低七条命令均已实际运行，没有未运行项。完整真实栈由 `make verify` 无过滤执行；单独 `make e2e` 的真实栈前半使用显式Plan过滤，后半仍执行全部默认fixture。两条根门禁最终均退出2，不能用补充检查合成为成功。

| 实际命令 | 结果 | evidence日志 |
|---|---|---|
| `git diff --check` | 0，最终Git与包含新文件的起点定向diff空白检查0问题 | git-diff-check.log、scoped-diff-check.json |
| `make lint` | 0，Ruff/ESLint通过 | lint-candidate-final.log |
| `make typecheck` | 0，mypy 117文件及frontend TypeScript通过 | make-typecheck-final.log |
| `npm --prefix frontend run test` | 0，最终111文件1067项passed | frontend-full-final.log |
| `npm --prefix frontend run typecheck` | 0，最终候选TypeScript通过 | frontend-typecheck-candidate.log |
| `PARTSIGNAL_E2E_SPEC=tests/e2e/plans-real-stack.spec.ts make e2e` | 2，Plan真实栈1 passed；完整fixture497 passed/52 skipped/1范围外Users失败；两阶段标准secret scan clean | make-e2e-targeted.log |
| `make verify COMPOSE='docker compose -p partsignal-geo209 -f .trellis/tasks/10-02-geo-209-plan-ui/evidence/validation-compose.yaml'` | 2，合同/静态/1247后端unit/早期111文件1066前端unit/625 integration（8既有metadata警告）/前后端镜像通过；无过滤真实栈23 passed/2范围外失败 | make-verify-final.log |
| `make test-deploy-scripts`（串行补verify后半） | 0，前端容器、GEO fixture/config、进程/数据库/敏感产物生命周期、staging/production harness通过 | deploy-scripts-serial.log |
| 隔离dev与verify同形prod Compose `config --quiet` | 0/0，只读配置检查，未部署 | dev-compose-config.log、prod-compose-config.log |
| `python3 .trellis/scripts/task.py validate .trellis/tasks/10-02-geo-209-plan-ui` | 0，上下文记录有效；大文件自动注入长度警告已用手动完整合同单元阅读补足 | trellis-context-validation.log |

外层测试使用本任务新建的PG端口55449、Redis端口56389/DB14及fake服务，命令所需变量和精确结果见 `evidence/validation-results.json` 与专属 `validation-compose.yaml`；没有操作生产库。

基线前端15文件132项passed，Plan contract/management/matrix/preview单元133项passed。新增Plan向导/preview定向61项、模型4项、工作区最终9项passed；最终工作区409反例回归及本地空态修改均通过。完整111文件1067项覆盖P2修正，之后仅改计划空态CSS，直接工作区9项及真实375 bounding-box验证覆盖该差异，没有再重复无关全套。

Plan真实栈最终1项passed（10.6s），完整门禁中再次passed（10.1s）：UI创建DISABLED→启用→暂停→恢复→ACTIVE修订→复制→删除副本→归档，刷新验证持久化和revision；dirty/URL/步骤焦点，375/768/1024/1440无页面横向溢出，375空态文字在可视区域。mobile/desktop截图已保存并视觉复核；未豁免任何写请求取消/重复/失败，未请求Batch/Run。脚本每次独占DB/storage/Redis/端口清理均有成功日志。

三个范围外失败：旧GEO上传postDataBuffer=null（GEO-106已记录）；Auth改密后surfaces仍用共享账号旧密码401（已确认测试间账号污染）；Users删除后立即断言的请求记录仍为前次update（具体深层原因未进一步确认）。对应源码与测试未被本任务修改，详细触发、覆盖缺口和日志见 `evidence/gate-failure-classification.md` 与 `fixture-users-error-context.md`。没有重跑未变化的全部真实栈/页面矩阵，也没有扩展到其他任务。

未执行Firefox/Safari兼容矩阵：本任务没有改变浏览器兼容合同，已执行Chromium mobile/desktop和四档宽度。未执行生产迁移、历史回填或部署：本任务无DDL且没有发布授权。未调用真实AI/provider/外部采集：明确范围外，测试仅使用本地fake。以上不属于遗漏的七条最低命令。

## 首次失败与修正

1. 新路由尚无generated注册导致首build/types失败，使用Vite路由生成器，仅增加plans注册。
2. 新测试fixture的Subject primary_task和spy参数推断不符合generated类型，修正后typecheck与目标测试通过。
3. react-hooks/refs禁止渲染期更新currentPlan/blockedRead，改为layout effect并验证取消旧查询期间卸载不再发送POST。
4. 测试环境总开关默认false，Profile资格真实阻断；隔离harness明确R1监测开启且所有自动采集开关关闭。测试遗漏问题变体语言/地区先决，确认后主动终止并精确清理，补字段后重验。
5. 浏览器审计观测resume/delete/archive的旧列表GET取消；仅白名单这些精确phase/method/path/reason，写请求仍严格唯一成功，不允许取消。全部业务流程与持久化本已通过，修正审计后整体通过。
6. 独立只读复核确认P2：Dialog关闭重开绕过409显式读取；独立conflicted修正，反例9项passed。清空复制名暴露错误文本进入label，移出label保持可访问名称稳定。
7. 图像复核发现空表说明居中到宽滚动表格可视区外，计划本地空态去掉宽表头/最小宽度，增加375实际bounding box断言通过，不改共享表格。

8. 主代理第一次补跑部署脚本与fixture E2E并行，漏查同端口/产物目录，post-run secret回归失败；等E2E退出后串行重跑，make test-deploy-scripts最终0。首次失败保留，不将其归为实现缺陷。

## 独立复核与审计

fresh critical_reviewer对preview/CAS/dirty/权限/并发/删除/选项/blocker进行只读复核，已确认P2源码修正，未确认其他缺陷；见evidence/independent-review.md。主代理确认回归测试通过。WorkPlan两阶段与Digest校验、Bundle关闭和audit-verify通过，无ready task遗漏/残留worker/未知写入。audit_id：20261002T195404Z-geo-209-plan-ui-a4c491a1。配置快照不冒充运行时模型确认。

## 修改文件（相对任务起点）

本任务源码/配置/稳定文档共32项：21项新文件、11项既有文件的定向增量；起点已存在的dirty/untracked工作保留，未按HEAD把前序任务改动归入GEO-209。

| 文件 | 变化 |
|---|---|
| `.trellis/spec/infra/e2e-isolation.md` | modified |
| `deploy/scripts/e2e-local.sh` | modified |
| `docs/geo-monitoring/03-technical/04-frontend-architecture.md` | modified |
| `docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md` | modified |
| `docs/geo-monitoring/04-delivery/task-manifest.yaml` | modified |
| `docs/geo-monitoring/CHANGELOG.md` | modified |
| `docs/geo-monitoring/README.md` | modified |
| `docs/geo-monitoring/SHA256SUMS` | modified |
| `frontend/src/app/navigation.test.ts` | modified |
| `frontend/src/app/navigation.ts` | modified |
| `frontend/src/domains/geo-plans/plan-actions.ts` | new |
| `frontend/src/domains/geo-plans/plan-controls.tsx` | new |
| `frontend/src/domains/geo-plans/plan-detail.tsx` | new |
| `frontend/src/domains/geo-plans/plan-list.tsx` | new |
| `frontend/src/domains/geo-plans/plan-options.tsx` | new |
| `frontend/src/domains/geo-plans/plan-preview.model.test.ts` | new |
| `frontend/src/domains/geo-plans/plan-preview.model.ts` | new |
| `frontend/src/domains/geo-plans/plan-preview.test.tsx` | new |
| `frontend/src/domains/geo-plans/plan-preview.tsx` | new |
| `frontend/src/domains/geo-plans/plan-wizard-steps.tsx` | new |
| `frontend/src/domains/geo-plans/plan-wizard.test.tsx` | new |
| `frontend/src/domains/geo-plans/plan-wizard.tsx` | new |
| `frontend/src/domains/geo-plans/plans-page.test.tsx` | new |
| `frontend/src/domains/geo-plans/plans-page.tsx` | new |
| `frontend/src/domains/geo-plans/plans.api.ts` | new |
| `frontend/src/domains/geo-plans/plans.model.test.ts` | new |
| `frontend/src/domains/geo-plans/plans.model.ts` | new |
| `frontend/src/domains/geo-plans/plans.options.ts` | new |
| `frontend/src/domains/geo-plans/plans.test-support.tsx` | new |
| `frontend/src/routeTree.gen.ts` | modified |
| `frontend/src/routes/_app/geo/plans.tsx` | new |
| `frontend/tests/e2e/plans-real-stack.spec.ts` | new |

另有本任务 `prd.md`、`design.md`、`implement.md`、`task.json`、`implement/check.jsonl`及evidence目录。Task Brief验收项已填写；manifest仅GEO-209 planned→in_progress→review，GEO-208保持done，其他任务状态不变。SHA256SUMS仅更新本任务修改的五份文档条目。

## 环境与可恢复状态

本任务专属partsignal-geo209 Compose容器、网络、两个命名卷已移除；每次E2E临时DB/storage与Redis14均由harness清理。Docker context恢复default，Colima恢复not running，8000/9001/4174/19009/19010/55449/56389验证端口均closed，见evidence/environment-restored.json。没有删除无关容器或用户业务数据。task保留review活动指针，completedAt为null，未归档、提交、推送、PR或发布。无需数据库回滚；前端回退边界是本任务候选diff。

## 已知限制与后续

费用估算在既有服务端无生产估价实现时unknown；页面明确展示。真实运行、定时执行、最近批次、运行成功率、批次历史与冻结快照留给后续任务；当前不伪造字段。没有新依赖/生产迁移/发布。全仓门禁三项范围外失败仍未修复，不能宣称release gate全绿；深层浏览器上传/Users时序原因未确认。下一步先由用户人工验收GEO-209，再按manifest单独推进GEO-301 Batch/Run合同、GEO-302状态策略、GEO-303批次工厂和冻结快照；本次均未实施。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-209 的实现与测试证据。”据此仅将 manifest 的 GEO-209 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief 当前状态同步更新。

上述实施章节与原始 evidence 保留人工验收前的历史状态、实际测试结果和已知限制，不将失败或未运行检查改写为通过。本次只记录 GEO-209 验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾运行 git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
