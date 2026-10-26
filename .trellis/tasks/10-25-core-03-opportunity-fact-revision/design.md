# 设计

## 服务端所有权

原 fact-revision POST 不变。其 _product_scope 规则提为共享 saved_own_product_ids：优先按机会 subject_id 的冻结 OWN_PRODUCT 范围，否则读取该机会全部保存来源的 OWN_PRODUCT。命令与新选项读取共用同一规则，不使用当前Catalog或分页推断。

新增 GET /api/v1/geo/opportunities/{id}/fact-revision-options，沿 EngineerUser 与 RR/no-autoflush 读边界。返回 opportunity_id/revision、FACT_REVISION 可用token、合法且仍ACTIVE的产品ID/品牌/型号和as_of。不要求存在批准FactVersion；命令仍锁产品、校验范围并重验机会CAS。无迁移、外发或生产配置变化。

## 前端

机会详情新增局部表单，按服务端动作和同revision选项展示。沿现有表单/通知/DirtyGuard/principal-continuation模式，只接入事实修订，不改内容任务或发布修复流程。请求通过生成类型；回执核对行动类型、来源机会/revision、产品、目标及导航身份后提供服务端导航。

409保留选择并锁定旧基线，仅显式刷新机会与选项后重确认；未知结果冻结完整载荷和幂等键，显式核对同一请求；拒绝清除敏感显示。成功先保留回执，取消旧列表/详情/比较请求后失效相关缓存（含CORE-02汇总与产品事实）；刷新失败不重发已成功命令。

产品事实路由仅增加source_opportunity_id的规范化及返回链接，该参数只拥有导航上下文，不授予权限、不进入事实保存/审核载荷、不客户端join机会事实。原工作区独立读取/编辑/审核合同保留。

## 验证与恢复

针对新只读选项、共享scope拒绝/允许及已有fact POST运行PG/HTTP测试；前端覆盖状态/结果恢复，浏览器覆盖真实目标路由、键盘/响应式及事实工作区未被自动提交。回退本轮源码/合同即可，既有行动/批准历史不改写。
