# A09 设计边界

- Models query key 与 channel ID 绑定且仅 active tab 启用；发现结果不进入持久/共享模型列表。
- 每个命令 intent 绑定 model ID、command 与当前 exact model revision；409 hold 按模型与命令隔离。
- 命令成功与消费者刷新分离，刷新失败只能重试读取，不重发模型命令。
