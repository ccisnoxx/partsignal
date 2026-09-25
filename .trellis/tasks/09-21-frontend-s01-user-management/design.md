# S01 设计边界

- 用户列表与 Query 继续消费服务端 read model；后端是权限和状态最终权威。
- 临时密码不能作为共享 mutation variables；请求生命周期与私有 Dialog 生命周期分离，卸载时清除 UI 引用且不让 pending 请求回写旧弹窗。
- bulk 确认保留最小身份、canonical scope 和 revision 快照；提交前同步读取 exact query 与当前 selection，范围或投影漂移立即撤销确认。
- 当前 actor 的 auth refresh 不等待 Users list invalidation；成功响应中 actor 状态变更直接触发会话同步。
