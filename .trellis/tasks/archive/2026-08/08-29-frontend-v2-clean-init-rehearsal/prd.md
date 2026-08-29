# Clean-init Rehearsal Gate

## 终止状态

- Outcome：`CANCELLED_BY_SCOPE_DECISION`
- Gate：`NOT_APPLICABLE`
- Execution：`NOT_STARTED`
- Remote mutation：`NONE`

本规划因开发阶段范围决策改变而终止。Clean-init 或隔离环境全流程演练未执行，不能记为 `MET`；未创建、修改或清理任何远端、Production 或 rehearsal 资源。未来如需演练，必须重新规划。

## 目标

使用 Candidate Gate 冻结的同一 commit、镜像、manifest 和 Production 脚本，在与真实 Production 的 Docker project、端口、数据、锁、env、OSS namespace 和公网入口完全隔离的环境中，证明 clean-init、激活、失败恢复和证据收集可重复执行。

## 要求

- Rehearsal 环境 owner 必须先由父任务设计决策确定；现有同机固定 owner 合同不能被测试逃生变量冒充 production-grade 证据。
- 使用不含真实业务数据的受控初始目录和独立外部服务测试 namespace；Production 容器、数据根、Nginx 和公网流量前后 checksum/identity 必须零变化。
- 覆盖 quarantine、clean-init deploy、实际 schema revision、API/Frontend prepared、candidate-bound AI/OSS Gate evidence、异步激活、frontend-only fallback、full restore 与中断恢复边界。
- 明确一次性状态根的销毁重建或第二次 fresh run 方式；不得把 `RESTORED` 状态直接重置后冒充第二次演练。

## 验收标准

- [ ] Rehearsal 与 Production 在 project/daemon、端口、数据、锁、env、OSS namespace 和入口上有可验证隔离。
- [ ] 同一 candidate 完成批准的 happy path、failure injection、frontend fallback 和 full restore，实际 DB revision 与 manifest 一致。
- [ ] Rehearsal 前后 Production inventory 完全一致，临时资源由精确 owner 清理或按批准范围保留证据。
- [ ] Open P0/P1/P2=`0/0/0`，Rehearsal Gate=`MET`；输出 Cutover 的恢复时间和精确命令，不执行 Production cutover。

## 不在范围

真实 Production 数据转换、Production Nginx reload、公网流量切换和 V1/旧环境删除。
