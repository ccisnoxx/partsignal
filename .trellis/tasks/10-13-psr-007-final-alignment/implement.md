# PSR-007 最终实现与人工验收证据

## 1. 交付状态与实现摘要

2026-10-13，PSR-001～006 均为 `done`，对应 Trellis `completed`，人工接受记录已核实。PSR-004、PSR-006 依赖满足。PSR-007 从 planned 经 in_progress 交付为 **review**，待人工审查；不标 done/completed、不归档。

文档统一已完成，指定快速/领域/合同与 Compose 配置检查通过；**完整 `make verify-release` 未通过，Docker daemon 环境阻断**。该状态单独记录，review 不能解释为发布获准。分支 `docs/PSR-007-final-alignment`，HEAD `9b588544`；证据针对包含前序 SDK/部署修改的当前工作树，不是干净目标 commit 的发布证明。本轮没有提交、推送、部署或真实外部 AI 调用。

消除当前技术方案的旧自研传输承诺；README 使用实际 no-egress 模式与已有试运行记录；AI/GEO/测试/运维/模板/部署说明统一当前边界；维护导航统一前序接受状态；GEO 运维配置改为当前 Settings 已实现字段。没有业务代码、测试或运行配置值变化，也没有确认需要修复的前序功能回归。

## 2. 修改、删除与工作区保护

本轮既有文件增量共17项，完整清单见 [changed-files.txt](./evidence/changed-files.txt)，相对开始基线的独立 patch 见 [changes.patch](./evidence/changes.patch)。

- 根 README；三份 `.env*.example` 仅注释修改。
- docs/architecture.md、testing.md、operations.md、production-configuration.md、Hostdzire部署上线流程.md、Hostdzire部署附录.md、GEO系统前后端技术与部署方案.md。
- GEO 当前运维配置段、CHANGELOG 与 SHA256SUMS（只更新上述两份文档的条目，138项校验一致）。
- 维护 README/manifest；现有 E2E 隔离 spec 的过时 CI/旧 AI 网络描述与权威导航。

新增本 Trellis Task Brief、preflight、implement、task.json 和正式 evidence。**本轮删除文件为0**；工作树中旧 AI 客户端/传输/专属测试、Actions 和 CI spec 的删除来自已接受的 PSR-004/006，不归为本轮新删除。

按本轮开始逐文件 SHA256 核对：backend/frontend/deploy/contracts、Makefile、依赖/锁文件、历史 Alembic、前序 PSR task/人工接受记录均无本轮字节变化。三份模板的全部非注释内容逐字一致。最终 actual diff、git status 与 staged 列表已检查，staged为空；保护结果见 [workspace-audit.json](./evidence/workspace-audit.json)。

## 3. 官方 SDK 调用边界

AI 配置模型发现/连接测试、正式生成/自然化、GEO Profile 诊断与已实现 API Collector 都使用官方 `openai` Python SDK，锁定3.29.0，继续 Models list / OpenAI-compatible Chat Completions。同步非流式，`max_retries=0`，关闭重定向和环境代理；支持管理员 Base URL、模型、API Key 与受支持 Header。

适配层拥有 SDK 生命周期、安全错误和结果投影；应用拥有 CredentialCipher、调用边界解密、业务快照、PUBLIC 门禁、严格输出 Schema、资格/revision/lease/状态机、预算、审计和指标。不宣称自研 DNS pinning、TCP peer、TLS 或 HTTP/1.1；生产 HTTPS 与 URL 结构校验不提供旧固定地址保证。

非空 OPENAI_CUSTOM_HEADERS 与 SDK 控制 Header 明确拒绝；普通/敏感支持值继续转发。生成必须直接满足 GeneratedDraft；GEO 严格原始字节业务解析与凭据回显拒绝保持。GEO 方法前授权成功进入 SENT 外部窗口，明确 HTTP 结果 COMPLETED、网络结果不确定 UNKNOWN，同 attempt 不自动重放。request ID、耗时与未报告 tokens/cost 仍按原 owner 投影，不补零。

## 4. Browser 延期边界

当前支持人工录入和已实现 API 采集。Browser Collector、自动登录、浏览器会话材料与页面采集延期，当前不启用、不部署、不作为默认验证门禁。

历史源码、公共/数据库合同、迁移、隔离非生产 Compose 与专属实验测试保留。默认 Make、Dev/Staging/Prod Compose 无 Browser 专属执行依赖；普通前端 Playwright 和 API GEO 保留。显式选择历史 Browser Session spec 的材料准备属于隔离资产，默认流程不准备；生产禁止与历史材料失败边界未削弱。

## 5. Makefile 分层入口

Makefile 本轮零改动。`check-fast` 组合后端/前端快速检查；单侧快速入口仍可选。`check-ai`/`check-geo` 是显式领域集合，要求专用 PostgreSQL；GEO 人工文件流还要求本地 development 存储。缺连接/端点非零，不能把 skip 当通过。

`verify-release` 保留完整合同、双语言静态/unit、全部PG integration、恢复、GEO performance、镜像、真实栈/Playwright、部署脚本与 Dev/Prod Compose。`make -n verify` 与 `make -n verify-release` 输出完全相同，且发布展开没有 Browser 专属执行。展开仅证明入口依赖，不证明未执行步骤通过。完整验证只在准备部署目标 commit 或当前明确交付要求时运行；此次完整执行由用户最低验收明确要求。

无 GitHub Actions；GitHub 仅备份与服务器拉取。Docker 按 commit SHA 追踪，无 GitHub Release/Git tag 前提；既有 release ID、镜像 tag、image ID/RepoDigest 与不可变 manifest 核验保持。

## 6. OpenAPI、数据库与 Alembic

`make contract-check` exit0：FastAPI runtime 全契约与提交 OpenAPI一致；openapi-typescript7.13.0临时生成产物与 canonical 前端 schema.d.ts逐字一致。没有生成源码漂移。

`git diff --name-status HEAD -- contracts backend/alembic frontend/src/shared/api/generated` 无输出。本轮和整个当前 PSR 工作树没有根 OpenAPI/database.md 或历史迁移变化；66份历史 revision未删除/重写。`uv run --project backend alembic -c backend/alembic.ini heads` exit0，唯一head=`0066_geo_manual_evaluation`。文件指纹见 [contracts-migrations.json](./evidence/contracts-migrations.json)。

`max_response_bytes` 只在内部 CollectionRequest/Collector/测试出现，公共OpenAPI、数据库合同、前端生成类型没有该字段；语义保持完整接收后、解析前检查，不能限制接收期内存。文档本轮只是收敛既有 PSR-003/004 合同，无公共字段语义/数据库/Alembic变化。

## 7. 残留扫描逐项结果

开始/结束均实际执行用户五条精确命令。[scans.json](./evidence/scans.json)保存命令、退出码和数量；[references-before.tsv](./evidence/references-before.tsv)与[references-after.tsv](./evidence/references-after.tsv)逐条列出文件、行、类别、处置与原文。

| 扫描 | 开始→结束 | 结论 |
| --- | --- | --- |
| 六个旧传输符号，全仓默认rg | 0→0；exit1 | 无匹配；隐藏历史任务不属于该默认rg搜索范围 |
| 旧客户端 backend/tests/docs/deploy | 0→0；exit1 | 无匹配 |
| DNS/peer/HTTP等网络词表 | 7→7；exit0 | 3条当前SDK取消旧保证声明、1部署输入/真实Gate边界、1威胁描述、1历史安全报告、1本机fake HTTP服务器 |
| Browser词表 | 136→137；exit0 | 新增1条维护README中的PSR-005记录导航；没有新增能力或执行入口 |
| find .github/workflows | 0→0；exit1 | 目录不存在，没有工作流；不将find的非零记成测试通过 |

Browser最终137条分类：显式实验入口11、模板关闭2、隔离overlay23、维护路径2、默认关闭1、显式历史E2E材料4、当前拒绝/零部署测试17、显式隔离/负例脚本36、当前延期/禁止说明12、已接受延期ADR1、历史交付/审查21、延期专属合同测试7。每条非空结果都有分类，当前产品/运维说明没有把延期资产描述为现行浏览器采集能力。历史审查报告与迁移原文不重写。

## 8. 实际命令与逐项结果

cwd=/Users/sc/PycharmProjects/partsignal。首轮精确argv/退出码/耗时见 [commands.json](./evidence/commands.json)，GEO复验见 [geo-recheck.json](./evidence/geo-recheck.json)，原输出为同名.log。环境为本轮随机回环PG17.11（56752），本地development对象存储（56753），虚构签名/凭据与HTTP fake；无生产库、Bucket或真实AI。GEO连接级PGTZ=UTC保持容器时间投影。

| 实际命令 | 结果 |
| --- | --- |
| git diff --check | exit0；文档、状态与证据收尾后最终再执行 |
| make contract-check | exit0，5.10s；FastAPI与提交合同、前端生成类型一致 |
| make check-fast | exit0，122.36s；Ruff、mypy252文件、3988backend unit；142文件/1347frontend测试 |
| make check-ai | exit0，62.31s；155unit、53PG/HTTP integration；10文件/119frontend测试 |
| make check-geo 首轮 | exit2，61.48s；fixture/208Collector/2830其余unit通过；PG集成27failed/77passed，存储进程退出导致Connection refused；frontend未执行 |
| make check-geo 最终 | exit0，79.96s；fixture、208Collector、secret_scan=0、2830其余unit、104PG integration；63文件/564frontend测试 |
| make verify-release | exit2，127.36s；合同、Ruff、mypy、3988unit与1347frontend通过；test-integration创建容器阶段被Docker阻断 |
| make -n verify-release；make -n verify | 均exit0，展开逐字一致，无Browser专属执行；非suite执行证据 |
| uv run --project backend alembic -c backend/alembic.ini heads | exit0；唯一head0066 |

首轮GEO的27项错误均在真实存储PUT处Connection refused；检查时本轮存储PID已退出、端口无监听。改为在同一受监督验证进程内启动/保持存储，再先执行直接受影响文件：

```bash
uv run --project backend pytest \
  backend/tests/integration/test_geo_manual_collection.py \
  backend/tests/integration/test_geo_manual_collection_boundaries.py \
  backend/tests/integration/test_geo_manual_races.py --tb=short
```

exit0，43passed，13.49s；存储进程仍存活。随后最终 `make check-geo` 通过，并由finally停止存储。没有改业务/测试/门禁，未无变化盲重试；首轮失败日志保留。Collector包装器 `GEO_CONTRACT_RESULT tests=0` 中tests字段是pytest退出码，实际数量以208passed为准。

## 9. 未执行项与原因

完整发布在以下准确命令失败：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration --ignore=tests/integration/test_geo_recovery.py
```

错误：`unable to get image 'partsignal-dev-fake-oss': failed to connect to the docker API at unix:///var/run/docker.sock ... connect: no such file or directory`。子步骤非零，Make在test-integration退出2。Docker daemon输入未变，不重复同因完整门禁。

之后的全PG16容器integration、PG16恢复、GEO performance、backend/frontend镜像构建/容器smoke、真实Redis/Celery与完整Playwright/E2E、发布部署脚本suite、发布recipe内的Compose检查没有执行。Dev/Prod Compose config另外独立实测，不能替代这些缺口。PG17领域结果不证明PG16或Linux SDK依赖/镜像兼容。未执行真实AI/OSS、Hostdzire现场验收、Browser实验/runtime或远端Actions/部署；前者按用户禁止或当前范围，Browser按延期边界。

本轮实际执行全部最低指定Make入口；未用前序测试结果替代本轮执行。前序人工接受和独立复核用于确认依赖/原实现保证，原文限制保留。本轮没有高后果实现变更或新业务测试，没有另行子代理审查，不将自查称为独立复核。

## 10. Compose 与 Docker

`docker compose --env-file .env.example -f deploy/compose.dev.yaml config --quiet` exit0。

Production独立配置检查使用以下非secret、示例输入：

```bash
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
PARTSIGNAL_VERSION=psr007-config-only \
PARTSIGNAL_RUNTIME_ENV_FILE=/Users/sc/PycharmProjects/partsignal/.env.production.example \
PARTSIGNAL_DATA_ROOT=/Users/sc/PycharmProjects/partsignal/data \
  docker compose --env-file .env.production.example -f deploy/compose.prod.yaml config --quiet
```

exit0。示例生产文件有空值，**这里只证明Compose结构/插值，不证明生产输入就绪或可启动**。Dev内部env_file仍引用既有.env，解析后的值只在进程内读取，不打印/保存。

两环境进一步执行 `config --format json` 的默认、`--profile geo-browser`、`--profile '*'`，6组均exit0，Browser服务和会话输入/挂载均为0；只保留服务名与派生计数，见 [compose-config.json](./evidence/compose-config.json)。没有新Docker容器、network、volume或image；没有修改/运行Nginx或访问服务器。

## 11. Trellis、manifest与清理

新增PSR-007 Brief/preflight/实现证据并关联本会话；现有E2E spec按同一owner清理过时CI/旧网络保证，没有新增平行规范。维护manifest只更新PSR-007标题、依赖、Brief路径与状态，PSR-001～006及其人工接受记录字节不变。PSR-007 task.json与manifest均review，release_gate另为blocked_environment，不产生human_acceptance。

本轮PG查询测试库遗留0，按精确data目录停止；受监督存储finally退出，56752/56753端口释放。系统临时baseline、PGdata/log、存储data/log、一次性监督/扫描/验证脚本收尾删除；无随机Compose或远端资源。正式evidence是本次明确交付物，由PSR-007拥有，保留到人工验收后按Trellis归档策略处理。共享工具/依赖缓存保留。清理与保护证明见 cleanup.json/workspace-audit.json。

## 12. 已知限制、后续建议与人工验收

当前工作树未提交，不能绑定为将要部署的干净SHA。后续先按既有授权收敛提交并固定目标commit，在Docker daemon/PG16/Redis/Playwright可用的隔离环境执行完整verify-release；只有实际通过且身份/现场门禁满足才进入部署。本任务不启动该后续发布，不创建GitHub Release/tag，不改变服务器。

SDK raw完整接收期无内存上限、无旧DNS/IP/peer固定保证、Browser延期均为已接受边界；真实兼容服务行为和现场配置不由本机fake/Compose解析证明。本轮未发现需要另建功能修复任务的回归。

人工验收应核对：17项文档增量与前序保护；官方SDK/Browser/手工验证/commit SHA表达；逐行残留分类和历史保留；合同/迁移零变化；首轮GEO环境失败及成功复验；完整发布仍被Docker阻断的准确记录。接受决定由用户作出，PSR-007保持review。


## 整个工作流人工验收完成（2026-10-13）

用户明确确认：“我已经人工审查并接受 PSR-007，以及整个 OpenAI SDK 替换、Browser 延期清理和手工质量验证分层工作流。”据此将维护 manifest 的 PSR-007 从 review 更新为 done，对应 Trellis task 从 review 更新为 completed，记录 completedAt、human_acceptance、human_accepted_at 与整个工作流接受状态。PSR-001～007 全部为 done；其他任务状态和前序人工接受记录保持不变。

维护 README 的当前状态同步为整个工作流已接受。上述十二项记录及 evidence/final-acceptance.json 保留当时 review 候选和真实测试结果；本节记录之后的人工作出接受决定，不重写历史证据。完整 verify-release 的 Docker daemon 阻断、未执行范围和已接受 SDK/Browser 边界继续保留，不能因 done 状态写成完整发布通过。

本次仅执行状态/人工验收记录收尾、git diff --check 和用户指定五条最终残留扫描；不重新运行实现测试、完整发布、Compose或Docker验证，不实施后续功能，不调用真实 AI，不提交、推送、部署或归档。具体命令、退出码、扫描分类、全部任务状态与本轮文件保护结果见 [人工接受收尾证据](./evidence/human-acceptance-2026-10-13.json)。
