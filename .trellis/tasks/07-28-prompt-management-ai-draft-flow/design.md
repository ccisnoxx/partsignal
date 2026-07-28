# 优化 Prompt 管理与 AI 草稿创建：技术设计

## 1. 设计边界

本任务是纯前端修正。现有后端已经提供完整权威链路：

1. `GET /api/v1/content-tasks/{content_task_id}/generation-options` 返回任务平台当前 Prompt 与可用模型。
2. `POST /api/v1/content-tasks/{content_task_id}/generation-jobs` 接收模型、Prompt 身份和 revision。
3. 服务端再次校验任务为 `OPEN`、事实版本已批准且为 `PUBLIC`、平台和 Prompt 未变化、渠道与模型可用。

因此不修改 `contracts/openapi.yaml`、`contracts/database.md`、后端路由、服务或数据模型，也不增加前端兼容字段或默认值。

## 2. Prompt 管理

### 2.1 导航命名

将 `frontend/src/app/AppLayout.tsx` 中 `/configuration/prompts` 的唯一导航标签改为“Prompt 管理”。顶部上下文和全局导航搜索均由同一导航项派生，不另建常量。

页面内部“平台 Prompt”页签保留，因为它用于区分“平台 Prompt”和“全局自然化 Prompt”，不是页面名称。

### 2.2 绑定摘要

删除 `PlatformPromptsPage` 编辑器上方现有的大号 `Alert`。改为一个紧凑、无警告图标的绑定摘要：

- 有绑定：显示次级标题“使用平台”、真实数量和每个 `bound_platforms` 名称 `Tag`。
- 无绑定：显示“暂未绑定平台，可直接删除此 Prompt”的中性说明。
- 标签继续使用 Ant Design `Tag`；容器只消费 `--ps-*` 语义 Token。
- 不新增卡片组件，避免编辑器内部再次嵌套完整 `Card`。

局部样式继续放在 `frontend/src/styles/workspace.css` 的 Prompt 管理边界内，响应式允许标签自然换行，不产生页面级横向滚动。

## 3. 内容任务生成入口

### 3.1 阻断原因

`TaskDetail` 从已有权威查询派生唯一阻断原因：

- 任务不是 `OPEN`：历史任务不可继续生成。
- 事实查询加载中：显示加载状态，不提前允许操作。
- 事实查询失败：保留现有 `QueryFailure`，生成区明确提示需先恢复事实数据。
- 事实分级不是 `PUBLIC`：明确说明第三方模型出站门禁。

符合 `OPEN + PUBLIC` 时继续显示现有“生成 AI 草稿”按钮；点击后打开既有弹窗。不得仅依靠 `disabled` 表达阻断状态。

### 3.2 新任务引导

终态或事实分级阻断时，在 AI 生成卡片显示“新建内容任务”操作，并复用同文件现有 `TaskCreateModal`：

1. 用户选择产品、已批准事实版本和活动平台。
2. 创建仍调用现有 `POST /api/v1/content-tasks`。
3. `TaskCreateModal` 增加可选的创建完成回调；任务列表使用方式保持不变。
4. 详情页创建成功后导航到新任务详情。
5. 若创建表单所选事实版本为 `PUBLIC`，通过 React Router `location.state` 携带一次性 `openAiGeneration` 意图；新详情在真实任务和事实查询确认仍满足门禁后打开现有 AI 弹窗，并立即清除该导航状态。
6. 若事实不是 `PUBLIC`，只进入新任务详情并显示现有阻断说明，不自动打开弹窗。

该导航状态只是瞬时 UI 意图，不成为 URL、TanStack Query 数据或服务端业务状态；刷新不会重复打开。

### 3.3 弹窗与错误

保留现有弹窗及载荷，不复制生成逻辑：

- Prompt 正文只读展示。
- 模型选项只消费生成选项接口返回值。
- 没有模型时禁止提交并显示现有警告。
- Prompt 缺失或生成选项失败使用 `QueryFailure` 重试。
- `PLATFORM_PROMPT_CHANGED` 保留本地弹窗并要求重新加载。

## 4. 状态与兼容性

- 不新增全局 Store。
- 不新增 URL 查询参数。
- 不改变任务列表筛选、分页、路由或现有创建任务能力。
- 不改变普通用户和管理员权限；Prompt 配置仍只有管理员可写，内容编辑用户只能消费生成选项。
- 终态任务、历史内容版本和生成快照保持不变。

## 5. 回滚

改动只涉及前端 TSX、CSS 和测试。若出现回归，可恢复导航文案、绑定摘要 JSX/CSS 和详情页新任务引导；后端与持久化数据无需回滚。
