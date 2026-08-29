# 当前 Gate 与合同缺口研究

## 已完成与未完成

- 已完成的是 Frontend V2 开发、Staging 最终验证、Production repository/runbook/manifest 合同，以及工作 commit `7e5c39d1` 的本地镜像 owner 修改。
- Candidate/Artifact、clean-init rehearsal、Production cutover 和 Observation 均没有 `MET` 证据；历史 Task 的 `completed` 只表示归档，不表示业务 Gate 通过。
- 本地/远端 `main` 仍为 `1cc6ec44ec76f593b424f8ae3911f90ab5f6d3ce`。`7e5c39d1` 可从该基线单独 fast-forward；后续两个 commit 是旧 Task 的 archive/journal bookkeeping。

## Candidate owner

- 新 candidate 只能在批准的规划材料和 `7e5c39d1` 集成后，以实际 clean pushed `main` HEAD 冻结。
- Hostdzire 当时可用约 44 GiB 根盘和 2.2 GiB 内存，Docker/Compose 可用且 Git SSH 可访问项目，但与多个项目共享资源。任何 write set 前必须重采 inventory。
- Candidate 写边界只允许新 release worktree、sibling artifact root、本地 release/rollback tags、source archive 和 manifest；不停止现有容器、不改 Production env/数据/Nginx/网络。

## Rehearsal blocker

- Production Compose 固定 `name: partsignal-staging`，API/Frontend 固定 `19000/19080`，网络名固定；数据脚本固定 Production 数据根、quarantine 根和维护锁。
- 当前 Hostdzire 的旧 Staging 已占用同一 project、端口和数据 owner。除 test-only 非标准路径外，仓库没有 production-grade rehearsal override。
- 因此“同一 Hostdzire、现有代码、不触碰 Production、隔离 clean-init rehearsal”不能同时成立。必须选择独立 VM/VPS，或先增加受控的 rehearsal owner 合同并重新走代码/验证 Gate。

## Cutover blocker

- Staging 与 Production Nginx 都代理 `19000/19080`；`deploy.sh` 在标记 `PRODUCTION_PREPARED` 前启动新 API/Frontend。公网实际切换可能发生在容器绑定端口时，而不是 Nginx reload。
- External Services Gate 目前只消费环境字符串 `MET`，不机器绑定报告；规划必须定义 report identity 和批准人。
- Manifest 记录 schema head，但部署没有比较实际 DB revision；迁移前后 revision 必须另行取证。
- Nginx 配置/备份/reload 不进入数据状态机或维护锁，必须作为与容器/端口切换串行的独立授权链。

## Observation 缺口

- 仓库已有完整 P0/P1/P2、W0–W6、公网、浏览器、AI/OSS 和清理矩阵。
- 尚无最小观察时长、5xx/API error、restart/OOM、health、AI/OSS 成功率/延迟和回滚触发阈值，也没有自动 Observation runner。
