# GEO-106 验收设计

运行时能力与合同已在 GEO-101～105 接受，本次只补跨层证据。后端使用真实 PostgreSQL/TestClient，前端使用 canonical real-stack harness，不加通用封装或测试专用业务入口。

后端准备批准事实后比较整个 Product、所有 FactVersion 和 FactReviewRecord；Catalog 成功/唯一冲突均不得改变。真实 E2E 从页面建立 Product/批准事实，以页面提交 Catalog 操作，公共 API 最终核对。允许 Product deletion projection 新增 GEO_SUBJECT blocker，不将派生可用性混同于事实。

OWN_PRODUCT 唯一性限定活动身份，不承诺唯一历史行。域名仅精确 hostname/IDNA 规范化，不验证网络所有权。服务端 available_actions 控制入口；不新增状态机。
