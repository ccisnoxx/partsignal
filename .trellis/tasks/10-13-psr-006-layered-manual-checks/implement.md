# PSR-006 实现与验收记录

## 交付状态

2026-10-13，PSR-005=done、Trellis completed 与人工接受记录已核实。PSR-006 按 planned→in_progress→review 交付，等待人工接受，不自行 done。当前分支 build/PSR-006-layered-manual-checks，源码 HEAD 9b588544，工作树包含前序 SDK/部署/Browser 治理修改；本轮增量单独保存。PSR-007 状态和实现未改变；未提交、推送、部署、调用真实 Provider 或运行完整发布门禁。

## 最终行为与兼容

- check-backend-fast：现有 Ruff 全 backend、全 backend/app mypy、全部 backend/tests/unit。
- check-frontend-fast：现有 canonical frontend lint/typecheck/Vitest；check-fast 只依赖上述两项。
- check-ai：6份 SDK/生成 unit、3份 AI 配置/生成本机 HTTP fake + PostgreSQL integration、10份 AI 渠道/Prompt/内容 AI frontend 测试。
- check-geo：复用 fixture 与 Collector secret-scan 包装器；56份其余当前 GEO unit、9份 SDK/Profile/不可重放/人工录入/分析 PostgreSQL integration、新 GEO 与原人工观测 frontend 测试。显式排除 Browser 专属文件、性能数据集、恢复 integration、Redis/Celery 真实队列和 Playwright。
- 两个领域目标要求显式 PARTSIGNAL_TEST_DATABASE_URL；GEO 还要求 OBJECT_STORAGE_ENDPOINT 与已启动的本地 development 存储。GEO integration 命令固定 development 适配器、连接级 PGTZ=UTC，不更改数据库全局时区或业务序列化，不用固定成功路径替代文件 PUT/HEAD。
- verify-release 保留本轮开始时 verify 的全部前置与两个 Compose recipe。verify 直接依赖 verify-release；原独立静态/unit/integration/build/E2E/deploy/实验入口保持。
- 删除 .github/workflows/ci.yml，空的 .github/workflows 与 .github 目录一并移除；删除仅服务 workflow 的 infra/ci-execution.md，新增手工规范并更新索引。无替代 CI、required checks、分支保护、Release/tag 流程。未发现需要删除的 badge。
- README、开发/测试文档、当前 Hostdzire 说明、GEO 测试说明和维护导航记录手工三层流程。GEO 两份改动文档刷新 SHA256；138项文档哈希全部一致。两个本地脚本仅清理过期 CI 注释/缺环境提示。

无本轮业务源码、OpenAPI/database.md、ORM/Alembic、依赖或 Compose 修改。完整发布依赖图见 prd.md；最终展开在 evidence/make-plan.txt。

## 实际命令与结果

命令从 /Users/sc/PycharmProjects/partsignal 执行。命令由 Python subprocess 记录 argv、退出码与耗时，原输出保留为本任务正式审查证据。环境使用本轮无密码回环 PostgreSQL 17：PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr006@127.0.0.1:53792/postgres；GEO 使用 OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:55037，本地存储与测试使用相同的虚构签名值。未回显私有 .env，也未使用生产凭据或数据。

| 实际命令 | 结果与边界 |
| --- | --- |
| git diff --check | exit0；最终状态/证据更新后再次执行 |
| make -n check-backend-fast check-frontend-fast check-fast check-ai check-geo verify-release verify | exit0；七目标组合展开，visited 前置不会重复打印；不是 suite 执行通过 |
| make check-backend-fast | exit0，92.82s；Ruff、mypy 252文件、3988 unit passed |
| make check-frontend-fast | exit0，54.80s；lint/typecheck、142文件/1347 Vitest passed |
| make check-ai | exit0，65.53s；155 unit、53 PG/HTTP integration、10文件/119 frontend passed |
| make check-geo（修正环境/选集后） | exit0，80.55s；fixture 校验、208 Collector unit与secret_scan=0、2830其他unit、104 PG integration、63文件/564 frontend passed |
| sh -n deploy/scripts/e2e-geo.sh | exit0；提示/注释改动后的 Shell 语法 |
| uv run --project backend ruff check deploy/scripts/test-geo-collector-contract.py | exit0；改动脚本 |

逐个执行 make -n verify、make -n verify-release，以及以本轮开始时 Makefile 执行 make -n -f <临时基线Makefile> verify，三个 stdout 完全相等。直接依赖 verify: verify-release、原完整 release 前置与 recipe 均已核对；check-fast 展开无 Docker/integration/build/E2E，check-geo 无 Browser/performance/E2E，所有显式测试路径和文档示例路径存在。结果见 evidence/release-compatibility.txt。

隔离命令替身执行四个目标的实际 Make 失败传播：后端 Ruff、前端 lint、AI/GEO integration 分别返回19，Make均非零且在故障步骤停止；两个领域缺数据库、GEO缺对象存储变量也非零，不启动 pytest。7项通过，见 evidence/failure-propagation.json；这是命令合同检查，不冒充真实业务测试。替身与记录临时目录已自动删除。

用 Python 对改动文档的相对链接、真实测试示例路径、138项 GEO SHA256 作只读检查，全部通过。无新业务测试、重复测试脚本或 diff 自动选择系统。

## 首次失败、证据与修正

第一次 make check-geo exit2：fixture、208 Collector、2830 unit 通过；integration 28 failed / 95 passed。27个人工文件路径失败于未运行对象存储，另一个评估用例读取容器专用 /contracts/openapi.yaml 失败。没有放宽断言、改业务、修改测试、创建 /contracts 或以固定成功替身伪装。

修正宿主机领域选集：整份依赖容器挂载的 test_geo_manual_opportunity_evaluation.py 留在完整 integration，选择已有 test_geo_analysis.py；人工评估 unit/frontend 保留。增加显式 development 存储前置，复用 app.dev_storage:app 启动真实本地 PUT/HEAD 服务，并补上原人工观测 frontend 测试。

先重验直接受影响文件：

```bash
uv run --project backend pytest backend/tests/integration/test_geo_manual_collection.py backend/tests/integration/test_geo_manual_collection_boundaries.py backend/tests/integration/test_geo_manual_races.py backend/tests/integration/test_geo_analysis.py --tb=short
```

exit1：51 passed / 2 failed；失败均为本地 PG 的 Asia/Shanghai 时间投影与容器 UTC 投影不同，首次提交 collected_at 为 +08:00，重放为 Z，代表同一时刻但既有等值断言不同。加入连接级 PGTZ=UTC 后首先重验失败边界：

```bash
uv run --project backend pytest backend/tests/integration/test_geo_manual_collection.py::test_submit_freezes_all_once_replay_and_no_analysis backend/tests/integration/test_geo_manual_collection.py::test_concurrent_submit_is_exactly_once --tb=short
```

exit0：3 passed（环境显式 PGTZ=UTC）。随后最终 make check-geo 全部通过。首次和局部失败日志均保留，不隐藏未通过结果；重跑依据为对象存储、选集和时区相关证据/环境发生变化，非盲重试。

## Actions 残留检查

开始精确搜索17条当前范围引用，保存 evidence/actions-references-before.txt。结束搜索 README/docs/infra spec 中 checks_group、workflow_dispatch、ci-execution、ci.yml、actions/workflows、手动CI教程和真实badge链接：无活动工作流字段、链接或使用教程。当前保留的 Actions/required-check 提及为禁用声明或历史记录，分类见 evidence/actions-references-after.tsv。

历史 Trellis 验收、GEO CHANGELOG、前端迁移交付、GEO codex-prompts 的通用 CI/fake-provider 当时要求与既有部署身份/manifest 的 release 字段保留，非已删除 workflow 的操作教程。没有把历史成功重写为当前 Actions 仍可执行，也没有删除本地 Docker/Compose/Playwright/deploy 资产。GitHub 远端设置未修改，远端 Actions 未触发。

## 复用、未执行与限制

依赖状态复用已接受的 PSR-005 记录；发布基线使用本轮开始时 Makefile，不用前序测试结果冒充本轮实际执行。快速层与 AI 实际成功后仅改变 GEO 选集/环境和文档，前者输入未变，复用本轮成功结果；未重复跑 check-fast aggregate，因为两个前置均已实际通过且 aggregate 无 recipe。

未实际执行 verify-release/verify 完整发布门禁、全部 PostgreSQL integration、PG16恢复、GEO performance/capacity、Docker build/container、真实 Redis/Celery、Playwright/E2E、Browser runtime/实验或远端部署。完整发布执行归 PSR-007；本机 Docker daemon 不可用，PG17证据不能替代 PG16容器与恢复门禁。领域选集是代表回归，重命名或新增领域测试时需维护 Make 中的显式 integration 列表。快速层仍是全 unit，实际耗时按上表报告，不声称小任务只测少量文件。

发布集合未实质改变，采用完整展开对比验证别名保持，未进行独立子代理审查，不声称自查是独立复核。没有公共协议、持久化、权限、并发或生产发布状态保证的本轮改动。

## 工作区保护与清理

本轮开始已有前序 modified/untracked；按系统临时基线逐文件比较，既有文件本轮增量15项，新增手工规范与本 task 记录另列；增量列表与独立 patch 保存在 evidence。业务、测试源、合同、迁移、依赖、Compose 和前序任务文件相对本轮基线字节未变。最终 git status --short 与 staged 列表已检查，无暂存、提交或推送。

本轮 PG、对象存储 PID/端口/data 均记录于临时 owner 文件；测试只创建随机库/虚构对象。收尾查询业务测试库遗留为0，精确停止对象存储进程与 PG data 对应实例，确认53792/55037端口释放后删除本轮系统临时基线、PG data/log、存储 data/log。没有启动 Docker/Redis/Playwright资源。fake HTTP context 已退出；依赖与共享缓存保留。

本 task 的 evidence 日志/清单/patch 是用户要求的正式验收证据，由 PSR-006 拥有，保留到人工接受后按 Trellis 归档策略处理；没有需继续运行的临时服务或环境。


## 人工验收完成（2026-10-13）

用户明确确认：“我已经人工审查并接受 PSR-006。”据此将维护 manifest 中 PSR-006 从 review 更新为 done；对应 Trellis task 从 review 更新为 completed，completedAt=2026-10-13。

本次仅更新 PSR-006 状态和人工验收记录，复用已接受的实现与测试证据；其他任务状态保持不变，PSR-007 仍为 planned，不实施、不提交、推送、归档或部署。没有再次实际运行快速/领域测试或完整发布门禁。

实际执行：

```bash
git diff --check
make -n check-backend-fast check-frontend-fast check-fast check-ai check-geo verify-release verify
```

两项均 exit0。七个 Make 目标可展开；check-fast 与 verify 在同一次调用中的前置已被展开，因此显示 Nothing to be done，属于 Make 前置去重。另分别 dry-run verify 与 verify-release，输出完全相同；check-fast 独立展开无 integration/Docker/build/E2E，check-geo 无 Browser 专属运行。dry-run 不表示实际测试或发布门禁重新通过。

最终按本次开始时的文件指纹确认，仅 manifest、PSR-006 task.json 和本记录三份文件改变；其他任务状态与现有修改未被覆盖。git status --short 已检查，staged 为空。本次没有创建临时服务、数据库或需清理的文件。
