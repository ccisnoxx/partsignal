# S03 设计边界

- real-stack 使用独立测试用户与真实 cookie/session，不复用 fixture route 拦截业务 API。
- 身份变更以服务端响应和后续 `/auth/me`/受保护 API 为证据；旧会话失效不能只靠前端隐藏。
- audit 只验证安全 metadata/detail 投影；敏感密码和会话值不得写入断言错误或 trace。
