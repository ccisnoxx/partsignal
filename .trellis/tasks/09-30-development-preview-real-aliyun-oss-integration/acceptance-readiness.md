> 最新进度：已按后续用户授权完成唯一文件API上传/下载，等待自然清理；UI因现有平台为空未执行。见[evidence/live-20261024T010420Z-b292543b/README.md](evidence/live-20261024T010420Z-b292543b/README.md)。以下保留此前准备阶段事实。

# 完整文件流程验收准备（2026-10-24）

本轮只完成现有源码与合同核对；没有上传对象、创建FileRecord或调用清理。真实验收仍未执行。本流程不依赖独立AMD64容量测试环境，但需要另行允许在选定环境写入本次测试文件及其记录；当前用户禁止线上业务写入，因此不启动现场步骤。

## 已核实的执行路径

1. 绑定候选SHA/image、环境和操作者，核对该候选包含现行后端中转实现；本地源码核对不能替代线上候选身份。使用已有获批账号和平台Logo上传入口，不保存平台表单、不绑定Logo，不导入Website候选，避免额外外部请求。
2. 使用唯一文件名的小PNG（小于2MiB），本地先记录字节数、SHA-256、MIME。正常UI发出 `POST /api/v1/files/upload-intents`，记录新file_id和返回相对路径；`PUT /api/v1/files/{file_id}/content` 以application/octet-stream传原始字节，预期204；`POST /api/v1/files/{file_id}/complete` 后才判定VERIFIED。PUT成功不等于验收完成。
3. `GET /api/v1/files/{file_id}` 核对状态、size/hash/type；`GET /api/v1/files/{file_id}/download-url` 获取限时链接，实际下载并比较字节/hash/type。UI本地blob预览不是OSS下载证据。签名URL、Cookie、CSRF和凭据不进入报告；只保留脱敏状态、时间和哈希。现行存储PUT明确设对象private，记录匿名/无效签名读取被拒绝，不因FileRecord.access_level=PUBLIC推断OSS匿名可读。
4. 未保存Logo表单意味着文件保持未引用。complete将PLATFORM_LOGO的cleanup_after设为verified_at+24小时；既有 `partsignal.cleanup_platform_logo_files` 每3600秒扫描。后续验收需留出到期及扫描/积压时间，不能把上传后即时未删除判为错误，也不能据到期时间推断实际删除成功。
5. 只跟踪本次精确file_id/object_key：实际到期清理后，记录DELETED墓碑、deleted_at、对象缺失、原下载链接不可取、新download-url请求409 FILE_INTEGRITY_FAILED。对象缺失若为403应记权限未知，不能伪称404/NoSuchKey。保留原记录，不能直接SQL改status/cleanup_after伪造自然回收。

## 清理边界核对结论

- `abort_file_upload`只允许PENDING；已VERIFIED文件不能用abort立即清理。
- `cleanup_file_records`没有file_id选择参数；batch_size仅限制数量，并不将清理限定为本次测试对象。不能把 `batch_size=1` 当作精确清理，也不能人为传未来now加速共享环境回收。
- 当前可行默认是等待既有到期扫描并对本次记录只读观察，不额外触发全局cleanup。该等待属于文件24小时保留策略，与Scheduler独立AMD64的24小时容量验收是两回事。
- 若后续验收必须即时精确清理，应先解决范围与真实入口；本轮没有据此扩展公共接口、修改清理服务或伪造墓碑。这是验收执行约束，不是已确认的产品实现缺陷。

## 证据字段（尚无现场值）

环境/候选/操作者/批准范围/时间；本地PNG大小与hash；file_id；意图/PUT/complete/GET状态码；VERIFIED字段；实际下载hash/type；匿名访问结果；cleanup_after与实际扫描时间；DELETED与deleted_at；对象缺失及下载拒绝；未触碰其他文件和未产生AI请求的核对结果。所有现场结果保持NOT_RUN，不用历史直接OSS探针或本地替身测试填充。

## 本轮核对依据

- [API路由](../../../backend/app/routers/files.py)：意图、content、complete、abort、记录读取和下载入口。
- [文件生命周期](../../../backend/app/services/file_records.py)：24小时保留、PENDING-only abort、无file_id选择的批量回收、DELETING→DELETED墓碑。
- [Worker](../../../backend/app/worker.py)：现有小时清理周期。
- [Logo UI](../../../frontend/src/domains/configuration/platform-workspace-page.tsx)与[传输函数](../../../frontend/src/shared/api/file-transfer.ts)：后端中转及blob预览。
- [存储实现](../../../backend/app/services/storage.py)：真实OSS对象private ACL。

既有源码交付及定向测试参考[中转上传实现记录](../10-01-backend-relay-file-upload/implement.md)。本轮没有源码变化，不机械重跑既有单测；未将这些历史测试升级为真实OSS完整流程通过。
