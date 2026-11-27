# A08 设计边界

- 继续由 `ai-channel-workspace-page.tsx` 持有 Basic/Request 草稿与 canonical revision；secret/header Dialog 自有请求生命周期，不复用含明文的共享 MutationCache variables。
- 统一区分“本地命令成功推进 revision”和“显式 reload 获取服务端版本”；dirty 配置存在时，secret/header reload 不得把旧草稿与新 revision 混合提交。
- reload 只有成功且有有效 Detail 才清理冲突；失败保留草稿、baseline、request ID 和错误。
- 仅修改 A08 页面及直接测试/严格 fixture；不改 A09 Models、A10 Usage/Logs 或根合同。
