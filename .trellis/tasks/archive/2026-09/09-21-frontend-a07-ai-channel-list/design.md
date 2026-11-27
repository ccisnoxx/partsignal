# A07 设计边界

- 列表命令状态归 AI Channel List 页面，pending/409/accepted-delete 与当前 exact list query 绑定。Dialog 只保留目标身份与焦点，展示与确认从当前 projection 读取。
- 成功 DELETE 后在相关列表缓存中移除目标，再做精确失效；失败刷新不可重新授权旧行。不得把 secret 存入查询缓存、错误文本或测试输出。
- 服务端继续在行锁与权限边界重验 revision/资格。前端测试只证明 UI 会话不重复派发、不使用旧 projection。
