# GEO-001 文档包纳入仓库与导航

## 基本信息

| 字段 | 内容 |
|---|---|
| GEO Task ID | GEO-001 |
| 发布增量 | R0 文档与基线 |
| 负责人 | 777 |
| 依赖 | 无；manifest 的 dependencies 为空 |
| 工作分支 | docs/geo-monitoring-v1（沿用开始时分支） |
| 状态来源 | [GEO task manifest](../../../docs/geo-monitoring/04-delivery/task-manifest.yaml) |
| 人工验收 | 2026-10-01，用户明确回复“已确认，批准” |
| PR / Commit | 尚未创建或提交 |

## 目标与依据

把已经复制的 GEO 文档包纳入本仓库文档导航，使全部文档可以从单一入口访问，并为人工验收提供链接和 SHA-256 校验证据。本任务不实现 GEO 业务能力，无独立 CAP / REQ 功能增量。

已读取根 AGENTS、仓库 README、Trellis 工作流及现有任务格式，并按以下权威资料限定范围：

- [GEO 文档入口](../../../docs/geo-monitoring/README.md)
- [文档治理规则](../../../docs/geo-monitoring/00-governance/01-document-governance.md)
- [WBS 的 GEO-001](../../../docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md)
- [任务状态与依赖清单](../../../docs/geo-monitoring/04-delivery/task-manifest.yaml)
- [Codex 执行指南](../../../docs/geo-monitoring/04-delivery/04-codex-execution-guide.md)
- [单任务说明模板](../../../docs/geo-monitoring/04-delivery/05-task-template.md)

manifest 的 required_docs 指向 PRD、领域模型、状态机、技术架构和执行指南；这些目标设计资料与五份 ADR 作为范围依据，原文和状态均保留。当前 contracts、GEO 源码、测试和迁移的归属已检查，本任务无需执行或改变相关业务行为。

## 开始时的状态

- 分支为 `docs/geo-monitoring-v1`，工作区只有根 AGENTS 的既有 GEO 规则修改和未跟踪的 `docs/geo-monitoring/`；保留这些已有内容。
- `docs/geo-monitoring/` 直接包含六个分层目录，共 31 个文件，没有额外套层。
- 原 README 声明的全部文档存在，但路径主要为代码格式，没有可点击的包内索引。
- 原始 SHA256SUMS 的 30 个内容文件哈希全部匹配，仅自身条目无效。
- GEO-001 为 planned，没有前置任务；其余任务不在本次范围内。
- `docs/` 和本任务目录没有适用子级 AGENTS；复用项目根规则和现有 Trellis 日期目录约定。

## 范围内与目标行为

- 根 README 链接 GEO 入口、实施路线图、WBS 和 manifest。
- GEO README 使用实际仓库路径，建立完整索引和可点击阅读顺序，说明目标设计与任务评审状态。
- 根 AGENTS 保留既有规则，补充文档任务验证与 review 状态要求；不复制执行指南正文。
- 检查包内相对链接，删除 SHA256SUMS 自引用，仅同步本次改动文件的哈希。
- 更新包内 CHANGELOG，按 Trellis 约定记录任务与验证证据。
- 交付验证后将 manifest 的 GEO-001 从 planned 改为 review；只有人工验收批准后才更新为 done。

## 范围外与不变量

- 不改变业务代码、数据库、OpenAPI、前端页面、依赖、部署或运行配置。
- 不实现 GEO-002 及下游任务；不改写产品范围、指标、状态机或 ADR。
- 不覆盖其他文档或已有工作，不进行无关格式化。
- 不调用真实外部服务，不运行无关代码质量门禁，不自动提交或归档。
- manifest 是 GEO 状态与依赖唯一权威；done 只能由人工评审确认。本次不会把已有 ADR 的 Accepted 字段解释为 GEO-002 已验收。

## 验收标准

- [x] 目录结构与 README 清单一致；文档根路径正确，没有多套层或缺失文档。
- [x] 所有文档及校验清单可从 GEO README 直接到达，新增仓库导航可用，包内相对链接无断链。
- [x] SHA256SUMS 不含自身，覆盖其他 30 个文件，SHA-256 校验全部通过。
- [x] 根 AGENTS 的原有内容保留，补充规则简短且能导航到指南。
- [x] GEO-001 经人工批准后为 done，其他 manifest 内容保持开始时的值。
- [x] 实际 diff、任务证据和工作区检查证明修改未越出文档范围。

## 验证计划与证据

仓库未提供 Markdown 链接检查工具；使用本任务目录内的 Python 标准库检查脚本，避免新增依赖。代码测试、Docker 和真实服务不属于 GEO-001 的验收边界。

从仓库根执行：

```bash
python3 .trellis/tasks/10-01-geo-001-documentation-navigation/check_links.py
git diff --check
python3 .trellis/scripts/task.py validate .trellis/tasks/10-01-geo-001-documentation-navigation
```

从 `docs/geo-monitoring/` 执行：

```bash
shasum -a 256 -c SHA256SUMS
```

实际运行结果、哈希更新范围、未跟踪文件空白检查和人工确认事项见 [验证记录](./validation.md)。

## 人工验收与后续

2026-10-01，用户在当前会话明确回复“已确认，批准”，完成 GEO-001 人工验收。manifest 的 GEO-001 更新为 done，Trellis 任务标记 completed，并同步受影响文件哈希。后续 GEO-002 的 ADR 评审由独立任务处理。
