# Frontend V2 Phase 9 Production Snapshot Sanitization 设计

## 1. 设计结论

采用一次性、任务内的 sanitizer，而不是修改产品代码或建立通用平台。它只对 quarantine database 工作，使用显式字段矩阵和 PostgreSQL 事务；独立 verifier 对 sanitized state 做 fail-closed 检查。sanitized dump 必须在 fresh verify database 重新恢复和验证后才能交给父 Task。

## 2. 数据流与信任边界

    production PostgreSQL
      -- approved read-only pg_dump -->
    encrypted raw SQL.gz
      -- restore -->
    quarantine database
      -- task-scoped sanitizer transaction -->
    sanitized quarantine state
      -- pg_dump -->
    sanitized SQL.gz
      -- restore -->
    fresh verify database
      -- verifier + aggregate profile -->
    parent manifest

production object storage 不在数据流中。raw/sanitized object namespace 都不复制 production payload。

## 3. Source owner

- production role 是本 Task 唯一 source owner，只用于 catalog inventory 与 pg_dump。
- role/session 必须证明 read-only、非 superuser、非 replication、无 role creation、无 temp/create 与无 table write grants。
- export 使用强制 read-only session 和受控 pg_dump 版本；数据库审计按 export role/window 检查只出现允许的 catalog/SELECT/COPY 行为。
- source 是在线系统，不能要求业务表 pre/post 相等；本 Task 的零写入结论只针对 export identity，不夸大为 production 零变化。

## 4. 隔离拓扑

同一专用临时私有主机允许一个受控 PostgreSQL cluster，但使用三个不同 database/role：

1. quarantine_<run-id>：raw restore 与 sanitizer；
2. verify_<run-id>：sanitized dump fresh restore；
3. rehearsal_<run-id>：父 Task 后续另行创建，本子 Task无权限。

database roles 无跨库 grants；quarantine/verify 不运行应用服务。磁盘加密、0600 artifact、私有管理入口、无公网监听和 egress deny 是创建前硬门禁。

## 5. Sanitizer owner

预计新增：

- research/sanitization-matrix.md：当前 0043 schema 的字段分类与变换合同；
- research/sanitize_snapshot.py：唯一 task-scoped executable，提供 self-check、sanitize 与 verify 子命令；
- research/evidence.md：只记录命令身份、聚合、checksum 与 Gate。

脚本复用当前 backend Python/psycopg/SQLAlchemy 与项目安全函数，不新增 dependency。它不成为 deploy 产品脚本，不接受任意 schema/version，也不支持候选路径或 fallback。

安全 guard：

1. 只读取 QUARANTINE_DATABASE_URL 或 VERIFY_DATABASE_URL；没有任何 source DSN 参数。
2. 要求数据库名、run ID、alembic revision 和 schema signature 精确匹配。
3. 对业务 schema 取得 advisory lock，设置 statement/lock timeout。
4. 在一个事务内执行；结束前运行内联硬断言，任一失败 rollback。
5. 所有 SQL 参数化；developer output 只含字段名、count、boolean、revision 和 checksum。

## 6. 字段策略

| 类别 | 策略 | 保留目的 |
| --- | --- | --- |
| UUID/外键 | 保留 | 关系、fan-out、identity 路由 |
| enum/status/revision/timestamp/numeric | 保留 | 状态分布、排序、冲突与规模 |
| user identity/password/session | 伪名、不可登录 hash、删 session | 保留归属，不保留身份/会话 |
| credentials/headers/ciphertext | 替换/清空并禁用 channel/model | 保证不可调用真实 provider |
| product/content/fact/prompt/GEO/publication text | 确定性无敏感文本，保留 null 与长度桶 | 保留页面形状与大字段负载 |
| URL/domain/request/provider identity | example.invalid 或清空 | 移除外部指向与关联标识 |
| JSON/JSONB | 按字段矩阵保留业务 key/enum，替换自由字符串叶 | 保留 read model 结构 |
| audit | 保留 action/outcome/time/FK，替换 message/details/request ID | 保留历史形状 |
| file metadata | 伪名 key/name/hash，保留 content type/size/status/FK | 保留列表/关系，不伪造 bytes |

所有 string/text/JSON/JSONB/byte-like 列必须在 matrix 出现；仅依赖字段名猜测敏感性是禁止模式。新增或未知列使 sanitize/verify 失败。

## 7. 数据 profile

只记录不泄密的聚合：

- 每张业务表 row count；
- status/account_type/classification 等登记枚举分布；
- created/tested/published 等时间跨度；
- 关键关系 fan-out 的 min/max/percentile；
- Markdown/text 的 null 比例与长度桶；
- file_records 的 category/content_type/status/size bucket；
- object payload copied 固定为 0。

不记录 min/max 原始字符串、样本、PII hash、正文片段或 URL。

## 8. 验证独立性

- self-check 在 disposable PostgreSQL 上注入已知 marker，覆盖普通 text、JSON、credential、URL、session、file metadata 和未知列。
- sanitize 事务中的断言防止部分提交；verify 子命令以独立查询再次检查。
- sanitized dump 必须恢复到 fresh verify DB，再运行 verify 与 aggregate profile；不能只验证 quarantine 后直接交付。
- 父 Task再次校验 dump checksum 与 verifier，形成传递式但不共享凭据的消费合同。

## 9. Cleanup 与失败

- sanitizer 或 verifier 失败：rollback、停止、不生成可消费 manifest。
- export/restore/checksum/schema 失败：保留现场，仅输出非敏感诊断。
- raw dump、quarantine、verify 删除前逐项核对 run ID、database owner、path 和 checksum；需要单独授权。
- sanitized dump 是唯一允许跨 Task 保留的 artifact；父 Task未完成前不可自动删除。
