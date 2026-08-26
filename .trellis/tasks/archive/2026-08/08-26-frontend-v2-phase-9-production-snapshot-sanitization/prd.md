# Frontend V2 Phase 9 Production Snapshot Sanitization

## 1. 目标与父依赖

在专用临时私有环境的 raw quarantine 中，对经批准的 production 只读 snapshot 执行一次性、可审计的字段级脱敏，交付可恢复、可验证且不含 production object payload 的 sanitized SQL dump。父 Task frontend-v2-phase-9-production-like-rehearsal 只有在本子 Task Gate=MET 后才能启动。

本子 Task 不运行应用 rehearsal，不向 clone 启动 API/frontend，不发布 artifact，也不接触 production 写权限。

## 2. 已确认事实与决策

- production source 仅允许单独授权的只读 inventory/export；DSN 和凭据不进入仓库、日志或 evidence。
- raw quarantine 与 sanitized verify database 分库、分 role；专用临时环境无公网入口，不复用 Staging/production owner。
- production object payload 零复制；raw/sanitized object namespace 均不得拉取 production objects。
- 当前 candidate schema head 为 0043_geo_platform_identity；source revision 不是该精确值时停止，不编写兼容 sanitizer。
- 父 Task只消费 sanitized dump、checksum、schema/data profile 和验证 evidence；不接收 raw dump、source DSN 或生产凭据。

## 3. 需求

### S1 Source 只读边界

1. 在任何 export 前冻结脱敏后的 source identity、数据库 revision、PostgreSQL/pg_dump 版本、只读 role grants、导出窗口和批准记录。
2. export session 强制 default_transaction_read_only=on；role 只允许 CONNECT/USAGE/SELECT/COPY 所需权限，不得有 CREATE/TEMP/DML/DDL、replication、superuser 或 role inheritance。
3. production 正常业务可能在窗口内变化，因此不以全库 pre/post 相等伪装零写入；以最小权限、只读 session 与数据库审计中该 export role 仅出现允许语句证明本任务零写入。
4. 只导出 PostgreSQL 逻辑 snapshot；不访问 production object storage。

### S2 Raw quarantine

1. raw dump 只写入已证明加密、权限 0600、容量足够的临时受控路径，记录字节数和 SHA-256，不记录行内容。
2. restore 只进入精确 run ID 的 quarantine database/role；quarantine 不启动 API、Worker、scheduler、frontend 或对象服务，且无 application egress。
3. quarantine 与 verify/rehearsal database、role、路径和 object namespace 均不同；任何身份不清即停止。

### S3 字段矩阵与 sanitizer

1. 子 Task新增一个 task-scoped sanitizer owner 和一份 sanitization matrix，不修改 ORM、migration、contracts 或产品服务。
2. matrix 必须覆盖 current schema 每个业务表的全部 string/text/JSON/JSONB/byte-like 字段；每项显式分类为 preserve、pseudonymize、redact、clear 或 delete。出现未登记表/列即失败。
3. UUID/外键、enum、布尔、数值、revision、状态、时间与关系默认保留，用于维持真实规模和业务形状；任何已知外部 identity/string 不在默认保留范围。
4. 用户 username/display_name 伪名化，password_hash 替换为不可登录的随机哈希，sessions 全删；原账号角色、启停、must-change、revision 与外键归属保留。
5. AI channel/model/header 的 credential、plain/encrypted header、base URL、request parameter、provider/request error 等全部替换或清空，所有 channel/model 强制 disabled/untested；不得保留可解密 production ciphertext。
6. Product、Fact、Content、Prompt、Publication、GEO、Platform、Audit 与 generation snapshot 中的人类正文、标识、URL、JSON string leaf、request ID 和错误摘要按字段矩阵替换为确定性无敏感值；保留 null/non-null、关系、状态和用于规模测试的长度桶。
7. file_records 的 filename/object_key/sha256 伪名化，关系、content_type、size 和状态保留；sanitized artifact 不含任何 object bytes。
8. sanitizer 只接受 QUARANTINE_DATABASE_URL，不接受 source DSN；在单一事务内执行，任何约束、schema drift 或验证失败整体回滚。

### S4 独立验证与输出

1. sanitizer 自带最小本地 self-check：在 disposable PostgreSQL fixture 中注入敏感 marker，断言 marker 清零、关系/计数/状态保留、未知列 fail closed。
2. 生产 quarantine 执行后，独立 verifier 只输出 counts、booleans、schema signature 和 checksum；不得输出原值、样本、hash of PII 或正文。
3. 从已验证 quarantine 生成 sanitized SQL.gz，再恢复到新的 verify database；重新运行 verifier、restore-verify 和 schema/data profile 对比。
4. 输出 manifest 包含 sanitized dump 路径、字节数、SHA-256、schema revision、sanitizer/matrix SHA-256、source/export identity、关键聚合、object payload copied=0 和 raw cleanup 状态。

### S5 Cleanup 与 Gate

1. raw dump、quarantine DB/role、verify DB/role、临时 secret 和 raw namespace 的删除均需精确授权；只删除 run ID 明确归属资源。
2. raw artifact/quarantine 未删除且未获明确隔离保留批准时 Gate=NOT_MET，父 Task 不得消费 sanitized dump。
3. sanitized dump 保留到父 Task 完成；其访问 owner、位置和保留期写入 manifest，后续删除由父 Task cleanup 单独授权。

## 4. 范围外

- application rehearsal、Frontend V2 artifact、浏览器 E2E、Staging/production部署或任何公网入口。
- production object payload 下载、文件正文 sanitizer 或真实文件体积分布验证。
- schema migration、业务数据修复、权限/状态机变化、通用 anonymization platform 或长期数据 pipeline。
- 自动 production 读取、资源创建/删除、commit、push、merge或 archive。

## 5. 验收标准

- [x] 父依赖、source、环境、对象和任务边界已获批准，无阻塞用户决策。
- [x] design.md 与 implement.md 完整，执行 manifests 已配置。
- [ ] source role/session/audit 证明仅只读 export，未输出或保存 DSN/凭据。
- [ ] raw dump/quarantine identity、权限、checksum 与无应用服务/egress 可验证。
- [ ] matrix 覆盖 current schema 所有敏感能力字段，未知表/列 fail closed。
- [ ] self-check 证明 marker 清零、约束/关系/计数/状态保留和事务回滚。
- [ ] production quarantine sanitizer/verifier 与 fresh verify restore 全部通过。
- [ ] sanitized manifest 完整，production payload copied=0。
- [ ] raw/quarantine/verify 资源完成精确 cleanup，或得到明确隔离保留批准。
- [ ] Gate=MET 且 open P0/P1/P2=0/0/0；父 Task 才可启动。
