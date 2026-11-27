# GEO-201 设计

权威：contracts/openapi.yaml、contracts/database.md；实施范围见 prd.md。

保持 PromptVariant 一个聚合、一张表；新增 app/geo_prompt_variants.py 拥有无 I/O 的规范化/枚举，Schema 转换输入，ORM 保存内部规范合同。文本采用 NFKC 和 Unicode 空白折叠，保留大小写、标点、连字符与后缀；语言沿用项目的 2..16 字符语言标签 grammar，保存 lowercase；地区为显式两位 ASCII 代码，保存 uppercase（格式校验，不宣称 ISO 注册真实性）。优先级沿用领域模型的变体枚举，不把主题 P0/P1/P2 复制到变体。

PostgreSQL frozen immutable SQL normalization function 与 Python 相同；canonical CHECK 拒绝未规范文本，generated SHA-256 防客户端/SQL 任意指定 hash；唯一键包含五个语义维度并涵盖停用。first_referenced_at 由未来真实消费者写入，事务回滚即回滚标记；已有值不可清除/变更，历史后 immutable 语义，允许 true→false。身份与创建追溯不可更新。每次有效配置/标记变更 revision 必须恰好 +1；无效/纯 no-op 不允许凭空增加版本。updated_at 由未来 Application Service 设置，不由 ORM 隐式更新。

本次严格遵守用户“被运行引用后只能停用”；目标文档允许编辑影响未来的宽松叙述在当前 R1 说明中明确收紧，后续以新变体表达新语义。不建立永久兼容分支。

将新 RESTRICT 引用接入 QueryTopic/User 既有批量删除预检，主题列表引用摘要暂不扩展字段，deletion.blockers 已能准确表示新类别。没有变体新接口，不提前选择 GEO-202 工作区/读模型。
