# PSR-005 实现与验证证据

## 状态与依赖

2026-10-13，分支 `chore/PSR-005-defer-browser-collector`。PSR-004 manifest=done、Trellis=completed，已读取 prd/implement 和人工接受记录。PSR-005 已于2026-10-13经用户人工审查并接受，维护manifest为done，Trellis为completed；不提交、推送、部署或归档。

已读根 AGENTS、RTK、Trellis workflow/infra 与 CI 规范、GEO 文档治理、Makefile、三套核心 Compose、环境模板、相关配置/部署/E2E/隔离 Browser 脚本和受影响当前文档。应用层、OpenAPI、数据库、Alembic、前端页面和 AI SDK 均无本轮改动。

## 删除、保留与延期

当前支持人工 GEO 数据录入和已经实现的 API 型采集。Browser Collector、浏览器会话材料、自动登录和浏览器页面采集属于后续功能，当前版本不支持、不开启、不部署。

- 删除当前 Browser 安装/启动/调试教程、会话材料/密钥/挂载/登录探针/健康检查教程、专属容量/恢复/合同默认门禁描述，以及核心架构图的 Browser 服务节点。26 份当前产品/开发/测试/运维说明统一采用上文声明；GEO 文档仅刷新本轮修改的14项校验和。
- Make 默认 bootstrap 不安装 Browser；lint/typecheck/test-unit 不执行独立 Browser 包；e2e 不依赖 Browser contract；test-deploy-scripts 不执行 Browser 检查，从而 verify 的传递依赖也清除。后端/前端原检查、普通 Playwright、API GEO 三阶段与 API Collector 合同保留。不实施质量门禁分层。
- Dev/Staging Compose 删除默认 Browser include；Prod 原先已无 include，本轮不修改 Prod Compose。更新 staging 配置测试不复制 overlay；配置脚本增加三环境默认/显式 Browser/全部 profile 零服务/会话断言，保留生产 Browser=true 的启动失败。
- e2e-local 默认不生成 Browser Session 目录/RSA公钥，默认19文件选集移出 Browser Session 专属 spec；历史用例文件保留，仅精确显式选择该 spec 时准备专属材料。既有秘密扫描、进程/数据库/存储清理不变。
- 保留 `browser-collector/`、Browser 后端模型/Schema/路由与前端历史页面/测试、历史 Alembic、隔离非生产 Compose/Seccomp/control 资产。保留显式 `check-browser-experimental`、`test-geo-browser`、`test-geo-browser-contract`；没有任何默认目标依赖这些入口。隔离配置检查改为显式追加非生产 overlay。
- 生产禁止 Browser/会话输入与 overlay/profile 拒绝边界保留。核心恢复工具遇历史材料继续非零 `BROWSER_RECOVERY_REQUIRED`；文档不再指导当前版本恢复会话，要求保持现场并另行授权处理。
- Accepted ADR、历史交付/WBS/manifest/审查记录保留当时原文。CI spec 只同步根入口事实并明确 Actions 遗留归 PSR-006；`.github/workflows` 不变。无 AI SDK 调用修改、无数据库对象删除。

39 个既有文件本轮增量列表在 [changed-files.txt](./evidence/changed-files.txt)，相对本轮基线的独立 diff 在 [changes.patch](./evidence/changes.patch)。这不是全部工作区 diff；前序 SDK、部署、infra/AGENTS modified/untracked 继续保留。中文文件路径本轮只插入声明，基线比较精确扣除该插入，未重写原正文。

## 精确引用分类

开始与结束均实际执行用户给出的命令，exit0：

```bash
rg -n "browser-collector|GEO_BROWSER_|BROWSER_ADAPTER_NOT_IMPLEMENTED|geo-browser|GeoBrowserSession|session_probe" README.md docs deploy .env*.example Makefile backend frontend browser-collector
```

| 分类 | 开始 | 结束 |
| --- | ---: | ---: |
| 当前产品说明 | 3 | 3 |
| 当前开发/部署/运维教程或禁用说明 | 37 | 11 |
| 默认验证入口或关闭/拒绝断言 | 31 | 11 |
| 隔离源码、显式实验/专属测试或历史合同 | 331 | 347 |
| 普通 Playwright E2E | 0 | 0 |
| 合计 | 402 | 372 |

[开始逐行分类](./evidence/references-before.tsv)和[结束逐行分类](./evidence/references-after.tsv)包含每个命中的文件、行、处置和原引用。结束11条当前配置/运维命中是 false、禁止/零部署说明；11条默认入口命中是 E2E false 与配置启动负例/零服务断言，没有 Browser 包安装、Collector 执行或 overlay 加载。Make 的所有 Browser 调用、E2E 专属材料准备属于显式隔离入口；维护manifest的Task Brief路径是审查元数据。普通 Playwright 在本精确词表无命中，另以默认19文件/31测试收集及实际 diff 证明没有删除；不把普通 BrowserContext/认证会话误判为采集。

## 实际验证命令与结果

| 命令 | 结果与范围 |
| --- | --- |
| `make bootstrap` | exit0；backend依赖同步、frontend npm ci；不安装Browser包 |
| `make lint` | exit0；backend Ruff与frontend ESLint，默认无Browser包执行 |
| `make typecheck` | exit0；mypy 252源码文件、frontend tsc；无Browser包执行 |
| `make -n bootstrap lint typecheck test-unit e2e verify` | exit0；六目标传递展开零Browser专属执行，保留普通Playwright/API合同；[展开证据](./evidence/make-default-plan.txt) |
| `docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet` | exit0；实际本地开发配置解析，没有启动容器 |
| `uv run --project backend python deploy/scripts/test-geo-configuration.py` | exit0；17组API/Worker/Beat正常启动一致＋production Browser负例拒绝；Dev/Staging/Prod默认/显式Browser/全部profile零Browser服务与挂载；启动网络审计零外部调用 |
| `deploy/scripts/test-deploy-staging.sh` | exit0；真实Compose配置解析与full/fast部署命令记录替身，不访问Hostdzire |
| `uv run --project backend python deploy/scripts/test-geo-browser.py` | exit0；只执行隔离Compose配置检查，验证显式非生产overlay；无 `--runtime`，不启动Browser |
| `uv run --project backend ruff check deploy/scripts/test-geo-configuration.py deploy/scripts/test-geo-browser.py` | exit0；两份改动Python脚本 |
| `sh -n deploy/scripts/e2e-local.sh deploy/scripts/test-deploy-staging.sh` | exit0；两份改动Shell语法 |
| `deploy/scripts/test-e2e-run-lifecycle.sh` | exit0；6个signal/失败优先级/secret scan/清理用例，子进程均回收 |
| `make test-geo-collector-contract` | exit0；208 passed，secret_scan=0，external_network=blocked；API Collector 保留且可运行 |
| `python3 .trellis/tasks/10-13-psr-005-defer-browser-collector/evidence/acceptance.py` | exit0；六Make目标、真实Dev三种profile、26份文档、核心架构图及138条GEO SHA256一致性 |
| `git diff --check` | exit0；实现、证据与状态更新后最终执行 |

定向后端单元，不声称完整 `make test-unit` 执行：

```bash
uv run --project backend pytest backend/tests/unit/test_geo_configuration.py backend/tests/unit/test_geo_worker_configuration.py backend/tests/unit/test_geo_production_boundary.py backend/tests/unit/test_geo_collector_registry.py --tb=short
```

exit0，176 passed，11.98s。

定向前端单元：

```bash
npm --prefix frontend run test -- src/domains/geo-catalog/surfaces-form.model.test.ts src/domains/geo-catalog/surfaces-search.model.test.ts src/domains/geo-catalog/surfaces.api.test.ts
```

exit0，3文件/30 passed，1.47s。

E2E 专属准备执行了维护脚本中的实际条件块：默认与API spec均零会话材料；精确显式Browser Session spec创建临时cipher目录/公钥。3个场景通过，所有临时材料退出即删除；不调用页面/API/数据库。

从 e2e-local 实际默认选集提取19条路径，执行：

```bash
npm --prefix frontend run e2e:raw -- --list <e2e-local中的19条默认spec路径> --project=foundation-desktop
```

exit0，31 tests in19files；只是测试收集，没有执行E2E业务、启动preview或证明完整真实栈通过。展开后的实际命令和收集输出见 [playwright-collection.log](./evidence/playwright-collection.log)。

首次用 `npm --prefix frontend run e2e -- --list` 收集时，Playwright列出选集，但包装器最终exit1：纯收集未生成产物目录，现有secret scanner明确拒绝缺失目录。没有改scanner或把该次记为通过；诊断后改用只读raw收集，不作为独立E2E门禁。首次日志保留在 [playwright-list.log](./evidence/playwright-list.log)。

## 证据复用、未执行与限制

依赖接受状态与SDK实现边界复用PSR-004的已人工接受记录；本轮没有重复SDK/PG85项或完整532项有效单元范围，也不把它们记成本轮重新执行。根默认命令变化由新Make展开、实际bootstrap/lint/typecheck、定向单元与Compose/E2E入口证据覆盖。

未执行完整 `make test-unit`、`make test-integration`、完整 `make e2e`/`make verify`、镜像构建/release gate、真实Browser runtime/实验aggregate/Browser contract、远端Actions或Hostdzire部署。此次没有业务模型、数据、API、权限、SDK或生产运行时修改；配置/文档/默认选择的直接风险由上述定向检查覆盖。19文件收集与生命周期检查不能替代完整用户旅程执行；远端环境不会因本地修改自动更新。Actions仍有历史Browser安装/环境设置，留PSR-006清理。

未进行独立子代理审查；本轮自查针对本轮独立diff，不声称独立复核。无公共/持久化/权限/并发/迁移/生产发布保证修改，没有扩大验证门禁。

## 保护与清理

最终检查 `git status --short` 与 `git diff --name-only --cached`，staged为空；`git diff --name-only -- contracts backend/alembic frontend browser-collector .github` 无输出。确认这些边界及历史迁移没有本轮变化，前序SDK/部署修改保留。本轮无文件物理删除，不回滚其他任务。

本轮没有新Compose资源、数据库或服务监听；Compose仅config。单元/本地API fake、E2E signal fixture进程已退出，RSA/secret/测试临时目录由context/trap清理。系统临时基线、日志和独立diff在交付前精确删除；共享uv/npm/tsbuildinfo/pytest缓存与依赖安装保留。正式证据在本任务evidence目录，由PSR-005拥有，作为人工review/接受与未来恢复记录随任务保留；不是生产材料。


## 人工验收完成（2026-10-13）

用户明确确认：“我已经人工审查并接受 PSR-005。”据此将维护manifest中PSR-005从review更新为done；对应Trellis task从review更新为completed，completedAt=2026-10-13。

本轮仅更新PSR-005的状态和人工验收记录，复用已接受的实现与验证证据；其他任务状态和记录不变，不实施PSR-006，不提交、推送、归档或部署。不重新运行实现测试或完整门禁。本轮实际diff检查与Browser精确残留搜索结果如下。

```bash
rg -n "browser-collector|GEO_BROWSER_|BROWSER_ADAPTER_NOT_IMPLEMENTED|geo-browser|GeoBrowserSession|session_probe" README.md docs deploy .env*.example Makefile backend frontend browser-collector
```

exit0，372条命中；相对已人工接受的evidence/references-after.tsv新增0条、减少0条。分类保持：当前产品说明3条、当前配置/运维禁用说明11条、默认入口关闭/拒绝断言11条、隔离源码/显式实验/历史合同与维护记录347条。残留不等于默认重新执行Browser。

状态与人工验收记录更新后执行 `git diff --check`：exit0，通过。
