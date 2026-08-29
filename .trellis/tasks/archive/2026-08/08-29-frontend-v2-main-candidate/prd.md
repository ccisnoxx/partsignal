# Main 集成与 Candidate Artifact Gate

## 终止状态

- Outcome：`CANCELLED_BY_SCOPE_DECISION`
- Gate：`NOT_APPLICABLE`
- Execution：`NOT_STARTED`
- Remote mutation：`NONE`

本规划因开发阶段改为直接完成仓库 canonical frontend cutover 而终止。Candidate Artifact Gate 未执行，不能记为 `MET`；未集成或推送 candidate 提交，未操作 Hostdzire、镜像、manifest、release 或环境文件。未来如需 Production candidate，必须重新规划。

## 目标

把本地镜像 Production 合同工作 commit `7e5c39d17b19fbdc101513c70495e818565ced49` 按单一 `main` 工作流集成并推送，然后在 Hostdzire 从新的 clean pushed `main` 构建、验证并冻结可供后续 Gate 使用的 candidate artifact。

## 要求

- Git 集成前重新 fetch 并证明本地/远端 `main` 与 `7e5c39d1` 的祖先关系；只集成批准的工作与规划材料，不隐式合入旧归档/journal bookkeeping。
- 集成与 push 使用精确 commit plan；push 后以实际 `main` HEAD 重新生成 release ID，要求本地/远端/Hostdzire `main` 一致且 clean。
- Hostdzire 只创建唯一 release worktree、sibling artifact root、release-specific backend/V2 tags、previous V2 rollback tag、source archive 和 manifest；不停止或替换现有容器，不改 Nginx、Production env、数据、网络或其他项目。
- 串行运行批准的 repository、Docker、container、E2E 和最终 `make verify`；资源低于停止线或现有项目 health/restart 漂移即停止，不 prune、不删旧资源。
- Manifest 必须由真实非测试路径排他生成，绑定 actual commit、archive SHA、schema head、三份镜像 ID/RepoDigest 和七项 tracked files。

## 验收标准

- [ ] `main == origin/main == Hostdzire release HEAD`，branch=`main`、工作树 clean。
- [ ] Candidate backend、Frontend V2、rollback V2 的唯一 reference、image ID 和非空 RepoDigest 已复核。
- [ ] Candidate-bound Required Validation 与最终 `make verify` 通过，现有运行项目未变化。
- [ ] Source archive 和 manifest 的路径/SHA-256、schema、tracked files 与镜像身份一致且不可覆盖。
- [ ] Open P0/P1/P2=`0/0/0`，Candidate/Artifact Gate=`MET`；输出 Rehearsal 的 exact inputs，但不执行 rehearsal。

## 不在范围

Clean-init rehearsal、Production env/数据、容器替换、Nginx、外部业务写与流量切换。
