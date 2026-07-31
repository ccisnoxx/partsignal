# 验收门禁恢复：技术设计

## 1. 边界

本任务只修测试、测试夹具、测试运行壳层、测试数据清理和与批准合同一致的文档/视觉基线。生产业务代码不是默认修改范围；若调查发现必须改业务代码才能让“测试基础设施”运行，先停止并重新评审任务边界。

## 2. 后端集成测试

### 2.1 Prompt 夹具

使用当前模型建立数据：

1. 创建 `platform_prompts` 模板，字段使用 `id`、`name`、`template_markdown`、`revision`、`updated_by`。
2. 创建或更新 `platform_profiles.platform_prompt_id` 指向模板。
3. 内容任务继续引用 `platform_profile_id`，由平台绑定解析冻结 Prompt。

不重新添加 `platform_prompts.platform_profile_id`，也不增加兼容分支。

### 2.2 迁移断言

- 对明确升级到某版本的测试断言该目标版本。
- 对 `upgrade head` 的测试从 Alembic 脚本解析当前 head，或断言当前已知 head `0033_task_owned_history_delete`，并在新增迁移时同步。
- 保留 downgrade 的数据与守卫验证，不只检查版本号。

## 3. 前端 E2E

### 3.1 24 表生命周期

为特殊表面使用明确关闭动作和可观察后置条件：

- 观测表单：点击可访问的关闭/取消控件，等待 dialog 不可见。
- 模型发现：同样等待 dialog 不可见。
- 导航下一表面前断言没有可见 Modal。

通用表格检查继续验证实际可见表面，不退化为源码字符串检查。

### 3.2 Trusted Types

优先复用生产构建产物与已有 Nginx CSP 检查脚本：

- 构建静态前端。
- 使用不注入 Vite React preamble 的静态服务或生产容器。
- 注入/读取权威 Nginx CSP，运行现有 Markdown 与 Ant 交互断言。

若现有生产容器已经包含正确 Nginx 头，直接对该容器运行测试，避免创建第二套 CSP。

### 3.3 合同与视觉基线

- Prompt DELETE 从列表或创建结果取得 `platform_prompt_id`。
- 工程师管理员页断言 403 可访问提示，不断言首页重定向。
- Prompt 截图只在确认当前页面稳定且无产品缺陷后更新。
- GEO 指标按已确认的 3 项正式口径同步测试与设计文档。

### 3.4 GEO 设计文档同步

以 `contracts/openapi.yaml`、`backend/app/schemas/geo_files.py` 和 `backend/app/services/geo_observation.py` 为当前实现依据，修改 `docs/GEO多平台内容运营系统方案设计.md`：

- 核心洞察指标统一为发现率、提及率、准确率。
- 工作台与运营验证指标使用当前 3 项，不再把推荐率、引用率列为当前洞察指标。
- 表现最佳排序改为准确率、提及率、发现率、观测次数。
- 表现下降改为上述 3 项任一项下降至少 10 个百分点。
- 原始人工观测中的推荐、引用事实和迁移前 `legacy_recommendation_rate`、`legacy_citation_rate` 边界继续保留，不把“3 项洞察”误写成删除底层事实。

OpenAPI、后端聚合和当前页面已经符合 3 项决定，本任务不为文档同步修改这些产品实现。

## 4. 数据清理

沿用现有 E2E setup/teardown，不建立新框架：

- 在运行上下文集中记录本次创建的 ID。
- 按依赖倒序清理普通配置和临时对象。
- 对合同禁止删除的历史只登记，不绕过数据库守卫。
- teardown 失败使测试失败或输出结构化清理报告，不能静默成功。

## 5. 风险与回滚

- 视觉基线更新可能掩盖真实回归：更新前必须人工核对 actual/expected/diff。
- 共享开发数据库可能已有非本轮对象：只按本次 run ID 清理。
- CSP 壳层变更可能增加 E2E 时间：只让 Trusted Types 项目使用生产壳层，不强迫所有快速 E2E 使用。
- 本任务改动均应限于测试/脚本/测试文档，可通过回退对应文件恢复；不得回退父任务报告。
