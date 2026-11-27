# I01 实施顺序

1. 对照路由蓝图复核全部显式旧 route、query mapper、return-to owner 与当前测试。
2. 运行 route-local 与 return-to 单元测试；只有出现可观察合同缺口时修改生产实现或测试。
3. 在当前 production artifact 上运行 mobile/desktop legacy routing 验收，覆盖 direct/refresh/Back/Forward、认证、权限和错误边界。
4. 运行类型、静态检查和独立复核；检查 diff/工作树，记录证据并进入 I02。
