# GEO-606 独立只读复核

critical_reviewer（全新隔离上下文）已完成公开合同、CSV资格/白名单、RR分批、审计事务、权限、打印与资源生命周期复核，实际写入路径为[]。原P2：ASGI2.4原生asyncio.Task.cancel在生产线程仍next时并发close，generator already executing且Session提前释放。主代理添加精确事件交错回归：原候选失败，RLock串行化完整next/close后35 unit及9 PG（共44）通过；复核者独立重放反例确认线程退出后生成器关闭、release恰好一次并保留CancelledError。该P2解除，无剩余确认阻断。

复核者确认固定keyset推进与同时间戳排序，冻结binding/latest attempt/current成功分析/latest Review资格；UNJUDGEABLE保留而不充当可判断分母；首条编码与审计提交先于交付，失败关闭会话且不提交请求heartbeat；空/不合格无打印入口，失权隐藏旧数据及下载。

边界：未重复全量门禁，未操作真实OS打印，未逐页视觉检查PDF；最终完整门禁与环境失败分类由主代理负责。复核期间主代理仅修CSV owner及对应回归；后续主代理还收紧403/无效参数下页头刷新入口并做定向组件验证。报告是LIVE，不具备归档冻结；机会501，未实施607或其他后续。
