# A11 设计边界

- Prompt Preview 与 Content Editor 正式生成使用不同 Content Task，避免首稿唯一位置相互遮蔽。
- Preview 通过用户明确选择 Test Context/模型并二次确认触发；验收 UI 展示服务端返回 Job 的 terminal 状态和其不可变 ContentVersion。
- AI provider 调用次数与 Usage 业务作业/成功数按实际命令精确断言；失败连接测试仍与业务生成分开计算。
- 真实 secret 只在写命令与受控测试清单中短暂存在，最终 artifact scan 和资源清理由真实栈入口持有。
