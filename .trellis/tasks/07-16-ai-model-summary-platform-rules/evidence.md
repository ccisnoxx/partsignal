# 正式环境 AI 渠道摘要脱敏证据

## 采集边界

- 采集时间：2026-07-16 17:53:37 CST（北京时间）
- 页面：`https://geo.962850.xyz/configuration/ai`
- 登录身份：管理员登录态；不记录账号凭据、Cookie、CSRF、API Key、敏感 Header 或无关响应正文。
- 操作范围：页面普通加载/刷新与 GET 响应读取。正式环境未新增、测试、启用、停用或删除任何模型或渠道。
- 发布标识：页面未暴露独立版本号，以入口资源 `index-o6FkeKTg.js` 和页面资源 `AIChannelsPage-D_SnulfT.js` 作为本次部署指纹。

## 首次登录态与普通刷新

目标渠道：`ds`（`5f664cef-d1f3-4a97-ae96-af0179191ced`）。

### 渠道卡片 DOM 集合

```text
enabled_models = ["deepseek-v4-flash"]
```

普通刷新后，渠道卡片仍只显示上述集合。

### `GET /api/v1/ai-channels`

- HTTP 状态：`200`
- 脱敏投影：

```json
{
  "id": "5f664cef-d1f3-4a97-ae96-af0179191ced",
  "name": "ds",
  "enabled_models": [
    {
      "display_name": "deepseek-v4-flash",
      "model_id": "deepseek-v4-flash"
    }
  ]
}
```

### `GET /api/v1/ai-channels/{channel_id}/models`

- HTTP 状态：`200`
- 脱敏投影：

```json
[
  {
    "model_id": "deepseek-v4-flash",
    "is_enabled": true,
    "test_status": "PASSED"
  }
]
```

### 页面实际加载的脚本与样式资源

```text
index-o6FkeKTg.js
index-E_EocXLn.css
ConfigurationLayout-DR_rjuxo.js
AIChannelsPage-D_SnulfT.js
PageHeader-iqaDWYmj.js
StatusTag-Bf1USFFu.js
index-BgjnOb0N.js
index-CETfHhlI.js
index-C3L1OqxY.js
DeleteOutlined-BbAmA3Ls.js
DashboardPage-DjRVKP5T.js
MetricTile-Bzs7iQ-c.js
ProductsPage-DUT2o7nI.js
TableRegion-BWO8YVia.js
index-DnSDTQbY.js
DeletionError-DtmnRoDq.js
```

资源集合来自渠道列表普通刷新时的实际网络响应；其中包含应用的路由预取资源。

## 重新登录复核

- 复核时间：2026-07-16 18:00:28 CST（北京时间）。
- 首次采集后正常退出，由用户自行重新登录；未读取或记录登录凭据。
- 渠道卡片 DOM：`enabled_models = ["deepseek-v4-flash"]`。
- `GET /api/v1/ai-channels`：HTTP `200`；渠道 ID、名称和 `enabled_models` 脱敏投影与首次采集完全一致。
- `GET /api/v1/ai-channels/5f664cef-d1f3-4a97-ae96-af0179191ced/models`：HTTP `200`；仍只有 `deepseek-v4-flash`，`is_enabled=true`、`test_status=PASSED`。
- 入口与渠道页资源指纹仍为 `index-o6FkeKTg.js`、`index-E_EocXLn.css` 和 `AIChannelsPage-D_SnulfT.js`，与首次采集一致。

## 最终分流

首次登录、普通刷新和退出后重新登录三次观察中，DOM、渠道摘要和模型明细的已启用模型集合完全一致，均为 `deepseek-v4-flash`；实际资源指纹也保持一致。没有模型业务逻辑、Query 缓存或部署资源错误的可复现失败证据，按门禁选择“不修改模型业务逻辑，只保留自动化回归和部署验收证据”。不把清缓存作为修复，也不增加前端二次过滤或模型 N+1 查询。

模型新增、测试、启用、停用和删除的一致性由受控本地 E2E 覆盖，未在正式环境执行写路径验收。
