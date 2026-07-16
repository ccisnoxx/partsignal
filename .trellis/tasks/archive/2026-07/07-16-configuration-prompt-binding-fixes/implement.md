# 实施计划

## 0. 实现前门禁

- [ ] 使用 `trellis-before-dev` 读取前端规范和本任务三份规划。
- [ ] 确认主工作目录位于 `main`，重新检查目标源码与测试没有新的并发修改。
- [ ] 记录现有视觉基线未提交改动，不覆盖、不暂存、不提交这些文件。
- [ ] 运行配置页面和布局目标测试，记录基线结果。

## 1. 修复渠道模型摘要

- [ ] 复用 `invalidateChannel(channelId, true)` 处理所有模型 mutation 成功回调。
- [ ] 确认模型发现结果仍只存在于获取模型弹窗，未添加或未启用模型不进入渠道摘要。
- [ ] 增加回归测试，锁定模型变更后渠道列表、渠道详情和模型列表缓存都被失效。

## 2. 调整 Prompt 管理

- [ ] 表格只使用 `prompt_configured=true` 的平台，空集合显示“暂无 Prompt”。
- [ ] 增加“新增 Prompt”入口，平台下拉只列出 `prompt_configured=false` 的平台，提交沿用现有 PUT 接口和 `expected_revision=null`。
- [ ] 保留既有 Prompt 的 Markdown 覆盖编辑，不允许在编辑时改绑平台。
- [ ] 删除成功后关闭编辑框并刷新相关查询，使 Prompt 行从列表消失；平台管理页继续显示平台缺少 Prompt 的状态。
- [ ] 更新配置页面测试，覆盖创建、编辑、删除和无 Prompt 空状态。

## 3. 删除侧栏说明

- [ ] 删除 `AppLayout` 中“事实可信 · 人工审核 · 历史可溯”节点。
- [ ] 删除 `.sider-note` 样式，不新增替代 footer、滚动逻辑或 `z-index`。
- [ ] 更新布局测试，确认配置子菜单仍可展开、选中且说明文字不存在。

## 4. 验证

- [ ] `npm --prefix frontend run test -- src/features/configuration/ConfigurationPages.test.tsx src/app/AppLayout.test.tsx`
- [ ] `npm --prefix frontend run test`
- [ ] `npm --prefix frontend run lint`
- [ ] `npm --prefix frontend run typecheck`
- [ ] `npm --prefix frontend run build`
- [ ] 使用浏览器检查 AI 渠道卡片启用模型、Prompt 新增/删除、短视口配置菜单和移动端导航。
- [ ] 不更新已有脏视觉基线；若视觉回归因此无法通过，报告受影响快照和剩余风险。

## 5. 收尾

- [ ] 检查没有新增 API、数据库字段、Prompt 绑定表、重复缓存 helper 或页面专属层级补丁。
- [ ] 检查现有方案文档仍准确；无需更新时在任务收尾中记录“仅修复前端展示与缓存，业务契约未变”。
- [ ] 提交前提供精确提交计划并取得用户确认，不包含现有视觉基线及其他无关改动，不自动推送。
