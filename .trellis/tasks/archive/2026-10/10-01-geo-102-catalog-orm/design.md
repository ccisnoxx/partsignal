# GEO-102 数据层设计

以 contracts/database.md Catalog 章节为详细权威，不复制第二份业务规则。

- `geo_catalog.py` 集中三个稳定聚合映射；按现有模型约定只映射标量和 FK，不用 ORM delete cascade 执行业务删除，不加入 Schema/Service/Router。
- 使用 `conv()` / Alembic `op.f()` 固定已批准名称，避免共享 naming convention 二次包装 CHECK。
- 父类型 CHECK 对两列显式判断 NULL，配合 MATCH FULL 与 UNIQUE(id,subject_type) 复合 FK 验证真实品牌类型；品牌不能有父级，天然避免多层环。
- 活动 Product partial unique 是创建/重新启用最终仲裁；字典唯一不排除停用 Alias，不引入全局名称唯一。
- DB 验证枚举、长度、基础 DNS 结构及非 IP；Unicode NFKC/casefold 和完整 IDNA round-trip 属于 GEO-103 信任边界，不新增 SQL 伪实现。
- 0044 内冻结所有 DDL，不读取运行时 metadata；只新增三表、索引与 Subject identity guard。没有旧行回填、开关或状态转换。downgrade 以 55000 拒绝，迁移失败事务回滚。
- Subject 的 revision/updated_at 保留未来服务权威；ORM 不自动增加版本，Alias/Domain 无独立版本。Product/User/父级 RESTRICT，聚合子项 CASCADE。

验证分工：metadata/公共枚举用单元测试；前滚、三表 metadata 差异、约束 NULL/实际父类型、身份不可改、删除/唯一竞争用隔离 PostgreSQL 16。独立复核针对这些数据库边界，主代理自查不能替代。
