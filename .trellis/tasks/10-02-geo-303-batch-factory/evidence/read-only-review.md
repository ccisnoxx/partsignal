# GEO-303 独立只读复核

固定角色 critical_reviewer，fresh context（fork_turns=none），接受范围由 WorkPlan/audit guard 校验。主代理依据实际报告对本次复核任务作出 accepted；这不等同于 GEO-303 人工验收 done。

结论：未确认需要修复的实现缺陷。覆盖公共创建合同、原子事务与回滚、1000 runs、用户作用域手工幂等/跨入口重放、调度 UTC 窗口不含 revision、资源锁后资格与快照读取、Prompt/Surface 锁存、主体/Profile/Plan/User历史删除保护、0049回填/FK/守卫、精确错误映射及认证/CSRF/安全字段边界。

读取证据：factory/计划读13 passed、API7 passed、后端2642 passed、前端1067 passed、contract/lint/typecheck通过；1000 runs 0.729秒；0048非空前滚与metadata对齐/降级安全停止。首轮完整集成666 passed+1 failed为新head降级说明断言陈旧；定向修正用例1 passed，复核完成时第二轮完整集成尚在运行。复核没有独立运行测试。

覆盖边界：未单独实测工厂等待资源锁时资格变化交错、主体完整性守卫每个直接SQL反例、缺失历史Subject导致前滚失败的真实演练。已检查共用锁协议与SQL失败路径，无确认反例。Collector/派发/Scheduler循环/读模型/页面均按范围排除。

主代理另从本轮审查会话实际工具事件提取17个exec调用与47个exec_command：命令首词仅pwd/cat/rg/sed/nl/tail；无文件、Git、数据库或外部状态写入，无再次委派。证据见 reviewer-tools.json 与 reviewer-commands.json。runtime工具只提供任务名称，没有opaque runtime_ref；执行记录正确保留null/unknown，不从名称或本地日志UUID推断。
