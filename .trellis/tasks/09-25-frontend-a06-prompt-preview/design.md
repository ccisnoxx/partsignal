# A06 设计边界

- 预览命令的 intent 绑定 Prompt、Task、模型和确认时看到的 revision；提交前重核可用 projection。
- 只持有服务端返回的 Job ID，并按明确 terminal 状态读取不可变 ContentVersion；未知状态显式失败。
- mutation 成功与后续 Job/Version 读取分离，读取失败不能重发真实生成命令。
