# GEO-207 边界与估价语义

RunMatrixBuilder 拥有请求矩阵和数量。输入从已经校验的 Plan configuration 显式转换为不可变选择；当前 Subject/Prompt/Profile 事实从列查询转换。Subject 角色不参与乘法，Profile 是矩阵维度（同 Surface 不合并）。停用或缺失资源保留请求单元，返回定位 blocker；缺失 Profile 无法归类时计 unresolved。按 UUID 排序及 1-based repeat_index 惰性迭代稳定单元，不建立 ORM Run 或生成运行 ID。

资格只调用 GEO-204 evaluate_profile；required_capabilities 是服务端要求，不接收客户端臆造能力。环境混合、问题与Profile语言/地区差异及没有模型版本观测能力为 warning，不猜测实际版本、登录或搜索事实。

估价是独立的无I/O内部函数边界，输入当前问题/Profile事实，返回一格的明确 Decimal 金额/币种或 None。当前没有生产估价实现，默认全部unknown，包括人工模式；人工不自动视为免费。只对活动问题且Profile有资格的格调用估价；Subject停用阻断计划，但不改变问题/Profile的估价事实。无法估价的格按重复数计unknown。cost能力只表示费用报告能力，不能代替估价。

按实际运行数记录known/unknown及NONE/PARTIAL/COMPLETE覆盖；每币种保留已知小计。唯一币种时value表示已知部分小计，不表示整个批次承诺；全未知value/currency均null。混币value/currency为null，保留分币小计并warning；有预算时混币明确blocker。当前budget没有独立币种，按本次唯一估价币种比较数额，不指定默认币种或换汇。已知小计>上限阻断，等于允许；未知格另给BUDGET_UNVERIFIED，不能据此保证未超预算。执行预算预留/消费属于后续任务。

预览服务固定三次批量SELECT，无autoflush/锁/写/commit/rollback。复合事实需同一REPEATABLE READ或SERIALIZABLE事务；隔离检查由service执行，事务由调用方创建，未来Router使用既有一致读dependency，不拥有业务锁或写。结果只是当前快照，不能替代GEO-208命令锁内复核或未来Worker发送边界。

公共响应通过显式projection产生，不暴露ORM、内部Prompt正文/Profile settings/模型凭据；新增数据组件，无HTTP路径。无数据库/迁移/revision/状态机/审计/Redis变化。
