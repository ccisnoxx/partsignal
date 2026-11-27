# GEO-408 实施设计

Run API已有全部R3投影，不新增协议/DB。runs.api唯一query owner，run-detail纯读，run-retry拥有显式命令生命周期。状态轮询只调度GET，不改变业务状态；错误暂停并保留data，明确恢复，后台暂停。usage三个数独立显示，cost字符串原值保留；外部调用状态穷尽显示。429是已结束尝试，只展示冷却建议，不将Retry-After变成自动重发。

retry POST无幂等键，确认绑定当前run/revision，发送恰好一次。成功回执闭合校验、取消旧GET并精确失效；按已确认回执导航新ID，再读取canonical投影。409/422只刷新canonical后重新确认，unknown只读取attempt链寻找明确后继；读无后继不能证明原POST未提交，不解除unknown去盲重发。命令journal属于QueryClient会话，仅保留稳定身份/确认revision/命令阶段，跨详情卸载、切换和路由卸载存活；主体epoch失效后旧continuation不能更新journal。principal/卸载守卫始终保留；迟到回执不覆盖用户切换的选中run，只对原身份仍选中时修改run_id。

测试仅tests中显式装配。APP_ENV=test、allowlist e2e DB、owned marker、回环provider/Redis非0和仅虚构GEO408 prompt均验证；不改production registry/BatchInputs/Collector源码。该进程批准的是本地测试adapter，虚构PUBLIC仅本轮fixture。业务仍使用真实OpenAICompatibleCollector、PG、CSRF/revision服务、Redis/Celery；固定fake估价若需要仅test装配。关闭开关测试须经过真实Worker并证明fake count=0。

运维说明解释当前生产尚无采集批准/外发分类合同，不能以测试成功代表已可生产启用；只列真实已实现开关/预算/限速/恢复行为，不提前实现902告警或801服务。
