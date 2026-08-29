# Frontend V2 Production 完整迁移

## 终止状态

- Outcome：`CANCELLED_BY_SCOPE_DECISION`
- Gate：`NOT_APPLICABLE`
- Execution：`NOT_STARTED`
- Remote mutation：`NONE`

本规划因开发阶段改为直接完成仓库 canonical frontend cutover 而终止。下列 Production Gate 均未执行，不能记为 `MET`；未操作 Hostdzire、Production 流量、数据、镜像、release、quarantine 或环境文件。未来如需 Production 发布，必须依据届时实现与环境重新创建规划，不得从本任务续跑。

## 目标与用户价值

把已经完成开发和部署合同调整的 Frontend V2，按可中止、可验证、逐 Gate 授权的方式迁移为 PartSignal Production 的唯一前端。迁移必须先固定可复现的 candidate，再通过隔离的 clean-init rehearsal，之后才允许 Production 数据转换、服务激活与 Nginx 流量切换，最后用公网、业务和运行指标完成观察期验收。

## 已确认范围

父任务只编排以下四个顺序 Gate，各子任务独立规划、审批、执行、验证和归档；前一 Gate 未达到 `MET` 时不得启动后一 Gate：

1. `Main 集成与 Candidate Artifact Gate`：把已验证工作 commit `7e5c39d1` 集成并推送到 `main`，在 Hostdzire 从该 commit 构建本地 backend/V2 镜像并生成正式 manifest。
2. `Clean-init Rehearsal Gate`：使用同一 candidate、同一部署脚本和隔离数据/端口完成可重复 rehearsal，不触碰 Production 数据与流量。
3. `Production Cutover Gate`：执行受控数据转换、Production deploy、真实 AI/OSS Gate、异步服务激活和 Nginx 切换。
4. `Production 验收与 Observation Gate`：完成回环、公网、浏览器、权限、AI/OSS、业务和运行指标验收，并经过批准的观察期。

每个 Gate 的远端写操作必须使用执行前重新核验的 exact commit、release ID、路径、镜像、manifest、命令、停止线和回滚目标，并在该 Gate 的最终计划得到用户明确批准后才能执行。

## 共同约束

- GitHub `main` 是 source owner；Hostdzire 直接从 Git 拉取并本机构建 release-specific 镜像，不引入云端或本地 Registry、registry credential 或 CI push。
- Candidate identity 继续绑定 commit、source archive、schema head、三份镜像 reference/image ID/RepoDigest 和固定 tracked-file checksum；缺失或漂移必须 fail-closed。
- PostgreSQL 是业务状态唯一来源；Redis 只作为 Celery broker。Production 数据转换、Nginx reload、外部服务写验证和任何删除都必须位于各自授权边界。
- 不通过放宽安全策略、使用固定成功适配器、输出 credential、清理共享镜像/cache、停止无关项目、`prune`、宽泛 `--remove-orphans` 或自动 Alembic downgrade 让 Gate 通过。
- 退役 V1、旧 staging、fake-oss、旧 image/release/cache 和 quarantine 不属于本父任务；Observation Gate 达到 `MET` 后另建任务、另行授权。

## 已确认的合同缺口

- 当前本地 `main` 与 `origin/main` 仍为 `1cc6ec44ec76f593b424f8ae3911f90ab5f6d3ce`；`7e5c39d17b19fbdc101513c70495e818565ced49` 的父提交正是该基线，可以单独 fast-forward 集成。其后的 `1149df24`、`831def47` 只是旧 Task 归档和 journal bookkeeping，不得因集成 `7e5c39d1` 被隐式带入。
- 当前新父/子 Task 是未提交规划材料，工作树不 clean；Candidate 只能在规划材料按批准范围提交、Git 集成完成且新的 `main == origin/main` 后，以实际 40 位 HEAD 重新冻结，不能预先把 `7e5c39d1` 当成最终 candidate SHA。
- `deploy/compose.prod.yaml` 和 Production 数据脚本固定使用 Compose project `partsignal-staging`、端口 `19000/19080`、数据根 `/root/partsignal-data`、quarantine 根和固定维护锁。现有 Hostdzire 同时运行使用这些 owner 的旧 Staging，因此当前代码不支持在同一 Docker daemon 上执行零 Production 影响的隔离 clean-init rehearsal。
- Staging 与 Production Nginx 都代理同一 `19000/19080`。新 API/Frontend 占用这些端口时，公网可能在 Nginx reload 之前就已经切到新 Production；Cutover 的真实流量切换点必须按执行时 `nginx -T` 和端口 owner 重新定义，不能只把 reload 当作切换点。
- `PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET` 当前是激活脚本消费的人工声明，不会自动验证 release、manifest、run ID 或真实 AI/OSS 报告；Cutover 必须定义 candidate-bound 外部 Gate evidence 和批准人。
- Manifest 记录 `schema_head`，部署运行 `alembic upgrade head`，但当前脚本不自动比较数据库实际 revision 与 manifest；Cutover evidence 必须显式记录迁移前后 revision 并与 manifest 绑定。
- 仓库已经定义公网、业务、权限、浏览器、AI/OSS 和 P0/P1/P2 验收矩阵，但没有定义 Production Observation 的最小时长或 5xx、restart/OOM、AI/OSS 成功率与延迟等数值阈值。

## 父级验收标准

- [ ] 四个子 Gate 按顺序完成，且每个 Gate 都有 candidate-bound evidence、明确的 `MET/NOT_MET` 结论和 open P0/P1/P2。
- [ ] Production 当前运行版本、Git commit、manifest、backend/V2 image identity、schema revision、Nginx target 与公网验收证据可相互追溯。
- [ ] Production 只提供 Frontend V2，API/Worker/Scheduler/数据与 Nginx 均处于批准状态，真实 AI/OSS 路径通过。
- [ ] Observation Gate 达到批准的时长与阈值，期间未出现要求回滚的 P0/P1 或未决 P2。
- [ ] 失败时停在当前 Gate，不把局部通过解释为后续 Gate 通过；恢复操作保留失败现场和既有数据。
- [ ] 退役范围没有被顺带执行，只输出独立退役任务所需的精确现状与授权边界。

## 待研究或待决定

- **阻塞设计决策**：Clean-init rehearsal 使用独立 VM/VPS，还是先扩展 Production Compose/脚本，使同一 Hostdzire 上具备 production-grade 的独立 project、端口、数据根、锁和入口 owner。
- 后续用户决策：Observation 的最小持续时间、指标阈值、允许告警级别、受控业务写范围和回滚触发条件。
