# 配置中心 Prompt 管理高保真复刻与功能闭环：实施计划

## 0. 开始门禁

- [x] 用户批准本次最终规划摘要后，运行 `task.py start`，任务进入 `in_progress`。
- [x] 重新确认主工作目录位于 `main`，记录并保护现有未提交改动；不创建分支、不提交、不推送。
- [x] 读取当前 `prd.md`、`design.md`、本文件、两份 context manifest、相关 spec 和所有研究文件。
- [x] 对即将修改的每个产品文件读取最新完整内容；在现有用户改动上增量实施，不覆盖并行成果。

## 1. 契约与并发根因

- [x] 在 `contracts/openapi.yaml` 为 `PlatformProfile` 增加必返可空 `prompt_updated_at`，为平台 Prompt DELETE 增加必填非负 `expected_revision` 查询参数；不增加预览端点。
- [x] 更新 `backend/app/schemas/configuration.py` 的平台投影类型。
- [x] 在 `backend/app/services/projections.py` 批量读取当前 Prompt 的 `updated_at`，统一派生 `prompt_configured/prompt_updated_at`；让详情复用该值，避免第二口径和 N+1。
- [x] 在 `backend/app/routers/configuration.py` 接收删除 revision；在 `backend/app/services/platform_configuration.py` 锁定后校验 revision，冲突显式 409，成功审计只记录 revision。
- [x] 更新所有仓内 DELETE 调用和测试，运行 `make contract-generate` 生成前端类型；未手改生成类型。

### 第一检查点

- [x] 定向集成测试证明：列表时间来自 Prompt 行；无 Prompt 为 null；正确 revision 删除成功；过期 revision 不删除、不写成功审计；管理员/CSRF 边界不变。
- [x] `make contract-check` 通过后再进入前端改造。

## 2. 页面结构与真实编辑闭环

- [x] 在当前 `PlatformPromptsPage.tsx` 上重构，不新建平行路由；保留管理员 `ConfigurationLayout`。
- [x] 接入平台列表服务端 `q/platform_type_id/page/page_size`，将 `tab/q/platform_type_id/page/page_size/platform_profile_id` 规范化到 URL；未配置平台仍显示和可选。
- [x] 复用平台 Logo、类型、ACTIVE 规则、`prompt_configured/prompt_updated_at` 和用户列表，显示真实更新人、状态与从规则派生的长度范围。
- [x] 新建 `PromptMarkdownEditor.tsx`：受控 textarea、同步行号、Unicode 字数/行数、显式保存状态、首次保存/按 revision 保存、平台删除入口；无新依赖。
- [x] 平台与自然化标签复用同一编辑器；自然化标签不显示平台列表和删除入口。
- [x] 实现保存成功基线更新、失败/409 草稿保留、重新加载当前值，以及平台/Tab/应用内路由链接/刷新离开保护。
- [x] 在页面内实现只读安全说明和当前平台规则深链；文案严格对应固定契约，不增加可编辑安全状态。

### 第二检查点

- [x] 前端组件测试覆盖 URL 搜索/筛选/分页/深链、未配置首次保存、更新人、dirty 状态、切换取消/确认、保存失败/409、删除409及自然化无删除。
- [x] 运行定向 Vitest、前端 typecheck 和 lint；修复后再接预览。

## 3. 真实输出预览

- [x] 新建 `PromptOutputPreview.tsx`，只消费现有内容任务、生成选项、内容版本、生成/自然化作业端点。
- [x] 平台模式按当前 `platform_profile_id` 读取任务，列出明显合格 OPEN/PUBLIC 候选；自然化模式读取 OPEN/PUBLIC 任务和合格 AI DRAFT/CHANGES_REQUESTED 来源。
- [x] 模型只来自所选任务 `generation-options`；无任务、源版本、Prompt 或模型时显示真实空态和现有入口。
- [x] dirty 时禁止生成；显式点击后用 `newIdempotencyKey()` 创建现有 Job，每 2 秒刷新任务级 Job 列表并按返回的 Job ID 定位，不重复创建、不请求含完整 `input_snapshot` 的 Job detail。
- [x] 成功后读取 `content_version_id`，用 `marked + DOMPurify` 渲染真实标题、摘要、正文和标签；全屏 Modal 复用同一 sanitized 内容。
- [x] 失败显示脱敏 code/summary；不自动重试、不调用确定性 fallback、不回显快照、凭据、Header 或 provider body。
- [x] Prompt 保存、Tab 或平台切换不改写旧预览；旧结果标明属于既有作业，用户显式再次生成获取新结果。

### 第三检查点

- [x] 组件测试覆盖平台/自然化请求载荷、幂等键、轮询终态、成功内容读取、失败/超时、无合格输入、dirty 禁用和 DOMPurify。
- [x] 扩展现有 E2E 真实数据流程；真实运行已完成平台预览和自然化预览并继续验证快照、超时失败及重试，整条跨模块用例随后在发布页 1024px 既有横向溢出门禁失败。

## 4. 高保真样式与可访问性

- [x] 在 `global.css` 追加 `prompt-management-*` 作用域样式，消费现有 Token；不写第二套主题变量或无关全局覆盖。
- [x] 完成 1581×995 首屏：184px 侧栏、现有顶栏、304px/自适应中栏/360px 三栏、10px 间隙、冷白玻璃表面、蓝紫主操作和 9–13px 高密度正文。
- [x] 对齐安全提示、平台行密度/选中态、编辑工具栏、行号/正文/状态栏、预览层级、安全说明、按钮和状态色。
- [x] 1200px 以下改为纵向工作台；375/768/1024/1440px 验证 Prompt 页面无横向溢出，核心操作、确认和焦点恢复有效。
- [x] 检查语义标题、label、aria-live、可见焦点、键盘 Tab/Select/Modal/Popconfirm 链及 reduced motion。

## 5. 文档、全量验证与审查

- [x] 更新 `contracts/database.md`、`.trellis/spec/backend/ai-configuration-guidelines.md`、`.trellis/spec/frontend/state-management.md`、`docs/GEO系统前后端技术与部署方案.md` 和 `docs/GEO多平台内容运营系统方案设计.md`；只描述当前实现，避免重复契约。
- [x] 对新增/实质修改的 Python/TypeScript 文件做中文注释、Docstring、日志和错误文本 touched-scope 检查；未给显然代码追加机械注释。
- [ ] 运行下列最小到完整验证，并记录真实结果：

```bash
make contract-generate
make contract-check
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/integration/test_publication_review_closure.py -k 'prompt'
npm --prefix frontend run test -- ConfigurationPages.test.tsx
make lint
make typecheck
make test-unit
make test-integration
npm --prefix frontend run build
```

- [x] 使用 Browser/IAB 启动并验证真实页面、控制台、URL 筛选、平台切换、dirty 确认、浅色/深色和响应式；未回退到 `playwright-cli`。
- [x] 在 1581×995 捕获实现截图，同轮 `view_image` 检查批准原型、最新桌面和移动截图；另验 375px、768px、1024px、1440px，并以 720 CSS px 验证 1440px 视口 200% 缩放的等效布局宽度。
- [x] 写 fidelity ledger，核对左导航、顶栏、标题/Tab/提示、平台栏、编辑器、保存/删除/dirty、输出预览、安全说明、颜色/字体/间距/圆角；完成首屏文案 diff。
- [x] 通过 Browser、组件、后端集成和真实 E2E 的组合验证平台搜索、筛选、分页、平台切换、两类保存/预览、全屏、删除、无配置、冲突、权限、模型失败/超时和规则入口。
- [x] 检查最终 diff：未引入第二 Prompt/预览来源、系统约束绕过、N+1、静默 fallback 或固定输出；目标文件与工作区其他并行改动已在交付说明中分开。

## 6. 风险与回滚点

- **工作区重叠风险**：目标契约、配置路由、平台投影、页面、样式和 E2E 当前已有用户改动。每一阶段先重读并只做小块 patch；不能可靠合并时停止。
- **DELETE 契约收紧**：后端、OpenAPI、生成类型、前端及 E2E 必须同批交付。第一检查点失败时整体撤回这组未提交改动。
- **真实预览副作用**：预览会产生合法 Job/DRAFT，UI 必须在触发前说明；回滚页面不能删除这些历史。
- **视觉密度风险**：不以固定高度裁掉内容；内部滚动和窄屏堆叠必须先保证可访问，再微调像素。
- **较重验证**：若完整 integration/E2E 因环境不可用而跳过，必须记录原因、已跑替代检查和剩余风险，不以静态判断代替。

## 7. 实施验证记录（2026-07-23）

- 通过：`make contract-generate`、`make contract-check`、`make lint`、`make typecheck`、`npm --prefix frontend run build`。
- 通过：Prompt 页面组件测试 26/26；后端 Prompt/权限/投影定向集成测试 3/3；完整后端单元测试 87/87。
- 通过：真实 E2E 已运行到并完成平台预览、自然化预览、不可变快照、Prompt 更新隔离、删除后显式失败、模型超时失败及重试；用例随后在发布管理页 1024px 横向溢出检查失败，失败点不在 Prompt 页面。
- 通过：Browser 在 1581×995、375px、768px、1024px、1440px、深色模式和 720 CSS px 等效 200% 缩放下验证 Prompt 页面无横向溢出；Prompt 页面无运行时错误。
- 未全绿：`make test-unit` 中后端 87/87 通过，前端 97/98 后仅 `PublicationsPage` 一项在默认 20 秒超时；该项以 60 秒阈值单独复跑通过（约 20.3 秒）。
- 未全绿：`make test-integration` 为 28 通过、12 失败，均由并行工作中的 `0023_platform_management` 新增 `is_active` 后旧 generation fixture 未赋值，以及 `0022` 降级约束名不一致触发；本任务定向集成测试通过。
- 非阻断提示：Vitest 的 jsdom CSS/伪元素能力警告与 Vite 主 chunk 超过 500 kB 警告仍存在，本任务未新增运行时依赖或平行设计系统。
