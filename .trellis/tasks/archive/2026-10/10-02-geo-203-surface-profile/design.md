# GEO-203 数据契约设计

Surface 表达观测产品身份、合规与能力；Profile 表达一种固定模式的采集配置。与发布 PlatformProfile、AIChannel/AIModel 和问题变体保持独立权威。非敏感环境参数只存在 Profile.settings_json，public settings 显式转换；没有配置管理端点或第二份前端状态机。

采用标准 OpenAPI components、Pydantic collection_mode 判别联合、PostgreSQL 命名约束三层合同。MANUAL/BROWSER 两个 AI 引用均空；API 同空或同非空，MATCH FULL 复合 FK 精确引用 AIModel(id,channel_id)。不加入重复的独立 channel FK，AIModel 的既有 FK 保证渠道存在；避免两个 SET NULL 动作产生半绑定。AI 删除只成对解绑而保留 Profile，运行资格必须重新读取，不得拿遗留 PASSED 或无绑定配置推断运行许可。

闭合 settings 允许 MANUAL.require_screenshot、API.temperature/max_output_tokens、BROWSER.require_screenshot/answer_timeout_seconds，类型仅 bool/number/null 且有范围。不接收 header、Cookie、API key、secret ref、session path 或任意字符串/嵌套 JSON。Adapter 身份只验证格式，不建立 registry/资格，也不读取或复制 AI 凭据。website_url 是展示数据，不产生网络请求。

新配置默认停用/UNTESTED。两类资源有各自 revision，插入 0、实际变化 +1、no-op 保留 revision/updated_at；身份、创建追溯与 Profile Surface/模式固定。数据库不自动更新 revision，不拥有命令事务/审计；FK 成对 SET NULL 的嵌套触发器豁免只能改变两个绑定列，不能改其他字段。Surface 首引用锁存不可清除、已引用不能删除，但当前配置可演进；未来 Run 保存不可变配置快照和实际 RESTRICT 引用，不在本任务创建历史。

0046 冻结 SQL 而不导入运行时 ORM/Schema，只 expand 两表、函数、触发器、索引以及 AIModel 复合 UNIQUE；不修改旧数据。降级显式拒绝删除表，恢复使用前滚修复或迁移前备份。User 删除批量引用计数纳入两表，沿用 USER_BUSINESS_HISTORY 和真实 RESTRICT，不放宽现有权限/锁/审计。

详细列与失败定位以 contracts/database.md 为唯一权威。未来命令的角色、expected_revision 检查、资格、锁序和原子审计由 GEO-204/205 实施；本次不定义新的 HTTP mapper、幂等键、队列或外部调用。
