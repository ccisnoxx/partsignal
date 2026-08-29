# Production 验收与 Observation Gate

## 终止状态

- Outcome：`CANCELLED_BY_SCOPE_DECISION`
- Gate：`NOT_APPLICABLE`
- Execution：`NOT_STARTED`
- Remote mutation：`NONE`

本规划因开发阶段范围决策改变而终止。Production 验收与 Observation 未执行，不能记为 `MET`；未产生远端业务写、观测窗口或 Production 运行证据。未来如需验收与观察，必须重新规划。

## 目标

在已切换的 Production 上，用真实公网入口、受控测试账号和明确标记的测试数据完成业务、权限、外部 AI/OSS、UI/UX、可访问性和运行稳定性验收，并经过批准的 Observation 窗口后判断 V2 是否可以作为唯一长期 Production 前端。

## 要求

- 执行 `docs/deployed-full-functional-acceptance-plan.md` 的 P0 风险、W0–W4 全流程及 W5–W6 适用路径；使用 `E2E-ACCEPT-<run-id>` 测试对象，不使用真实客户数据或真实第三方发布。
- 验证未登录/管理员/工程师、直接 URL/API 权限、历史不可变、RESTRICTED 数据不出站、revision/幂等/错误恢复、桌面/移动/键盘和审计闭环。
- 跟踪 Nginx 5xx/upstream、API error、container restart/OOM、Worker/Scheduler、DB/Redis、AI/OSS 和核心业务结果；阈值和持续时间由父任务用户决策确定。
- 外部 AI 调用遵守既有次数预算；OSS 使用独立测试 namespace，报告不包含 credential、Cookie、Token、敏感 Header 或完整 trace/storage state。
- Observation 期间的 P0/P1、回滚触发和受控写边界必须事先明确；退役和物理清理不属于本 Gate。

## 验收标准

- [ ] 所有 P0 已执行并通过，W0–W4 完整通过，W5–W6 适用项通过；无 Critical/High 未关闭缺陷。
- [ ] 公网、浏览器、业务不变量、权限、AI/OSS、审计、响应式和可访问性证据完整。
- [ ] 运行指标在批准窗口内满足批准阈值，没有触发回滚的 P0/P1 或未决 P2。
- [ ] 测试会话已退出，本地认证状态已清理；保留测试记录 ID 和最终状态，不破坏不可删除历史。
- [ ] Observation Gate=`MET` 后只输出独立退役任务的精确输入，不删除任何 V1、旧 staging、fake-oss、旧镜像、quarantine 或环境文件。

## 待决定

Observation 最短持续时间、指标阈值、P1/P2 容忍策略、受控业务写范围和回滚触发条件。
