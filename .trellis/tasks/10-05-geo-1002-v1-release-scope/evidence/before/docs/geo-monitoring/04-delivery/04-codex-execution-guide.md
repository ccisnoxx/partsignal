# PartSignal GEO Codex 执行指南

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 目标 | 让 Codex 按单任务、契约优先、可验证方式扩展现有 PartSignal |

## 1. Codex 的工作单位

Codex 一次只执行一个 `GEO-NNN` 任务。一个发布阶段不是一个任务，一个页面也不一定是一个任务。

执行前必须具备：

- 任务 ID；
- 依赖任务均为 done；
- 当前任务未处于 deferred；延期任务必须先按恢复条件重新排期、核对授权和依赖，不能因前序 done 自动开始；
- 明确的需求/能力 ID；
- 相关业务和技术文档；
- 验收标准；
- 当前仓库基线可运行或已记录阻断。

当前核心路径为 R6 → R8；MANUAL 是正式采集方式，R7 为 post-core 扩展，依据[ADR-006](../05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)。deferred 是交付治理状态，不修改业务状态机，也不满足依赖的 done 条件。

## 2. 必读顺序

每个任务至少按顺序读取：

1. 根 `AGENTS.md` 和当前目录所有适用 `AGENTS.md`；
2. `.trellis/spec`、任务记录和仓库当前约定；
3. `docs/geo-monitoring/README.md`；
4. WBS 中任务行；
5. 任务引用的 PRD/业务/技术文档；
6. 相关 ADR；
7. 当前 `contracts/openapi.yaml` 和 `contracts/database.md`；
8. 相关后端/前端代码和测试。

不要仅凭任务标题开始写代码。

## 3. 权威性

### 3.1 目标语义

PRD、业务架构、领域模型、状态机和指标文档定义“应该是什么”。

### 3.2 当前实现

当前代码、迁移和 contracts 定义“现在是什么”。

### 3.3 实施任务

Task brief 定义“这一次改变什么”。

如果三者不一致：

- 不猜测；
- 在任务说明中列出差异；
- 只实现任务授权的迁移路径；
- 需要新决策时先创建/更新 ADR，不在代码里暗自选择。

## 4. 单任务执行流程

## 4.1 任务准备

```text
1. 检查依赖
2. 生成 Task Brief
3. 列出现有行为和目标行为
4. 列出明确不在范围内的内容
5. 定义验证命令
6. 运行基线测试
```

Task Brief 使用 `05-task-template.md`。

## 4.2 先检查现有实现

Codex 必须搜索：

- 相邻领域 service；
- 当前 Schema/ORM 归属；
- 类似状态机；
- query key；
- 现有 E2E；
- 数据库命名约定；
- 审计模式；
- 错误码和 constraint diagnostics；
- 是否已有部分实现。

不要重复建设已有 helper、状态机或 API。

## 4.3 契约优先

公共功能的顺序：

```text
更新业务/任务说明（需要时）
→ contracts/openapi.yaml
→ contracts/database.md
→ Alembic/ORM
→ Pydantic Schema
→ Application Service
→ Router
→ 前端 generated types
→ Frontend UI
→ E2E
```

数据层任务可以先写 migration draft，但在合并前必须完成契约和运行时一致性。

## 4.4 数据库规则

- 只使用 Alembic；
- 不修改历史 frozen migration/schema snapshot；
- 新约束使用稳定命名；
- mutable aggregate 使用 revision；
- 并发最终依赖数据库约束/行锁；
- `IntegrityError` 只按精确 SQLSTATE + constraint name 映射；
- 不按错误文本猜测；
- 迁移测试覆盖当前 head 前滚；
- 默认不实现 downgrade；
- 不用 SQLite 替代 PostgreSQL 约束测试。

## 4.5 后端分层

Router 只负责：

- HTTP 参数；
- 认证和权限依赖；
- response projection；
- AppError 映射。

Application Service 负责：

- 事务；
- 行锁；
- revision；
- 状态转换；
- 跨实体协调；
- 审计；
- 外部任务 dispatch metadata。

Collector 负责：

- 外部协议；
- 传输；
- provider 响应解析；
- 稳定错误。

Collector 不接收 ORM Session，不决定业务指标。

## 4.6 前端规则

- 类型只来自 generated OpenAPI；
- query key 有唯一 owner；
- 筛选、分页、选中对象放 URL；
- 表单草稿放组件状态；
- 状态机和 available actions 来自服务端；
- 不在前端计算指标；
- 复杂详情不跨接口 join；
- mutation 409 保留本地输入；
- 后台刷新保留上一成功数据；
- 不把 secret 放 localStorage/sessionStorage/console/query state。

## 4.7 异步和外部调用

- Redis 消息只携带 ID；
- Worker 每步重新加载数据库状态；
- 外部请求 at-most-once；
- 发送后不自动 retry；
- PENDING 可补投递；
- SENT/UNKNOWN 创建新 attempt 才可再次调用；
- 迟到结果不能覆盖终态；
- fake provider 才是 CI 权威；
- 不使用真实 provider 作为普通测试。

## 5. Codex 不得自行做的事

- 拆微服务；
- 引入 MongoDB、Kafka、向量库或新身份系统；
- 删除现有人工 GEO；
- 将旧 GeoObservation 原地改造成新 Run；
- 新增统一 GEO 总分；
- 改变指标分母；
- 将失败运行当作未提及；
- 将 point estimate 当成因果结论；
- 自动启用 Browser Collector；
- 绕过平台验证码/访问控制；
- 添加未批准第三方 SaaS；
- 在失败时静默回退到假数据；
- 为通过测试放宽安全边界；
- 修改无关代码“顺手重构”；
- 更新依赖大版本，除非任务明确要求。

## 6. 任务上下文包

给 Codex 的提示词应包含：

```text
任务 ID
目标
依赖完成状态
关联需求 ID
必读文档路径
当前实现文件
范围内
范围外
业务不变量
接口/数据变化
验收标准
必须运行的测试
```

不要把全部文档内容复制进提示词；提供路径并要求读取。

## 7. 推荐提示词模板

```text
请实现 PartSignal GEO 任务 <GEO-NNN>。

先读取：
1. AGENTS.md 和适用子目录 AGENTS.md
2. docs/geo-monitoring/README.md
3. docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md 中 <GEO-NNN>
4. <列出任务相关文档>
5. contracts/openapi.yaml 与 contracts/database.md
6. 当前相关代码与测试

约束：
- 只实现该任务；不得提前实现后续任务
- 契约优先
- 保持模块化单体、PostgreSQL 权威、Redis 只传 ID
- 不改变已批准指标和状态机
- 不引入新依赖，除非任务明确批准
- 不使用真实外部平台作为测试

开始编码前输出：
- 当前行为
- 目标行为
- 计划修改文件
- 数据/接口迁移
- 测试计划
- 明确范围外

完成后输出：
- 实现摘要
- 关键不变量如何保证
- 迁移与契约
- 测试命令和结果
- 未完成/后续任务
```

## 8. 基线命令

通常先运行：

```bash
make contract-check
make lint
make typecheck
make test-unit
```

涉及 PostgreSQL、Worker、迁移或 E2E 时：

```bash
make test-integration
make e2e
make build
```

阶段完成时：

```bash
make verify
```

若环境不能运行某命令，必须记录具体阻断，不能写“应当通过”。

## 9. 测试要求

每个任务至少包含：

- 正常路径；
- 边界；
- 非法状态；
- 权限；
- revision；
- 数据库最终防线；
- 错误码；
- 敏感信息；
- 需要时并发；
- 页面 loading/empty/error/conflict；
- 与现有功能回归。

涉及公式：增加金标。涉及外部调用：增加调用计数和失败矩阵。涉及文件：增加真实字节和 HEAD/哈希。涉及 Browser：仅本地模拟站进入 CI。

## 10. 变更规模控制

一个任务如果同时出现以下三项以上，应拆分：

- 新增多个聚合；
- 多个 Alembic revision；
- 20+ 公共 endpoints；
- 后端和三个以上页面；
- 新外部 provider；
- 新指标体系；
- 大规模历史迁移；
- 新部署服务。

拆分后保持原任务为 Epic，新增子任务并更新 manifest。

## 11. 代码审查清单

```text
[ ] 是否只实现任务范围
[ ] 是否更新契约
[ ] 是否保持数据库约束和应用错误一致
[ ] 是否存在前端第二套状态机/公式
[ ] 是否存在 N+1
[ ] 是否有 secret/正文日志
[ ] 是否有发送后 retry
[ ] 是否有失败静默回退
[ ] 是否破坏旧人工 GEO
[ ] 是否更新测试和文档
```

## 12. 完成报告格式

Codex 最终报告应包含：

### 实现

- 修改了什么；
- 用户可见结果；
- 业务不变量。

### 契约和数据

- OpenAPI operation/schema；
- Alembic revision；
- 约束/索引；
- 数据迁移。

### 测试

- 实际运行命令；
- 结果；
- 未运行项及原因。

### 风险

- 已知限制；
- 是否需要后续任务；
- 上线/开关说明。

不要只列文件名，也不要宣称未运行的测试通过。

## 13. 任务状态更新

任务完成后：

1. `task-manifest.yaml` status 更新；
2. Trellis 任务归档（如项目继续使用）；
3. 追踪矩阵标记实现/测试；
4. 相关文档状态更新；
5. ADR 后果如有新信息，追加说明，不改写历史；
6. 记录 commit/PR 和验证证据。
