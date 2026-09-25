# A05 设计边界

- Prompt 列表与 Detail query 分离，Detail 不在首屏为每行补请求；URL 只持有 canonical 筛选与 prompt intent。
- Markdown 是唯一可编辑正文；保存成功接受 canonical response，消费者失效失败独立显示且不得重复提交。
- DirtyGuard 与 409 hold 属于 Prompt workspace owner，reload 成功才更新 revision baseline。
