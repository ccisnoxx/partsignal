# MAN-04 一键复制本次运行的冻结完整问题

## 目标与边界

在人工录入和运行详情的现有冻结问题全文旁提供“复制完整问题”，仅复制本次 Run 输入快照的 `prompt.prompt_text`，保持原文、首尾空白、换行及格式。当前题库、计划模板和 `canonical_question` 都不是复制来源。

复用现有 Button、Clipboard API 和页面内可访问文字反馈。复制仅由用户显式触发；权限拒绝、剪贴板不可用或写入失败时明确提示并保留可手动选择的全文。复制不会保存草稿、提交观测或向外部平台发送问题；切换 Run 后不沿用上次复制提示。

## 代码核对与实现选择

- `manual-editor-view.tsx` 的 `FrozenInput` 展示 `context.input_snapshot.prompt.prompt_text`；后端 `manual_entry_context` 直接验证并返回 `run.input_snapshot`，无需新增请求或协议。
- `run-detail.tsx` 已展示 `run.input_snapshot.prompt.prompt_text`，回答原文已有 `navigator.clipboard.writeText` 和 `aria-live` 文字反馈。
- 在 geo-runs 内共享冻结问题复制交互，两个页面分别传入本 Run 的快照原文，并用 Run ID 隔离临时复制状态；既有只读全文展示保留。
- 不变更 API、Schema、持久化、权限、状态机、后台任务、依赖或部署。

## 验收

- [x] 两处既有冻结全文旁有可由键盘触发的复制按钮。
- [x] Clipboard API 接收到完整快照 `prompt_text`，原样保留空白、CRLF/LF、列表、代码及符号；不会复制标题或重新读取当前题库/模板。
- [x] 成功、写入拒绝和 API 不可用均有明确反馈；失败后全文仍可见。
- [x] 复制不提交表单或触发业务写入；切换 Run 后旧完成回调不会污染新提示，新按钮复制新 Run 原文。
- [x] 完成必要的定向组件验证、类型检查、受影响文件 lint、差异与工作区保留核对，并更新父功能清单。

## 授权与证据边界

MAN-01～03 保持本地 `review`，不重复实施；本任务完成后也仅进入 `review`，不表示部署或用户验收。MAN-05/06 不实施。保留上传验收 `NOT_RUN_NO_EXISTING_PLATFORM`，不接入浏览器自动化、不创建平台、不操作线上、不提交/推送、不新增自动跟进、不重复检查 OSS 自然清理。只做本任务必要定向验证，所有既有未提交及暂存内容作为保留基线。
