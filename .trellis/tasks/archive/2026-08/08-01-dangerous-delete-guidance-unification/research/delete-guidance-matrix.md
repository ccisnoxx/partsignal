# 危险删除说明权威映射

## 1. 结论

`PS-QA-202` 与 `PS-QA-203` 均是前端确认层说明问题。六类删除的资格、引用阻断、关联清理和状态失效已经由服务端实现持有；最小修复是在现有确认框本地翻译这些事实，不修改服务或建立共享删除规则。

## 2. 逐对象映射

| 对象 | 当前确认位置 | 服务端权威位置 | 已确认行为 | 文案缺口 |
| --- | --- | --- | --- | --- |
| 产品 | `frontend/src/features/product-facts/ProductsPage.tsx:63` | `backend/app/services/product_facts.py:190` `delete_product` | 删除产品及其当前事实工作区；事实版本、内容任务或 GEO 观测任一引用均返回 `PRODUCT_IN_USE` | 标题使用“物理删除”，正文未枚举三类引用 |
| 事实版本 | `frontend/src/features/product-facts/ProductFactsPage.tsx:157` | `backend/app/services/product_facts.py:253` `delete_fact_version` | 内容任务或内容版本引用会阻断；无引用时同事务清理从属审核记录 | 标题使用“物理删除” |
| GEO 人工观测链 | `frontend/src/features/geo-observations/GeoObservationsPage.tsx:301` | `backend/app/services/geo_observation.py:1666` `delete_geo_observation` | 删除目标所属的完整人工更正链及从属关系；无其他引用的证据文件进入既有延迟清理 | 正文使用“物理删除” |
| 平台 | `frontend/src/features/configuration/PlatformsPage.tsx:256` | `backend/app/services/platform_configuration.py:856` `delete_platform_profile` | 内容任务或平台账号引用会阻断；Prompt 模板不级联删除；历史不改写；解除的 Logo 文件按既有引用清理边界处理 | 标题使用“物理删除”，未直接说明删除的是平台配置 |
| 发布账号 | `frontend/src/features/settings/SettingsPage.tsx:168` | `backend/app/services/publication.py:309` `delete_platform_account` | 发布记录引用会返回 `PLATFORM_ACCOUNT_IN_USE`，不级联发布历史 | 标题使用“物理删除” |
| AI Header | `frontend/src/features/configuration/AIChannelDetailPage.tsx:433` | `backend/app/services/ai_configuration.py:571` `delete_ai_channel_header`；`:374` `invalidate_channel_models` | 删除 Header 后停用渠道及全部模型；全部模型置 `UNTESTED`，清空 `last_tested_at` 与 `last_test_error_summary`，revision 递增 | 只有标题，没有任何影响说明 |

## 3. 合同交叉核对

- `contracts/database.md:73`：连接、凭据或 Header 变化必须停用渠道并使全部子模型测试失效。
- `contracts/database.md:115-117`：事实版本删除只在无内容引用时允许，并显式清理所属审核记录。
- `contracts/database.md:189,211`：平台删除由内容任务和平台账号引用阻断，不级联或改写历史。
- `contracts/database.md:255-257`：GEO 删除以完整更正链为单位，无引用文件进入既有清理状态机。
- `.trellis/spec/frontend/component-guidelines.md`：危险操作必须使用业务语言，不把“物理删除”等存储实现术语写入菜单、按钮或弹窗标题。

## 4. 测试所有者

- `frontend/src/features/product-facts/ProductsPage.test.tsx`
- `frontend/src/features/product-facts/ProductFactsPage.test.tsx`
- `frontend/src/features/geo-observations/GeoObservationsPage.test.tsx`
- `frontend/src/features/configuration/ConfigurationPages.test.tsx`
- `frontend/src/features/settings/SettingsPage.test.tsx`

这些现有文件已经持有对应页面 fixture 和确认链，扩展原测试比创建新测试文件或 E2E 数据脚手架更小。真实浏览器的全站操作列和危险操作一致性留到七项完成后的集中回归。
