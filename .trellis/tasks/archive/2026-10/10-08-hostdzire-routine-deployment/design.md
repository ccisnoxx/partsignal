# 设计

## 状态与依赖

prepare-production-data.py继续拥有唯一持久状态、锁和supervisor；production_deployment.py继续拥有执行编排。新日常入口只是调用这些权威命令，不维护第二份发布状态。核心restart/资格裁决应放在已有tracked模块，避免新增未被manifest认证的执行owner。

## 日常流程

已准备的不可变release通过host侧日常入口执行check/prepare/activate/smoke/restart。check只核实候选、实际镜像、配置、现存initialized状态和schema/迁移资格；prepared/failed/unknown阶段拒绝作为日常新升级。prepare要求公网维护503已真实确认，然后复用现有upgrade部署。activate复用原MET/AI待配置裁决，完成loopback smoke；Nginx原子切换仍走已有Runbook。smoke可针对已恢复的公网执行只读检查。

同版本restart只接受state绑定的initialized候选，验证manifest/image及配置边界，使用锁内supervisor精确重建应用服务，不触碰DB/Redis迁移或账号初始化。必须拒绝另一候选、未知阶段和容器身份漂移。保持admin-ui待配置事实，不伪造AI Gate。

无schema/迁移变化资格应依真实当前schema与已部署候选，不能仅凭新manifest声称schema未变。旧manifest/迁移源码证明若不足，明确要求完整Runbook，不猜测或静默降级。

## 验证复用

部署消费已有源码验证记录。记录基线commit、candidate、changed paths、执行命令/结果、复用范围与限制；记录不冒充全套测试或可信签名。完整门禁仅由具体剩余风险/实际完整交付要求触发。

## 分工

主代理拥有docs、.trellis/spec、AGENTS、任务记录。实现代理拥有deploy/scripts/Production日常入口及必要既有owner修改、目标测试与Makefile。独立critical_reviewer只读复核最终diff的发布/状态/验证门禁。
