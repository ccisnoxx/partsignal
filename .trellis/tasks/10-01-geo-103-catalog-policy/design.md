# GEO-103 设计与责任边界

本任务依照已接受的 GEO-101 公共/数据库合同与 GEO-102 三表实现，不改变业务规则或接线 Router。

## 规范化与协议边界

`geo_catalog_normalization.py` 是 Catalog 文本、语言与 hostname 的唯一规范化实现。Schema 在请求信任边界调用它，未来写 Application Service 使用相同规范键；旧 Product 身份或发布平台域名规则有不同业务合同，不能误合并。idna 使用已安装 3.18 的 IDNA2008/UTS #46 non-transitional + STD3，并验证 ASCII A-label round-trip；无 DNS/HTTP。原始请求及规范化后长度都受约束，casefold 扩张不能写入超长键。

公共模型使用现有 ContractModel，unknown enum 与契约外字段显式失败。OWN_PRODUCT 与命名对象是闭合判别 union；类型和 Product 绑定不可由 PATCH 改写。PATCH 的非 nullable 字段可省略但不能传 null，因此使用不代表写意图的默认占位；唯一写意图是 model_fields_set / model_dump(exclude_unset=True)。未来 Service 不得用普通 model_dump 覆盖旧字段。parent_subject_id 和 language_code 的显式 null 是清空，省略是保留。JSON Schema 条件与最少属性元数据对齐根合同，不能只以未来 Router 未接线掩盖 shape 漂移。

## 领域策略与投影

`geo_catalog_policy.py` 是真实父子、字典候选歧义和角色动作的 owner。真实 parent_id/type 成对提供；未知类型、自引用、品牌/参考型号有父级以及产品连错品牌显式失败。停用品牌仍可构成合法类型。别名只比较完整规范字典键，去重全部活动候选；多个 Subject 命中抛出带候选 ID 的歧义错误，不选择对象或实现回答分析器。

引用值使用五项全部必填、非负且排除 bool 的领域计数，禁止默认零。projection 不统计数据、不把当前分页误当全量。ADMIN 的 ACTIVE/DISABLED、primary_task、Subject/子项动作与 blockers 来自同一策略；ENGINEER 保留业务 stage，所有动作为空且 deletion=null。投影只能提示 UI，未来命令仍必须服务端授权及锁内重验。

`geo_subjects.subject_out` 显式接收当前 Product、真实父级、全量子字典与一致引用计数，校验关联 identity 后逐字段转换 DTO；无 Session、懒查询、commit/flush 或 ORM mutation。OWN_PRODUCT 名称和 Product revision 从当前 Product 读取，Catalog 名称列必须 NULL；不暴露 facts_body_markdown。调用服务负责同一读取快照和批量加载，本任务不能以 ORM 关系隐式触发 N+1。

## 后续接线与恢复

GEO-104 才实现 DB 查询、事务、Product→品牌→Subject→子项锁序、CAS/revision、成功审计、数据库冲突精确映射及 Product/User 生命周期。此处没有幂等重放、Redis 载荷、外部调用或历史写入。无新数据库 revision；0044 与全部旧迁移保持字节不变，运行时策略可以随代码回退，数据库既有恢复仍用前滚修复或迁移前备份。
