# A02 设计边界

- 复用现有 Platform Detail query 与 route URL schema；确认首屏单读和 Tab 按需依赖。
- 写命令由当前 Detail revision 与每 Tab 私有草稿构造完整 `PlatformProfileUpdate`；冲突处理保留用户输入并显式恢复。
- Logo transfer 和官网候选不提前进入已保存投影；consumer invalidation 只覆盖实际依赖。
- 平台账号区属于 A03，本项仅确保 Accounts Tab 的路由交接与延迟读取边界。
