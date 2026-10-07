# GEO-1010-DEPLOY 实施记录

2026-10-07 已按新会话启动授权开展发布准备；候选冻结与目标写入因必需输入/授权缺失停止。任务已实际开始准备，尚未部署，未达到 review。

## 启动检查

- 执行：本 DEPLOY Codex 会话；准备前工作树快照时间 `2026-10-07T17:01:57.918219Z`（America/Los_Angeles 10:01:57 PDT）。人工部署操作者/责任人尚未指定。
- 使用 `task.py start` 关联本会话；CLI 仅转换 planning，不自动转换 ready，状态按实际准备开始另行维护。
- main HEAD=`bc68f087153009aae032e52415ee5c9274199581`，缓存 origin/main 相同；工作树 dirty，79 项修改/未跟踪文件。未 fetch、commit、push；该 HEAD 不包含 UI，不是发布候选。
- GEO-1009/UI 均 done；UI 人工接受及 22 项源码/9 项证据身份匹配。旧 GEO-1009 门禁日志哈希匹配，只证明旧 SHA。
- 精确目标、阶段批准、镜像 repository、previous V2、runtime、smoke 数据和操作者/恢复负责人未闭合；来源与具体要求见 [发布准备](./preparation.md)。

## 实际实施与变更

完成 producer/consumer、13 项 tracked-file allowlist、Production Compose/shared Settings、8 项 Beat 注册、schema 源码 head、部署持久阶段与停止/恢复路径核对。建立可审阅 [操作与输入清单](./preparation.md)、[低敏现场记录](./evidence/release-record.yaml) 和可重复准备检查。现场未知保持 null/NOT_VERIFIED；没有伪造 release、manifest、image digest、批准或目标事实。

更新父任务/当前导航和当前 runbook 的候选归属说明；不改历史 ADR/接受记录，不修改应用代码、OpenAPI、数据库或发布执行器。已接受 UI 及其他工作树变更保留。

## 实际验证与证据

| 检查 | 实际结果 | 证据/边界 |
|---|---|---|
| 工作树准备基线 | main/dirty/缓存 origin；79 个文件身份 | [entry-state.json](./evidence/entry-state.json)，不是 candidate |
| 接受身份、依赖、allowlist、Beat | 22 源码＋9 证据均匹配；旧 gate log hash 匹配；13 文件与 8 任务一致 | `backend/.venv/bin/python .../evidence/check-preparation.py` exit 0；[preparation-checks.json](./evidence/preparation-checks.json) |
| 迁移 head | `0066_geo_manual_evaluation (head)`，exit 0 | `backend/.venv/bin/alembic -c backend/alembic.ini heads`；未连接/迁移目标 DB |
| 本机工具 | Docker client/server 29.6.1/29.5.2，Compose 5.3.1，exit 0 | 只查版本，不证明目标能力/健康 |
| Nginx/source 安全检查 | `node deploy/scripts/check-nginx-security.mjs` exit 0 | 当前工作树离线检查，不是 candidate 全门禁或目标 Nginx 验收 |

第一次临时准备检查使用系统python3，在YAML导入处因 `ModuleNotFoundError: yaml` 退出1；entry-state已保存，其余结果未生成。已确认项目venv安装YAML/Alembic/SQLAlchemy，改用该运行时完成正式检查，没有安装依赖或覆盖entry-state。准备脚本首次Ruff检查发现两项B905和一项UP017，已显式严格zip并使用UTC别名，修正后Ruff与准备检查通过。文档/hash、状态/链接、diff与无关文件保全的最终检查见 [validation.json](./evidence/validation.json)。

完整 `run-verify.py/make verify` **NOT_RUN**：缺包含 UI 的 clean pushed main SHA。未提前重复 UI 验证或旧 SHA 门禁。archive/images/manifest、实际配置、readiness/MANUAL smoke、备份/停止/恢复和观察期 **NOT_VERIFIED**；未执行 SSH、配置/镜像上传、容器启动、Nginx/数据库写入或 UAT。

## 缺口与剩余义务

准备时 GIT/TARGET/IMAGES/RUNTIME/STAGES/RECOVERY 六组输入待闭合，详细出处与可执行顺序见 preparation.md。未获 Git 发布授权、精确目标与恢复输入时不能推进冻结/部署；按 ADR-008 保持 blocked，父任务仍 in_progress，UAT planned/未开始。若选择空环境，不能自行把 previous V2 或持久状态要求改为 N/A，也不能套测试绕过。业务代码缺陷另立任务。

## 工作验收与人工接受

DEPLOY 六项验收尚未完成；没有 DEPLOY review、人工接受、内部 Go/No-Go 或生产 Go。准备检查通过只关闭本地准备核对，不代替候选或现场验收。后续实施完成先 review，明确人工接受后才 done；父任务须另行集成与接受。

## Git 授权后的候选工作

2026-10-07T17:19:07.470277+00:00 用户明确授权提交已接受 UI、接受治理及本次 DEPLOY 准备到 main，并 push/fetch、固定新候选。开始按 UI 与 DEPLOY 归属提交；尚未填写未执行的 SHA 或门禁通过。GIT 已闭合，其余五组输入没有实际值或记录引用，目标写入继续等待。
