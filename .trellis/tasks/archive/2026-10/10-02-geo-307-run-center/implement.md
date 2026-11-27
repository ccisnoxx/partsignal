# GEO-307 实施与验证记录

## 交付状态

2026-10-02（America/Los_Angeles），R2，`geo/GEO-307`。唯一直接依赖GEO-306的manifest和人工接受记录均为done，执行前已确认允许进入。GEO-307按planned→in_progress→review交付，等待人工接受，没有标记done或归档。没有提交、PR或生产发布。

已阅读Task Brief列出的根/前端规则、spec、GEO文档和Accepted ADR，以及当前OpenAPI、数据库合同、0048..0051迁移、manual/read服务与相邻测试；编码前已输出12项preflight。当前实现已有Batch factory、MANUAL命令和稳定读模型，本次补齐前端使用入口。起点包含大量前序任务脏修改，保存基线后仅修改本任务文件。

## 实际行为与文件

- `/geo/runs`提供批次/运行双层视图、完整服务端summary、从计划创建批次、筛选/分页/选中对象与详情。具体源码见`frontend/src/domains/geo-runs/`；真实文件路由遵循仓库现有`frontend/src/routes/_app/geo/runs.tsx`约定。
- 人工编辑器保存正文格式、来源信息、实际采集时间、截图和引用。引用可增删及记录原始位置；规范化和重复引用合并由服务端完成。已保存草稿刷新可恢复，未保存输入仅在组件状态并由dirty guard保护。
- 文件上传复用真实intent→内容PUT→complete；只关联与预期ID、category、摘要、大小和MIME一致的VERIFIED文件。失败恢复先读取canonical文件状态；PENDING可继续确认或终止，FAILED/ABORTED/DELETING/DELETED解除上传阻塞并保留表单，VERIFIED可关联或舍弃关联。
- 详情展示冻结问题/环境、原始回答、hash、来源、实际采集时间、引用原始位置、签名截图、同cell attempts和真实时间线。HTML_TEXT以文本展示，Markdown复用安全渲染。费用和批次统计全部消费服务端值，unknown不补零。
- 接入导航、计划详情到运行中心的链接、generated route tree；注册新真实栈用例。文档更新README、CHANGELOG、前端架构、质量说明、manifest与文档哈希。

完整本任务源码/稳定文档清单见[evidence/changed-files.txt](evidence/changed-files.txt)，相对任务起点的实际补丁见[evidence/candidate.patch](evidence/candidate.patch)。Trellis另保存prd/design、jsonl上下文、task.json和此记录及证据；根级与其他任务既有修改不属于本次补丁。

## 合同、迁移与不变量

没有修改`contracts/openapi.yaml`、`contracts/database.md`、generated OpenAPI schema、后端应用服务或Alembic。前端仅消费现有generated协议类型；表单类型表达本地输入，不能替代领域状态和服务端资格。`make contract-check`确认runtime/根合同/generated同步。

Alembic head仍为`0051_geo_manual_collection`。隔离真实栈创建空数据库，实际前滚base→0051成功，日志见`e2e-final.log`；没有本任务新revision、历史回填、存量数据迁移或生产迁移。回退本次前端入口即可，已保存草稿和正式证据继续由既有后端读取。

事务、锁、revision、状态机和审计保证继续归属现有Application Service；Router没有新增事务或ORM写入。既有User→Surface→Profile→Batch→Run→Draft→Files排序锁，正式提交actor/key事务advisory锁、expected_draft_revision、唯一Answer/提交身份及冻结触发器未改变。PostgreSQL仍是业务唯一来源，Redis稳定ID协议未改变。

批次三次人工提交后各run为COLLECTED，分析/质量仍NOT_IMPLEMENTED，完整summary的collected_count=3、pending_manual_count=0、completed_count=0。前端不把已采集冒充分析或完成，不实现取消、重试采集或机器分析命令。

## URL、并发与错误处理

`view/q/资源ID/状态/模式/触发方式/时间范围/错误/排序/page/page_size/latest_only/needs_review/batch_id/run_id/edit/create`按适用视图存入canonical URL。列表query key只由规范URL参数生成；批次、run、manual各有独立key。读取传AbortSignal，可见页面按服务端阶段轮询；隐藏页面暂停，terminal或读取失败停止自动轮询，失败保留已成功数据并给出明确恢复。

RHF拥有本地草稿及提交revision。后台GET不重置表单或CAS基线，保存成功采用canonical响应；409和读取/资格变化冻结写入并保留输入，只在用户明确比较/重载时采用服务端版本。401/403/404提供说明和安全返回，不提供无效重试。

批次创建/正式提交的结果未知时保留原payload、revision、幂等键和principal，显式同键确认，不自动重发写操作。创建回执做closed schema、UUID、数量与带时区时间校验，格式损坏不当成功。上传不盲重传内容PUT，先按同ID查询。principal变化/卸载后迟到响应不能关联文件、改表单或导航；迟到提交成功通过最新导航ref保留用户最新筛选/分页。

现有结构化错误保持原status和ErrorDetail；明确4xx与网络/损坏回执的未知结果区分。409不吞错，401/403不绕过资格。URL只包含筛选和稳定ID，正文、引用草稿和签名访问不进入持久浏览器存储；详情Query禁HTTP缓存、gcTime=0。

## 安全与数据边界

复用现有认证、CSRF、principal continuation、上传MIME/大小/摘要验证和RESTRICTED的INTERNAL OPERATION_SCREENSHOT。截图仅PNG/JPEG/WEBP，最大10MiB；提示人工裁剪敏感内容，未引入自动隐私处理。正式证据只读，未放宽历史不可变、审计、TLS或文件权限。

外链仅http(s)，拒绝凭据URL，使用noopener/noreferrer；HTML不执行。签名过期提供显式刷新，不猜测存储位置。测试使用虚构配置、fake/local服务、隔离PostgreSQL/Redis与本地对象存储，没有调用真实外部AI。真实栈、fixture和最终定向E2E均由标准秘密扫描确认clean。

## 实际验证

以下exit code来自实际执行完成状态，不由空日志推断。最低要求全部执行；完整`make e2e`失败如实保留，补充检查不能改写其结果。详细命令/输入/日志见[evidence/validation-results.json](evidence/validation-results.json)。

| 命令 | 结果 | 证据 |
|---|---|---|
| 当前基线frontend定向（9 files） | 91 passed | baseline-frontend.log |
| 当前基线backend manual/read合同 | 31 passed | baseline-backend.log |
| `git diff --check` | exit 0 | diff-check.log |
| `make lint` | exit 0，Ruff/ESLint通过 | lint-final.log |
| `make typecheck` | exit 0，142后端文件和frontend通过 | typecheck-final.log |
| `npm --prefix frontend run test` | exit 0，119 files / 1121 tests passed | frontend-full-final.log |
| `npm --prefix frontend run typecheck` | exit 0 | frontend-typecheck-final.log |
| `make contract-check` | exit 0，runtime/合同/generated一致 | contract.log |
| `npm --prefix frontend run build` | exit 0；既有Markdown chunk warning保留 | build-final.log |
| `make e2e`（未过滤默认真实栈） | exit 2；24 passed / 2 failed；secret scan clean | make-e2e.log |
| `npm --prefix frontend run e2e`（默认fixture，补充检查） | exit 0；498 passed / 54 skipped；secret scan clean | e2e-fixture.log |
| GEO-307真实栈定向（最终候选） | exit 0；1 passed；secret scan clean | e2e-final.log |

基线命令：

```sh
npm --prefix frontend run test -- src/domains/geo-plans src/domains/geo-questions src/domains/geo/geo-evidence-upload.test.tsx src/design-system/forms/dirty-guard.test.tsx
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_manual_collection_contract.py backend/tests/unit/test_geo_read_contract.py
```

真实栈所需环境指向仅本任务的本地Compose：

```sh
DATABASE_URL=postgresql+psycopg://partsignal:geo307-local-test-only@127.0.0.1:55457/partsignal REDIS_URL=redis://127.0.0.1:56397/15 make e2e
DATABASE_URL=postgresql+psycopg://partsignal:geo307-local-test-only@127.0.0.1:55457/partsignal REDIS_URL=redis://127.0.0.1:56397/15 PARTSIGNAL_E2E_SPEC=tests/e2e/runs-real-stack.spec.ts deploy/scripts/e2e-local.sh
```

这里的密码只用于任务创建的隔离临时PostgreSQL，与生产凭据无关。最终定向覆盖：UI创建3个run的批次、筛选刷新、dirty取消导航、已保存草稿刷新、真实PNG intent/PUT/complete、截图保存刷新、三个正式提交、原文字节hash、图片naturalWidth、HTML不执行、规范化引用positions=[1,3]和完整summary。编辑器与详情在375/768/1024/1440px无页面横向溢出，编辑器另验证实际CSS zoom=2和焦点；没有宣称native浏览器缩放。截图见[evidence/geo307-manual-editor.png](evidence/geo307-manual-editor.png)。

组件测试保护URL、server动作、轮询、dirty、冲突/权限、迟到principal/URL、未知回执同键恢复、上传失败/GC终态、安全正文和证据展示。既有成功检查复用，未重复跑无变化的广泛后端套件；后端业务保证已有GEO-305/306真实数据库证据，本次真实栈亦覆盖正常纵向路径。

完整E2E运行之后补齐文件GC终态和不可恢复的初始读取错误展示；最终候选重跑lint、typecheck、完整前端1121项测试及GEO-307真实栈。未重跑未修改的完整真实栈失败用例，表格保留其原始失败状态，不将较早完整门禁称为最终候选通过。

## 完整门禁失败与早期诊断

完整`make e2e`的GEO-307用例通过，失败来自两个未修改的既有用例，且已在GEO-209记录：

1. `frontend/tests/e2e/geo-real-stack.spec.ts:292`：上传intent/PUT/complete成功后，Playwright `postDataBuffer()`返回null，字节断言失败。底层浏览器原因未确认；不把接口成功视为断言通过。
2. `frontend/tests/e2e/surfaces-real-stack.spec.ts:100`：共享content_editor账号seed密码登录401。前执行auth-session用例已将此账号改为随机新密码，后用例沿用旧密码；这是既有测试间账号污染。本任务使用admin准备虚构配置，没有修改上述账号或测试。

范围外用例未修改，完整门禁没有盲重跑。Make在真实栈失败后未进入fixture后半，故单独实际执行fixture并报告。细节见[evidence/gate-failure-classification.md](evidence/gate-failure-classification.md)。

早期GEO-307定向失败依次诊断并修复：列表未展示run ID导致定位失败（补可追溯ID）；新测试可选方法类型不匹配导致构建失败（修正类型调用）；Chromium空204 PUT及列表替换GET取消触发审计（仅放行确切路径/生命周期，PUT必须先观测204，仍验证单次真实PUT、complete、文件内容和后续证据；未豁免其他写入失败）。只有相应代码或诊断证据改变后才重跑，最终候选通过。

## 独立复核与审计限制

独立只读复核指出并已修复：损坏批次成功回执丢失幂等恢复身份；截图失败/GC终态长期阻塞；迟到提交覆盖最新URL。后续只读复核确认原项和DELETING/DELETED补充项均关闭。原始派发/execution/读写工具证据保存于Audit Bundle和本Task evidence；主代理最终集成和diff检查另行完成。

Audit ID：`20261003T045826Z-geo-307-ee12561b`。首阶段之后Codex配置哈希改变，审计工具重新校验时拒绝`codex_config_evidence`，不能生成覆盖全部当前任务的有效SUBAGENT_EXECUTION_DIGEST；finalize/verify实际失败，Bundle保持open。没有改写旧计划配置或伪造摘要，不能可靠发布聚合尝试/验收/独立复核统计。见[evidence/audit-limitation.md](evidence/audit-limitation.md)及audit-digest-failure/audit-finalize/audit-verify日志。

未在真实浏览器注入网络丢回执、跨principal切换或GC竞争；这些错误路径有组件测试和独立复核，正常纵向有真实栈。没有运行完整后端unit/integration、`make verify`或生产迁移：本次无后端/合同/数据库修改，已选择相关基线、合同检查和用户要求门禁。最低要求没有未执行项。

## 环境、残余限制与后续

测试环境起点Colima停止/Docker default；仅启动本任务Compose的PostgreSQL16/Redis7.4。标准E2E清理独占数据库、存储、Redis DB15任务键和8000/9001/4174/19009端口；结束后删除本任务Compose及其volume、停止Colima、恢复Docker default，见environment-cleanup.log。

完整门禁两个既有失败与审计聚合缺口仍保留，均未隐藏或称为通过。未保存草稿不会跨浏览器刷新持久化，已保存草稿可恢复；签名证据需要有效登录和过期后刷新；未知结果需人工显式确认。分析/质量/已完成统计继续明确NOT_IMPLEMENTED/unknown，不构造假结果。

后续只列GEO-308的R2并发/不可变/旧观测兼容整体验收与GEO-408的API自动观测UI。它们仍为planned，本次未实施。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-307 的实现与测试证据。”据此仅将manifest的GEO-307从review更新为done，Trellis task.json从review更新为completed，completedAt=2026-10-02，记录接受者、范围与依据；Task Brief当前状态同步更新。

上述实施章节、原始evidence与审计记录保留验收前历史状态、实际测试结果及已知完整门禁失败和审计聚合限制，不改写测试结果。本次仅记录GEO-307人工验收，不修改其他任务状态，不实现后续任务，不提交、归档或清除会话指针。SHA256SUMS仅同步manifest对应条目。

本次收尾运行git diff --check，实际结果见本轮最终报告；未重跑实现阶段测试。
