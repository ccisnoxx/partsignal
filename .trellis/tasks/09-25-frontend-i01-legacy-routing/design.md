# I01 设计边界

- 每个旧 pathname 由具体 TanStack file route 持有，在 `beforeLoad` 或 route component 中以 replace 写入 canonical URL。
- 查询转换集中复用目标领域 search schema 与 canonical record；旧字段只作为一次性输入，不进入 canonical 状态。
- 匿名回跳先恢复受批准的原始旧地址，再由同一显式 legacy route 归一化；登录、自循环与外部地址不进入 history。
- 认证、must-change、ADMIN 权限、canonical 资源错误和根 404 继续由各自既有 boundary 持有。
