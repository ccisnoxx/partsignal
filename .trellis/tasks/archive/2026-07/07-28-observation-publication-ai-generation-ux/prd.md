# 观测发布界面与可配置 AI 生成优化

## Goal

修正重新部署后暴露的观测、洞察、发布管理和内容任务体验问题；让已废弃的观测概念退出当前界面，让列表与详情交互协调一致，并建立可复用 Prompt 模板库、平台唯一当前绑定和可确认的 AI 生成弹窗。

## Background

- 新人工观测只保留互相独立的“发现、提及、准确性”，但历史只读投影仍向前端返回推荐和引用，列表、详情和筛选仍在展示这些已废弃概念（`frontend/src/features/geo-observations/GeoObservationsPage.tsx:105`、`:236`、`:354`）。
- 观测详情使用 Ant Design Drawer，但显式设置了 `mask={false}`，因此没有原生点击外部关闭行为（`frontend/src/features/geo-observations/GeoObservationDrawer.tsx:193`）。
- 平台表现对比的 GEO 平台列没有宽度和溢出约束（`frontend/src/features/geo-observations/GeoInsightsPage.tsx:221`）；发布记录的内容标题与实际标题采用不一致的宽度和长文本处理（`frontend/src/features/publications/PublicationWorkspace.tsx:511`）。
- 内容任务把 Prompt 和模型选择直接铺在页面中，只有手工录入使用弹窗（`frontend/src/features/content-tasks/ContentTasksPage.tsx:305`、`:441`）。
- 当前 `platform_prompts.platform_profile_id` 是主键，一个 Prompt 只能属于一个平台；平台通过独立端点直接编辑正文（`backend/app/models/configuration.py:59`、`backend/app/services/platform_configuration.py:398`）。
- 产品已确认采用“Prompt 模板库 + 每个平台单选当前 Prompt + 同一 Prompt 可被多个平台复用”。共享 Prompt 修改影响全部绑定平台，保存前必须明确展示影响范围。

## Requirements

- **R1 观测字段收敛**：观测记录列表、详情和筛选不再展示或提交历史推荐、历史引用；历史旧版数据及后端只读投影不物理删除。
- **R2 观测详情收起**：详情 Drawer 使用组件原生的外部点击关闭与键盘关闭能力；点击详情内部不得误关闭。
- **R3 平台表现列宽**：平台表现对比的 GEO 平台列具有稳定的宽度、截断和完整文本提示，相邻指标在桌面与窄屏下保持协调。
- **R4 发布记录布局**：内容标题与实际标题采用一致的长文本规则和清晰的宽度层级；状态、时间和固定操作列不被标题挤压。
- **R5 AI 生成弹窗**：点击“系统 AI 生成”先打开弹窗；弹窗只读展示任务平台当前绑定的 Prompt 名称、修订号和正文，用户只选择一个已启用且测试通过的模型，确认后创建生成作业。
- **R6 生成一致性**：前端提交用户确认过的 Prompt ID 和 revision；服务端创建新作业时校验平台仍绑定该 Prompt 且 revision 未变化，过期时明确拒绝，不静默改用新 Prompt。
- **R7 手工录入保持**：手工录入继续使用现有弹窗并创建人工 `DRAFT`，不依赖 Prompt、模型或生成作业。
- **R8 Prompt 模板库**：管理员可创建、查看、编辑和删除命名 Prompt；Prompt 正文继续是普通 Markdown，不增加变量、编排或默认值。
- **R9 平台唯一绑定**：平台创建和编辑时可从模板库选择零或一份当前 Prompt；同一 Prompt 可以绑定多个平台。绑定关系由 PostgreSQL 和服务端负责，前端不推断。
- **R10 共享影响与删除边界**：编辑已绑定 Prompt 前展示全部受影响平台；已被任一平台绑定的 Prompt 不可删除，必须先解除或切换绑定。删除平台不级联删除共享 Prompt。
- **R11 历史追溯**：新生成快照冻结 Prompt ID、名称、revision 和最终 system message；平台换绑或 Prompt 后续修改不得改写历史作业，旧生成快照继续只读可解释和按原快照重试。
- **R12 明确失败**：缺少绑定 Prompt、没有可用模型、Prompt 确认过期、共享 Prompt revision 冲突和删除被引用 Prompt时，返回明确错误；不得跨平台回退、自动换 Prompt、自动换模型或转为手工录入。

## Acceptance Criteria

- [x] 观测列表、详情与筛选中不再出现历史推荐和历史引用；历史观测本身仍可查看。
- [x] 打开观测详情后点击 Drawer 外部区域会关闭，点击内部不会误关闭，Escape 和关闭按钮仍可用。
- [x] 平台表现对比在 1440、1024 和 768 宽度下无页面级横向溢出，GEO 平台名称可查看完整文本。
- [x] 发布记录的内容标题、实际标题、状态和操作列在长短标题场景下保持可读、对齐，长标题可查看完整文本。
- [x] Prompt 管理可维护多份命名模板；平台创建或编辑时可选择其中一份，也可明确不绑定。
- [x] 一份 Prompt 可同时绑定多个平台；编辑时显示全部受影响平台，引用中删除返回明确冲突且数据不变。
- [x] 现有每个平台 Prompt 迁移为一份独立模板并回绑原平台，不按正文自动合并，不丢失正文、revision、操作者和时间。
- [x] AI 生成弹窗展示任务平台绑定的 Prompt 和可用模型；未选择模型不能提交。
- [x] Prompt 在弹窗打开后被换绑或修改时，原确认提交返回明确冲突；重新加载后才能使用新配置。
- [x] 新生成快照冻结 Prompt 身份、revision 和正文；共享 Prompt 后续变化不改变历史作业，旧 `content-markdown-v2` 快照仍可读取并按原快照重试。
- [x] 手工录入、自然化和现有内容审核发布流程保持可用。
- [x] 定向后端、前端和 Playwright 验收通过；不以全量测试作为本任务默认完成条件。

## Out of Scope

- 物理删除历史观测中的推荐、引用或旧版 API 字段。
- 允许内容生产人员在生成时改选其他 Prompt。
- 为单个平台同时启用多份 Prompt，或根据条件自动路由 Prompt。
- Prompt 变量、版本历史、审批流、A/B 测试、自动回退和专用“复制模板”动作。
- 重做观测、洞察、发布管理或内容任务页面的整体视觉系统。
- 改变模型、渠道、人工首稿、审核、发布和 GEO 历史的业务状态机。

## Risks and Constraints

- Prompt 所有权从平台一对一改为可复用模板，是数据库和公开 API 变更，代码、迁移、OpenAPI、生成类型和稳定规范必须同批更新。
- 共享 Prompt 的修改具有多平台影响；服务端 revision 乐观锁和保存前影响提示都不能省略。
- 旧快照不可改写。新快照采用明确的新契约版本，旧版本通过有限、显式的历史分支读取和重试，不增加模糊兼容。
- 迁移不自动按正文去重，避免把文本相同但业务含义独立的现有 Prompt 错误合并。
