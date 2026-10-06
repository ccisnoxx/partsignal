# GEO-801 实施与本地验证

## 实现摘要

独立 browser-collector Node/Playwright 包、锁文件、Dockerfile 与只依赖离线内存DOM的真实运行时健康；dev/staging/prod共享 geo-browser include/profile，普通镜像没有浏览器依赖。无网络、非root/sandbox、只读根、全部cap删除和限额；默认双开关false及默认STOP。CLI只收稳定UUID，未实现/停用显式退出，不消费Redis消息或创建PG lease；普通API Worker提前忽略非API冻结模式。没有真实adapter、会话、截图或HTTP任务入口。

## 变更文件

- browser-collector/{Dockerfile,.dockerignore,.gitignore,package.json,package-lock.json,tsconfig.json,README.md,src/service.mjs,src/main.mjs,src/healthcheck.mjs,tests/service.test.mjs}。
- deploy/compose.geo-browser.yaml、geo-browser-seccomp.json、geo-browser-control/STOP；compose.dev/staging/prod.yaml仅添加include；scripts/test-geo-browser.py新增验收，scripts/test-geo-configuration.py只补临时include来源。
- backend/app/services/geo_runs.py仅非API守卫；tests/unit/test_geo_browser_boundary.py及tests/integration/test_geo_browser_boundary.py。
- Makefile接入独立包与定向runtime目标、部署config检查。
- GEO README、03-technical/08-deployment-and-operations.md、task-manifest.yaml与SHA256SUMS；本Trellis Task Brief/design/implement/jsonl/task/evidence。

## 契约与业务不变量

OpenAPI/database及所有Alembic源码与任务起点SHA相同。没有新revision、DDL或历史迁移；head0062_geo_opportunity_decisions。真实PG定向测试从空库前滚到head成功，随后删除本轮测试库；未运行生产迁移、未改现有开发业务库。

Application Service仍是业务状态、锁、lease、revision、预算和发送仲裁唯一owner。模式来自PG冻结输入，普通Worker读取后非API即返回；新骨架不持有业务状态/数据库连接，也不改变Batch/Run、dispatch字段、答案/历史。API原配置→accounting→Batch→Run锁顺序、token、SENT at-most-once、恢复/retry行为保持。重复或并发非API消息不产生业务副作用；现有19项Worker并发/重复、Redis/Celery生命周期回归通过。

错误边界：内部UUID非法 BROWSER_TASK_INVALID；配置非法 BROWSER_CONFIGURATION_INVALID；关闭/STOP/控制目录错误 COLLECTOR_DISABLED；开关允许仍 BROWSER_ADAPTER_NOT_IMPLEMENTED。均退出1，不写公共Run.error_code；普通Worker返回None。健康只返回固定503 BROWSER_RUNTIME_UNAVAILABLE或真实browser_runtime与collection状态；session_probe始终NOT_IMPLEMENTED。

安全：没有外部URL/AI调用、Cookie/session volume、截图/video/trace/正文日志，容器没有DB/Redis/AI/SESSION credential env_file。只有回环健康端点；network_mode none，无端口和业务网络；默认1CPU/1GiB/128PID/128MiB tmpfs+shm，readonly/cap_dropALL/no-new-privileges/pwuser/init。seccomp固定来源与子namespace chroot理由见design和部署合同。SIGTERM释放浏览器，真实停止exit0。热STOP按容器文件系统逐次重读；Desktop bind传播在测试中最多有界等待5秒，控制文件缺失目录/访问错误拒绝。

无前端代码/路由/query key/URL状态/generated类型变化；未修改指标、权限、CSRF、TLS、SSRF、安全门禁或状态机。

## 运行命令与结果

| 命令 | 实际结果与证据 |
|---|---|
| git diff --check | exit0，无whitespace错误；新文件另行--no-index --check无诊断（exit1表示内容新增）。见git-diff-check.log |
| make lint | exit0；Node语法、backend Ruff、frontend ESLint。lint.log |
| make typecheck | exit0；Collector checkJs/TS、backend233源mypy、frontendTS。typecheck.log |
| make test-unit | exit0；Collector3、backend3660、frontend1266通过。test-unit.log |
| make test-deploy-scripts | 最终exit0；三环境Browser/18组配置、194项Collector、fixture金标、生命周期/secret scan/部署与真实Engine网络检查。test-deploy-scripts.log |
| make contract-check | exit0；公共合同/后端/generated前端类型一致。contract-check.log |
| make test-geo-browser | 最终exit0；三环境默认/profile/空值保留，真正默认up零容器，独立build，空值启动明确失败，真实sandbox DOM健康、非root/CPU/内存/PID/networknone/只读、默认及热kill、未实现拒绝、正常退出0与本轮project/tag清理。runtime.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_worker_configuration.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_configuration.py -q | 编辑前104通过。baseline.md |
| UV_CACHE_DIR=.cache/uv uv run --project backend python deploy/scripts/test-geo-configuration.py | 编辑前18组通过，无启动外部调用。baseline.md |
| PARTSIGNAL_TEST_DATABASE_URL=postgresql://partsignal:partsignal_dev@127.0.0.1:55432/partsignal REDIS_URL=redis://127.0.0.1:56379/15 UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_browser_boundary.py backend/tests/integration/test_geo_worker.py -q | 首次exit1：既有19项通过，新夹具缺BatchSubject失败；未宣称原命令通过。worker-integration-initial.log |
| 同上述环境 pytest backend/tests/integration/test_geo_browser_boundary.py -q | 修正夹具主体引用后exit0，1通过，重复claim/process/首次dispatch/补投递后Run+Batch整行JSON与前相同、发布0。browser-integration.log |
| docker build --target production -t partsignal-geo801-backend:test backend | exit0。backend-image.log |
| docker run --rm --network none --entrypoint python partsignal-geo801-backend:test（importlib/shutil/Path探针，见验证记录） | exit0：无Playwright/Selenium/Chromium/Chrome/Firefox executable与/ms-playwright；tag已删除。backend-image-probe.log |
| python3 .trellis/scripts/task.py validate .trellis/tasks/10-05-geo-801-browser-collector | exit0，两个jsonl各6项，已用定向依赖证据避开manifest注入截断 |

所有env中的数据库账户均为仓库既有本地测试专用值，不是生产凭据；从未输出实际.env。完整初始失败与成功日志保留；证据对实际runtime敏感值和GEO canary变体扫描clean。

## 失败定位与修正

1. Chromium首次sandbox启动在zygote sys_chroot失败：官方profile的initial CAP_SYS_CHROOT条件与cap_dropALL冲突。保留kernel权限检查，子namespace允许chroot；force-recreate重新加载filter，健康通过。无SYS_ADMIN/privileged/unconfined/关闭sandbox。
2. runtime首次bind失败：Docker Desktop不共享/var/folders临时路径；测试owner改仓库.cache共享路径。runtime-initial.log。
3. 宿主STOP unlink短暂未对容器可见；健康观察改为5秒有界等待，未改变入口裁决。runtime-propagation-initial.log。
4. 新真实PG夹具缺冻结BatchSubject，数据库拒绝提交；补真实主体关系，未放宽守卫，单测定向通过。
5. 旧配置baseline用临时project-directory解析include找不到共享文件，补夹具复制；完整部署命令成功重跑。test-deploy-scripts-initial.log。
6. 独立复核P2：Compose :-会把显式空值改false。改为仅未定义默认的 - 插值，三环境空值保留与真实启动拒绝、runtime/部署全流程复验通过。

## 覆盖与限制

未运行make verify、全后端integration/full E2E/浏览器矩阵：本次不改变完整用户旅程/前端/数据schema，最低用户门禁和定向真实PG/Redis/容器覆盖直接边界，其他全套不会覆盖不同实质风险。test-deploy-scripts内部实际执行既有单条secret产物E2E，按真实执行报告。未执行真实平台、生产启用、发布镜像推送或网络接线；后续802/803及804–807仍按清单分别执行。仅本机Docker Linux runtime已验证，其他运行平台未实测。资源限额尚未用于真实平台负载度量。

## 证据与交付状态

baseline-sha256/before保存任务起点；task-only.diff只包含本任务候选，working-tree-audit确认起点源码没有缺失且只有任务拥有的9个已有文件改变（加最终CHANGELOG/SHA清单），庞大前序未提交变化均保留。manifest仅GEO801 planned→in_progress→review；GEO408/GEO002仍done、802/803仍planned。无提交/推送/部署/归档。独立review与validated digest已归档到evidence，持久化Audit Bundle 20261005T074127Z-geo-801-baa4e4e9，finalize/verify均passed，无异常，只读复核未写文件；一项P2修正后解除。

文档包SHA检查：本任务四个更新文档摘要均通过；完整shasum命令exit1，唯一失败01-product/02-geo-core-prd.md。当前文件SHA与任务起点baseline完全相同，原SHA清单已经不匹配该起点文件，确认为前序遗留，不修改其业务文档或掩盖摘要。见doc-sha256.log及pre-existing-doc-checksum.json。本任务最后git diff --check和新文件whitespace检查通过。


## 人工验收完成 — 2026-10-05

本会话用户明确表示：“我已经人工审查并接受 GEO-801 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-05。既有review阶段实现、测试结果、原始失败与覆盖限制保留为验收前历史，不改写已有验证结论。

本次只收尾GEO-801，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS只同步manifest条目。验收前状态保存于evidence/acceptance-before.json；收尾git diff --check精确命令与结果保存于evidence/acceptance-diff-check.json/log。
