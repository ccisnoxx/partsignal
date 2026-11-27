# GEO-403 设计
诊断与采集资格复用同一事实和能力策略。显式 connection_test 模式只豁免 Profile 启用、Profile 旧测试与采集批准三项；adapter 必须显式支持当前已实现的诊断。开关、合规、环境、能力、模型协议、凭据与模型资格仍强制。仅 answer_text 支持，不声明 citation/search/usage/cost。

测试预留 token 属于 Profile 当前配置，无业务任务。预留提交释放所有锁后进行同步有限超时调用；最终使用锁序重验身份、绑定、依赖版本和 token。中断后保持 UNTESTED/inactive，可以从最新 revision 显式重试；旧请求不会覆盖后来的预留。诊断成功或失败均不改变启用意图。

数据库是失效 owner：Profile 实质配置变更、渠道连接/凭据/启用、模型请求/资格/启用、Surface 合规/能力/类型/启用与删除模型触发当前 API Profile 失效。Header 服务已使 Channel revision/资格失效。触发器只从已持有的上游锁获取 Profile UUID 顺序锁，不反向获取其他上游锁。只在存在资格/预留时修改，避免重复失效生成无意义 revision。FK paired SET NULL 维持原 nested guard 特例。

安全错误采用代码到固定摘要的闭合映射，未知程序故障显式失败，不保存 raw provider body/exception。测试审计只保存状态、revision 和 is_active。
