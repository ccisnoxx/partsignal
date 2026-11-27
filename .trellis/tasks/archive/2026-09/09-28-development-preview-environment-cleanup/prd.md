# 开发预览环境定位、配置归属与Hostdzire清理

用户明确项目仍在开发，服务器仅用于查看界面/验证业务，要求本次清理、不重新部署。用户已选择永久删除测试数据，保留配置和旧冻结证据。

## 验收

- 仅清理已确认归属本项目的7容器、3网络、旧release/临时条目、测试数据库/Redis/上传数据和不被保护资源使用的项目镜像。
- 保留shared两份env及历史配置备份，原路径保留旧冻结目录/archive/manifest及image identities，不覆盖、不retag、不新建release。
- 其他9容器、共享TLS/ACME/Nginx不改变；预览入口关闭，所有应用路径410，无upstream，不进入Production maintenance/cutover状态机，不重新部署。
- 内部6项secret由本地首次准备工具自动随机生成，DATABASE_URL派生；用户只提供预览网址和实际测试所需外部服务信息。
- 新增完整38项staging模板、通用9项AI说明清单与逐字段中文说明；AI可在开发/预览页面配置，旧Production操作确认不成为开发前置条件。
- 既有staging harness验证自动生成/不覆盖/不泄漏/配置边界；必要静态检查与独立只读高风险review。
- 不提交/推送，不修改应用、schema或权限，不执行make verify、新release或部署。
