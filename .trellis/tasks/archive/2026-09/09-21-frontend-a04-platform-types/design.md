# A04 设计边界

- 分类页保持既有 Settings 导航层级；query key 与 route 只持有 canonical 列表筛选分页。
- 删除确认读取当前 exact projection 的引用数/blockers；服务端阻断原因原样映射为安全可读错误。
