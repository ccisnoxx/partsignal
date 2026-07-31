# 产品验收缺陷修复：技术设计

## 1. 总体原则

前端只修改现有页面和共享样式，不新增组件框架、依赖或第二套表格抽象；后端只修正生成作业分支条件。四个缺陷分别修正各自的权威位置，保持业务请求和服务端合同不变。

## 2. GEO 打印尺寸链

先检查 print media 下 `.app-shell`、Ant `Layout`、`.app-content` 和 `.geo-insights-print` 的计算尺寸。修复应满足：

- 打印壳层和主 Layout 不再继承会把内容压缩为 0 的 flex 约束。
- `.app-content` 使用可打印宽度并取消不适用的 flex basis/min-width 限制。
- header/sider 隐藏后，内容直接占据打印画布。
- 保留现有 CSS 变量和白色打印表面。

不使用固定像素宽度，不为单一浏览器新增 UA 分支。

## 3. 内容任务产品列

当前问题集中在 `.task-title-cell { min-width: 180px; }`。实施时先通过失败 trace 和计算样式确认父子尺寸，再选择最小修正：

- 允许产品单元格父容器收缩到列宽，通常使用 `min-width: 0` 与 `max-width: 100%`。
- 为产品列提供明确、可压缩的 width，而不是让子元素撑开 `td`。
- 继续复用 `.table-cell-ellipsis` 和现有 Tooltip。

不修改全站 `.table-cell-ellipsis`，除非证据证明共享规则本身是根因且所有调用者都受益。

## 4. 取消任务弹窗

列表和详情使用同一交互规范：

- 保留自定义 Form 时，在表单底部使用主/次按钮组。
- 次按钮调用对应的关闭 state，不提交 Form。
- 主按钮保持 `htmlType="submit"` 和 pending 状态。
- 提交中是否允许关闭沿用现有业务行为，不新增隐藏回退。

若存在可复用的现有按钮布局样式则复用；否则使用 Ant `Space`，不创建仅服务两个弹窗的新组件。

## 5. 测试

- 扩展现有 `ContentTasksPage.test.tsx`，验证列表/详情取消按钮、无请求和焦点恢复。
- 使用现有 `compatibility.spec.ts` 三浏览器打印用例证明尺寸链。
- 使用现有真实 zoom E2E 证明产品列几何边界。
- 不修改断言来绕过问题，不删除 Tooltip 或真实 zoom。

## 6. 自然化作业分支

`_create_job` 只在原始生成分支要求 `platform_prompt_id` 和
`platform_prompt_revision`。自然化分支直接进入 `build_humanization_input`，由该权威
输入构建器在全局 Prompt 缺失时抛出 409 `HUMANIZATION_PROMPT_MISSING`。

不捕获断言、不补伪造平台 Prompt，也不改变原始生成 `content-markdown-v3` 快照。

## 7. 风险与回滚

- Print flex 修正可能影响普通路由：定向检查 screen media 下 AppLayout。
- 产品列收缩可能让文本更早省略：保证 Tooltip 和主身份仍可访问。
- 弹窗 footer 调整可能影响 Enter 提交：保留 Form submit 语义并测试键盘。
- 生成分支调整可能弱化原始 Prompt 门禁：单元与 E2E 同时验证原始生成快照和自然化缺失错误。
- 回滚按样式和弹窗局部改动即可，不涉及数据迁移或接口兼容。
