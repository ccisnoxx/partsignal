# GEO-1010-UI 局部页面设计

## 权威与边界

现有 evaluate、Action、Retest preview/create、comparison/resolve/continue API 已覆盖所需合同，不改 OpenAPI/schema/领域规则。现有 detail 投影遗漏 ADDITIONAL_MONITORING：在既有 ADMIN/ENGINEER 与 IN_PROGRESS 门禁后返回该已有 token，使 UI 可尝试 preview；它不承诺可比，preview/create 仍拥有完整校验。无新 API、DDL 或迁移。前端只管理表单、请求身份与反馈；资格由 available_action_types/available_actions、preview、服务端提交重验拥有。

## 页面流程

机会工作台ADMIN显式评估 → 冻结created/reused/skipped/unavailable回执 → 机会证据与确认 → 选择产品/批准FactVersion/PlatformProfile创建ContentTask → 现有内容审核/人工发布 → 来源基线preview → 可比后明确确认RETEST → 运行中心人工观测 → 所选batch比较 → 填写依据显式resolve/continue。动作完成不自动解决，变化不证明因果。

评估使用显式UTC半开窗口、合法规则revision、ALL/FILTERED及Subject/Surface/Profile/Mode。产品以Subject现有产品关联展示；不添加不存在的product_id过滤。评估候选使用已有分页搜索读 API；Content Task 使用现有单一 creation-options 原子读模型，本地搜索其完整选项，不拼接产品/事实 API 形成第二套资格快照。比较只读服务端单个比较响应，不从Run重算。

## 状态与请求所有权

Query拥有服务端状态；URL拥有机会/比较批次选择；RHF拥有输入；组件拥有临时展开与确认。mutation禁止自动重试，幂等命令冻结key+payload。未知结果保留原身份，只由用户显式恢复；拒绝保留输入。409必须显式读取并重新确认，preview变化不能静默替换基线。Principal continuation与卸载生命周期拒绝旧主体及过期响应。

## 验证边界

模型/组件覆盖权限、范围与窗口、冻结请求身份、失败/冲突、不可比及过期响应。现有全前端unit/type门禁按brief执行；目标真实栈E2E改用正式管理员HTTP和页面Action/RETEST，不用测试seed执行被验收动作。隔离test栈显式开启evaluator，生产/DEPLOY/UAT不操作。
