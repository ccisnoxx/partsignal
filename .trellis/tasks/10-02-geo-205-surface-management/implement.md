# GEO-205 实施与证据

当前 review；未提交/发布。初始分支geo/GEO-205；依赖GEO-204 done/人工接受。起始状态与哈希见evidence，保留前置任务的未提交改动。

## 依赖、基线与环境

- manifest 的 GEO-204=done；GEO-204 task.json=completed，implement.md 有 2026-10-02 人工接受。GEO-205 仅这一项依赖，允许进入 R1。
- `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_surface_contract.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_configuration.py backend/tests/unit/test_contract.py`：215 passed，exit 0，`evidence/baseline-unit.log`。
- `npm --prefix frontend run test -- src/domains/geo-catalog`：5 files / 63 passed，exit 0，`evidence/baseline-frontend.log`。
- `env APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55445/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_surfaces_profiles.py backend/tests/integration/test_geo_profile_eligibility.py`：51 passed / 2 既有 SQLAlchemy metadata 反射 warnings，exit 0，`evidence/baseline-pg.log`。
- Docker 初始 default context、Colima 停止；已为专用 project `partsignal-geo205-validation` 启动 Colima。PG/Redis/fake-oss 为独占 55445/56385/19005；fake 不是外部 provider。完整命令和环境见 `evidence/validation-compose.yaml` / `infra-up.log`。完成时恢复初始状态。

## 契约与前滚

- 编码前输出了 12 项 preflight，采用 Task Brief 中的事务、权限、并发与范围设计。
- 根 OpenAPI 新增 8 paths / 14 operations、角色摘要与管理员配置包装、typed actions/blockers；声明了完整错误状态/代码。运行时导出初次包含无关旧 Out 别名，已删除这些无关新增组件；原孤立 GeoApiSettings 的两项 null default 被 FastAPI 导出过程省略；初次移除默认使 GEO-203 精确组件断言失败，已恢复根合同，并由运行时导出从 Pydantic FieldInfo 保留已声明默认。没有修改既有数据语义或放宽断言。
- `npm --prefix frontend run api:generate` 成功；`make contract-check` 两项通过，exit 0，见 `evidence/contract-check.log`。`runtime-management-openapi.json` 保存初次声明证据，最终合同以根文件为准。
- 创建本 project 的独占 `partsignal_geo205_migration` 空库；`env APP_ENV=test DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55445/partsignal_geo205_migration UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini upgrade head` exit 0；同环境 `alembic current` 得到 `0046_geo_surfaces_profiles (head)`。日志见 `evidence/migration-forward.log`。无新 revision、回填或生产操作；结束随专用 volume 清理。

## 实施与验证

后端、前端由所有权独立的代理实施；主代理维护根合同、Task、文档和真实 API E2E。统一 422 handler 确认存在输入值回显，已在权威 owner 修复；没有新增 route-specific 兜底。最终门禁、独立复核、范围检查与审计 Digest 已完成，现为 review，不自行 done。


## 最终指定门禁

所有日志位于 `evidence/`，最终命令均 exit 0：

| 命令 | 结果 | 日志 |
|---|---|---|
| `git diff --check` | 通过 | git-diff-check.log |
| `make lint` | Ruff + frontend ESLint 通过 | make-lint.log |
| `make typecheck` | backend mypy 107 source files + frontend tsc 通过 | make-typecheck.log |
| `make contract-check` | runtime/OpenAPI、generated API check 两项通过 | contract-check.log |
| `make test-unit` | backend 1114 passed；frontend 106 files / 993 passed | make-test-unit.log |
| `make test-integration COMPOSE='docker compose -p partsignal-geo205-validation -f .trellis/tasks/10-02-geo-205-surface-management/evidence/validation-compose.yaml'` | 572 passed / 6 既有 SQLAlchemy metadata 反射 warnings | make-test-integration.log |
| `npm --prefix frontend run test` | 由 `make test-unit` 实际调用，同一候选 993 passed；未重复运行 | make-test-unit.log |
| `npm --prefix frontend run typecheck` | 由 `make typecheck` 实际调用，tsc 通过 | make-typecheck.log |

定向证据：后端77项定向PG（含既有Surface/Profile结构与资格、管理及约束映射）、61项合同、345项runtime metadata，见backend-targeted日志。共享422最终6项通过。复核后Surface/Profile API、页面、命令与首次列表GET竞争4文件45项通过，见review-security-regression.log/review-refresh-regression.log。

## 真实用户流程与视觉证据

精确命令：

```bash
env DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55445/partsignal REDIS_URL=redis://127.0.0.1:56385/14 GEO_MONITORING_ENABLED=true GEO_API_COLLECTION_ENABLED=false GEO_BROWSER_COLLECTION_ENABLED=false PARTSIGNAL_E2E_SPEC=tests/e2e/surfaces-real-stack.spec.ts deploy/scripts/e2e-local.sh
```

最终1 passed，`E2E_RESULT playwright=0 secret_scan=0`；production frontend build、真实API/PG、UI管理员创建Surface/Profile、启用、修改停用/UNTESTED、刷新持久化、真实子引用阻断和删除、ENGINEER直接URL摘要均通过。每个mutation恰好一次请求/响应；未豁免任何写取消。desktop/mobile PNG已从Playwright输出保存、人工视觉检查；375px页面无横向溢出。E2E端口8000/9001/4174/19009、随机独占DB、Redis14与临时存储按日志清理。

这是GEO-205定向纵向验收。未运行完整E2E、跨浏览器矩阵、`make verify`、生产迁移/部署或真实provider：本任务未完成整个R1，未改变浏览器兼容合同，也不实现采集或连接测试。完整指定unit/integration门禁已执行；自动adapter批准路径用显式fake registry元数据测试，默认runtime仍仅manual。

## 初次失败、诊断与修复

- unit初次因新增端点后的contract/runtime operation/response计数和FastAPI遗漏既有nullable default失败；恢复精确模型合同并更新明确计数，未放宽相等断言。见make-test-unit.initial.log/backend-targeted日志。
- frontend组件初次TS2488/TS2339，修正typed inputs和signal捕获；临时backend验证脚本初次Ruff失败，移入Task证据并移除一次性脚本。复核新增parametrize行初次E501，分行后lint通过。
- 完整integration初次571 passed/1 setup error，根合同不在容器；只读挂载实际contracts后失败用例通过，完整572 passed。不是环境失败后当作通过。见make-test-integration.initial.log/review-contract-container.log。
- 首次独立复核确认extra_forbidden未知键名回显；根级/settings新增两项测试修前失败，修后固定unknown-field并保留合法定位，总计6项通过。
- 首次独立复核确认无缓存列表首次GET复用旧promise；enable/delete两项组件修前失败，修后取消旧读、guard、提交后新快照与忽略取消的迟到结果通过。
- E2E初次完整流程已完成，但GET和DELETE请求审计报中止；随后一次build撞到已发现TS问题，一次response.finished()对204未返回，一次UI完成后204仍ERR_ABORTED。最终根据安装版openapi-fetch与现有auth-provider对空响应的处理，在API边界消费204后关闭详情，最终E2E通过。各日志均保留，不通过写取消白名单隐藏失败。

## 安全、事务与并发

Router仅协议/认证/CSRF/参数处理；Application Service拥有提交/回滚、锁/revision/资格与最小成功审计。User FOR NO KEY UPDATE兼容审计FK锁；当前及目标Channel/Model按UUID排序，再Surface/Profile；等待后重读角色、revision、绑定，SET NULL不能复用旧PASSED。API/BROWSER gate来自同一GEO-204资格owner，BROWSER未批准失败；未知adapter422。实际Profile配置变更停用/UNTESTED，no-op不改revision/时间/审计。

列表/详情在认证前使用RR快照，不加载密钥正文。ENGINEER配置、activation blockers、删除管理信息均null且actions空；ADMIN闭合非敏感设置，不保存headers/key/cookie/session/path。统一422只投影合法位置/类型/静态消息，未知键换固定标记；审计只记revision/is_active/稳定ID。business flush仅映射已知SQLSTATE+constraint；audit异常不伪装业务冲突，整体rollback。没有Idempotency-Key、自动重放或新增Redis业务状态。

## 独立复核与范围

首次fresh critical_reviewer返回两项P2，主代理修复；第二个隔离上下文reviewer复验已确认两项P2关闭，204生命周期及只读根合同挂载可接受；未确认新的实质问题。详见evidence/independent-review.md及review-fixes.diff。审计Bundle在用户级持久目录，validated Digest/audit_id完成后附录，不根据agent status猜测验收。

相对initial-hashes统计修改维护文件清单见modified-files.md；前置任务的大量未提交改动保持不变。根合同/生成产物/入口初始到最终diff存evidence/initial-to-final.diff。无新Alembic、依赖升级、指标/机会、Plan/Run/采集、连接测试或browser会话运维；当前Profile不存在未来Run/Plan引用，未来真实owner需接入RESTRICT/锁/删除查询。Surface first_referenced_at blocker count1表示不可逆标记存在，不冒充未来Run历史数量。

## 清理与交付状态

专用Compose已down --volumes --remove-orphans；无该project容器/卷残留，migration空库随专用volume删除。Colima已停止（status明确not running），Docker context恢复default；infra-cleanup.log有确认。本地验证与最终复核/范围检查完成，GEO-205 manifest和Task已更新review，completedAt=null；不提交/推送、归档或自行done。

后续仅列：GEO-206计划契约、GEO-403连接测试及模型/profile测试资格、GEO-806浏览器session/健康/启停运维；本任务未提前实现。

最后合同范围检查发现初次增补仍残留未引用的旧GeoArticleResultOut别名；已从根合同删除并重新生成schema，只增加GEO-205的15个component，既有component均不变。仅做合同/metadata定向单元、contract check和生成类型typecheck重验；该无调用者声明删除不改变业务实现和已验证用户流程。未重新运行完整integration/E2E以覆盖冗余范围。

## 审计与最终证据

`SUBAGENT_EXECUTION_DIGEST` 已由work-plan校验并聚合3个plan/4次执行/2次独立复核，无异常或残留活跃worker。审计Bundle closed、audit-verify passed；audit_id=`20261002T164115Z-geo-205-management-d0bff766`，保留90天。副本见evidence/SUBAGENT_EXECUTION_DIGEST.md。模型/effort是固定Agent TOML配置证据，非独立运行时证明；accepted来自具体交付/验收证据而非status。只读reviewer无写入，维护文件写入归属已由scope/hash检查确定。

最终根合同新增8路径/14操作/15组件，既有组件均不变；无无关Out声明残留。最终contract/metadata/Surface组件定向单元和生成类型tsc均exit0。文档包SHA256SUMS仅更新本任务编辑条目，校验结果见evidence/docs-checksums.log。完整修改维护文件60项，清单见modified-files.md；本Task与证据另外列出。最终git diff --check及哈希范围检查见evidence；未运行检查及限制见上节，无未关闭验收问题。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-205 的实现与测试证据。”据此仅将 manifest 的 GEO-205 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief 当前状态同步更新。

上述实施章节和原始 evidence 保留人工验收前的历史状态、实际测试结果与已知限制，不将未运行检查改写为通过。本次只记录 GEO-205 验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾运行 git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
