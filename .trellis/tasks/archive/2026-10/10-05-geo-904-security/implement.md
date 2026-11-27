# GEO-904 / R8 实施与证据

## 1. 验收前结果与状态

本地复核、全部 TEST-GEO-SEC 映射、两项真实PG补测及必要验证已执行；**GEO-904 为 blocked**。903=done、Trellis completed且有2026-10-05人工接受；按ADR006核心R6→R8，R7 deferred不作为前置。唯一停止原因是完成904必需的目标现场与实际平台批准外部输入尚缺。此前通过异步文字问题请求名称/授权只读入口或脱敏报告路径及批准清单，未收到回复；没有猜测目标、访问未指定VPS或自行批准例外。

状态planned→in_progress→blocked，manifest/task.json一致，completedAt=null；未进入review/done，未实施905/906或804～807。

## 2. 入场与阅读

已读取根/适用backend/frontend AGENTS、Trellis workflow、task template与相关backend/infra/frontend spec。主线程核对manifest依赖与WBS完整904行，读取README/governance/roadmap/execution-guide/template、903历史；两个fresh只读analyst完整读取用户指定PRD/domain/workflows/methodology/technical/data/security/ADR001～006及roadmap/WBS/security/testing/deployment/ADR006，完整/局部清单保存在调查报告。

当前OpenAPI/database的相关GEO及Browser权威单位、0048/0050/0052/0054/0055/0063～0065迁移及实际代码/测试已检查；主线程补读四条AI secret写路径及请求/投影/CSRF参数。不声称审查全仓全部迁移/协议。先输出十二项preflight并继续，Collector当前194项基线通过后补测。

## 3. 修改文件与行为

- `backend/tests/integration/test_geo_security_review.py`：两项真实PG攻击反例。
- `docs/geo-monitoring/04-delivery/11-r8-security-review.md`：八项映射、实际边界、现场/批准未知及恢复条件。
- `docs/geo-monitoring/03-technical/07-testing-and-quality.md`：补测入口与适用边界。
- `docs/geo-monitoring/04-delivery/task-manifest.yaml`：只变904，执行及blocked原因。
- `docs/geo-monitoring/README.md`、`CHANGELOG.md`、`SHA256SUMS`：索引、状态和本任务哈希。
- 本Task的prd/design/task/implement及evidence：调查中文摘要、实际日志/结果、目标未知、增量diff、清理与审计验证。

恶意回答含读取SESSION_SECRET/文件、凭据解密、外传、shell、人工批准/COMPLETED指令。实际Analysis Worker在随机PG执行，虚构canary及CredentialCipher.decrypt/PinnedHTTPTransport/socket/Popen拒绝计数器均零调用。原文/hash不变，DETERMINISTIC分析完成，UNTRUSTED_INSTRUCTIONS/CLAIM_UNJUDGEABLE、claims均UNJUDGEABLE，Run NEEDS_REVIEW，无人工review、finished_at=null，结果/日志无canary。只证明当前本地分析，不声称外部模型system已测。

真实ADMIN创建虚构渠道/Header，仅配置不连接外部。ENGINEER有效CSRF和ADMIN错误CSRF攻击Key替换及Header新增/修改/删除，分别403 PERMISSION_DENIED/CSRF_INVALID；每次拒绝后渠道/密文Header/revision/成功审计内存摘要不变。只比较摘要，不输出秘密或密文。这是缺少等价覆盖的行为补测，不是产品漏洞修复，不声称原代码red/green；没有修改应用规则来通过。

## 4. 契约、迁移、事务与前端

OpenAPI/generated类型/database/Alembic无变化；无新revision，当前head0065_geo_observability。隔离PG沿现有链前滚到head，无生产前滚、数据回填、历史迁移或回滚操作。

PG权威、Redis稳定ID、Router不拥有事务/ORM写入、Application Service裁决保持。锁序、revision/CAS/lease/发送账、幂等、状态机和错误映射未改；原始回答、批准事实、机器分析/Review不可变守卫保留。新增用例观察拒绝无写及回答不能执行状态指令。前端路由/query key/URL/页面状态、配置文件与默认开关均无变化。

## 5. 八项SEC与敏感边界

专项报告是本轮SEC001～008映射入口。secret/API投影/审计日志/cache、SSRF混合DNS/peer/TLS/redirect/限体、分级外发、XSS scheme/HTML、CSV公式注入、角色/CSRF、prompt injection和Browser引用/审计/撤销均有本地直接证据。无确认可利用高风险绕过，不等于目标验收已通过。

正式collector approved=False、冻结INTERNAL；诊断成功不授采集批准。当前分析仅DETERMINISTIC；本地fixture PUBLIC/approved=True不是实际批准。未使用真实外部AI、生产秘密或会话；MANUAL图片内容脱敏依赖SOP/提交裁剪，不把MIME/hash当图片秘密检测。未创建/接受例外，不编造责任人或到期日。

## 6. 实际验证

| 命令 | 结果 | evidence日志 |
|---|---|---|
| `UV_CACHE_DIR=.cache/uv uv run --project backend python deploy/scripts/test-geo-collector-contract.py` | exit0；194通过，secret_scan=0/external_network=blocked | baseline-collector.log |
| `make lint` | 入场及最终均exit0，Browser/backend/frontend通过 | make-lint.log、make-lint-final.log |
| `make typecheck` | exit0，Browser、249backend源文件、frontend通过 | make-typecheck.log |
| `make contract-check` | exit0 | make-contract-check.log |
| `make test-unit` | exit0，Browser13/backend3781/frontend1285（135files）通过 | make-test-unit.log |
| `make test-integration` | **exit2未通过**；1162通过、6失败、6errors、43warnings；630.32s | make-integration.log |
| `docker compose --env-file .env -f deploy/compose.dev.yaml run --rm --no-deps backend-test pytest tests/integration/test_geo_security_review.py` | 最终exit0；2通过，5.93s | security-review-pg-final.log |
| `docker compose --env-file .env -f deploy/compose.dev.yaml run --rm --no-deps backend-test pytest tests/integration/test_geo_answer_files.py` | 环境修正后exit0；8通过，4.09s | object-storage-rerun.log |
| 下述显式PG16桥接→`pytest backend/tests/integration/test_geo_recovery.py -q` | exit0；六节点通过 | recovery-environment-rerun.log |
| `node deploy/scripts/check-nginx-security.mjs` | exit0，静态安全头/Markdown/HTML/DOM sink通过 | nginx-security.log |
| `git diff --check` | exit0，无空白诊断 | git-diff-check.log |
| `git diff --no-index --check /dev/null backend/tests/integration/test_geo_security_review.py` | 无空白诊断；exit1表示新增差异，未写成exit0 | new-test-diff-check.log |
| 文档目录`shasum -a 256 -c SHA256SUMS` | 最终exit0，123项通过 | docs-sha256-final.log |
| `work-plan audit-verify 20261005T182700Z-geo-904-622ed545 --json` | closed/passed，写路径未知异常保留 | audit-verify.json |

typecheck/unit/contract结果复用：随后只新增integration测试/文档，没有改其覆盖的应用代码、类型或依赖。完整integration在新测试文件前已收集；两项以最终定向结果为准，不混入原1162计数。逐项结果见validation-results.json。

## 7. 失败诊断与环境修正

完整integration六失败全部在test_geo_answer_files.py。原fake-oss入场exited，backend-test依赖只启动PG/Redis，报DNS Name or service not known。一次性自有对象容器加入相同alias，APP_ENV=test、OBJECT_STORAGE_PATH=/tmp/geo904-object-store，核实实际Settings后仅重跑该文件8项通过。最初临时变量名写错即停止并重建，没有用共享/data执行测试；未修改Compose/Makefile。最终容器--rm已删除，原fake-oss仍exited，PG/Redis继续运行，见local-cleanup.json。

六errors全部是GEO903 fixture要求显式RECOVERY_PG_BIN/GEO_RECOVERY_PG_CONTAINER，缺失即fail不skip。沿903已验收宿主桥接仅使用本机开发PG16工具/owner随机库，重跑六节点通过，无应用修改或依赖安装。精确桥接命令如下，只在进程内保留连接秘密，fixture拒绝非测试前缀库：

```sh
UV_CACHE_DIR=.cache/uv PYTHONPATH=backend uv run --project backend python - <<'PY'
import os
os.environ['APP_ENV'] = 'test'
from app.config import settings
from sqlalchemy.engine import make_url
import pytest
os.environ['PARTSIGNAL_TEST_DATABASE_URL'] = make_url(settings.database_url).set(host='127.0.0.1', port=55432).render_as_string(hide_password=False)
os.environ['REDIS_URL'] = make_url(settings.redis_url).set(host='127.0.0.1', port=56379, database='14').render_as_string(hide_password=False)
os.environ['GEO_RECOVERY_PG_CONTAINER'] = 'partsignal-dev-postgres-1'
raise SystemExit(pytest.main(['backend/tests/integration/test_geo_recovery.py', '-q']))
PY
```

完整门禁失败保留，未把定向通过改写为全量通过，未盲重跑十分钟套件。43warnings来自既有SQLAlchemy表循环/dialect_options检查。

新增测试曾有E501和审计target_id(varchar)与UUID比较错误；拆断言及显式::text后ruff/两PG通过，中间日志保留。文档初次哈希因./路径重复失败，恢复原格式/顺序后123项通过；无无关内容变更。实施记录第一次保存命令因内嵌heredoc同名导致shell语法错误，未执行文件写入，改用独立外层delimiter后保存。

## 8. 未验证范围、目标证据与下一步

local-container-inventory只观察本机Docker，无Browser容器；不证明目标API开关/profile/PG会话/密钥/材料。901仅开发，903仅新建恢复来源N/A，804批准搜索也仅历史指定范围。target-environment-status.json将未知保留null；生产NOT_VERIFIED，Browser清理/恢复NOT_DETERMINED，不误标N/A。

未运行目标只读检查、真实批准核对、生产TLS/ingress/cache/人工截图内容检查：入口及批准清单未提供。未运行真实平台请求或804 consumer/staging smoke：deferred且无批准/能力。不运行全产品E2E、Browser矩阵、make verify、905容量或906上线：无应用/页面变更或额外独立风险要求扩张；指定门禁和直接安全边界已执行，未运行项不写为通过。

恢复904需同一目标身份/revision/时间，API/worker实际Browserfalse、服务/profile停用、无capability/key/session挂载、PG零session/引用及受保护路径/卷无材料；实际API/platform inventory及范围匹配批准。确无API启用须有据N/A，发现Browser材料沿已验收保护/撤销/清理/恢复路径处理。全部条件满足才review，done仍待人工接受，不实施906。

## 9. 范围检查与子代理证据

入场大面积未提交改动保留。task-only.patch基于入场before，scope-inspection确认manifest只变904、903仍done，Makefile和安全权威正文未改。SHA保留原顺序，仅四项更新及904报告追加。未提交/推送/发布或归档。

两份只读analyst报告已核对交付并保存中文摘要，不计独立reviewer。应用公开/持久化/权限安全保证没有改变，未触发高后果候选独立review要求。审计id 20261005T182700Z-geo-904-622ed545，关闭/完整性校验通过；未取得子代理完整字节级写路径证据，observed_write_paths=null，digest异常如实保留，不能由self-report或TOML假称已确认零写入。

最后链接检查：904新增及修改链接全部有效；07-testing-and-quality.md中既有GEO902链接使用../../../../而不是../../../，入场before也同样不存在，未改该无关路径。整份修改文档链接扫描存在这一项pre-existing失败，不能写作全包链接通过；见delivery-integrity.json。最终git diff --check/123项SHA均exit0。

最后补测将审计断言限定为SUCCESS事实，允许将来记录DENIED/FAILED审计而不锁定偶然实现；真实PG两项重跑exit0（5.93s），make lint重跑exit0。应用行为/合同仍未修改。

## 10. 人工验收 — 2026-10-05

用户明确表示：“我已经人工审查并接受 GEO-904 的实现与测试证据。”据此将manifest的实际blocked状态更新为done，Trellis标记completed，完成日期为2026-10-05；不虚构review过渡。

本会话用户已人工审查并接受 GEO-904 的实现与测试证据；本次仅记录验收完成，manifest=done、Trellis=completed，保留原验证结果、目标环境未验证及其他覆盖限制，不修改其他任务状态、不实施后续任务，不提交、推送或归档。原完整集成门禁失败不改写为通过，目标NOT_VERIFIED不改写为已检查。收尾只运行git diff --check，结果在本次交付回复中报告；本次仅更新manifest、对应哈希、Task Brief、任务元数据及本验收记录。
