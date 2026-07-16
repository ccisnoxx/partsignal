# 技术设计

## 设计结论

复用现有 `platform_profile_versions` 表、状态机和激活服务，不新增“规则库”、规则名称、共享绑定表或 `current_rule_id`。平台的当前规则继续由该平台唯一的 `ACTIVE` 版本推导；独立管理只调整契约查询能力和前端信息架构。规则在 `DRAFT` 阶段可编辑，进入 `ACTIVE` 或 `RETIRED` 后不可原地修改。

现有表已经具备 `platform_profile_id`、同平台现存版本号唯一约束、`status`、`rules`、`revision`，并有“每个平台最多一个 ACTIVE”的 PostgreSQL 部分唯一索引，不新增表或字段。但 `0003_content_planning` 的 `partsignal_guard_platform_version()` 会拒绝任何 `rules` 更新，因此新增最小迁移 `0015_platform_rule_draft_editing`：只在更新前后状态均为 `DRAFT` 时允许修改 `rules`，继续冻结 `platform_profile_id`、`version`、`created_at` 以及 `ACTIVE`、`RETIRED` 的规则正文。版本仍按现存最大值加一分配；物理删除最高版本后展示用 V 编号可能复用，稳定身份和审计关联始终使用 UUID。本任务不为已删除配置增加永久计数器。

## 模型摘要诊断边界

当前正式环境数据库、后端投影和部署前端资源都只会产生一条已启用模型摘要，且现有前端模型写操作会同时失效渠道详情、渠道列表和模型列表 Query，不能据此继续修改生产逻辑。

实施时先用管理员登录态、在不写入正式配置的前提下捕获同一会话的证据，并写入任务内脱敏 `evidence.md`：

1. 北京时间、页面 URL、目标渠道 ID 和当前发布版本。
2. 渠道卡片“已启用模型”的 DOM 文本集合。
3. `GET /api/v1/ai-channels` 对应渠道的 `enabled_models` 集合。
4. `GET /api/v1/ai-channels/{channel_id}/models` 中每条模型的 `model_id`、`is_enabled` 和 `test_status`。
5. 当前文档加载的带哈希脚本和样式资源名称。
6. 正常刷新、退出后重新登录的复核结果；若 DOM 与 API 不一致，再记录禁用缓存重载前后的资源哈希，但不得把清缓存本身视为修复。

证据只保存上述集合和标识，不保存 Cookie、CSRF、API Key、敏感 Header 或无关响应字段。写路径的新增、测试、启用、停用和删除由自动化与本地 E2E 覆盖，不在正式环境制造验收数据。

判断规则：

- DOM、API 摘要和模型明细集合一致：不修改模型业务代码，只补自动化回归和部署验收记录。
- API 摘要与模型明细不一致：先用 PostgreSQL 权威行确认是投影错误还是模型写路径错误，为该根因补一个可失败回归后，只修改共同所有者。
- API 摘要正确而 DOM 错误：对比浏览器实际资源哈希与部署发布版本，为可复现的资源或客户端生命周期问题补回归，再修复部署/前端根因；不增加前端二次过滤和模型 N+1 查询。
- 无法稳定复现：保留证据并停止模型代码修改；平台规则与事实版本工作可继续，不以猜测阻塞其他已批准范围。

模型修复门禁只有一个：没有“修复前失败、修复后通过”的证据或自动化用例，不提交模型业务逻辑、缓存或部署改动。

## 契约调整

### 平台创建

`PlatformProfileCreate` 删除 `rules`。`POST /api/v1/platform-profiles` 只创建平台身份、所属类型和允许域名，响应允许 `active_version=null`。

这是内部管理端契约的直接替换，不保留同时接受旧 `rules` 的兼容分支。前后端必须在同一版本发布。

### 规则查询

新增管理员接口：

```text
GET /api/v1/platform-profile-versions
```

返回全部真实规则版本，沿用 `PlatformProfileVersionList`。`PlatformProfileVersion` 增加必填 `platform_profile_id`，使前端可一次查询后按平台分组，避免逐平台 N+1 请求。结果按平台名称升序、同平台版本号降序排列；`platform_profiles` 没有创建时间字段，不引入新的排序状态。现有按平台查询接口保留给已有明确平台上下文的调用。

### 草稿编辑

新增管理员接口：

```text
PATCH /api/v1/platform-profile-versions/{platform_profile_version_id}
```

请求体 `PlatformProfileVersionUpdate`：

```yaml
expected_revision: integer
rules: PlatformRules
```

服务端锁定目标版本，校验 revision 和 `status=DRAFT`，更新 `rules`、递增 revision 并记录 `platform_profile_version.updated` 审计。`ACTIVE`、`RETIRED` 返回明确的 `409 INVALID_STATE_TRANSITION`。

### 当前规则选择

不新增绑定接口。平台页选择某个本平台 `DRAFT` 后，继续调用：

```text
POST /api/v1/platform-profile-versions/{id}/activate
```

现有服务已经锁定平台并原子退役旧 `ACTIVE`、激活目标 `DRAFT`。前端下拉框只提供当前 `ACTIVE` 和本平台 `DRAFT`；服务端仍以版本归属和状态为最终权威。

### 事实版本删除

新增管理员接口：

```text
DELETE /api/v1/fact-versions/{fact_version_id}
```

成功返回 `204`。接口不要求先把 `APPROVED` 改为 `RETIRED`，状态不是删除权限来源；真正的边界是是否已经被内容历史引用。

冲突继续使用现有结构化删除错误：

```yaml
code: FACT_VERSION_IN_USE
details:
  references:
    - type: CONTENT_TASK
      count: 1
    - type: CONTENT_VERSION
      count: 1
```

只返回实际存在且数量大于零的直接引用。`FactReviewRecord` 不进入冲突响应，因为它随所属事实版本在同一事务中显式删除。

## 后端调整

- `create_platform_profile` 只创建 `PlatformProfile`，不再隐式插入首个规则版本。
- `platform_version_out` 返回 `platform_profile_id`。
- 管理员全局规则列表复用 `PlatformProfileVersionList` 和同一投影，按平台名称、版本号确定性排序，不引入第二份响应模型。
- `content_planning` 继续作为创建、编辑、激活和退役规则版本的单一生命周期所有者；新增 `update_platform_profile_version`，只允许修改 `DRAFT`。
- 继续复用现有创建草稿、激活、退役和受约束物理删除服务；不改变内容任务对 `ACTIVE` 版本和当前 Prompt 的门禁。
- 删除 `ACTIVE` 后仍不自动恢复历史版本，存在内容任务引用时仍返回结构化 `409`。
- 同步修正新近触及的模型、投影和方案文档中“所有规则版本均不可变”的表述，明确只有 `ACTIVE`、`RETIRED` 与任务/作业快照不可变。

## 事实版本删除服务

新增 `delete_fact_version`，执行顺序固定为：

1. 使用 `FOR UPDATE` 锁定目标事实版本，不存在返回 `404`。
2. 分别统计 `content_tasks.fact_version_id` 与 `content_versions.fact_version_id` 的直接引用。
3. 任一引用存在时返回 `FACT_VERSION_IN_USE` 和完整非零引用清单，不修改任何行。
4. 统计目标版本自己的 `fact_review_records` 数量。
5. 记录不包含快照正文或审核意见的删除审计摘要，包括产品 ID、版本号、状态和被清理审核记录数量。
6. 显式删除该版本的 `fact_review_records`，再删除 `fact_versions`，同一事务提交。

`0002_product_facts` 的通用 append-only 触发器会拒绝从属审核记录删除，因此新增最小迁移 `0016_fact_review_cleanup`：仅给 `fact_review_records` 替换专用触发器。服务在同一事务内通过 transaction-local `partsignal.fact_version_delete_id` 声明当前已锁定并通过引用检查的父版本；只有记录的 `fact_version_id` 与该值完全一致时允许 `DELETE`，`UPDATE` 和未声明/错配 ID 的删除继续拒绝。其他使用通用 append-only 函数的表不变，downgrade 恢复原触发器。

不修改外键为级联删除。这样直接数据库误删仍受 `RESTRICT` 和专用触发器保护，只有经过管理员服务且无内容历史引用时才执行开发数据清理。

## 前端调整

### 导航与路由

配置中心并列显示：

```text
平台类型 | 平台管理 | 平台规则管理 | Prompt 管理 | AI 配置
```

新增 `/configuration/platform-rules` 管理页，仅管理员路由可见。

新路由接入现有 `routeLoaders` 和 `routePrefetch` 注册表，避免绕过当前懒加载与导航预取所有者。

### 平台管理

- 新增平台表单移除全部规则字段，提交后平台显示“无有效规则”。
- 删除“创建后续版本”“管理版本”及嵌套规则弹窗。
- 平台页与规则页共享一个全局规则 Query 定义和 Query Key，不复制请求或本地规则集合。
- “当前规则”列改为下拉选择：当前 `ACTIVE` 作为已选项，本平台 `DRAFT` 作为可切换项；没有可选草稿时只展示当前状态和进入规则管理的入口。
- 选择草稿后调用现有激活命令，并同时失效平台列表和全局规则列表查询。

### 平台规则管理

- 一次加载平台列表和全局规则版本列表，在前端用 `platform_profile_id` 关联平台名称。
- 表格只渲染真实规则版本；删除成功后行消失，不为无规则平台制造占位行。
- 新增规则时选择所属平台并创建 `DRAFT`；把 `PlatformsPage` 现有规则字段移动到新页面复用，不复制或抽象出额外通用表单层。
- 仅 `DRAFT` 显示编辑操作；激活由平台管理页的“当前规则”选择完成。
- 删除继续使用现有结构化引用错误展示；删除当前 `ACTIVE` 后刷新平台列表，使平台显示“无有效规则”。

### 产品事实工作区

- `ProductFactsPage` 读取现有认证上下文，仅管理员在事实版本行看到“删除”操作；认证状态不得替换现有工程师事实维护能力或审核状态门禁。
- 确认提示明确说明会删除该版本及其审核记录，存在内容任务或内容版本引用时服务端拒绝。
- 删除成功后失效该产品的事实版本列表；失败使用现有 `DeletionError` 展示结构化中文引用。
- 工程师仍可执行现有事实维护和审核流程，但不渲染删除按钮。
- `DeletionError` 增加 `CONTENT_VERSION` 中文标签，继续消费服务端统一 `details.references`，不在页面维护第二套错误解析。

## 数据与历史兼容

- 不迁移、不复制、不重命名任何既有规则版本；历史 ID 和内容任务外键保持不变。
- 已有 `ACTIVE`、`DRAFT`、`RETIRED` 版本原样出现在独立规则页。
- 新平台可以没有任何规则版本，这是现有数据库和内容任务门禁已支持的状态。
- 规则版本 UUID 是稳定业务身份；V 编号只要求在同平台现存记录中唯一。删除最高版本后再次创建可能复用该展示编号，不影响现存列表、外键或按 UUID 保存的审计目标。
- 回滚旧应用不需要数据库降级；旧后端仍能读取无规则平台，但旧创建接口会再次要求首版规则。若明确降级 `0015`，只恢复原有“所有状态规则正文不可更新”的触发器，不改写数据。
- 事实版本删除保持当前 `RESTRICT` 外键；`0016` 只增加按父版本 ID 限定的事务本地删除门禁，服务仍显式处理从属审核记录并拒绝内容引用。
- 本次把“审核记录追加式”限定为正常业务生命周期；管理员显式删除无内容引用的开发事实快照时，该快照的审核记录作为从属数据一并清理。审计日志继续保留删除事件。

## 测试设计

- 后端 API：平台可无规则创建；全局列表返回归属并按约定排序；仅草稿可编辑；revision 冲突；激活原子替换；跨平台版本不能通过前端选择且服务端状态规则不变；删除引用边界保持。
- 模型摘要：构造“已启用”“测试通过但未启用”“未测试”和远端仅发现模型，断言渠道摘要只含已启用且已落库模型；模型各写操作后渠道列表 Query 与明细一致。
- 前端：独立规则页只显示真实记录；新增选择平台；草稿可编辑；删除移除行；平台页只列本平台草稿并调用激活；新平台表单不再提交规则；新路由参与加载与预取注册。
- E2E：管理员创建无规则平台、创建并编辑规则草稿、在平台页激活、创建任务可用、删除未引用当前规则后不可用；模型发现多个 ID 但只添加并启用一个时渠道卡片只显示一个。
- 事实版本删除：覆盖所有状态可删、审核记录同步清理、管理员权限、工程师拒绝、内容任务引用、内容版本引用、完整非零引用清单，以及清理全部版本后产品可删除。
- 前端事实页面：管理员按钮可见、工程师不可见但原事实维护能力不变、成功后行消失、结构化引用冲突正确展示。

## 文档同步

同一任务更新：

- `contracts/openapi.yaml`：请求、响应和新增接口。
- `contracts/database.md`：平台可先创建、草稿可编辑、当前规则仍由唯一 `ACTIVE` 推导、`0015` 触发器边界，以及事实版本受约束物理删除。
- `.trellis/spec/backend/database-guidelines.md`：稳定的规则生命周期、事实版本删除、从属审核清理和历史锁定约束。
- `docs/GEO多平台内容运营系统方案设计.md`：当前实现状态、领域关系、配置中心信息架构、开发数据清理边界和验收流程。
- `docs/GEO系统前后端技术与部署方案.md`：把“全部规则不可变”收敛为“草稿可编辑、激活后不可变”，同步事实版本删除和独立规则页面；不顺带清理其他历史表述。

## 风险与回滚

- 主要风险是前后端契约不同步；通过 `make contract-check` 和同版本镜像发布控制。
- 草稿编辑与激活并发由版本行锁、状态和 revision 校验控制，不添加额外锁或兼容分支。
- 事实版本删除与任务/内容创建竞争时，现有外键 `RESTRICT` 是最终保护；服务端在同一事务先锁定版本并统计引用，外键冲突不得被吞掉或转换为成功。
- 正式环境只做登录态只读证据采集；任何生产写入烟测都需要新的明确授权，不包含在本任务默认实施权限内。
- `0015` 与 `0016` 都只替换触发器且不改写业务数据。应用回滚不要求数据库降级；若显式降级，分别恢复旧触发器即可，历史规则、审核和任务无需数据恢复。
