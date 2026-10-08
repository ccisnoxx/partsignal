# 新站上线后管理界面配置AI

用户于2026-10-08 UTC明确选择：新站上线后在管理界面配置AI。该选择改变首次安装顺序，不要求在env保存AI API Key或维护窗口TTY交接。既有管理员+CSRF渠道管理、模型真实测试与手动启用继续拥有配置/生成资格；不把空AI状态转成假成功。

## 状态与责任

- `prepare-production-data.py`是唯一部署状态owner；复用maintenance lock、run ID、manifest/current candidate校验与真实API容器identity。
- 新命令`defer-ai-configuration RUN_ID MANIFEST`仅在`PRODUCTION_PREPARED`的新安装候选下记录显式`ai_configuration_handoff`，字段为`mode=admin-ui`、同一run ID与manifest SHA；记录初始化方式，不保存第二套AI就绪状态。
- 移交前执行受控只读AI三表空集检查；任何已有或畸形bootstrap attempt/移交、部分配置、错误candidate/run/API identity均拒绝。移交不覆盖任何结果；显式移交后不再走Host bootstrap。
- 激活只接受`OSS_MET_AI_PENDING`与合法同候选admin-ui移交组合。该值说明真实OSS已验证、AI尚未配置，不写`MET`或`ai_bootstrap_attempt=SUCCEEDED`。
- 未选择admin-ui的新安装仍按原true-TTY成功bootstrap＋完整真实AI/OSS `MET`激活。`STARTED`/`FAILED`和未知结果不能通过新路径跳过。
- upgrade不能使用OSS-only Gate；普通upgrade保留原MET与所有迁移/恢复条件，历史初始化方式不能替代后续真实Gate。
- 新站可以运行API/frontend/worker/scheduler，AI业务资格仍由PostgreSQL真实模型/渠道状态与现有服务守卫裁决。管理员上线后创建渠道，按需配置Header，真实测试成功后手动启用。没有Key或合格模型时不生成作业、不外发、不回退假适配器。

## 验证与交付

定向owner/harness检查保护显式成功、缺选择/缺OSS拒绝、attempt失败/未知拒绝、真实身份、upgrade禁用与无secret/无伪成功状态。改变发布行为后需fresh独立只读复核，按新候选取得发布脚本证据；此前852c6d5e应用完整Gate与旧工件保留为历史，不把旧source Gate冒充新SHA。

当前Bucket全局权限范围仍待用户确认，尚未维护、清空或切换。源码owner实施、复核与新候选现场结果在implement.md追加；配置事实见[运行配置执行证据](./evidence/hostdzire-runtime-config-execution.json)。
