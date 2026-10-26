# 设计

- 采集事实归不可变 AnswerSnapshot：新增 nullable JSONB citation_observation，值为 {status, missing_reason}。无默认值/无数据回填；API 及历史记录保持 NULL。用数据库 CHECK 校验结构和 citation_count 组合；已有原文不可变触发器同时冻结新字段。
- Draft 复用 JSON 和修订锁；显式状态采用相同值对象。COMPLETE 必须有引用；NONE/UNKNOWN 无引用；PARTIAL 可保存已知引用。PARTIAL/UNKNOWN 原因非空 <=2000；其他状态原因必须为 NULL。UNKNOWN 有部分 URL 时须改选 PARTIAL，不自动删 URL。
- Submit 新命令在现有回执重放后要求显式 observation。optional wire 字段仅用于读取旧草稿和重放真实历史请求；未声明时 canonical JSON 省略新增字段，使旧 hash/no-op 不变。
- DTO->MetricRun 显式提取 status。PARTIAL/UNKNOWN 用现有 CITATION_OBSERVATION_UNAVAILABLE 排除三个引用指标；NONE 提供已观察无引用的依据；历史 NULL 不补造完整性并保留旧口径。分类完整性仍只检查已采集引用的分析结果。未改公式、样本门槛、AI 输入或分析版本。
- 前端在现有人工引用区增加显式选择和原因，旧草稿显示未记录；提交前给出字段错误，草稿可保留未记录。详情及冲突比较只读展示同一事实。
- 迁移 0070 仅加列/约束、扩展草稿校验；不更新旧行，降级拒绝丢失证据，使用前向修复或迁移前备份。服务端锁、文件生命周期、权限和事务边界沿用。
