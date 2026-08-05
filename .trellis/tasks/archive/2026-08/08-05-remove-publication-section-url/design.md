# 技术设计

## 1. 边界与不变量

本任务删除一个贯穿数据库、API 和 UI 的无效字段，但不重构发布模块。保留以下权威边界：

- `platform_account_id` 表示本次发布使用的唯一账号。
- `final_url` 只在登记发布结果时产生，表示内容真实公开地址，并继续匹配 `PlatformProfile.allowed_domains`。
- 服务端继续负责账号归属、状态转换、revision、权限与输入校验；PostgreSQL 继续保护不可变身份和历史。
- 工作、核验、成果和问题的现有生命周期不变。

## 2. 合同与数据流

### 2.1 开始发布

```text
前端选择发布账号
  -> POST /api/v1/publication-works
     {content_version_id, platform_account_id}
  -> 服务端校验已批准内容、任务锁定平台、账号启用与归属
  -> 写入 publication_works（无 section_url）
```

创建请求键与现有唯一约束继续负责幂等和内容身份；幂等重放只比较仍属于请求合同的两个字段。

### 2.2 更新准备信息

```text
前端选择新账号并填写说明
  -> PATCH /api/v1/publication-works/{id}/preparation
     {platform_account_id, expected_revision, comment}
  -> 服务端锁行、校验 revision、状态、账号启用与平台归属
  -> 更新账号、revision，追加 PREPARATION_UPDATED 事件
```

不引入仅为保留原弹窗而存在的新字段；如果账号没有变化，沿用现有命令语义处理。

### 2.3 登记结果与读取

结果登记仍提交 `actual_title`、`final_url`、`published_at`、`expected_revision`、`comment` 与可选证据。工作列表/详情和发布成果详情删除 `section_url`，继续返回账号与最终 URL 等现有字段。

## 3. 数据库迁移

新增单个 0036 revision，`down_revision` 指向 `0035_business_workflow`：

1. 使用 0035 当前函数定义为基线，`CREATE OR REPLACE FUNCTION partsignal_guard_publication_work()`，只从准备阶段冻结条件删除 `section_url` 比较，保留其余所有守卫。
2. 删除 `publication_works.section_url`。
3. 不重建触发器；现有 `publication_works_guard` 仍调用同名函数。

必须先替换函数再删除列，避免已存函数体继续引用被删列。现存栏目地址数据按产品决定直接丢弃；其余行数据和关联对象不改写。

`downgrade()` 不重新添加不可确定恢复的非空列，也不制造占位地址，而是抛出 SQLSTATE `55000`，要求从升级前备份恢复。这与当前不可逆迁移策略一致。

## 4. 代码改动面

- 合同：从五类 OpenAPI schema 删除字段及 required 项，并重新生成 `frontend/src/shared/api/schema.d.ts`。
- 后端：删除 ORM 列、Pydantic 字段、创建/更新逻辑中的地址比较与域名校验、查询投影字段。
- 前端：删除两个表单中的字段、初始值、请求映射和详情展示；保留账号选择、说明与结果登记。
- 测试：更新当前发布流程 fixture 和请求断言；新增 0035→0036 迁移覆盖。旧 revision 的 fixture 继续携带当时合法的 `section_url`。
- 文档：更新数据库合同、发布工作台规范和系统方案设计；历史归档不改写。

## 5. 兼容与发布

这是有意的破坏性合同变更。数据库迁移、后端和前端必须作为同一版本发布，不提供双读、双写、可选字段或版本分支。部署前必须有数据库备份；部署失败时不能通过 Alembic 降级恢复被删值，只能回滚应用并从备份恢复数据库。

## 6. 取舍

- 选择直接删除而非改成可空：可空字段仍会保留无效合同、存储和分支，违背“完整移除”。
- 选择保留准备更新命令：更换发布账号仍是有效业务能力；只删除无效地址职责。
- 选择保留域名校验辅助逻辑：它仍用于 `final_url`，删除会削弱发布结果边界。
