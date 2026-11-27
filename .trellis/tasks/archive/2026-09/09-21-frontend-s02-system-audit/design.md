# S02 设计边界

- 仅由 Audit domain 持有列表与 Detail query key；行列表不为补字段访问 Users 或业务域。
- `logId` 作为 canonical detail intent，桌面/移动共用同一 Detail 投影与关闭焦点语义。
- 未知 metadata/detail 字段和服务端错误显式失败，不猜测、不降级成空详情。
