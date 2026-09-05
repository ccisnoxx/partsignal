# 超大稳定规范的上下文加载路由

## 背景

`task.py validate` 实测以下稳定规范超过当前 `context_injection.max_file_bytes=32768`，若直接登记到 JSONL，原生注入会截断：

- `.trellis/spec/backend/database-guidelines.md`：64582 bytes
- `.trellis/spec/frontend/state-management.md`：79884 bytes

## 强制加载要求

- Backend implement/check 子代理在修改或检查 backend 文件前，必须从当前工作区完整读取 `.trellis/spec/backend/database-guidelines.md`，不得只依赖 prompt 中的截断片段。
- Frontend implement/check 子代理在修改或检查 frontend 文件前，必须从当前工作区完整读取 `.trellis/spec/frontend/state-management.md`，不得只依赖 prompt 中的截断片段。
- 若无法完整读取对应文件，停止该支线并向主会话报告；不得凭截断内容猜测约束。
- 本文件只解决上下文传递，不复制或替代稳定规范；稳定规范仍是唯一权威 owner。
