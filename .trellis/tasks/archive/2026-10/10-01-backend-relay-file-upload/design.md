# 文件传输边界

UploadIntent 保留现有 file/upload 结构，method 仅 PUT，url 是 `/api/v1/files/{id}/content` 相对路径，headers 指定 `application/octet-stream`，fields 为空。前端以 canonical API base 发送该路径的原始 File 字节，携带 Cookie 和 X-CSRF-Token；不得把令牌发送到意图携带的外部 URL。下载仍使用现有短期 OSS GET URL，本轮不改变下载和 Bucket 的访问语义。

后端先确认认证、权限、CSRF、意图创建者、PENDING 和有效期，再在 120 秒内接收实际字节。实际字节超过意图/类别上限即 413，短缺或 SHA-256 不符为 422；传输 Content-Type 仅 application/octet-stream，保存对象 Content-Type 取已校验意图。输入最多 50 MiB，不依赖 Content-Length 声明建立上限。

接收结束后锁定 FileRecord 行并重新检查状态、创建者、有效期，再执行 storage.put。complete 与 abort 使用相同行锁；已有清理 SKIP LOCKED 保持不变。存储写入失败返回 503 并保留 PENDING，可按现有 abort/清理恢复。对象键仍为服务端生成的 environment/category/year/month/UUID，客户端不提交任意目标。

复用 EvidenceStorage.put/head/download/delete，不新增存储客户端、依赖、持久化字段或状态。移除不再被业务调用的浏览器上传授权适配器接口。上传成功不等同于 VERIFIED，HEAD complete 仍为权威状态裁决。

部署模板只在 `/api/v1/files/` 路径将 body limit 从 10m 调整为 50m；同一 API upstream 和 proxy 策略保持一致。开发预览和既有通用站点模板同步同一文件大小边界，避免后端上传替代直传后丢失50 MiB合同；当前远端 Nginx 不重载，不创建/实施Production部署任务。


三个入口的错误恢复沿用真实基线：GEO/Publication可只重试complete；Logo当前transfer或complete失败均尝试abort，本轮不增加Logo恢复UI。
